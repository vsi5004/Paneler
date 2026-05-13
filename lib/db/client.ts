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
