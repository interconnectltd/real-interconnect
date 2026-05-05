/**
 * 同一実在人物の重複アカウント検出
 *
 * 1 人の実在人物が複数 workspace で別 user_profile を持つケース
 * (山田太郎@work-A / 山田太郎@work-B) を検出し、representative + alternates に
 * グルーピングする。compute-v2 / scores API は alternates を target から外すか
 * 結果セットに 1 グループ 1 件のみ残すために使う。
 *
 * 戦略:
 *  - HIGH confidence のみ自動統合に使う:
 *      1. email 完全一致 (確実)
 *      2. name + linkedin_id 一致 (LinkedIn ID は本人ユニーク前提)
 *  - MEDIUM (name + company) は誤検出リスクが高い (同社内同姓同名 = 別人)
 *      ため confidence='medium' を返すが、デフォルトの除外候補には含めない。
 *      呼び出し側が opt-in で扱う。
 *  - 漢字/ひらがな/英語表記揺れの fuzzy match は誤検出が読めないので **やらない**。
 *
 * representative の選び方:
 *  - is_active=true を優先 (削除済 / 無効化済 アカウントは代表から除外)
 *  - analysis_count 最大 (= 一番アクティブなワークスペース)
 *  - tie の場合 updated_at 最新 (最近メンテされている方)
 */

export type DuplicateConfidence = "high" | "medium";

/** 検出に必要な最小フィールド。user_profiles row + analysis_count を別 table から渡せる。 */
export interface DuplicateCandidateProfile {
  id: string;
  name: string;
  email: string;
  company: string | null;
  /** linkedin_id (00003 migration で追加)。同一人物の強い signal。 */
  linkedin_id?: string | null;
  is_active: boolean;
  updated_at: string;
  /** member_ai_profiles_v2.analysis_count or user_conversation_vectors.analysis_count。0 で代用可。 */
  analysis_count?: number;
}

export interface DuplicateGroup {
  /** グループの代表 (UI / matching に出す方) */
  representative: DuplicateCandidateProfile;
  /** 代表以外。matching target / 推薦結果から除外する候補。 */
  alternates: DuplicateCandidateProfile[];
  /** 何でマッチしたか */
  matchKey: "email" | "name+linkedin_id" | "name+company";
  confidence: DuplicateConfidence;
}

/* ───────── normalize helpers ───────── */

function normEmail(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

function normName(name: string | null | undefined): string {
  if (!name) return "";
  // 全半角空白除去 + lower。漢字/ひらがな間の正規化は意図的にしない (誤検出回避)。
  return name.replace(/[\s　]+/g, "").toLowerCase();
}

function normCompany(company: string | null | undefined): string {
  if (!company) return "";
  return company.replace(/[\s　]+/g, "").toLowerCase();
}

/**
 * company が誤検出を起こしやすい "generic" 値か判定。
 * Sub-A レビュー対応: 同社内同姓同名は別人の可能性が高いが、特に短い名称や
 * "フリーランス" "個人事業主" "未設定" 等は別人を強引にマージするリスク絶大。
 */
function isGenericCompany(normalized: string): boolean {
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  // ベタ書き block list (ASCII / 日本語両対応)
  const generics = [
    "フリーランス", "個人事業主", "個人", "無職", "未設定", "なし", "未定",
    "freelance", "freelancer", "self-employed", "selfemployed", "individual",
    "n/a", "na", "none", "unknown", "other",
  ];
  return generics.some((g) => normalized === g);
}

function normLinkedin(id: string | null | undefined): string {
  if (!id) return "";
  // URL slug / vanity id の最後の path だけにする (https://linkedin.com/in/foo → foo)
  const trimmed = id.trim().toLowerCase().replace(/\/+$/, "");
  const m = trimmed.match(/(?:linkedin\.com\/in\/)?([^/?#]+)$/);
  return m?.[1] ?? trimmed;
}

/* ───────── representative 選定 ───────── */

function pickRepresentative(
  members: DuplicateCandidateProfile[],
): DuplicateCandidateProfile {
  // 安全策: 1 件しかない場合 (group としては成立しないがガード)
  if (members.length === 1) return members[0]!;

  // Sub-B レビュー対応: is_active を最優先。削除済 / 無効化済アカウントは
  // 「ユーザーが今使っているメインアカウント」になりえない。
  const active = members.filter((m) => m.is_active);
  const pool = active.length > 0 ? active : members;

  return [...pool].sort((a, b) => {
    const ac = a.analysis_count ?? 0;
    const bc = b.analysis_count ?? 0;
    if (ac !== bc) return bc - ac; // 大きい方が先頭
    // tie: updated_at 最新
    const at = Date.parse(a.updated_at);
    const bt = Date.parse(b.updated_at);
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
    // 最終 tie: id 安定ソート (deterministic な代表選び)
    return a.id.localeCompare(b.id);
  })[0]!;
}

/* ───────── main: findDuplicatePersons ───────── */

export interface FindDuplicateOptions {
  /** MEDIUM (name+company) も含めるか。デフォルト false (HIGH のみ)。 */
  includeMedium?: boolean;
}

/**
 * profiles から同一人物候補をグループ化。
 *
 * 出力契約:
 *  - 1 アカウント 1 グループまでにしか属さない (union-find ライク)
 *  - 重複なし (alternates 数 >= 1 のグループのみ返す)
 *  - email match を name+linkedin より優先、name+linkedin を name+company より優先
 */
export function findDuplicatePersons(
  profiles: DuplicateCandidateProfile[],
  options: FindDuplicateOptions = {},
): DuplicateGroup[] {
  const { includeMedium = false } = options;

  // どのアカウントが既に別グループに confirm されたか追跡 (id → groupKey)
  const claimed = new Map<string, string>();

  // 各種 index を構築
  const byEmail = new Map<string, DuplicateCandidateProfile[]>();
  const byNameLinkedin = new Map<string, DuplicateCandidateProfile[]>();
  const byNameCompany = new Map<string, DuplicateCandidateProfile[]>();

  for (const p of profiles) {
    const e = normEmail(p.email);
    const n = normName(p.name);
    const li = normLinkedin(p.linkedin_id);
    const co = normCompany(p.company);

    if (e) {
      const arr = byEmail.get(e);
      if (arr) arr.push(p);
      else byEmail.set(e, [p]);
    }
    if (n && li) {
      const k = `${n}|${li}`;
      const arr = byNameLinkedin.get(k);
      if (arr) arr.push(p);
      else byNameLinkedin.set(k, [p]);
    }
    if (n && co && !isGenericCompany(co)) {
      const k = `${n}|${co}`;
      const arr = byNameCompany.get(k);
      if (arr) arr.push(p);
      else byNameCompany.set(k, [p]);
    }
  }

  const groups: DuplicateGroup[] = [];

  function commit(
    members: DuplicateCandidateProfile[],
    matchKey: DuplicateGroup["matchKey"],
    confidence: DuplicateConfidence,
  ): void {
    // 既に他グループに claim されているメンバーは除く
    const fresh = members.filter((m) => !claimed.has(m.id));
    if (fresh.length < 2) return;
    const rep = pickRepresentative(fresh);
    const alternates = fresh.filter((m) => m.id !== rep.id);
    const key = `${matchKey}:${rep.id}`;
    for (const m of fresh) claimed.set(m.id, key);
    groups.push({ representative: rep, alternates, matchKey, confidence });
  }

  // 1. email 完全一致 — HIGH
  for (const members of byEmail.values()) {
    if (members.length >= 2) commit(members, "email", "high");
  }

  // 2. name + linkedin_id — HIGH
  for (const members of byNameLinkedin.values()) {
    if (members.length >= 2) commit(members, "name+linkedin_id", "high");
  }

  // 3. name + company — MEDIUM (opt-in)
  if (includeMedium) {
    for (const members of byNameCompany.values()) {
      if (members.length >= 2) commit(members, "name+company", "medium");
    }
  }

  return groups;
}

/* ───────── 補助: alternates の id 集合 ───────── */

/**
 * findDuplicatePersons の出力から「除外すべき alternates の id Set」を返す。
 * compute-v2 / recommendations API で `targetIds.filter(id => !excluded.has(id))` するための薄い helper。
 */
export function collectAlternateIds(groups: DuplicateGroup[]): Set<string> {
  const set = new Set<string>();
  for (const g of groups) {
    for (const a of g.alternates) set.add(a.id);
  }
  return set;
}
