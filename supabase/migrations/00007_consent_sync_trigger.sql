-- Trigger that copies signUp consent metadata into user_terms_acceptances
-- on auth.users INSERT. Eliminates the post-signup session race condition.

CREATE OR REPLACE FUNCTION public.sync_user_consent_from_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  consent_data jsonb;
  ua text;
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

  IF v_terms IS NOT NULL THEN
    INSERT INTO public.user_terms_acceptances (user_id, kind, version, accepted_at, user_agent)
    VALUES (NEW.id, 'terms', v_terms, ts, ua)
    ON CONFLICT (user_id, kind, version) DO NOTHING;
  END IF;
  IF v_privacy IS NOT NULL THEN
    INSERT INTO public.user_terms_acceptances (user_id, kind, version, accepted_at, user_agent)
    VALUES (NEW.id, 'privacy', v_privacy, ts, ua)
    ON CONFLICT (user_id, kind, version) DO NOTHING;
  END IF;
  IF v_tokushoho IS NOT NULL THEN
    INSERT INTO public.user_terms_acceptances (user_id, kind, version, accepted_at, user_agent)
    VALUES (NEW.id, 'tokushoho', v_tokushoho, ts, ua)
    ON CONFLICT (user_id, kind, version) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_consent_trigger ON auth.users;
CREATE TRIGGER sync_user_consent_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_consent_from_metadata();
