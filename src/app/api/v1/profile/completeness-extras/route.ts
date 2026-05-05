import { withAuth, json, handleApiError } from "@/lib/api-helpers";

/**
 * /api/v1/profile/completeness-extras
 *
 * Profile 完成度計算で必要な「Profile 外」のメトリクスをまとめて返却。
 *   - user_goals 件数 + detail 文字数評価 (effective count / 平均長 / 件数内訳)
 *   - user_offerings 件数 + detail 文字数評価 (同上)
 *   - 第三者提供同意の取得日時
 *   - tl;dv 解析済 transcripts 件数 (本人 participant が紐付き済かつ analyzed)
 *   - linkedin_id (SNS 配点用 / migrations 上 user_profiles に存在)
 *
 * detail 文字数評価ルール (Z4):
 *   - detail.trim().length >= DETAIL_FULL_THRESHOLD (30字) → 1.0 件
 *   - 1字以上 30字未満                               → 0.5 件
 *   - 0字 / null                                      → 0.5 件 (登録自体は事実)
 *   effective_count を tier 判定に渡せば、短い detail は 2件で tier1 を取れ、
 *   長い detail は 1件で tier1 を取れる「届きやすさ × 精度」両立が実現する。
 */

/** detail がこの文字数以上で「完全カウント」扱い。未満は 0.5 件減衰。 */
const DETAIL_FULL_THRESHOLD = 30;

interface DetailRow {
  detail: string | null;
}

interface DetailMetrics {
  count: number;            // 行数 (件数)
  effective: number;        // 文字数評価込みの実効件数 (= 1.0/0.5 加重和)
  full_count: number;       // detail >= 30字 の件数
  partial_count: number;    // detail 0〜29字 の件数
  avg_detail_length: number;// 平均文字数 (空も含む全件平均)
}

function computeDetailMetrics(rows: DetailRow[]): DetailMetrics {
  if (rows.length === 0) {
    return { count: 0, effective: 0, full_count: 0, partial_count: 0, avg_detail_length: 0 };
  }
  let full = 0;
  let partial = 0;
  let totalLen = 0;
  for (const row of rows) {
    const len = (row.detail ?? "").trim().length;
    totalLen += len;
    if (len >= DETAIL_FULL_THRESHOLD) full += 1;
    else partial += 1;
  }
  const effective = full * 1.0 + partial * 0.5;
  // 小数 1 桁丸め (浮動小数の表示揺れ抑止)
  const effectiveRounded = Math.round(effective * 10) / 10;
  const avgRounded = Math.round((totalLen / rows.length) * 10) / 10;
  return {
    count: rows.length,
    effective: effectiveRounded,
    full_count: full,
    partial_count: partial,
    avg_detail_length: avgRounded,
  };
}

export async function GET() {
  try {
    const { user, supabase } = await withAuth();

    const [
      { data: goalsRows },
      { data: offeringsRows },
      { data: profile },
      { data: analyzedRows },
    ] = await Promise.all([
      // detail を含めて取得し JS 側で文字数評価
      supabase
        .from("user_goals")
        .select("detail")
        .eq("user_id", user.id),
      supabase
        .from("user_offerings")
        .select("detail")
        .eq("user_id", user.id),
      // SNS (linkedin_id) と consent を一括取得
      supabase
        .from("user_profiles")
        .select("contact_sharing_consent_at, linkedin_id")
        .eq("id", user.id)
        .maybeSingle(),
      // distinct な transcript_id をカウント (同一 transcript に複数 speaker で
      // 紐付いた場合の二重カウント回避)。onboarding/internal は除外。
      supabase
        .from("meeting_participants")
        .select(
          "transcript_id, transcript:meeting_transcripts!inner(status, meeting_kind)",
        )
        .eq("user_id", user.id)
        .in("transcript.status", ["analyzed", "ready"])
        .neq("transcript.meeting_kind", "onboarding")
        .neq("transcript.meeting_kind", "internal"),
    ]);

    const goalsMetrics = computeDetailMetrics((goalsRows ?? []) as DetailRow[]);
    const offeringsMetrics = computeDetailMetrics(
      (offeringsRows ?? []) as DetailRow[],
    );

    // distinct transcript_id 数を JS 側で計算
    const distinctTranscripts = new Set(
      ((analyzedRows ?? []) as { transcript_id: string }[]).map(
        (r) => r.transcript_id,
      ),
    );

    const profileRow = (profile as
      | { contact_sharing_consent_at?: string | null; linkedin_id?: string | null }
      | null) ?? null;

    return json({
      // 後方互換: 既存 hook が読む単純カウント
      goals: goalsMetrics.count,
      offerings: offeringsMetrics.count,
      // 新規: detail 文字数評価込みのメトリクス
      goals_metrics: goalsMetrics,
      offerings_metrics: offeringsMetrics,
      consent_at: profileRow?.contact_sharing_consent_at ?? null,
      analyzed_count: distinctTranscripts.size,
      // SNS: linkedin_id のみ migrations 上に存在 (website_url / x_url は未追加)
      linkedin_id: profileRow?.linkedin_id ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
