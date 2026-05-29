-- user_terms_acceptances.user_id を NULLABLE に修正。
--
-- 背景: 00010_prospect_invite_hardening.sql で FK を ON DELETE SET NULL に
--   変更し「退会後も同意エビデンスを保持する」設計 (退会後5年保持) にしたが、
--   00006_legal_compliance.sql 由来の NOT NULL 制約を外し忘れていた。
--   そのため auth.users 削除時に FK の SET NULL が NOT NULL 違反を起こし、
--   Supabase ダッシュボードの Delete user が全ユーザーで
--   "Database error deleting user" となって失敗していた。
--
--   退会後の本人特定性は deleted_user_id / email_at_acceptance スナップショット
--   (00010 で追加) が担うため、user_id は NULL 許容で正しい。
alter table public.user_terms_acceptances
  alter column user_id drop not null;
