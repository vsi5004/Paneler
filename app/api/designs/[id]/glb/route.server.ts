// 302 redirect to a short-lived presigned R2 GET URL for a design's GLB.
// Avoids streaming bytes through this pod — R2 egress is $0 and the pod
// stays out of the bandwidth path entirely.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { getDesign } from "@/lib/db/designs";
import { presignedGetUrl } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

export async function GET(
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
  const design = await getDesign(userSub, id);
  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = await presignedGetUrl(design.glb_key);
  return NextResponse.redirect(url, 302);
}
