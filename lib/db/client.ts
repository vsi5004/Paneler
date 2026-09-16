import "server-only";
import { Pool, type PoolClient } from "pg";

// Singleton pool, lazy-initialized so the module can be imported in code
// paths that may not have DATABASE_URL set (the request runtime only
// reaches here when isDbEnabled() is true).
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set — withUserSession/withOwner should not be called in files-only mode",
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Run `fn` against the pool as the runtime `paneler_app` role with the GUC
 * `app.user_sub` set to the given subject. Used by every request that hits
 * the designs table.
 *
 * The `BEGIN` is load-bearing: `SET LOCAL` is a no-op outside a transaction,
 * so without it RLS reads NULL for `app.user_sub` and the policy denies every
 * row. The failure mode is silent ("queries return zero rows"), not an error.
 */
export async function withUserSession<T>(
  userSub: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_app");
    // Parameterized via set_config (not string-concat) to defend against
    // GUC injection — userSub flows from a JWT we don't fully own.
    await client.query("SELECT set_config('app.user_sub', $1, true)", [
      userSub,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` as the read-only `paneler_public` role, with **no** `app.user_sub`.
 *
 * This is the shop pages' read path. They render before anyone signs in, so
 * there is no subject to scope RLS with, and the alternatives are worse:
 * `withOwner` is not a bypass (both tables are FORCE ROW LEVEL SECURITY, so the
 * owner is subject to the same policies), and setting the GUC to the stitcher's
 * sub would hand the app a read-anyone primitive.
 *
 * Leaving `app.user_sub` unset is deliberate and load-bearing: every
 * GUC-keyed policy then compares against NULL and denies, so this session can
 * reach only what a `TO paneler_public` policy explicitly opens — published
 * shops, published items, and the designs those items pin. `paneler_public` also
 * holds column-level SELECT grants only, so `api_key_hash` and `email` are
 * unreachable for it regardless of any policy.
 *
 * Callers must still choose what to return: see lib/db/shop.ts, which is the
 * only module that uses this.
 */
export async function withPublicSession<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE paneler_public");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` as the cluster owner (no SET ROLE). Used for schema migrations,
 * which need DDL privileges that paneler_app doesn't have. Retries on
 * connection refused for up to ~60s — CNPG cluster bootstrap takes 30–60s
 * on first apply, and we'd rather hang the readiness probe than fail boot.
 */
export async function withOwner<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const startedAt = Date.now();
  const deadline = startedAt + 60_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      const transient =
        code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT";
      if (!transient || Date.now() > deadline) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
