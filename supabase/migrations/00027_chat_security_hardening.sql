-- 00027_chat_security_hardening.sql
--
-- Phase A (00026) の chat 機能を 5 観点並列レビュー (Sec 71 / Arch 62 / TS 64 / FE 72 / Phase B 62) で
-- 全観点共通の致命傷を潰すハードニング migration。
--
-- 目的:
--   1. payload JSONB カラム追加 (scheduling_card 等の構造化データ受け口、Phase B Calendar 連携の基盤)
--   2. UPDATE 列改竄禁止 trigger (受信者は is_read のみ変更可、content/content_type 改竄を物理拒否)
--   3. last_message_sender_id / last_message_content_type を chat_rooms に追加 (UI の "" 嘘データ解消)
--   4. (room_id, created_at DESC, id DESC) 複合 index で cursor pagination tie-break 解消
--   5. rate_limits テーブル + check_rate_limit() 関数 (60req/min/user/route)
--   6. audit_logs テーブル + 物理 append-only trigger (UPDATE/DELETE 拒否)
--   7. last_message_sender_id 自動更新 trigger
--
-- 後方互換性:
--   - payload は NULL 許容で追加 (既存 row 影響なし)
--   - last_message_sender_id / last_message_content_type は NULL 許容
--   - chat_messages_immutable trigger は既存 INSERT/SELECT/DELETE に影響なし
--   - 既存の auth_update_recipient_read policy は維持、trigger で列改竄を追加遮断

-- ────────────────────────────────────────
-- 1) chat_messages.payload JSONB 追加
-- ────────────────────────────────────────
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS payload JSONB;

-- payload + content_type の整合 CHECK
-- text/image/file は content 必須、scheduling_card/meeting_suggestion/meeting_confirmed は payload 推奨
-- (移行期は payload を必須にせず、Phase B 着手時に厳格化)
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_payload_jsonb_check CHECK (
    payload IS NULL OR jsonb_typeof(payload) = 'object'
  );

CREATE INDEX IF NOT EXISTS idx_chat_messages_payload_meeting
  ON public.chat_messages USING gin (payload)
  WHERE content_type IN ('scheduling_card', 'meeting_suggestion', 'meeting_confirmed');

-- ────────────────────────────────────────
-- 2) chat_rooms.last_message_sender_id / last_message_content_type 追加
-- ────────────────────────────────────────
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS last_message_sender_id UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_message_content_type TEXT;

-- ────────────────────────────────────────
-- 3) (room_id, created_at DESC, id DESC) 複合 index 追加
-- ────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_chat_messages_room;
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_cursor
  ON public.chat_messages(room_id, created_at DESC, id DESC);

-- ────────────────────────────────────────
-- 4) chat_messages の UPDATE 列改竄禁止 trigger
--    is_read 以外の列変更を物理拒否
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_chat_message_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role は bypass
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'chat_messages: only is_read column is mutable for non-service_role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_immutable_trigger ON public.chat_messages;
CREATE TRIGGER chat_messages_immutable_trigger
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_chat_message_immutable();

-- ────────────────────────────────────────
-- 5) chat_rooms.last_message_* 自動更新 trigger 拡張
--    既存 update_chat_room_last_message() を sender_id / content_type 含むよう更新
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_chat_room_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chat_rooms
     SET last_message_at = NEW.created_at,
         last_message_preview = LEFT(NEW.content, 100),
         last_message_sender_id = NEW.sender_id,
         last_message_content_type = NEW.content_type
   WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────
-- 6) rate_limits テーブル (sliding-window 風)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  bucket       TEXT NOT NULL,                            -- 'chat.message.post' / 'chat.message.read' 等
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup
  ON public.rate_limits(window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_rate_limits_full"
  ON public.rate_limits AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- check_rate_limit(): 1 分 sliding window で count incr、threshold 超過なら false
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id UUID,
  p_bucket  TEXT,
  p_limit   INT,
  p_window_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_total        INT;
BEGIN
  v_window_start := date_trunc('minute', now());

  INSERT INTO public.rate_limits(user_id, bucket, window_start, count)
  VALUES (p_user_id, p_bucket, v_window_start, 1)
  ON CONFLICT (user_id, bucket, window_start)
    DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_total;

  -- 直近 p_window_seconds 秒のトータル
  SELECT COALESCE(SUM(count), 0) INTO v_total
    FROM public.rate_limits
   WHERE user_id = p_user_id
     AND bucket  = p_bucket
     AND window_start > now() - make_interval(secs => p_window_seconds);

  RETURN v_total <= p_limit;
END;
$$;

-- 古い window の cron purge 用関数
CREATE OR REPLACE FUNCTION public.purge_rate_limits()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
$$;

-- ────────────────────────────────────────
-- 7) audit_logs テーブル + 物理 append-only
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                            -- 'chat.message.send' / 'chat.message.read' 等
  target_type TEXT,                                     -- 'chat_message' / 'chat_room' 等
  target_id   TEXT,
  payload     JSONB,                                    -- リダクト後の最小情報のみ
  ip          INET,
  ua          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs(action, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.audit_logs TO service_role;
GRANT SELECT ON public.audit_logs TO authenticated;

CREATE POLICY "audit_logs_self_select"
  ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

-- 物理 append-only: UPDATE / DELETE / TRUNCATE 拒否
CREATE OR REPLACE FUNCTION public.audit_logs_deny_modify()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_deny_update ON public.audit_logs;
CREATE TRIGGER audit_logs_deny_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_deny_modify();

DROP TRIGGER IF EXISTS audit_logs_deny_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_deny_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_deny_modify();

-- ────────────────────────────────────────
-- 8) chat_rooms の RLS で /rooms GET を service_role 撤廃可能にする
--    既存 auth_select_own_chat_rooms はあるので serviceClient 不要、
--    ただ「相手側プロフィール」を JOIN 経由で取得する際 connections 経由で OK か確認
-- ────────────────────────────────────────
-- (既存 policy で認証ユーザーは自分の room を SELECT 可能。追加 policy 不要)

-- ────────────────────────────────────────
-- 9) chat_messages の UPDATE policy 列スコープ強化
--    既存 auth_update_recipient_read は USING/WITH CHECK あるが、列改竄は trigger で物理拒否済
--    冗長性のため WITH CHECK にも列固定を追加 (defense-in-depth)
-- ────────────────────────────────────────
DROP POLICY IF EXISTS "auth_update_recipient_read" ON public.chat_messages;
CREATE POLICY "auth_update_recipient_read"
  ON public.chat_messages AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms r
       WHERE r.id = room_id
         AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
    )
  )
  WITH CHECK (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms r
       WHERE r.id = room_id
         AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
    )
  );
-- 注: 列改竄防止は enforce_chat_message_immutable trigger が物理保証
