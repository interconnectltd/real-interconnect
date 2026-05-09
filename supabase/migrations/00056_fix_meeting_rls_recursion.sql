-- 00056: meeting_participants / meeting_transcripts の RLS 無限再帰 (42P17) 解消
--
-- 症状:
--   admin/import-requests の「会議紐付け」画面 (tl;dv データ取込候補表示) で
--   `transcripts: 42P17 ... infinite recursion detected in policy for
--    relation "meeting_participants"` が発生し候補リストが取れない。
--
-- 原因:
--   - 00010 の `transcripts_select` は USING 句で `meeting_participants` を
--     EXISTS 参照する。
--   - 00010 の `participants_select` は USING 句で 同テーブルを自己参照し、
--     さらに `meeting_transcripts` を JOIN している。
--   → meeting_transcripts SELECT → transcripts_select 評価 → meeting_participants
--      SELECT → participants_select 評価 → meeting_transcripts SELECT → 無限ループ
--   → PostgreSQL が再帰検出で 42P17 を投げる。
--
-- 修正方針:
--   policy 内の自テーブル/相互参照 EXISTS を SECURITY DEFINER 関数に外出しする。
--   関数は RLS をバイパスして動くため、policy 評価が再帰しない。
--   関数は `STABLE` + `SET search_path = ''` で planner 最適化 + search_path
--   injection 防止 (Wave Sec audit 鉄則) を担保する。

-- ============================================================================
-- 1) SECURITY DEFINER helper functions
-- ============================================================================

-- 自分が当該 transcript の participant か (transcripts_select で利用)
CREATE OR REPLACE FUNCTION public.user_is_transcript_participant(
  p_transcript_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.meeting_participants
     WHERE transcript_id = p_transcript_id
       AND user_id = p_user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_is_transcript_participant(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_is_transcript_participant(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.user_is_transcript_participant(UUID, UUID) IS
  'RLS無限再帰回避用 SECURITY DEFINER ヘルパ (00056)。自身が participant の transcript か返す。';

-- 自分が participant かつ transcript が ready/analyzed か
-- (participants_select で他人の participant 行を見せて良いかの判定)
CREATE OR REPLACE FUNCTION public.user_can_view_transcript_participants(
  p_transcript_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.meeting_participants mp
      JOIN public.meeting_transcripts mt ON mt.id = mp.transcript_id
     WHERE mp.transcript_id = p_transcript_id
       AND mp.user_id = p_user_id
       AND mt.status IN ('ready', 'analyzed')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_can_view_transcript_participants(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_can_view_transcript_participants(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.user_can_view_transcript_participants(UUID, UUID) IS
  'RLS無限再帰回避用 SECURITY DEFINER ヘルパ (00056)。自身が participant かつ transcript が ready/analyzed の場合 true。';

-- ============================================================================
-- 2) meeting_transcripts.transcripts_select を helper 経由に書き換え
-- ============================================================================

DROP POLICY IF EXISTS "transcripts_select" ON public.meeting_transcripts;
CREATE POLICY "transcripts_select" ON public.meeting_transcripts
  FOR SELECT
  TO authenticated
  USING (
    status != 'pending_consent'
    AND public.user_is_transcript_participant(id, auth.uid())
  );

-- ============================================================================
-- 3) meeting_participants.participants_select を helper 経由に書き換え
-- ============================================================================

DROP POLICY IF EXISTS "participants_select" ON public.meeting_participants;
CREATE POLICY "participants_select" ON public.meeting_participants
  FOR SELECT
  TO authenticated
  USING (
    -- 自分の participant 行は status関係なく見られる (consent gate UI で必要)
    user_id = auth.uid()
    OR
    -- 他人の participant でも、自分が同 transcript の participant かつ status ready/analyzed なら可
    public.user_can_view_transcript_participants(transcript_id, auth.uid())
  );

-- ============================================================================
-- 4) admin_update_participants_v46 (00046) と auth_admin_update_participants
--    (00037) の重複整理。 同条件 (is_admin=true, FOR UPDATE) を別名で 2 つ
--    持っており可読性が悪い。 OR 結合で動作には影響しないが、後発の v46 を
--    DROP し 00037 の policy に統一する。
-- ============================================================================

DROP POLICY IF EXISTS "admin_update_participants_v46" ON public.meeting_participants;

-- ============================================================================
-- 5) 検証メモ (commentary only)
-- ============================================================================
-- 適用後の確認:
--   1. 一般ユーザー: 自分が participant の ready/analyzed transcript と、その
--      participants 一覧が見える。pending_consent transcript は見えない。
--   2. admin (anon key 経由): admin_all_transcripts (00001) と
--      admin_select_participants (00046) で全件 SELECT 可。
--   3. service_role: 既存の *_service_all policy + role bypass で全件可。
--   4. 42P17 が再現しないこと (admin/import-requests で会議候補が表示される)。
