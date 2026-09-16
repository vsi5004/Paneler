import "server-only";
import type { FabricEntry, ProfileData } from "@/lib/types";
import { withUserSession } from "@/lib/db/client";

// -----------------------------------------------------------------------------
// Per-user settings. Every query runs inside withUserSession(), so RLS scopes it
// to the caller's own row.
//
// Two rules hold everywhere in this file:
//
//   1. No SELECT *, and no spreading a client-supplied object into a SET list.
//      Every column is named literally.
//   2. api_key_hash and prev_key_hash NEVER appear in a returned shape. Callers
//      get metadata and a boolean; the plaintext is shown once at mint time and
//      the hash never leaves the database.
//
// api_key_enabled is absent from every write below on purpose — it is granted
// by hand as the DB owner. schema.sql also revokes the column from paneler_app,
// so a future edit that forgets this rule fails loudly rather than silently
// handing out API access.
// -----------------------------------------------------------------------------

/** Columns backing ProfileData. `has_api_key` is derived so no hash escapes. */
const PROFILE_COLUMNS = `
  fabrics,
  fill_materials,
  shop_id,
  display_name,
  shop_published,
  (avatar_key IS NOT NULL) AS has_avatar,
  api_key_enabled,
  api_key_created_at,
  api_key_last_used,
  (api_key_hash IS NOT NULL) AS has_api_key
`;

interface ProfileRow {
  fabrics: FabricEntry[];
  fill_materials: string[];
  shop_id: string | null;
  display_name: string | null;
  shop_published: boolean;
  has_avatar: boolean;
  api_key_enabled: boolean;
  api_key_created_at: Date | null;
  api_key_last_used: Date | null;
  has_api_key: boolean;
}

function toProfile(row: ProfileRow): ProfileData {
  return {
    fabrics: row.fabrics ?? [],
    fillMaterials: row.fill_materials ?? [],
    shopId: row.shop_id,
    displayName: row.display_name,
    hasAvatar: row.has_avatar,
    shopPublished: row.shop_published,
    apiKeyEnabled: row.api_key_enabled,
    hasApiKey: row.has_api_key,
    apiKeyCreatedAt: row.api_key_created_at?.toISOString() ?? null,
    apiKeyLastUsed: row.api_key_last_used?.toISOString() ?? null,
  };
}

/**
 * Create the user's row if it doesn't exist, and return their profile either
 * way. This is the row-creation hook: the app never initiates sign-in (that
 * happens in the landing repo), so there's no callback to hang it off — the
 * first authenticated request does it.
 *
 * `DO UPDATE` rather than `DO NOTHING` is load-bearing: `DO NOTHING` returns
 * zero rows on conflict, so every existing user would come back empty. Touching
 * `email` is also how a changed address propagates.
 *
 * One statement, because callers (the designer page, the profile page) need the
 * profile anyway and a separate existence check would double the round-trips on
 * every page load.
 */
export async function ensureUserProfile(
  userSub: string,
  email: string | null,
): Promise<ProfileData> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<ProfileRow>(
      `INSERT INTO users (user_sub, email)
       VALUES ($1, $2)
       ON CONFLICT (user_sub) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email)
       RETURNING ${PROFILE_COLUMNS}`,
      [userSub, email],
    );
    return toProfile(rows[0]);
  });
}

/** Plain read, for callers that know the row exists. */
export async function getUserProfile(
  userSub: string,
): Promise<ProfileData | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM users WHERE user_sub = $1`,
      [userSub],
    );
    return rows[0] ? toProfile(rows[0]) : null;
  });
}

/** Replace the stocked fabric list. Validate with validateFabrics() first. */
export async function setFabrics(
  userSub: string,
  fabrics: FabricEntry[],
): Promise<ProfileData | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<ProfileRow>(
      `UPDATE users
          SET fabrics = $2::jsonb,
              updated_at = now()
        WHERE user_sub = $1
       RETURNING ${PROFILE_COLUMNS}`,
      [userSub, JSON.stringify(fabrics)],
    );
    return rows[0] ? toProfile(rows[0]) : null;
  });
}

/**
 * Update the shop's public identity. Validate with validateShop() first.
 *
 * Two things here are load-bearing.
 *
 * **shop_id is minted once and never changes.** COALESCE keeps whatever is
 * already there, so a stitcher can rename their shop or unpublish and republish
 * without breaking a link they have already printed or pasted. The caller
 * supplies a candidate id for the first-publish case; collisions surface as
 * 23505 and are retried by the caller.
 *
 * **Unpublishing the shop unpublishes every item.** That is not tidiness, it is
 * the invariant `order_items_public_read` depends on. That policy gates on
 * `published` alone, because the obvious version — also requiring the owner's
 * `shop_published` — would reference `users` from inside a policy, and a policy
 * expression is subject to the referenced table's RLS: evaluated as a customer,
 * `users_isolate` hides the stitcher's row, the EXISTS goes false, and the item
 * silently vanishes. Maintaining the invariant in one statement here is what
 * lets the policy stay simple enough to be correct.
 *
 * Both statements run inside withUserSession's transaction, so they commit or
 * roll back together.
 */
export async function setShop(
  userSub: string,
  shop: {
    displayName: string | null;
    fillMaterials: string[];
    shopPublished: boolean;
    avatarKey?: string | null;
    /** Used only if the row has no shop_id yet. */
    candidateShopId: string;
  },
): Promise<ProfileData | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<ProfileRow>(
      `UPDATE users
          SET display_name   = $2,
              fill_materials = $3::jsonb,
              shop_published = $4,
              avatar_key     = COALESCE($5, avatar_key),
              shop_id        = COALESCE(shop_id, $6),
              updated_at     = now()
        WHERE user_sub = $1
       RETURNING ${PROFILE_COLUMNS}`,
      [
        userSub,
        shop.displayName,
        JSON.stringify(shop.fillMaterials),
        shop.shopPublished,
        shop.avatarKey ?? null,
        shop.candidateShopId,
      ],
    );
    if (!rows[0]) return null;

    if (!shop.shopPublished) {
      await client.query(
        `UPDATE order_items SET published = false, updated_at = now()
          WHERE user_sub = $1 AND published`,
        [userSub],
      );
    }
    return toProfile(rows[0]);
  });
}

/**
 * Set a new API key hash, handling both first creation and regeneration.
 *
 * The current hash moves to `prev_key_hash` with a 24-hour expiry so rotating
 * doesn't break a live site the instant the button is clicked — the caller
 * updates their server, and the old key keeps working until they do.
 *
 * `AND api_key_enabled` in the WHERE clause is the real gate. Enforcing it here
 * rather than only in the route means a future caller that forgets the check
 * still can't mint a key: the statement matches no rows and returns false.
 *
 * Returns false when the user has no row or isn't permitted a key.
 */
export async function rotateApiKey(
  userSub: string,
  newHash: string,
): Promise<boolean> {
  return withUserSession(userSub, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users
          SET prev_key_hash    = api_key_hash,
              prev_key_expires = CASE
                WHEN api_key_hash IS NULL THEN NULL
                ELSE now() + interval '24 hours'
              END,
              api_key_hash       = $2,
              api_key_created_at = now(),
              api_key_last_used  = NULL,
              updated_at         = now()
        WHERE user_sub = $1
          AND api_key_enabled`,
      [userSub, newHash],
    );
    return (rowCount ?? 0) > 0;
  });
}
