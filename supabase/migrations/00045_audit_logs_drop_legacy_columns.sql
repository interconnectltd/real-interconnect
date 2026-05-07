-- 00045: audit_logs の旧カラムを物理削除
--
-- 経緯:
--   00027/00035 で actor_id/target_type/target_id/payload/ip/ua の新スキーマに
--   統一したが、00004 の旧カラム (user_id/entity_type/entity_id/metadata/ip_address)
--   を残していた。本日時点で旧カラムを参照するコードはゼロ、データも 0 件のため
--   物理削除して二重ログ / 型ファイル肥大の根を絶つ。
--
-- 安全性:
--   - SELECT count(*) FROM audit_logs WHERE 旧カラム IS NOT NULL = 0 件確認済
--   - src/* を grep して旧カラム参照ゼロ確認済
--   - writeAuditLog は 00027 系のみで書き込み中

-- 旧 index も連動削除
DROP INDEX IF EXISTS public.idx_audit_logs_user;

ALTER TABLE public.audit_logs
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS entity_type,
  DROP COLUMN IF EXISTS entity_id,
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS ip_address;

NOTIFY pgrst, 'reload schema';
