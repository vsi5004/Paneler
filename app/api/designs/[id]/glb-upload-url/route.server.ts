// Mint a presigned PUT URL the client uses to upload the design's GLB bytes
// directly to R2. The bytes never touch this pod. The presigned URL omits
// Content-Type from its signed headers — including it triggers silent
// SignatureDoesNotMatch 403s from browser uploads.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { getDesign } from "@/lib/db/designs";
import { presignedPutUrl } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
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
  const { id } = await params;
  // The getDesign call also enforces RLS scoping — a user can only mint an
  // upload URL for a design that belongs to them.
  const design = await getDesign(userSub, id);
  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = await presignedPutUrl(design.glb_key);
  return NextResponse.json({ url, key: design.glb_key });
}
