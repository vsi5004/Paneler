import "server-only";
import type { DesignMeta } from "@/lib/types";
import { withUserSession } from "@/lib/db/client";

// Columns returned in any list/get/insert/update response. Order matters for
// the test fixtures and the client-side row shape.
const ROW_COLUMNS = `
  id, name, glb_key, glb_etag, glb_size_bytes, thumbnail_key,
  panel_count, shape_signature, palette_hash, source, template_slug,
  starred, published, created_at, updated_at
`;

export async function listDesigns(userSub: string): Promise<DesignMeta[]> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<DesignMeta>(
      `SELECT ${ROW_COLUMNS}
       FROM designs
       ORDER BY starred DESC, updated_at DESC`,
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
