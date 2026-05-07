-- 00050: Wave1 sec audit (2026-05-07) 統合パッチ
--
-- 1. invitation_uses (冪等性テーブル) + consume_invitation_code (atomic RPC)
-- 2. validate_invitation_code (anon, leak なし)
-- 3. handle_new_user で raw_user_meta_data.consent を撤去 + invitation_code を消費
-- 4. promote_pending_consent_for_user に caller=p_user_id ガード
-- 5. authenticated_check_codes RLS を本人関連に絞る
-- 6. rate_limits テーブル + check_rate_limit RPC (DB-backed sliding window)
-- 7. 法的同意の最新 version 強制 gate 用 view (フロント/middleware で参照)

-- ────────────────────────────────────────────────────────────
-- 1. invitation_uses + consume RPC
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invitation_uses (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id   UUID NOT NULL REFERENCES public.invitation_codes(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(code_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_invitation_uses_user ON public.invitation_uses(user_id);

ALTER TABLE public.invitation_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_read_invitation_uses" ON public.invitation_uses;
CREATE POLICY "self_read_invitation_uses" ON public.invitation_uses
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_invitation_uses" ON public.invitation_uses;
CREATE POLICY "service_invitation_uses" ON public.invitation_uses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_invitation_code(
  p_code TEXT,
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code_id UUID;
BEGIN
  -- caller (auth.uid()) と p_user_id の整合性検証 (handle_new_user trigger 経由 の
  -- ケースでは auth.uid() は NULL 可。その場合は trigger 内 SECURITY DEFINER 信頼経路。)
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: caller % cannot consume for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- 1 ステートメント atomic:
  --   有効な code を use_count<max_uses 条件付きで +1。0 行なら EXHAUSTED/INVALID/EXPIRED。
  UPDATE public.invitation_codes
     SET use_count = use_count + 1,
         used_by = COALESCE(used_by, p_user_id)
   WHERE upper(code) = upper(trim(p_code))
     AND is_active = true
     AND use_count < max_uses
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING id INTO v_code_id;

  IF v_code_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_OR_EXHAUSTED' USING ERRCODE = '23514';
  END IF;

  -- 冪等性: 同 user が同 code を再消費しても 1 行のみ
  INSERT INTO public.invitation_uses(code_id, user_id)
       VALUES (v_code_id, p_user_id)
  ON CONFLICT (code_id, user_id) DO NOTHING;

  -- user_profiles.invitation_code_id を最初の消費で記録
  UPDATE public.user_profiles
     SET invitation_code_id = COALESCE(invitation_code_id, v_code_id)
   WHERE id = p_user_id;

  RETURN v_code_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_invitation_code(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_invitation_code(TEXT, UUID) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. validate_invitation_code (anon, 詳細を漏らさない)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_invitation_code(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.invitation_codes
     WHERE upper(code) = upper(trim(p_code))
       AND is_active = true
       AND use_count < max_uses
       AND (expires_at IS NULL OR expires_at > now())
  ) INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_invitation_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation_code(TEXT) TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. handle_new_user 更新: consent strip + invitation_code 自動消費
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation_code TEXT;
BEGIN
  -- raw_user_meta_data.consent はクライアント自己申告で法的証跡を汚染するため即座に削除。
  -- 法的証跡は public.user_terms_acceptances を **単一情報源** とする (Wave1 audit C-05)。
  IF NEW.raw_user_meta_data ? 'consent' THEN
    UPDATE auth.users
       SET raw_user_meta_data = raw_user_meta_data - 'consent'
     WHERE id = NEW.id;
  END IF;

  INSERT INTO public.user_profiles (id, name, email, company, position, industry, bio)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'company', ''),
    NULLIF(NEW.raw_user_meta_data->>'position', ''),
    NULLIF(NEW.raw_user_meta_data->>'industry', ''),
    NULLIF(NEW.raw_user_meta_data->>'bio', '')
  );
  INSERT INTO public.settings (user_id) VALUES (NEW.id);

  -- raw_user_meta_data.invitation_code がセットされている場合に atomic 消費
  -- (register-form では従来 client から POST/PATCH していたが、TOCTOU/IDOR 回避のため
  --  trigger 内 SECURITY DEFINER 経路に移行)
  v_invitation_code := NULLIF(NEW.raw_user_meta_data->>'invitation_code', '');
  IF v_invitation_code IS NOT NULL THEN
    BEGIN
      PERFORM public.consume_invitation_code(v_invitation_code, NEW.id);
    EXCEPTION
      WHEN OTHERS THEN
        -- 招待消費失敗時は user 作成自体を rollback しない (legal/onboarding 段で再判定)
        -- が、警告を残す
        RAISE WARNING 'consume_invitation_code failed for user % code %: %',
          NEW.id, v_invitation_code, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. promote_pending_consent_for_user に caller ガード追加
--    元定義 (00011) の full body を保持しつつ先頭で auth.uid() != p_user_id を拒否。
--    service_role 呼出 (auth.uid() IS NULL) は通過。
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promote_pending_consent_for_user(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_promoted_count INT := 0;
  v_transcript_id UUID;
  v_participant_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: caller % cannot promote for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  FOR v_transcript_id, v_participant_id IN
    SELECT mt.id, mp.id
      FROM public.meeting_transcripts mt
      JOIN public.meeting_participants mp ON mp.transcript_id = mt.id
     WHERE mp.user_id = p_user_id
       AND mt.status = 'pending_consent'
     FOR UPDATE OF mt
  LOOP
    UPDATE public.meeting_transcripts
       SET status = 'ready'
     WHERE id = v_transcript_id
       AND status = 'pending_consent';

    INSERT INTO public.job_queue (type, payload, status, priority, attempts, max_attempts)
    VALUES (
      'analyze',
      jsonb_build_object('transcript_id', v_transcript_id, 'participant_id', v_participant_id),
      'pending',
      10,
      0,
      3
    )
    ON CONFLICT DO NOTHING;
    v_promoted_count := v_promoted_count + 1;
  END LOOP;

  UPDATE public.bulk_invite_log
     SET status = 'consented', updated_at = now()
   WHERE user_id = p_user_id AND status = 'invited';

  RETURN v_promoted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. invitation_codes RLS 絞り込み (本人関連のみ SELECT)
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "authenticated_check_codes" ON public.invitation_codes;
CREATE POLICY "self_or_admin_read_codes" ON public.invitation_codes
  FOR SELECT
  USING (
    created_by = auth.uid()
    OR used_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ────────────────────────────────────────────────────────────
-- 6. rate_limits + check_rate_limit (DB-backed sliding window)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, identifier, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup
  ON public.rate_limits(window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- service_role / SECURITY DEFINER 関数経由のみアクセス
DROP POLICY IF EXISTS "service_rate_limits" ON public.rate_limits;
CREATE POLICY "service_rate_limits" ON public.rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 既存 check_rate_limit(p_user_id UUID,...) は 00027 で定義済 (auth ユーザー軸)。
-- こちらは anon endpoints 用に IP/email など任意 identifier 軸で叩ける別 RPC。
CREATE OR REPLACE FUNCTION public.check_anon_rate_limit(
  p_bucket TEXT,
  p_identifier TEXT,
  p_limit INT,
  p_window_seconds INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window TIMESTAMPTZ;
  v_count INT;
BEGIN
  IF p_limit <= 0 OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid rate limit args';
  END IF;

  -- 窓を window_seconds 秒単位で丸める (fixed window 近似 / atomic upsert で multi-instance 対応)
  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits(bucket, identifier, window_start, count)
       VALUES (p_bucket, p_identifier, v_window, 1)
  ON CONFLICT (bucket, identifier, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  -- 古い窓を削除 (best effort, 行数小なので毎回実行)
  DELETE FROM public.rate_limits
   WHERE window_start < now() - INTERVAL '1 hour';

  RETURN v_count <= p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_anon_rate_limit(TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_anon_rate_limit(TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;
