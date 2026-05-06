-- 00035: audit_logs スキーマを 00027 系に統一
--
-- 経緯:
--   - 00004_full_data_structure.sql で `user_id/action/entity_type/entity_id/metadata/ip_address`
--     の旧スキーマで CREATE
--   - 00027_chat_security_hardening.sql で `actor_id/action/target_type/target_id/payload/ip/ua`
--     の新スキーマで CREATE (CREATE IF NOT EXISTS により実 DB は旧スキーマのまま残った)
--   - `src/types/database.ts` および `writeAuditLog` ヘルパは 新スキーマで書こうとしていたが
--     カラム不一致で INSERT が黙って失敗 (本番 audit_logs は 0 件)
--
-- 方針:
--   - 実 DB を新スキーマ (00027 系) に ALTER で寄せる
--   - 既存レコードは 0 件なので互換性問題なし
--   - 旧カラム (user_id 等) は将来的な参照下位互換のため一旦残置 → 後続 migration で DROP

DO $$
BEGIN
  -- actor_id (uuid)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'actor_id'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- target_type (text)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'target_type'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN target_type text;
  END IF;

  -- target_id (text)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'target_id'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN target_id text;
  END IF;

  -- payload (jsonb)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'payload'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN payload jsonb;
  END IF;

  -- ip (text)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'ip'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN ip text;
  END IF;

  -- ua (text)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'ua'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN ua text;
  END IF;
END $$;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_type, target_id, created_at DESC);

-- PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
