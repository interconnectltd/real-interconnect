/**
 * judge ハンドラ: Haiku LLM 4-text crossmatch (+10 score core)
 * SCORING_V2_ARCHITECTURE.md §3
 *
 * 入力: viewer_id × candidate target_ids[] (top-50)
 * 処理:
 *   1. user_conversation_vectors から viewer / targets の need_vectors / offer_vectors を取得
 *   2. 各 (viewer_need, target_offer) ペアについて 4-text crossmatch を Haiku に判定させる
 *      ① need.text × offer.text
 *      ② solver_profile × offer.text
 *      ③ need.text × beneficiary_profile
 *      ④ solver_profile × beneficiary_profile
 *      → max(4) + 15字 reason
 *   3. 同時に逆方向 (target.need × viewer.offer) も判定 (h_rv)
 *   4. judge_pair_cache に UPSERT
 *
 * コストガード:
 *   - 1 viewer / 1日 / 100 ペア超は SKIP & WARN (judge_quota_log)
 *   - top-N (default 50) を超える candidate は無視
 *
 * モデル: claude-haiku-4-5-20251001 (固定)
 *
 * プロンプトキャッシュ: 共通システムプロンプトを cache_control で 1 ブロック化、
 * バッチ間で再利用。50ペア=1 API call にまとめて (need.text × offer.text 行列を圧縮入力)。
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { supabase } from "../queue";

// 仕様: ANTHROPIC_API_KEY を優先、なければ既存 worker の AI_API_KEY にフォールバック
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
if (!ANTHROPIC_KEY) {
  console.warn("[judge] Neither ANTHROPIC_API_KEY nor AI_API_KEY is set; judge handler will fail at runtime.");
}

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_KEY ?? "missing",
});

const HAIKU_MODEL = "claude-haiku-4-5-20251001" as const;
const PROMPT_VERSION = "haiku-judge-1.0.0";
const TOP_N_DEFAULT = 50;
const PER_VIEWER_DAILY_CAP = 100;
const PAIRS_PER_LLM_CALL = 12;          // 1 API call で扱う (need × offer) ペア数
const MAX_TEXT_LEN = 220;               // 各テキストフィールドの安全上限
const MAX_PROFILE_LEN = 320;            // solver/beneficiary_profile の安全上限

// ---------- 型 ----------

interface NeedV {
  text?: string;
  solver_profile?: string;
  weight?: number;
  confidence?: number;
}
interface OfferV {
  text?: string;
  beneficiary_profile?: string;
  weight?: number;
  confidence?: number;
}

export interface JudgePairBatchPayload {
  viewer_id: string;
  target_ids: string[];
  /** 上位 N 件まで処理（既定 50, §3.4） */
  top_n?: number;
}

interface VectorRow {
  user_id: string;
  need_vectors: NeedV[];
  offer_vectors: OfferV[];
}

// Haiku が返す JSON 1行の Zod スキーマ
const judgmentItemSchema = z.object({
  need_idx: z.number().int().min(0),
  offer_idx: z.number().int().min(0),
  score: z.number().min(0).max(1),
  reason: z.string().max(60).default(""), // 多少長くても truncate するので緩めに
});

const judgmentResponseSchema = z.object({
  judgments: z.array(judgmentItemSchema),
});

// ---------- 共通システムプロンプト（プロンプトキャッシュ対象） ----------
//
// このシステムプロンプトはバッチごとの user メッセージを問わず固定なので
// cache_control: { type: "ephemeral" } を付与し、後続の API コールで再利用させる。
const SYSTEM_PROMPT = `あなたはビジネスマッチングの判定エキスパートです。
入力された (need, offer) ペアについて、「offer 側の人が need 側の人の課題を実際に解決できるか」を 0.0-1.0 で評価してください。

【評価基準】
- 0.9-1.0: 直接解決できる（例: VC 投資ニーズ × VC 自身）
- 0.6-0.8: 因果的に解決できる（カテゴリ違いでも解決関係が成立, 例: マーケ分析ニーズ × データ基盤オファー）
- 0.3-0.5: 部分的に役立つ（情報提供・紹介レベル）
- 0.0-0.2: 関係なし

【4 テキストクロスマッチ】
各ペアに以下 4 つの情報が与えられます。あなたは 4 つの組み合わせを総合し、最も解決関係が強いものを採用してください。
  ① need.text × offer.text
  ② solver_profile × offer.text
  ③ need.text × beneficiary_profile
  ④ solver_profile × beneficiary_profile
solver_profile = need 側が「どんな人に解決してほしいか」, beneficiary_profile = offer 側が「どんな人に役立つか」。

【出力】
JSON のみ。説明・前置き・コードフェンス禁止。各ペアにつき 1 行:
{"judgments":[{"need_idx":<int>,"offer_idx":<int>,"score":<0-1>,"reason":"<最大15字, 日本語>"}, ...]}

reason は 15 文字以内。「投資× SaaS 適合」のような短文。viewer のニーズを直接書かず、ターゲットの能力で表現する。`;

// ---------- メインハンドラ ----------

export async function handleJudgePairBatch(payload: JudgePairBatchPayload): Promise<void> {
  const { viewer_id } = payload;
  const topN = Math.max(1, Math.min(payload.top_n ?? TOP_N_DEFAULT, TOP_N_DEFAULT));
  const targetIds = (payload.target_ids ?? []).slice(0, topN);

  if (!viewer_id || targetIds.length === 0) {
    console.log(`[judge] noop: viewer_id=${viewer_id} targets=${targetIds.length}`);
    return;
  }

  // ---- コストガード: 日次 quota チェック ----
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const { data: quotaRow } = await supabase
    .from("judge_quota_log")
    .select("pairs_used")
    .eq("viewer_id", viewer_id)
    .eq("quota_date", today)
    .maybeSingle();
  const usedToday = (quotaRow as { pairs_used?: number } | null)?.pairs_used ?? 0;

  if (usedToday >= PER_VIEWER_DAILY_CAP) {
    console.warn(`[judge] WARN: viewer=${viewer_id} daily cap (${PER_VIEWER_DAILY_CAP}) already reached (used=${usedToday}). Skipping.`);
    return;
  }
  const remainingQuota = PER_VIEWER_DAILY_CAP - usedToday;

  // ---- viewer / targets のベクトル取得 ----
  const ids = [viewer_id, ...targetIds];
  const { data: rowsRaw, error: vecErr } = await supabase
    .from("user_conversation_vectors")
    .select("user_id, need_vectors, offer_vectors")
    .in("user_id", ids);

  if (vecErr) {
    console.error("[judge] failed to load vectors:", vecErr.message);
    throw vecErr;
  }

  const rowMap = new Map<string, VectorRow>();
  for (const r of (rowsRaw ?? []) as VectorRow[]) {
    rowMap.set(r.user_id, {
      user_id: r.user_id,
      need_vectors: Array.isArray(r.need_vectors) ? r.need_vectors : [],
      offer_vectors: Array.isArray(r.offer_vectors) ? r.offer_vectors : [],
    });
  }

  const viewerVec = rowMap.get(viewer_id);
  if (!viewerVec || (viewerVec.need_vectors.length === 0 && viewerVec.offer_vectors.length === 0)) {
    console.log(`[judge] viewer ${viewer_id} has no vectors; skipping`);
    return;
  }

  // ---- 各 target についてペアを構築・呼び出し・キャッシュ書込 ----
  let pairsBudget = remainingQuota;

  for (const tid of targetIds) {
    if (pairsBudget <= 0) {
      console.warn(`[judge] WARN: viewer=${viewer_id} hit daily cap mid-batch; remaining targets dropped.`);
      break;
    }

    const targetVec = rowMap.get(tid);
    if (!targetVec) continue;
    if (targetVec.need_vectors.length === 0 && targetVec.offer_vectors.length === 0) continue;

    // 順方向ペア: viewer.need × target.offer
    const fwdPairs: PairRow[] = [];
    for (let ni = 0; ni < viewerVec.need_vectors.length; ni++) {
      const need = viewerVec.need_vectors[ni];
      if (!need) continue;
      for (let oi = 0; oi < targetVec.offer_vectors.length; oi++) {
        const offer = targetVec.offer_vectors[oi];
        if (!offer) continue;
        fwdPairs.push({
          need_idx: ni, offer_idx: oi,
          need_text: clip(need.text, MAX_TEXT_LEN),
          solver_profile: clip(need.solver_profile, MAX_PROFILE_LEN),
          offer_text: clip(offer.text, MAX_TEXT_LEN),
          beneficiary_profile: clip(offer.beneficiary_profile, MAX_PROFILE_LEN),
        });
      }
    }

    // 逆方向ペア: target.need × viewer.offer
    // 同じ (need_idx, offer_idx) スロットに h_rv として書き込むため、
    // 順方向ペアと「重ねて」同じ row に格納する設計。
    // 仕様: judge_pair_cache.need_idx は viewer 側の need_idx, offer_idx は target 側の offer_idx.
    // 逆方向は別軸 (target.need_idx, viewer.offer_idx) なので別ペアセット。
    const revPairs: PairRow[] = [];
    for (let ni = 0; ni < targetVec.need_vectors.length; ni++) {
      const need = targetVec.need_vectors[ni];
      if (!need) continue;
      for (let oi = 0; oi < viewerVec.offer_vectors.length; oi++) {
        const offer = viewerVec.offer_vectors[oi];
        if (!offer) continue;
        revPairs.push({
          need_idx: ni, offer_idx: oi,
          need_text: clip(need.text, MAX_TEXT_LEN),
          solver_profile: clip(need.solver_profile, MAX_PROFILE_LEN),
          offer_text: clip(offer.text, MAX_TEXT_LEN),
          beneficiary_profile: clip(offer.beneficiary_profile, MAX_PROFILE_LEN),
        });
      }
    }

    const usableFwd = Math.min(fwdPairs.length, pairsBudget);
    const usableRev = Math.min(revPairs.length, Math.max(0, pairsBudget - usableFwd));
    const fwdSubset = fwdPairs.slice(0, usableFwd);
    const revSubset = revPairs.slice(0, usableRev);

    if (fwdSubset.length === 0 && revSubset.length === 0) continue;

    const fwdScores = await judgePairs(fwdSubset).catch((err: unknown) => {
      console.error(`[judge] forward judge failed viewer=${viewer_id} target=${tid}:`, err instanceof Error ? err.message : String(err));
      return new Map<string, { score: number; reason: string }>();
    });

    const revScores = await judgePairs(revSubset).catch((err: unknown) => {
      console.error(`[judge] reverse judge failed viewer=${viewer_id} target=${tid}:`, err instanceof Error ? err.message : String(err));
      return new Map<string, { score: number; reason: string }>();
    });

    // judge_pair_cache に詰める。direction='fwd' / 'rev' で別行に分離。
    //   direction='fwd': need_idx=viewer.need_idx, offer_idx=target.offer_idx, h_no=score
    //   direction='rev': need_idx=target.need_idx, offer_idx=viewer.offer_idx, h_no=score
    //                    (reverse 視点の forward = h_no、h_rv は deprecated 扱いで 0)
    // P8 HIGH 指摘: 旧版は 1 行に forward と reverse を merge しようとしたが
    // (need_idx, offer_idx) の意味軸が異なるため意味混在のリスクがあった。
    type CacheUpsert = {
      viewer_id: string; target_id: string;
      direction: "fwd" | "rev";
      need_idx: number; offer_idx: number;
      h_no: number; h_rv: number;
      reason_no: string | null; reason_rv: string | null;
      prompt_version: string;
      judged_at: string;
    };
    const out: CacheUpsert[] = [];
    const now = new Date().toISOString();

    for (const p of fwdSubset) {
      const v = fwdScores.get(`${p.need_idx}|${p.offer_idx}`);
      out.push({
        viewer_id, target_id: tid,
        direction: "fwd",
        need_idx: p.need_idx, offer_idx: p.offer_idx,
        h_no: v?.score ?? 0,
        h_rv: 0,
        reason_no: v?.reason ? truncate15(v.reason) : null,
        reason_rv: null,
        prompt_version: PROMPT_VERSION,
        judged_at: now,
      });
    }

    for (const p of revSubset) {
      const v = revScores.get(`${p.need_idx}|${p.offer_idx}`);
      out.push({
        viewer_id, target_id: tid,
        direction: "rev",
        need_idx: p.need_idx, offer_idx: p.offer_idx,
        h_no: v?.score ?? 0,
        h_rv: 0,
        reason_no: v?.reason ? truncate15(v.reason) : null,
        reason_rv: null,
        prompt_version: PROMPT_VERSION,
        judged_at: now,
      });
    }

    if (out.length === 0) continue;

    const { error: upErr } = await supabase
      .from("judge_pair_cache")
      .upsert(out, { onConflict: "viewer_id,target_id,direction,need_idx,offer_idx" });

    if (upErr) {
      console.error(`[judge] cache upsert failed viewer=${viewer_id} target=${tid}:`, upErr.message);
      continue;
    }

    const usedHere = fwdSubset.length + revSubset.length;
    pairsBudget -= usedHere;

    // matching_scores_v4 を stale 化（Track-Main の次回 compute で applyHaikuJudgment が読む）
    await supabase
      .from("matching_scores_v4")
      .update({ is_stale: true })
      .or(`and(viewer_id.eq.${viewer_id},target_id.eq.${tid}),and(viewer_id.eq.${tid},target_id.eq.${viewer_id})`);
  }

  // ---- quota log 更新 ----
  const usedTotal = remainingQuota - pairsBudget;
  if (usedTotal > 0) {
    // upsert: existing + usedTotal
    const newPairsUsed = usedToday + usedTotal;
    const { error: qErr } = await supabase
      .from("judge_quota_log")
      .upsert(
        { viewer_id, quota_date: today, pairs_used: newPairsUsed, updated_at: new Date().toISOString() },
        { onConflict: "viewer_id,quota_date" },
      );
    if (qErr) console.error("[judge] quota log upsert failed:", qErr.message);
  }

  console.log(`[judge] viewer=${viewer_id} targets=${targetIds.length} usedPairs=${usedTotal} remaining=${pairsBudget}`);
}

// ---------- 内部: Haiku 呼び出し ----------

interface PairRow {
  need_idx: number;
  offer_idx: number;
  need_text: string;
  solver_profile: string;
  offer_text: string;
  beneficiary_profile: string;
}

/**
 * ペア配列を 1 回ずつ複数の API call に分割し、Haiku に判定させる。
 * 戻り値: key="need_idx|offer_idx" → {score, reason}
 */
async function judgePairs(
  pairs: PairRow[],
): Promise<Map<string, { score: number; reason: string }>> {
  const out = new Map<string, { score: number; reason: string }>();
  if (pairs.length === 0) return out;

  for (let i = 0; i < pairs.length; i += PAIRS_PER_LLM_CALL) {
    const chunk = pairs.slice(i, i + PAIRS_PER_LLM_CALL);
    const userBlock = chunk
      .map(
        (p) =>
          `[${p.need_idx},${p.offer_idx}] need.text="${escapeForPrompt(p.need_text)}" solver_profile="${escapeForPrompt(p.solver_profile)}" offer.text="${escapeForPrompt(p.offer_text)}" beneficiary_profile="${escapeForPrompt(p.beneficiary_profile)}"`,
      )
      .join("\n");

    const userMessage = `以下のペアそれぞれを 4 テキストクロスマッチで評価し、JSON で返してください。

${userBlock}

出力フォーマット:
{"judgments":[{"need_idx":<int>,"offer_idx":<int>,"score":<0-1>,"reason":"<15字>"}, ...]}`;

    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < 3) {
      attempt++;
      try {
        const resp = await anthropic.messages.create({
          model: HAIKU_MODEL,
          max_tokens: 800,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              // プロンプトキャッシュ: バッチ間で再利用 (90% off, §3.5)
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userMessage }],
        });

        const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
        const parsed = parseJudgmentResponse(text);
        for (const j of parsed) {
          out.set(`${j.need_idx}|${j.offer_idx}`, {
            score: j.score,
            reason: j.reason,
          });
        }
        break; // 成功
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        // 5xx / rate limit のみリトライ。指数バックオフ。
        const retriable = /429|5\d\d|timeout|ECONNRESET|fetch failed/i.test(msg);
        if (!retriable || attempt >= 3) {
          console.error("[judge] Haiku call failed:", msg);
          break;
        }
        const delayMs = 500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (out.size === 0 && lastErr) {
      // 1チャンクも成功しなかった場合は呼び出し側でハンドル
    }
  }

  return out;
}

function parseJudgmentResponse(
  text: string,
): { need_idx: number; offer_idx: number; score: number; reason: string }[] {
  if (!text) return [];

  // JSON ブロックを抽出（コードフェンス対策）
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1] ?? text;
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return [];
  }

  const v = judgmentResponseSchema.safeParse(raw);
  if (!v.success) {
    // 部分解析: judgments が array なら個別アイテムだけパースを試みる
    const obj = raw as { judgments?: unknown };
    if (!Array.isArray(obj?.judgments)) return [];
    const out: { need_idx: number; offer_idx: number; score: number; reason: string }[] = [];
    for (const item of obj.judgments) {
      const it = judgmentItemSchema.safeParse(item);
      if (it.success) {
        out.push({
          need_idx: it.data.need_idx,
          offer_idx: it.data.offer_idx,
          score: it.data.score,
          reason: typeof it.data.reason === "string" ? it.data.reason : "",
        });
      }
    }
    return out;
  }

  return v.data.judgments.map((j) => ({
    need_idx: j.need_idx,
    offer_idx: j.offer_idx,
    score: j.score,
    reason: typeof j.reason === "string" ? j.reason : "",
  }));
}

// ---------- ヘルパ ----------

function clip(s: string | undefined | null, max: number): string {
  if (!s) return "";
  // 改行や制御文字をスペースに、" を ' に置換しつつクリップ。
  // プロンプトインジェクション緩和: \n\n やクオート/角括弧は中和。
  const cleaned = String(s)
    .replace(/[\r\n\t -]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\\/g, "/")
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

function escapeForPrompt(s: string): string {
  // クオート・改行をさらに無害化（clip 後の最終チェック）
  return s.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
}

function truncate15(s: string): string {
  const chars = Array.from(s.trim());
  return chars.length <= 15 ? chars.join("") : chars.slice(0, 15).join("");
}
