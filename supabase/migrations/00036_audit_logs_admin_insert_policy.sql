-- 00036: admin が audit_logs に INSERT できるよう GRANT + RLS policy 追加
--
-- 経緯:
--   00027 で `GRANT INSERT, SELECT ... TO service_role` のみ付与され、
--   authenticated は SELECT のみ。`audit_logs_self_select` policy も SELECT のみ。
--   この状態で `/api/v1/admin/users/[id]` の view_user 監査ログ insert が
--   黙って失敗 (RLS で拒否) し、法務 R5 (admin 操作の追跡) 要件を満たせない。
--
-- 修正:
--   1. authenticated に INSERT GRANT
--   2. admin 限定の INSERT policy (`actor_id = auth.uid()` + `is_admin = true`)

GRANT INSERT ON public.audit_logs TO authenticated;

DROP POLICY IF EXISTS audit_logs_admin_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

NOTIFY pgrst, 'reload schema';
