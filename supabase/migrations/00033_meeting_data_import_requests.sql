-- 00033_meeting_data_import_requests.sql
--
-- 会議データ取込申請テーブル。
-- ユーザーが「自分の tl:dv 会議データを INTER CONNECT に取り込んでほしい」と
-- 運営 (admin) に申請、admin が管理画面で受付・処理する。

CREATE TABLE IF NOT EXISTS public.meeting_data_import_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','rejected','cancelled')),
  message       TEXT,                                -- ユーザー → 運営への自由記述
  source        TEXT NOT NULL DEFAULT 'tldv'
                CHECK (source IN ('tldv','manual_csv','other')),
  admin_note    TEXT,                                -- admin の処理メモ
  processed_at  TIMESTAMPTZ,
  processed_by  UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_req_user_status
  ON public.meeting_data_import_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_import_req_status_created
  ON public.meeting_data_import_requests(status, created_at DESC);

-- 1ユーザーが pending を複数同時に持たない (UI 上の重複申請防止)
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_req_pending_per_user
  ON public.meeting_data_import_requests(user_id)
  WHERE status = 'pending';

ALTER TABLE public.meeting_data_import_requests ENABLE ROW LEVEL SECURITY;

-- service_role
DROP POLICY IF EXISTS "service_role_import_req_full" ON public.meeting_data_import_requests;
CREATE POLICY "service_role_import_req_full"
  ON public.meeting_data_import_requests AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ユーザー: 自分の申請のみ SELECT/INSERT/UPDATE(cancel only)
DROP POLICY IF EXISTS "auth_select_own_import_req" ON public.meeting_data_import_requests;
CREATE POLICY "auth_select_own_import_req"
  ON public.meeting_data_import_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "auth_insert_own_import_req" ON public.meeting_data_import_requests;
CREATE POLICY "auth_insert_own_import_req"
  ON public.meeting_data_import_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- ユーザーは自分の pending を cancelled に変更可能
DROP POLICY IF EXISTS "auth_cancel_own_import_req" ON public.meeting_data_import_requests;
CREATE POLICY "auth_cancel_own_import_req"
  ON public.meeting_data_import_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending','cancelled'));

-- admin: 全件 SELECT + status/admin_note 更新可
DROP POLICY IF EXISTS "auth_admin_all_import_req" ON public.meeting_data_import_requests;
CREATE POLICY "auth_admin_all_import_req"
  ON public.meeting_data_import_requests AS PERMISSIVE FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- updated_at 自動
DROP TRIGGER IF EXISTS import_req_touch ON public.meeting_data_import_requests;
CREATE TRIGGER import_req_touch
  BEFORE UPDATE ON public.meeting_data_import_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
