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

-- Customer's fill choice, set by the embed order flow. Null for every design
-- made in the designer. Free text rather than an enum: fill options vary per
-- stitcher and get configured per-account, so the database shouldn't pin the
-- vocabulary. Behaves like the other mirror columns.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS fill text;

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


-- ---------------------------------------------------------------------------
-- users — per-account settings. Identity itself comes from the Dex-issued OIDC
-- subject in the JWT; this row is the place to hang anything keyed to it.
--
-- Populated two ways, so no explicit migration step is ever needed: the
-- backfill below catches everyone who already has a design, and
-- ensureUserProfile() upserts on the next authenticated request for everyone
-- else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  user_sub           text PRIMARY KEY,
  email              text,
  -- Fabric list the stitcher stocks. Array of
  --   {"kind":"catalog","id":"lx-red"}
  --   {"kind":"custom","id":"custom:a1b2c3","label":"...","color":"#rrggbb"}
  -- Order is display order. jsonb rather than rows: always read and written
  -- whole by its owner, never queried across users.
  fabrics            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Gate for the whole API-key feature. Granted by hand as the owner; see the
  -- column-privilege note below for why the app cannot set this itself.
  api_key_enabled    boolean NOT NULL DEFAULT false,
  api_key_hash       text UNIQUE,
  api_key_created_at timestamptz,
  api_key_last_used  timestamptz,
  -- Rotation grace window: the previous key keeps working until prev_key_expires
  -- so regenerating doesn't break a live site the instant the button is clicked.
  prev_key_hash      text,
  prev_key_expires   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_isolate ON users;
CREATE POLICY users_isolate ON users
  FOR ALL
  USING (user_sub = (SELECT current_setting('app.user_sub', true)))
  WITH CHECK (user_sub = (SELECT current_setting('app.user_sub', true)));

-- Explicit grants rather than relying on ALTER DEFAULT PRIVILEGES above, so
-- correctness doesn't depend on where in this file the table is declared.
--
-- IMPORTANT: RLS does NOT protect api_key_enabled. The policy is row-level —
-- a user's own row satisfies both USING and WITH CHECK, so the policy happily
-- permits them to update ANY column in it, including that one. Column-level
-- privileges are what actually stop a user granting themselves API access, and
-- they hold regardless of application bugs, a careless SELECT *, or injection.
--
-- The REVOKE is required because ALTER DEFAULT PRIVILEGES (above) already
-- handed paneler_app table-level INSERT and UPDATE at creation time; without
-- the revoke, a row could be created with the flag already set. Both
-- orderings are idempotent, so this is safe to re-run on every boot.
GRANT SELECT, DELETE ON users TO paneler_app;
REVOKE INSERT, UPDATE ON users FROM paneler_app;
GRANT INSERT (user_sub, email) ON users TO paneler_app;
GRANT UPDATE (email, fabrics, api_key_hash, api_key_created_at,
              api_key_last_used, prev_key_hash, prev_key_expires,
              updated_at)
  ON users TO paneler_app;

-- Backfill from existing designs. DISTINCT ON needs the leading ORDER BY key
-- to match; updated_at DESC picks each user's most recent email.
INSERT INTO users (user_sub, email)
SELECT DISTINCT ON (user_sub) user_sub, email
FROM designs
ORDER BY user_sub, updated_at DESC
ON CONFLICT (user_sub) DO NOTHING;
