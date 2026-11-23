// Mint a presigned PUT URL the client uses to upload the design's GLB bytes
// directly to R2. The bytes never touch this pod. The client says how many
// bytes it will send; the URL is signed for exactly that size, capped at
// MAX_GLB_BYTES.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { getDesign } from "@/lib/db/designs";
import { MAX_GLB_BYTES, presignedPutUrl } from "@/lib/r2/client";
import { bodyErrorResponse, readJsonBody } from "@/lib/requestBody";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let size: unknown;
  try {
    ({ size } = (await readJsonBody(req, 1024)) as { size?: unknown });
  } catch (err) {
    return bodyErrorResponse(err);
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) {
    return NextResponse.json({ error: "invalid_size" }, { status: 400 });
  }
  if (size > MAX_GLB_BYTES) {
    return NextResponse.json({ error: "glb_too_large", maxBytes: MAX_GLB_BYTES }, { status: 413 });
  }
  const { id } = await params;
  // The getDesign call also enforces RLS scoping — a user can only mint an
  // upload URL for a design that belongs to them.
  const design = await getDesign(userSub, id);
  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = await presignedPutUrl(design.glb_key, size);
  return NextResponse.json({ url, key: design.glb_key });
}
