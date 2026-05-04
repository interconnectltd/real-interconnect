-- prospect 招待パイプライン用の拡張
--
-- 目的: tl;dvから取り込んだ商談相手(prospect)を招待→同意→分析の順で安全に処理する。
-- 設計の穴を埋める:
--   ・同意前のClaude送信を阻止 (越境移転同意の時系列違反対策)
--   ・誰がいつ招待したかをaudit
--   ・prospect由来かどうかを user_profiles で判別可能に

-- 1) meeting_transcripts.status に 'pending_consent' を追加
--    旧: pending/fetching/ready/analyzing/analyzed/error
--    新: pending/fetching/ready/analyzing/analyzed/error/pending_consent
ALTER TABLE public.meeting_transcripts
  DROP CONSTRAINT IF EXISTS meeting_transcripts_status_check;
ALTER TABLE public.meeting_transcripts
  ADD CONSTRAINT meeting_transcripts_status_check
  CHECK (status IN ('pending','fetching','ready','analyzing','analyzed','error','pending_consent'));

-- 2) user_profiles に prospect_invite_at を追加
--    招待経由で作成されたユーザーかつ同意未完了かを識別
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS prospect_invite_at TIMESTAMPTZ;
COMMENT ON COLUMN public.user_profiles.prospect_invite_at IS
  'auth.admin.inviteUserByEmail で招待された時刻。NULLは通常signUp。設定済かつ user_terms_acceptances 無しの場合は consent gate 必須。';

-- 3) bulk_invite_log: 一括招待操作の監査ログ (audit_logs に集約せず明示テーブル)
CREATE TABLE IF NOT EXISTS public.bulk_invite_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_meeting_ids TEXT[] DEFAULT '{}',
  status       TEXT NOT NULL CHECK (status IN ('invited','failed','consented','revoked','deleted')),
  error_message TEXT,
  metadata     JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bulk_invite_log_email ON public.bulk_invite_log (email);
CREATE INDEX IF NOT EXISTS idx_bulk_invite_log_status ON public.bulk_invite_log (status);
CREATE INDEX IF NOT EXISTS idx_bulk_invite_log_user ON public.bulk_invite_log (user_id);
ALTER TABLE public.bulk_invite_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read bulk_invite_log" ON public.bulk_invite_log;
CREATE POLICY "Admin can read bulk_invite_log"
  ON public.bulk_invite_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );
-- INSERT/UPDATE は service_role のみ (RLS により遮断)

-- 4) on consent → meeting_transcripts.status を pending_consent → ready に昇格、analyze ジョブ投入
--    これは Phase 2 で worker か API ルートに実装するためここでは関数だけ用意
CREATE OR REPLACE FUNCTION public.promote_pending_consent_for_user(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_promoted_count INT := 0;
  v_transcript_id UUID;
  v_participant_id UUID;
BEGIN
  -- このユーザーが participant になっている transcript で pending_consent のもの
  FOR v_transcript_id, v_participant_id IN
    SELECT mt.id, mp.id
    FROM public.meeting_transcripts mt
    JOIN public.meeting_participants mp ON mp.transcript_id = mt.id
    WHERE mp.user_id = p_user_id
      AND mt.status = 'pending_consent'
  LOOP
    -- transcript を ready に
    UPDATE public.meeting_transcripts
       SET status = 'ready'
     WHERE id = v_transcript_id;
    -- analyze ジョブ投入 (重複避けるため既存pending/runningがなければ)
    IF NOT EXISTS (
      SELECT 1 FROM public.job_queue
       WHERE type = 'analyze'
         AND payload @> jsonb_build_object('transcript_id', v_transcript_id::text, 'participant_id', v_participant_id::text)
         AND status IN ('pending','running')
    ) THEN
      INSERT INTO public.job_queue (type, payload, status, priority, attempts, max_attempts)
      VALUES (
        'analyze',
        jsonb_build_object('transcript_id', v_transcript_id, 'participant_id', v_participant_id),
        'pending',
        10,
        0,
        3
      );
    END IF;
    v_promoted_count := v_promoted_count + 1;
  END LOOP;

  -- bulk_invite_log の status を 'invited' → 'consented' に
  UPDATE public.bulk_invite_log
     SET status = 'consented', updated_at = now()
   WHERE user_id = p_user_id AND status = 'invited';

  RETURN v_promoted_count;
END;
$$;

COMMENT ON FUNCTION public.promote_pending_consent_for_user IS
  '同意完了したユーザーの meeting_transcripts(pending_consent) を ready に昇格し analyze ジョブを投入。/api/v1/legal/accept から呼ぶ前提。';

-- 5) reject_prospect_invite: prospect が同意を拒否した時のクリーンアップ
CREATE OR REPLACE FUNCTION public.reject_prospect_invite(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- pending_consent transcripts の participant 紐付けを解除
  UPDATE public.meeting_participants
     SET user_id = NULL, is_linked = false, linked_method = NULL
   WHERE user_id = p_user_id
     AND transcript_id IN (
       SELECT id FROM public.meeting_transcripts WHERE status = 'pending_consent'
     );

  -- bulk_invite_log を revoked に
  UPDATE public.bulk_invite_log
     SET status = 'revoked', updated_at = now()
   WHERE user_id = p_user_id AND status = 'invited';

  -- auth.users 削除 (CASCADE で user_profiles, user_terms_acceptances も削除)
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.reject_prospect_invite IS
  'prospectが同意を拒否した場合のクリーンアップ。pending_consentの participant紐付け解除、ログ記録、ユーザー削除。';
