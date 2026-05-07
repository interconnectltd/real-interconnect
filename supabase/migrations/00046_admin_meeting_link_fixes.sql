-- 00046: 会議紐付け管理画面の 500/silent-empty を解消
--
-- 1) notifications.type に 'system' を追加 (admin の link-meetings 完了通知用)
--    旧 enum: connection_request / connection_accepted / match_mutual /
--             event_reminder / referral_accepted / point_earned
--    POST /api/v1/admin/import-requests/[id]/meetings:201 で 'system' を INSERT
--    していたため enum 違反で 500 になっていた。
--
-- 2) meeting_participants に admin SELECT policy を追加
--    00011 で `authenticated_view_participants` を DROP、代わりに 00010 で
--    `participants_select` (自分が participant のみ可) を作成。
--    admin はこの条件を満たさないため、他人の transcript の participants が
--    一切見えず、admin/import-requests 「会議紐付け」画面で候補が常に空。
--
-- 3) meeting_transcripts は 00001:459 で `admin_all_transcripts` 既存。
--    本 migration では participants 側のみ追補。

-- ────────────────────────────────────────────────────────────
-- 1) notification_type enum 追加
-- ────────────────────────────────────────────────────────────

-- ALTER TYPE ... ADD VALUE は既存値が無いと冪等にできないため動的判定
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'notification_type' AND e.enumlabel = 'system'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'system';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2) meeting_participants admin SELECT policy
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_select_participants" ON public.meeting_participants;
CREATE POLICY "admin_select_participants"
  ON public.meeting_participants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND is_admin = true
    )
  );

-- admin は participant 紐付けの修正時に UPDATE 必要
-- (既に 00037 で `auth_admin_update_participants` が作られているはずだが冪等保証)
DROP POLICY IF EXISTS "admin_update_participants_v46" ON public.meeting_participants;
CREATE POLICY "admin_update_participants_v46"
  ON public.meeting_participants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND is_admin = true
    )
  );
