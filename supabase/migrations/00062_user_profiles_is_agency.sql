-- 00062_user_profiles_is_agency.sql
--
-- user_profiles.is_agency 列追加 — admin が任意の member に「代理店」ラベル
-- を付与/解除できる仕組み。バッジは他 member 全員から見える設計。
--
-- 設計判断:
--   - 列レベルで RLS の追加は不要。既存 authenticated_view_profiles policy
--     (00001) は列を限定していないため、追加列も自動的に他 user から SELECT 可能。
--   - 既存 protect_admin trigger 関数を拡張し、is_agency も service_role のみ
--     更新可能にする (本人含む通常 user による self-escalation を遮断)。
--   - 既存 trg_profile_stale_scores が AFTER UPDATE で stale 化するため、
--     is_agency の変更ではマッチング再計算は走らない (期待動作)。
--
-- 監査: PATCH /api/v1/admin/users/[id]/agency-badge から audit_logs に
-- `admin.user.grant_agency_badge` / `admin.user.revoke_agency_badge` を記録。

-- 1) 列追加 (再実行安全)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_agency BOOLEAN NOT NULL DEFAULT false;

-- 2) protect_admin → is_agency も保護対象に拡張
--    CREATE OR REPLACE で既存 trigger は自動的に新定義を使用 (再 attach 不要)
CREATE OR REPLACE FUNCTION public.protect_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.is_active IS DISTINCT FROM NEW.is_active
     OR OLD.is_agency IS DISTINCT FROM NEW.is_agency THEN
    IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'is_admin, is_active and is_agency can only be modified by service_role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) クエリ最適化 (代理店一覧 / フィルタ用、 partial index で is_agency=true のみ)
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_agency
  ON public.user_profiles(id)
  WHERE is_agency = true;

COMMENT ON COLUMN public.user_profiles.is_agency IS
  '代理店バッジ。admin が grant/revoke。service_role 以外は変更不可 (protect_admin trigger)。';

-- 4) PostgREST schema cache 再読込
--    本 migration を apply した直後、PostgREST 側 cache が古いまま
--    `SELECT ... is_agency` で "column not found" を返す事故が発生したため、
--    末尾で NOTIFY を送って即時反映を確実化する。
NOTIFY pgrst, 'reload schema';
