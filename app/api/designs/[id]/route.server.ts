import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import {
  deleteDesign,
  getDesign,
  updateDesign,
} from "@/lib/db/designs";
import { deleteObject } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

const MAX_NAME_CHARS = 200;

interface PatchBody {
  name?: string;
  starred?: boolean;
  published?: boolean;
  panel_count?: number;
  shape_signature?: string;
  palette_hash?: string;
  glb_etag?: string;
  glb_size_bytes?: number;
  thumbnail_key?: string;
}

async function resolveUser(): Promise<
  | { kind: "ok"; userSub: string }
  | { kind: "err"; res: NextResponse }
> {
  if (!isDbEnabled()) {
    return {
      kind: "err",
      res: NextResponse.json({ error: "db_disabled" }, { status: 503 }),
    };
  }
  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return {
      kind: "err",
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { kind: "ok", userSub };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;
  const { id } = await params;
  const design = await getDesign(r.userSub, id);
  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ design });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.name === "string" && body.name.length > MAX_NAME_CHARS) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  const design = await updateDesign(r.userSub, id, body);
  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ design });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;
  const { id } = await params;
  // Fetch the row first so we know the glb_key to delete from R2. The DB row
  // and R2 object are loosely coupled; if the R2 delete fails the row is
  // still removed and the object becomes an orphan (cleaned up by a future
  // sweeper if we ever need one).
  const existing = await getDesign(r.userSub, id);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await deleteDesign(r.userSub, id);
  try {
    await deleteObject(existing.glb_key);
  } catch (err) {
    console.error("[paneler:r2] delete failed for", existing.glb_key, err);
  }
  return new Response(null, { status: 204 });
}
