import "server-only";
import type { DesignMeta } from "@/lib/types";
import { withUserSession } from "@/lib/db/client";

// Columns returned in any list/get/insert/update response. Order matters for
// the test fixtures and the client-side row shape.
// `email` is included as of the order feature. It was previously omitted as
// unnecessary metadata, which was true while every row was the reader's own —
// but on an order row it holds the CUSTOMER's address, and that is how the
// stitcher replies. RLS still means a reader only ever sees rows they own.
// `user_sub` stays out: it is never useful to the client and is a Dex subject.
const ROW_COLUMNS = `
  id, name, glb_key, glb_etag, glb_size_bytes, thumbnail_key,
  panel_count, shape_signature, palette_hash, source, template_slug,
  fill, starred, published, created_at, updated_at, note,
  email
`;

export async function listDesigns(userSub: string): Promise<DesignMeta[]> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignMeta>(
      `SELECT ${ROW_COLUMNS}
       FROM designs
       ORDER BY COALESCE(source LIKE 'order:%', false) DESC,
                starred DESC, updated_at DESC`,
    );
    return rows;
  });
}

export async function getDesign(
  userSub: string,
  id: string,
): Promise<DesignMeta | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignMeta>(
      `SELECT ${ROW_COLUMNS}
       FROM designs WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });
}

export interface CreateDesignInput {
  name: string;
  glbKey: string;
  source: string;
  templateSlug: string | null;
  panelCount: number | null;
  shapeSignature: string | null;
  paletteHash: string | null;
  glbEtag: string | null;
  glbSizeBytes: number | null;
}

export async function createDesign(
  userSub: string,
  email: string | null,
  input: CreateDesignInput,
): Promise<DesignMeta> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignMeta>(
      `INSERT INTO designs (
         user_sub, email, name, glb_key, source, template_slug,
         panel_count, shape_signature, palette_hash, glb_etag, glb_size_bytes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${ROW_COLUMNS}`,
      [
        userSub,
        email,
        input.name,
        input.glbKey,
        input.source,
        input.templateSlug,
        input.panelCount,
        input.shapeSignature,
        input.paletteHash,
        input.glbEtag,
        input.glbSizeBytes,
      ],
    );
    return rows[0];
  });
}

export interface UpdateDesignPatch {
  name?: string;
  starred?: boolean;
  published?: boolean;
  // GLB-mirror metadata — recomputed client-side after each save.
  panel_count?: number;
  shape_signature?: string;
  palette_hash?: string;
  glb_etag?: string;
  glb_size_bytes?: number;
  thumbnail_key?: string;
  /** Customer's fill choice; written by the embed order flow. */
  fill?: string;
}

/**
 * Create the row for a customer's order, owned by the STITCHER.
 *
 * The only cross-account write in the app. It is permitted by the
 * `designs_order_insert` policy, which requires the named item to be published
 * and owned by `stitcherSub` - so a forged stitcherSub or itemId is rejected in
 * SQL, not merely by this function's caller.
 *
 * `email` is the CUSTOMER's, not the owner's. That is the column's job on an
 * order row: who to contact about it.
 *
 * The GLB is uploaded server-side before this runs, so etag and size are known
 * up front. That is not a stylistic choice: the customer cannot PATCH them
 * afterwards the way createFromUpload does, because updateDesign is scoped by
 * RLS to the row's owner and the owner is the stitcher.
 *
 * NOTE: no RETURNING, and that is not an oversight. RETURNING applies the
 * SELECT policy, and the customer cannot select a row owned by the stitcher, so
 * adding it makes the statement fail with "new row violates row-level security
 * policy" - a message identical to a WITH CHECK failure and near-guaranteed to
 * be misdiagnosed. The id is minted by the caller (it has to be, so the R2 key
 * can be derived before upload), so there is nothing to read back.
 */
export async function createOrderDesign(
  customerSub: string,
  input: {
    id: string;
    stitcherSub: string;
    itemId: string;
    customerEmail: string | null;
    glbKey: string;
    name: string;
    fill: string;
    note: string | null;
    panelCount: number | null;
    glbEtag: string | null;
    glbSizeBytes: number | null;
  },
): Promise<void> {
  await withUserSession(customerSub, async (client) => {
    // Columns and values are declared together, and the placeholders are
    // derived, so the two cannot drift. They did once: adding glb_etag and
    // glb_size_bytes grew the value list to 11 while the hand-numbered
    // statement stayed at 9, and every order submission failed with "bind
    // message supplies 11 parameters, but prepared statement requires 9".
    // Nothing caught it until a real order was placed, because this is the one
    // statement no test exercises.
    const fields: [string, unknown][] = [
      ["id", input.id],
      ["user_sub", input.stitcherSub],
      ["email", input.customerEmail],
      ["name", input.name],
      ["glb_key", input.glbKey],
      ["source", `order:${input.itemId}`],
      ["fill", input.fill],
      ["note", input.note],
      ["panel_count", input.panelCount],
      ["glb_etag", input.glbEtag],
      ["glb_size_bytes", input.glbSizeBytes],
    ];
    await client.query(
      `INSERT INTO designs (${fields.map(([c]) => c).join(", ")})
       VALUES (${fields.map((_, i) => `$${i + 1}`).join(", ")})`,
      fields.map(([, v]) => v),
    );
  });
}

export async function updateDesign(
  userSub: string,
  id: string,
  patch: UpdateDesignPatch,
): Promise<DesignMeta | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignMeta>(
      `UPDATE designs SET
         name             = COALESCE($2,  name),
         starred          = COALESCE($3,  starred),
         published        = COALESCE($4,  published),
         panel_count      = COALESCE($5,  panel_count),
         shape_signature  = COALESCE($6,  shape_signature),
         palette_hash     = COALESCE($7,  palette_hash),
         glb_etag         = COALESCE($8,  glb_etag),
         glb_size_bytes   = COALESCE($9,  glb_size_bytes),
         thumbnail_key    = COALESCE($10, thumbnail_key),
         fill             = COALESCE($11, fill),
         updated_at       = now()
       WHERE id = $1
       RETURNING ${ROW_COLUMNS}`,
      [
        id,
        patch.name ?? null,
        patch.starred ?? null,
        patch.published ?? null,
        patch.panel_count ?? null,
        patch.shape_signature ?? null,
        patch.palette_hash ?? null,
        patch.glb_etag ?? null,
        patch.glb_size_bytes ?? null,
        patch.thumbnail_key ?? null,
        patch.fill ?? null,
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
