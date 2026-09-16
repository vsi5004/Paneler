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

-- Customer's fill choice, set by the order form. Null for every design made in
-- the designer. Free text rather than an enum: fill options vary per stitcher
-- and get configured per-account, so the database shouldn't pin the vocabulary.
-- Behaves like the other mirror columns.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS fill text;

-- Customer's special requests, set by the order form. Null otherwise.
--
-- Note what is NOT here: size. That is the finished diameter, and it already
-- lives in the GLB as LaserSettings.diameterIn, where it drives mmPerUnit() and
-- therefore the scale of every laser template. A column here would be a second
-- copy free to disagree with the file, and the copy here is the one that would
-- be wrong.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS note text;

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

-- Shop identity. Null/false for everyone who never sets one up; a stitcher
-- fills these in on the profile page and flips shop_published to go live.
--
-- shop_id is what the public URL carries. NEVER user_sub: for the Google
-- connector that is the user's Google account id, and this link gets pasted in
-- public. UNIQUE, so minting retries on 23505.
--
-- display_name is deliberately NOT unique. A URL must be stable and a display
-- name must stay freely renameable; those cannot share one column without a
-- rebrand breaking every link already printed or pasted. If readable URLs are
-- wanted later that is a separate `handle` column, which is where uniqueness
-- belongs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_id        text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key     text;
-- Fill materials the stitcher stocks, as plain strings. Shown on the order form
-- as a note so a customer can ask for one in their order note.
ALTER TABLE users ADD COLUMN IF NOT EXISTS fill_materials jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_published boolean NOT NULL DEFAULT false;

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
--
-- ⚠ ANY new writable column on users MUST be listed here. The REVOKE above
-- removed table-level UPDATE, so only the columns named below come back. An
-- omitted column fails at runtime with 42501 permission denied and passes every
-- unit test — that has already shipped once, with updated_at.
GRANT UPDATE (email, fabrics, api_key_hash, api_key_created_at,
              api_key_last_used, prev_key_hash, prev_key_expires,
              shop_id, display_name, avatar_key, fill_materials,
              shop_published, updated_at)
  ON users TO paneler_app;

-- Backfill from existing designs. DISTINCT ON needs the leading ORDER BY key
-- to match; updated_at DESC picks each user's most recent email.
--
-- The NO FORCE sandwich is REQUIRED, and its absence fails silently. Migrations
-- run as the table owner, and FORCE ROW LEVEL SECURITY applies the policy to
-- the owner too — with app.user_sub unset, the owner sees zero rows, so the
-- SELECT matches nothing and the INSERT quietly does nothing. Verified on
-- production: `SET ROLE paneler; SELECT count(*) FROM designs` returns 0.
--
-- This is safe. FORCE governs only the OWNER's visibility; paneler_app stays
-- subject to RLS throughout because row security remains ENABLED on both
-- tables. The migrator is the only owner connection.
--
-- NOTE FOR FUTURE MIGRATIONS: any migration that READS an RLS-forced table
-- needs this treatment. It will not show up in local testing — docker-compose
-- runs `paneler` as a superuser (bypassrls), so the owner sees everything
-- locally and nothing in production.
ALTER TABLE designs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users   NO FORCE ROW LEVEL SECURITY;

INSERT INTO users (user_sub, email)
SELECT DISTINCT ON (user_sub) user_sub, email
FROM designs
ORDER BY user_sub, updated_at DESC
ON CONFLICT (user_sub) DO NOTHING;

ALTER TABLE designs FORCE ROW LEVEL SECURITY;
ALTER TABLE users   FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Shops, order items, and the public read path.
--
-- A stitcher publishes a shop (the users columns above) listing order items,
-- each pinned to one of their designs. A customer opens the shop link, recolors
-- the ball, and submits — and the order arrives as an ORDINARY designs row in
-- the stitcher's account. There is no orders table on purpose: an order IS a
-- design, which is what lets the stitcher open it in the designer and cut laser
-- templates from it without any new view.
-- ---------------------------------------------------------------------------

-- The role the shop pages read as. It exists because those pages render before
-- anyone signs in, so there is no app.user_sub to scope RLS with — and neither
-- alternative is acceptable: withOwner is not a bypass (FORCE ROW LEVEL
-- SECURITY applies to the owner too), and impersonating the stitcher by setting
-- the GUC would hand the app a read-anyone primitive.
--
-- It can SELECT and nothing else. Its column grants at the bottom of this file
-- are the real control: api_key_hash and email are not merely policy-protected,
-- they do not exist for this role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paneler_public') THEN
    CREATE ROLE paneler_public NOLOGIN;
  END IF;
END $$;

GRANT paneler_public TO paneler;   -- required for SET ROLE from the owner
GRANT USAGE ON SCHEMA public TO paneler_public;

CREATE TABLE IF NOT EXISTS order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    text NOT NULL,
  -- Deleting the pinned design retires the item. Orders already placed are
  -- independent designs rows and survive it.
  design_id   uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  -- Finished diameters this stitcher will make, inches. Numbers drawn from the
  -- same ladder as the designer's own slider (MIN_DIAMETER_IN..MAX_DIAMETER_IN
  -- in lib/laser/constants.ts) — the customer's pick ends up as diameterIn in
  -- the submitted GLB, not in a column.
  sizes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Display order on the shop page. Assigned on insert (max + 1) and never
  -- changed: items appear in the order they were created. There is deliberately
  -- no reorder UI — the list is short and nobody has wanted one.
  position    int NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_user_position_idx
  ON order_items (user_sub, position);
CREATE INDEX IF NOT EXISTS users_shop_id_idx ON users (shop_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_items_isolate ON order_items;
CREATE POLICY order_items_isolate ON order_items
  FOR ALL
  USING (user_sub = (SELECT current_setting('app.user_sub', true)))
  WITH CHECK (user_sub = (SELECT current_setting('app.user_sub', true)));

-- Scoped TO paneler_public, and that is a TIGHTENING of what was here before.
--
-- This policy originally had no TO clause, because designs_order_insert had to
-- see an item while evaluating in a signed-in customer's own session: a policy
-- expression that references another table is subject to THAT table's RLS, so
-- scoping this one would have made every order insert fail with a message
-- naming nothing. That policy is gone - orders are emailed now, not stored - so
-- the exception can go too, and published items are once again visible only
-- through the public read path.
--
-- Still no cross-table EXISTS on users.shop_published: it would have the same
-- defect one level deeper. `published` is the single gate, and setShop() keeps
-- that honest by unpublishing every item when the shop goes offline.
CREATE POLICY order_items_public_read ON order_items
  FOR SELECT TO paneler_public
  USING (published);

-- Shop identity for the public pages. TO paneler_public IS load-bearing here,
-- unlike order_items above: paneler_app holds table-level SELECT on users, so
-- an unscoped policy would let any signed-in user read any published stitcher's
-- email and API-key metadata.
DROP POLICY IF EXISTS users_public_read ON users;
CREATE POLICY users_public_read ON users
  FOR SELECT TO paneler_public
  USING (shop_published);

-- Only a design pinned by a published item — rather than reusing
-- designs.published, which is an inert flag reserved for the public gallery.
DROP POLICY IF EXISTS designs_public_item_read ON designs;
CREATE POLICY designs_public_item_read ON designs
  FOR SELECT TO paneler_public
  USING (EXISTS (SELECT 1 FROM order_items i
                  WHERE i.design_id = designs.id AND i.published));

-- NOTE: there is deliberately no cross-account INSERT policy on designs.
-- An earlier design had orders arrive as rows in the stitcher's account, which
-- needed one. Orders are now emailed instead and nothing is stored, so the only
-- way to write a designs row is designs_isolate: your own account, nobody
-- else's. If order storage ever returns, that policy is in this file's history
-- along with the reason it had to be checked in the customer's own session.
DROP POLICY IF EXISTS designs_order_insert ON designs;

-- order_items picks up CRUD for paneler_app from ALTER DEFAULT PRIVILEGES
-- above, but state it explicitly so correctness doesn't depend on where in this
-- file the table is declared.
GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO paneler_app;

-- paneler_public: SELECT only, column-scoped. The columns omitted here are
-- unreachable for this role no matter what any policy says.
-- `email` is in this list as of the order-notification flow, and it is a
-- deliberate narrowing of an earlier claim: this role could previously not read
-- it at all. An order now has no database row - the email IS the order - so the
-- public submission path must be able to learn where to send it.
--
-- What still holds is the part that mattered: api_key_hash and prev_key_hash
-- remain unreachable for this role, and getPublicShop() returns a purpose-built
-- object rather than a row, so a widened SELECT cannot leak the address to a
-- browser by accident. Only getShopNotifyEmail() reads it, and it returns
-- nothing else.
GRANT SELECT (user_sub, shop_id, display_name, avatar_key, fabrics,
              fill_materials, shop_published, email)
  ON users TO paneler_public;
-- created_at is in this list because getPublicShop ORDERs BY it. Column-level
-- SELECT covers every column a statement TOUCHES, not just the ones it returns
-- — an ORDER BY, WHERE, or JOIN on an ungranted column fails with
-- "permission denied for table order_items" and names no column, which is the
-- same trap the users UPDATE grant hit with updated_at.
GRANT SELECT (id, user_sub, design_id, title, description, sizes, position,
              published, created_at)
  ON order_items TO paneler_public;
GRANT SELECT (id, glb_key, name, panel_count) ON designs TO paneler_public;
