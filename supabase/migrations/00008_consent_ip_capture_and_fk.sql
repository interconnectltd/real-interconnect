-- Capture IP from PostgREST request headers in the consent sync trigger,
-- and seed the latest content version so referential integrity holds.
--
-- Note: auth.users INSERT is fired by Supabase GoTrue, which may or may not
-- propagate the original HTTP request headers into the PostgreSQL session
-- via current_setting('request.headers'). The trigger uses an EXCEPTION
-- block so a missing setting does not break signup; ip_address simply
-- becomes NULL in that case. The dedicated /api/v1/legal/accept route
-- supplies IP+UA on first authenticated request as a backup.

CREATE OR REPLACE FUNCTION public.sync_user_consent_from_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  consent_data jsonb;
  ua text;
  ip_text text;
  ip_inet inet;
  ts timestamptz;
  v_terms text;
  v_privacy text;
  v_tokushoho text;
BEGIN
  consent_data := COALESCE(NEW.raw_user_meta_data->'consent', '{}'::jsonb);
  IF consent_data = '{}'::jsonb OR consent_data IS NULL THEN
    RETURN NEW;
  END IF;

  v_terms := consent_data->>'terms_version';
  v_privacy := consent_data->>'privacy_version';
  v_tokushoho := consent_data->>'tokushoho_version';
  ua := consent_data->>'user_agent';
  ts := COALESCE(
    NULLIF(consent_data->>'accepted_at', '')::timestamptz,
    now()
  );

  BEGIN
    ip_text := split_part(
      current_setting('request.headers', true)::jsonb->>'x-forwarded-for',
      ',',
      1
    );
    IF ip_text IS NULL OR ip_text = '' THEN
      ip_text := current_setting('request.headers', true)::jsonb->>'x-real-ip';
    END IF;
    IF ip_text IS NOT NULL AND ip_text != '' THEN
      ip_inet := trim(ip_text)::inet;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    ip_inet := NULL;
  END;

  IF v_terms IS NOT NULL THEN
    INSERT INTO public.user_terms_acceptances (user_id, kind, version, accepted_at, ip_address, user_agent)
    VALUES (NEW.id, 'terms', v_terms, ts, ip_inet, ua)
    ON CONFLICT (user_id, kind, version) DO NOTHING;
  END IF;
  IF v_privacy IS NOT NULL THEN
    INSERT INTO public.user_terms_acceptances (user_id, kind, version, accepted_at, ip_address, user_agent)
    VALUES (NEW.id, 'privacy', v_privacy, ts, ip_inet, ua)
    ON CONFLICT (user_id, kind, version) DO NOTHING;
  END IF;
  IF v_tokushoho IS NOT NULL THEN
    INSERT INTO public.user_terms_acceptances (user_id, kind, version, accepted_at, ip_address, user_agent)
    VALUES (NEW.id, 'tokushoho', v_tokushoho, ts, ip_inet, ua)
    ON CONFLICT (user_id, kind, version) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO public.terms_versions (kind, version, effective_from)
VALUES
  ('terms',     '2026-05-03c', now()),
  ('privacy',   '2026-05-03c', now()),
  ('tokushoho', '2026-05-03c', now())
ON CONFLICT (kind, version) DO NOTHING;
