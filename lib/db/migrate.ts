import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { withOwner } from "@/lib/db/client";

export type MigrationStatus =
  | { state: "pending" }
  | { state: "ready" }
  | { state: "error"; message: string };

// Next.js bundles instrumentation.ts and route handlers into separate module
// graphs at build time, so module-level state in this file isn't shared
// across them. Pin status to globalThis so both readers see the same value.
interface MigrationGlobal {
  status: MigrationStatus;
  promise: Promise<void> | null;
}

const STATE_KEY = Symbol.for("paneler.db.migration");
type WithSymbol = typeof globalThis & {
  [STATE_KEY]?: MigrationGlobal;
};
const g = globalThis as WithSymbol;
if (!g[STATE_KEY]) {
  g[STATE_KEY] = { status: { state: "pending" }, promise: null };
}
const state: MigrationGlobal = g[STATE_KEY]!;

/**
 * Read schema.sql and apply it idempotently. CREATE TABLE IF NOT EXISTS,
 * CREATE INDEX IF NOT EXISTS, DROP/CREATE POLICY, and the role DO block all
 * tolerate re-runs.
 */
async function runMigration(): Promise<void> {
  const schemaPath = path.join(process.cwd(), "lib", "db", "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  await withOwner(async (client) => {
    await client.query(sql);
  });
}

/**
 * Kick off migration once per process. Subsequent calls return the same
 * promise. Safe to invoke concurrently; the idempotent SQL handles any
 * lingering races at the database level.
 */
export function startMigration(): Promise<void> {
  if (!state.promise) {
    state.promise = runMigration()
      .then(() => {
        state.status = { state: "ready" };
        // eslint-disable-next-line no-console
        console.log("[paneler:db] schema applied");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        state.status = { state: "error", message };
        // eslint-disable-next-line no-console
        console.error("[paneler:db] migration failed:", message);
      });
  }
  return state.promise;
}

export function getMigrationStatus(): MigrationStatus {
  return state.status;
}
