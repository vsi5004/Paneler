// Static-export stub. next.config.ts swaps @/lib/db/client → this file when
// STATIC_EXPORT=1 so `pg` never enters the bundle. These functions must
// never be invoked at runtime — the API routes that call them are excluded
// from the static build via pageExtensions.

import type { PoolClient } from "pg";

function unreachable(): never {
  throw new Error("DB client called in static export build — should be unreachable");
}

export async function withUserSession<T>(
  _userSub: string,
  _fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return unreachable();
}

export async function withOwner<T>(
  _fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return unreachable();
}
