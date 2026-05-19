-- Paneler design persistence. Single table; RLS scopes rows to the user_sub
-- (Dex-issued OIDC subject) set per request via `app.user_sub` GUC.
--
-- The GLB-source-of-truth refactor moved geometry + colors into a binary
-- glTF blob stored in Cloudflare R2; the row keeps the R2 key + a handful
-- of queryable mirror fields refreshed on every save.
--
-- This whole file is idempotent — the migrator re-applies it on every boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fresh-DB shape (new installations).
CREATE TABLE IF NOT EXISTS designs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub        text NOT NULL,
  email           text,
  name            text NOT NULL DEFAULT 'Untitled',
  glb_key         text NOT NULL,
  glb_etag        text,
  glb_size_bytes  int,
  thumbnail_key   text,
  panel_count     int,
  shape_signature text,
  palette_hash    text,
  source          text,
  template_slug   text,
  starred         boolean NOT NULL DEFAULT false,
  published       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Upgrade path from the previous payload-jsonb schema. We wipe the table —
-- the old Design objects (modelType + panelColors records) have no carryover
-- to the GLB era — then drop the old column and bring in the new ones.
-- IF EXISTS guards the DO block so it's a no-op on already-migrated DBs.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'designs' AND column_name = 'payload'
  ) THEN
    TRUNCATE TABLE designs;
    ALTER TABLE designs DROP COLUMN payload;
    ALTER TABLE designs ADD COLUMN glb_key text NOT NULL;
    ALTER TABLE designs ADD COLUMN glb_etag text;
    ALTER TABLE designs ADD COLUMN glb_size_bytes int;
    ALTER TABLE designs ADD COLUMN thumbnail_key text;
    ALTER TABLE designs ADD COLUMN panel_count int;
    ALTER TABLE designs ADD COLUMN shape_signature text;
    ALTER TABLE designs ADD COLUMN palette_hash text;
    ALTER TABLE designs ADD COLUMN source text;
    ALTER TABLE designs ADD COLUMN template_slug text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS designs_user_sub_updated_idx
  ON designs (user_sub, updated_at DESC);
CREATE INDEX IF NOT EXISTS designs_user_panel_count_idx
  ON designs (user_sub, panel_count);
CREATE INDEX IF NOT EXISTS designs_user_shape_idx
  ON designs (user_sub, shape_signature);

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

-- Required for `SET ROLE paneler_app` from the owner connection. Without
-- this, Postgres rejects the SET with "permission denied to set role" (42501)
-- — the owner must be a member of the target role to assume it.
GRANT paneler_app TO paneler;

GRANT USAGE ON SCHEMA public TO paneler_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON designs TO paneler_app;

-- Future tables created by the owner auto-grant CRUD to paneler_app so we
-- don't have to remember a GRANT in every migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO paneler_app;
