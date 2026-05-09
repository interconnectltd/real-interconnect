-- 00057: 紐付け後に aggregate ジョブを enqueue する経路を追加
--
-- 背景:
--   admin が「会議紐付け」UI で N 件の participants を user に紐付けても
--   `member_ai_profiles_v2` (= /settings/ai-profile に表示する needs/offers
--    /topics の集約結果) が更新されない致命傷があった。
--
--   実機検証:
--     2026-05-09 worker (Render) は生存し 5 秒間隔で polling 中だが、 過去
--     28 日間 (4/11 以降) ジョブが投入されておらず profile 0 件。 手動で
--     aggregate ジョブを INSERT したら 22 秒で完了し needs=8 / offers=7 /
--     topics=17 が反映された。
--
--   真因:
--     `link_import_request_meetings_v2` (および旧版 jsonb 引数版) は
--     meeting_participants.user_id を UPDATE するだけで、 aggregate ジョブ
--     を job_queue に enqueue していなかった。
--
-- 修正:
--   1. 内部 helper `_enqueue_aggregate_for(p_user_id UUID)` を作成し、 同
--      user_id の pending/running aggregate が無ければ INSERT する重複防止
--      ロジックを集約。
--   2. v2 / 旧版 RPC の末尾で、 v_linked > 0 の時のみ helper を呼ぶ。
--   3. SECURITY DEFINER + search_path='' で RLS 経路を意識せず安全に動作。
--
-- 注意:
--   - skills (demonstrated_skills) は analyze.ts 側で常に [] にハードコード
--     されているため、 aggregated_skills も空になる。 これは prompt V4 で
--     skills 抽出を追加する別タスク (P2) で対応する。
--   - score 連鎖 (aggregate.ts:412 で enqueue する 'score' ジョブ) は worker
--     が placeholder 実装のため実分析されない (本来は Next.js compute-v2
--     route に委譲する設計)。 今回スコープ外。

-- ============================================================================
-- 1) 内部 helper: aggregate ジョブを重複防止付きで enqueue
-- ============================================================================

CREATE OR REPLACE FUNCTION public._enqueue_aggregate_for(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 同 user の pending/running aggregate が既にあれば何もしない
  -- (jsonb の `=` は構造比較で順序非依存)
  IF EXISTS (
    SELECT 1 FROM public.job_queue
     WHERE type = 'aggregate'
       AND payload = jsonb_build_object('user_id', p_user_id)
       AND status IN ('pending', 'running')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.job_queue (type, payload, priority, status)
  VALUES (
    'aggregate',
    jsonb_build_object('user_id', p_user_id),
    5,
    'pending'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._enqueue_aggregate_for(UUID) FROM PUBLIC;
-- 一般 grant 不要 (SECURITY DEFINER の他関数からのみ呼ぶ内部 helper)

COMMENT ON FUNCTION public._enqueue_aggregate_for(UUID) IS
  '紐付け/分析完了経路から呼ぶ aggregate ジョブ enqueue helper。 同 user の pending/running aggregate があれば skip (00057 で導入)。';

-- ============================================================================
-- 2) link_import_request_meetings_v2 (UUID 配列版) に enqueue 追加
-- ============================================================================

CREATE OR REPLACE FUNCTION public.link_import_request_meetings_v2(
  p_request_id      UUID,
  p_participant_ids UUID[],
  p_force           BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller  UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_linked  INT;
BEGIN
  -- 認可
  SELECT is_admin INTO v_is_admin
    FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'link_import_request_meetings_v2: admin only';
  END IF;

  -- 申請取得
  SELECT user_id INTO v_user_id
    FROM public.meeting_data_import_requests
   WHERE id = p_request_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'link_import_request_meetings_v2: request not found';
  END IF;

  -- participant_id 直接指定で UPDATE
  WITH upd AS (
    UPDATE public.meeting_participants mp
       SET user_id = v_user_id,
           is_linked = true,
           linked_method = 'manual'
     WHERE mp.id = ANY(p_participant_ids)
       AND (
         mp.user_id IS NULL
         OR (p_force = true AND mp.user_id <> v_user_id)
       )
    RETURNING mp.id
  )
  SELECT count(*) INTO v_linked FROM upd;

  -- pending → processing
  UPDATE public.meeting_data_import_requests
     SET status = 'processing'
   WHERE id = p_request_id AND status = 'pending';

  -- ★ NEW: 1 件以上紐付いた場合のみ aggregate ジョブを enqueue
  IF v_linked > 0 THEN
    PERFORM public._enqueue_aggregate_for(v_user_id);
  END IF;

  RETURN jsonb_build_object(
    'participants_linked', COALESCE(v_linked, 0),
    'request_user_id',     v_user_id
  );
END;
$function$;

-- ============================================================================
-- 3) link_import_request_meetings (旧 jsonb 引数版) にも enqueue 追加
--    後方互換のため UI が participant_id 無しで呼んだ場合の経路もカバー。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.link_import_request_meetings(
  p_request_id UUID,
  p_meetings   jsonb,
  p_force      BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller   UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_user_id  UUID;
  v_status   TEXT;
  v_linked   INT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT is_admin INTO v_is_admin
    FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- 申請レコードを排他ロック (DELETE cancel との race を防止)
  SELECT user_id, status INTO v_user_id, v_status
    FROM public.meeting_data_import_requests
   WHERE id = p_request_id
   FOR UPDATE;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'request not found';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'request was cancelled';
  END IF;

  WITH targets AS (
    SELECT
      (elem->>'transcript_id')::UUID AS transcript_id,
      lower(trim(elem->>'speaker_name')) AS speaker_name_lower
    FROM jsonb_array_elements(p_meetings) AS elem
    WHERE elem->>'transcript_id' IS NOT NULL
      AND elem->>'speaker_name' IS NOT NULL
  ),
  upd AS (
    UPDATE public.meeting_participants mp
       SET user_id = v_user_id,
           is_linked = true,
           linked_method = 'manual'
      FROM targets t
     WHERE mp.transcript_id = t.transcript_id
       AND lower(trim(mp.speaker_name)) = t.speaker_name_lower
       AND (
         mp.user_id IS NULL
         OR (p_force = true AND mp.user_id <> v_user_id)
       )
     RETURNING mp.id
  )
  SELECT count(*) INTO v_linked FROM upd;

  -- 内部 audit_log (RPC 直叩き対策)
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, payload)
  VALUES (
    v_caller,
    'admin.import_request.update',
    'import_request',
    p_request_id::text,
    jsonb_build_object(
      'op', 'link_meetings',
      'target_user_id', v_user_id,
      'meetings_attempted', jsonb_array_length(p_meetings),
      'participants_linked', COALESCE(v_linked, 0),
      'force', p_force
    )
  );

  -- 申請を pending → processing に遷移
  IF v_status = 'pending' THEN
    UPDATE public.meeting_data_import_requests
       SET status = 'processing'
     WHERE id = p_request_id;
  END IF;

  -- ★ NEW: 1 件以上紐付いた場合のみ aggregate ジョブを enqueue
  IF v_linked > 0 THEN
    PERFORM public._enqueue_aggregate_for(v_user_id);
  END IF;

  RETURN jsonb_build_object(
    'participants_linked', COALESCE(v_linked, 0),
    'request_user_id',     v_user_id
  );
END;
$function$;

-- ============================================================================
-- 4) 検証メモ (commentary only)
-- ============================================================================
-- 適用後、 admin で「N 件を紐付ける」を押した直後 5-30 秒以内に
-- member_ai_profiles_v2 / user_conversation_vectors が埋まる。
-- 確認 SQL:
--   SELECT user_id, analysis_count, last_analyzed_at
--     FROM public.member_ai_profiles_v2
--    ORDER BY last_analyzed_at DESC NULLS LAST;
