import "server-only";
import type { Design } from "@/lib/types";
import { withUserSession } from "@/lib/db/client";

export interface DesignRow {
  id: string;
  name: string;
  payload: Design;
  starred: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * List the signed-in user's designs, most-recently-updated first.
 * RLS isolates the result set to rows matching the current `app.user_sub`.
 */
export async function listDesigns(userSub: string): Promise<DesignRow[]> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignRow>(
      `SELECT id, name, payload, starred, published, created_at, updated_at
       FROM designs
       ORDER BY starred DESC, updated_at DESC`,
    );
    return rows;
  });
}

export async function getDesign(
  userSub: string,
  id: string,
): Promise<DesignRow | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignRow>(
      `SELECT id, name, payload, starred, published, created_at, updated_at
       FROM designs WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });
}

export async function createDesign(
  userSub: string,
  email: string | null,
  name: string,
  payload: Design,
): Promise<DesignRow> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignRow>(
      `INSERT INTO designs (user_sub, email, name, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, payload, starred, published, created_at, updated_at`,
      [userSub, email, name, payload],
    );
    return rows[0];
  });
}

export async function updateDesign(
  userSub: string,
  id: string,
  patch: {
    name?: string;
    payload?: Design;
    starred?: boolean;
    published?: boolean;
  },
): Promise<DesignRow | null> {
  return withUserSession(userSub, async (client) => {
    // COALESCE keeps untouched columns at their current value when the
    // patch omits a key.
    const { rows } = await client.query<DesignRow>(
      `UPDATE designs
       SET name      = COALESCE($2, name),
           payload   = COALESCE($3, payload),
           starred   = COALESCE($4, starred),
           published = COALESCE($5, published),
           updated_at = now()
       WHERE id = $1
       RETURNING id, name, payload, starred, published, created_at, updated_at`,
      [
        id,
        patch.name ?? null,
        patch.payload ?? null,
        patch.starred ?? null,
        patch.published ?? null,
      ],
    );
    return rows[0] ?? null;
  });
}

export async function deleteDesign(
  userSub: string,
  id: string,
): Promise<boolean> {
  return withUserSession(userSub, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM designs WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
