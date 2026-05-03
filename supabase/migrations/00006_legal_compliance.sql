-- Legal compliance migration: terms_versions / user_terms_acceptances
-- Records which version of each legal document each user agreed to,
-- with IP and user-agent for evidence preservation.

CREATE TABLE IF NOT EXISTS public.terms_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('terms', 'privacy', 'tokushoho')),
  version TEXT NOT NULL,
  content_hash TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

CREATE INDEX IF NOT EXISTS idx_terms_versions_kind_effective
  ON public.terms_versions (kind, effective_from DESC);

ALTER TABLE public.terms_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read terms_versions" ON public.terms_versions;
CREATE POLICY "Anyone can read terms_versions"
  ON public.terms_versions FOR SELECT
  USING (true);

CREATE TABLE IF NOT EXISTS public.user_terms_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('terms', 'privacy', 'tokushoho')),
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT,
  UNIQUE (user_id, kind, version)
);

CREATE INDEX IF NOT EXISTS idx_user_terms_acceptances_user
  ON public.user_terms_acceptances (user_id, kind);

ALTER TABLE public.user_terms_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own acceptances" ON public.user_terms_acceptances;
CREATE POLICY "Users can read own acceptances"
  ON public.user_terms_acceptances FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT/UPDATE は service_role 経由のみ許可。明示policyなしでRLSにより遮断される。

-- Seed current versions
INSERT INTO public.terms_versions (kind, version, effective_from)
VALUES
  ('terms',     '2026-05-03b', now()),
  ('privacy',   '2026-05-03b', now()),
  ('tokushoho', '2026-05-03b', now())
ON CONFLICT (kind, version) DO NOTHING;
