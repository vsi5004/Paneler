// Schema + RLS smoke test. Skipped unless TEST_DATABASE_URL is set so vitest
// in a vanilla CI environment without a database stays green.
//
// Run locally with:
//   TEST_DATABASE_URL=postgres://paneler:paneler@localhost:5432/paneler \
//     npx vitest run __tests__/schema.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;

(url ? describe : describe.skip)("schema + RLS smoke", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    // Reset state so re-runs are deterministic. paneler_app may own grants
    // on existing public-schema objects from a prior run — REASSIGN them to
    // the connecting role, then DROP OWNED to remove the role's privileges,
    // then DROP ROLE.
    await client.query("DROP TABLE IF EXISTS users CASCADE");
    await client.query("DROP TABLE IF EXISTS designs CASCADE");
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paneler_app') THEN
        EXECUTE 'REASSIGN OWNED BY paneler_app TO ' || quote_ident(current_user);
        DROP OWNED BY paneler_app;
        DROP ROLE paneler_app;
      END IF;
    END $$;`);
    // Also clear ALTER DEFAULT PRIVILEGES set in a previous run.
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM PUBLIC`);
    const sql = readFileSync(
      path.join(process.cwd(), "lib", "db", "schema.sql"),
      "utf8",
    );
    await client.query(sql);
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates the designs table with RLS enabled and FORCED", async () => {
    const { rows } = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE relname = 'designs'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it("creates the paneler_app role", async () => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM pg_roles WHERE rolname = 'paneler_app'`,
    );
    expect(rows[0].count).toBe("1");
  });

  it("isolates rows per app.user_sub", async () => {
    // User A inserts a row.
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-a', true)");
    await client.query(
      `INSERT INTO designs (user_sub, name, glb_key)
       VALUES ('user-a', 'A', 'designs/a.glb')`,
    );
    await client.query("COMMIT");

    // User B inserts their own.
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-b', true)");
    await client.query(
      `INSERT INTO designs (user_sub, name, glb_key)
       VALUES ('user-b', 'B', 'designs/b.glb')`,
    );
    const { rows: bRows } = await client.query<{ name: string }>(
      "SELECT name FROM designs",
    );
    await client.query("COMMIT");

    expect(bRows.map((r) => r.name)).toEqual(["B"]);
  });

  it("rejects INSERT when GUC mismatches user_sub (WITH CHECK)", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-a', true)");
    await expect(
      client.query(
        `INSERT INTO designs (user_sub, name, glb_key)
         VALUES ('hacker', 'spoof', 'designs/x.glb')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await client.query("ROLLBACK");
  });

  it("returns zero rows when app.user_sub is unset (fail-closed)", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*) FROM designs",
    );
    await client.query("COMMIT");
    expect(rows[0].count).toBe("0");
  });

  // ---------------------------------------------------------------------
  // users
  // ---------------------------------------------------------------------

  it("creates the users table with RLS enabled and FORCED", async () => {
    const { rows } = await client.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE relname = 'users'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it("defaults api_key_enabled to false", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-a', true)");
    await client.query(
      `INSERT INTO users (user_sub, email) VALUES ('user-a', 'a@example.com')`,
    );
    const { rows } = await client.query<{ api_key_enabled: boolean }>(
      "SELECT api_key_enabled FROM users WHERE user_sub = 'user-a'",
    );
    await client.query("COMMIT");
    expect(rows[0].api_key_enabled).toBe(false);
  });

  it("isolates user rows per app.user_sub", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-b', true)");
    await client.query(
      `INSERT INTO users (user_sub, email) VALUES ('user-b', 'b@example.com')`,
    );
    const { rows } = await client.query<{ user_sub: string }>(
      "SELECT user_sub FROM users",
    );
    await client.query("COMMIT");
    expect(rows.map((r) => r.user_sub)).toEqual(["user-b"]);
  });

  it("returns zero user rows when app.user_sub is unset (fail-closed)", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*) FROM users",
    );
    await client.query("COMMIT");
    expect(rows[0].count).toBe("0");
  });

  // The one that matters. RLS is row-level: a user's OWN row satisfies both
  // USING and WITH CHECK, so the policy alone would happily let them grant
  // themselves API access. Column-level privileges are what actually stop it.
  // An RLS-only implementation passes every other case in this file.
  it("forbids a user granting themselves api_key_enabled via UPDATE", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-a', true)");
    await expect(
      client.query(
        "UPDATE users SET api_key_enabled = true WHERE user_sub = 'user-a'",
      ),
    ).rejects.toThrow(/permission denied/);
    await client.query("ROLLBACK");
  });

  it("forbids inserting a new row with api_key_enabled already set", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-c', true)");
    await expect(
      client.query(
        `INSERT INTO users (user_sub, email, api_key_enabled)
         VALUES ('user-c', 'c@example.com', true)`,
      ),
    ).rejects.toThrow(/permission denied/);
    await client.query("ROLLBACK");
  });

  it("still permits the writes the app actually makes", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-a', true)");
    // Both statements set updated_at, which must be in the column grant.
    await client.query(
      `UPDATE users SET fabrics = $1::jsonb, updated_at = now()
        WHERE user_sub = 'user-a'`,
      [JSON.stringify([{ kind: "catalog", id: "lx-red" }])],
    );
    const { rowCount } = await client.query(
      `UPDATE users
          SET api_key_hash = 'deadbeef', api_key_created_at = now(),
              api_key_last_used = NULL, prev_key_hash = NULL,
              prev_key_expires = NULL, updated_at = now()
        WHERE user_sub = 'user-a' AND api_key_enabled`,
    );
    await client.query("COMMIT");
    // Gate holds: the flag is false, so rotateApiKey's statement matches nothing.
    expect(rowCount).toBe(0);
  });

  it("permits key rotation once the owner grants the flag", async () => {
    await client.query(
      "UPDATE users SET api_key_enabled = true WHERE user_sub = 'user-a'",
    );
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-a', true)");
    const { rowCount } = await client.query(
      `UPDATE users
          SET api_key_hash = 'deadbeef', api_key_created_at = now(),
              updated_at = now()
        WHERE user_sub = 'user-a' AND api_key_enabled`,
    );
    await client.query("COMMIT");
    expect(rowCount).toBe(1);
  });

  it("adds designs.fill as a nullable text column", async () => {
    const { rows } = await client.query<{
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'designs' AND column_name = 'fill'`,
    );
    expect(rows[0]).toEqual({ data_type: "text", is_nullable: "YES" });
  });
});
