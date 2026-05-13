-- Paneler design persistence. Single table; RLS scopes rows to the user_sub
-- (Dex-issued OIDC subject) set per request via `app.user_sub` GUC.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS designs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub   text NOT NULL,
  email      text,
  name       text NOT NULL DEFAULT 'Untitled',
  payload    jsonb NOT NULL,
  starred    boolean NOT NULL DEFAULT false,
  published  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS designs_user_sub_updated_idx
  ON designs (user_sub, updated_at DESC);

ALTER TABLE designs ENABLE ROW LEVEL SECURITY;
-- FORCE applies the policy to the table owner too. Without this, the owner
-- silently bypasses RLS.
ALTER TABLE designs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designs_isolate ON designs;
-- The SELECT wrapper enables initPlan caching so current_setting() is read
-- once per statement, not once per row.
CREATE POLICY designs_isolate ON designs
  FOR ALL
  USING (user_sub = (SELECT current_setting('app.user_sub', true)))
  WITH CHECK (user_sub = (SELECT current_setting('app.user_sub', true)));

-- Non-owner runtime role. Migrations connect as the owner; the request path
-- SET ROLEs to paneler_app so RLS applies even if FORCE is ever dropped.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paneler_app') THEN
    CREATE ROLE paneler_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO paneler_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON designs TO paneler_app;

-- Future tables created by the owner auto-grant CRUD to paneler_app so we
-- don't have to remember a GRANT in every migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO paneler_app;
