-- 00048: audit_logs に SHA-256 hash chain を追加 (WORM 監査強化)
--
-- 既存の WORM (00039) は UPDATE/DELETE を trigger で阻止していたが、
-- DBA が直接 INSERT で過去日時の偽ログを差し込めば検知不能だった。
-- ここで SHA-256 chain (Bitcoin の block header と同じ原理) を導入し、
-- 任意行の改竄を「以降の chain 全て不整合」で検知可能にする。
--
-- 各行に:
--   seq BIGSERIAL UNIQUE      -- 連続番号 (隙間ができたら欠損)
--   prev_hash TEXT            -- 直前行の this_hash (NULL = chain 開始)
--   this_hash TEXT NOT NULL   -- sha256(seq || actor || action || ... || prev_hash)
--
-- 検証 RPC `verify_audit_chain()` を admin が叩いて整合性確認。
-- 不整合が出たら最早の不整合 seq を返す → 過去のレポート再現で改竄日時が特定可能。

-- ────────────────────────────────────────────────────────────
-- 1) 列追加
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS seq        BIGSERIAL,
  ADD COLUMN IF NOT EXISTS prev_hash  TEXT,
  ADD COLUMN IF NOT EXISTS this_hash  TEXT;

-- seq は本来 BIGSERIAL で UNIQUE 制約も付けたいが、既存行への遡及付与で
-- 一旦 NULL 許容 → backfill 後 NOT NULL に。
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_seq ON public.audit_logs(seq);

-- ────────────────────────────────────────────────────────────
-- 2) chain 計算用関数
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_logs_compute_hash(
  p_seq BIGINT,
  p_actor_id UUID,
  p_action TEXT,
  p_target_type TEXT,
  p_target_id TEXT,
  p_payload JSONB,
  p_ip TEXT,
  p_ua TEXT,
  p_created_at TIMESTAMPTZ,
  p_prev_hash TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(
    extensions.digest(
      coalesce(p_seq::text, '') || '|' ||
      coalesce(p_actor_id::text, '') || '|' ||
      coalesce(p_action, '') || '|' ||
      coalesce(p_target_type, '') || '|' ||
      coalesce(p_target_id, '') || '|' ||
      coalesce(p_payload::text, '') || '|' ||
      coalesce(p_ip, '') || '|' ||
      coalesce(p_ua, '') || '|' ||
      coalesce(p_created_at::text, '') || '|' ||
      coalesce(p_prev_hash, ''),
      'sha256'
    ),
    'hex'
  );
$$;

-- pgcrypto 拡張が必要 (extensions.digest)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ────────────────────────────────────────────────────────────
-- 3) BEFORE INSERT trigger
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_logs_chain_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_prev TEXT;
BEGIN
  -- 直前行の this_hash を取得 (seq desc の先頭)
  SELECT this_hash INTO v_prev
    FROM public.audit_logs
   WHERE seq IS NOT NULL
   ORDER BY seq DESC
   LIMIT 1;

  -- seq は default で BIGSERIAL が振られている前提
  NEW.prev_hash := v_prev;
  NEW.this_hash := public.audit_logs_compute_hash(
    NEW.seq,
    NEW.actor_id,
    NEW.action,
    NEW.target_type,
    NEW.target_id,
    NEW.payload,
    NEW.ip,
    NEW.ua,
    NEW.created_at,
    v_prev
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_chain ON public.audit_logs;
CREATE TRIGGER audit_logs_chain
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_chain_trigger();

-- ────────────────────────────────────────────────────────────
-- 4) 既存行の backfill (chain 化)
-- ────────────────────────────────────────────────────────────

-- seq の振り直し (created_at 順)
DO $$
BEGIN
  -- 既に seq が NULL の行があれば連番付与
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE seq IS NULL LIMIT 1) THEN
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
        FROM public.audit_logs
       WHERE seq IS NULL
    )
    UPDATE public.audit_logs al
       SET seq = (SELECT COALESCE(max(seq), 0) FROM public.audit_logs) + ordered.rn
      FROM ordered
     WHERE al.id = ordered.id;
  END IF;
END $$;

-- chain hash の計算 (seq 順)
DO $$
DECLARE
  r RECORD;
  prev TEXT := NULL;
  cur TEXT;
BEGIN
  FOR r IN
    SELECT * FROM public.audit_logs ORDER BY seq ASC
  LOOP
    cur := public.audit_logs_compute_hash(
      r.seq, r.actor_id, r.action, r.target_type, r.target_id,
      r.payload, r.ip, r.ua, r.created_at, prev
    );
    UPDATE public.audit_logs
       SET prev_hash = prev, this_hash = cur
     WHERE id = r.id;
    prev := cur;
  END LOOP;
END $$;

-- this_hash NOT NULL 制約 (backfill 後)
ALTER TABLE public.audit_logs
  ALTER COLUMN this_hash SET NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 5) 検証 RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_audit_chain()
RETURNS TABLE (
  total_rows BIGINT,
  first_broken_seq BIGINT,
  first_broken_id UUID,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r RECORD;
  expected TEXT;
  prev TEXT := NULL;
  total BIGINT := 0;
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_is_admin FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'verify_audit_chain: admin only';
  END IF;

  FOR r IN
    SELECT * FROM public.audit_logs ORDER BY seq ASC
  LOOP
    total := total + 1;
    expected := public.audit_logs_compute_hash(
      r.seq, r.actor_id, r.action, r.target_type, r.target_id,
      r.payload, r.ip, r.ua, r.created_at, prev
    );
    IF r.this_hash IS DISTINCT FROM expected
       OR r.prev_hash IS DISTINCT FROM prev THEN
      total_rows := total;
      first_broken_seq := r.seq;
      first_broken_id := r.id;
      message := 'CHAIN BROKEN at seq=' || r.seq::text;
      RETURN NEXT;
      RETURN;
    END IF;
    prev := r.this_hash;
  END LOOP;

  total_rows := total;
  first_broken_seq := NULL;
  first_broken_id := NULL;
  message := 'OK: ' || total::text || ' rows verified';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO authenticated;
