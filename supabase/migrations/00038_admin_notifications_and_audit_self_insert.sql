-- 00038: 残 Critical/High 対処
--
-- C1: admin が他ユーザー宛に notifications を INSERT できない (RLS 拒否)
--     → admin policy を追加 (silent failure 解消)
-- H1: 一般ユーザーが自分の audit_logs を INSERT できない (admin only policy のみ)
--     → audit_logs_self_insert policy (actor_id = auth.uid()) 追加

DROP POLICY IF EXISTS notifications_admin_insert ON public.notifications;
CREATE POLICY notifications_admin_insert
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS audit_logs_self_insert ON public.audit_logs;
CREATE POLICY audit_logs_self_insert
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

NOTIFY pgrst, 'reload schema';
