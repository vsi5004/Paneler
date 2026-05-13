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
      `INSERT INTO designs (user_sub, name, payload)
       VALUES ('user-a', 'A', '{"version":1,"modelType":"soccer","panelColors":{}}'::jsonb)`,
    );
    await client.query("COMMIT");

    // User B inserts their own.
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    await client.query("SELECT set_config('app.user_sub', 'user-b', true)");
    await client.query(
      `INSERT INTO designs (user_sub, name, payload)
       VALUES ('user-b', 'B', '{"version":1,"modelType":"soccer","panelColors":{}}'::jsonb)`,
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
        `INSERT INTO designs (user_sub, name, payload)
         VALUES ('hacker', 'spoof', '{"version":1,"modelType":"x","panelColors":{}}'::jsonb)`,
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
});
