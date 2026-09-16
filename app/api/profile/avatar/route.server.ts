// Upload a stitcher's shop photo. Goes through the pod rather than a presigned
// PUT so the size and the format are checked before anything is stored — a
// presigned URL is unconstrained by nature, and this object is served back to
// the public.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { ensureUserProfile, setShop } from "@/lib/db/users";
import { generateShopId } from "@/lib/apiKey";
import { avatarKey, putObject } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

/** 256x256 webp is a few KB; 512 KB is generous and still trivially bounded. */
const MAX_AVATAR_BYTES = 512 * 1024;

/**
 * Accept only what the client crop actually produces.
 *
 * This is not belt-and-braces: the object is served back from our own origin,
 * so storing arbitrary bytes here would mean serving them. The route response
 * hardcodes `image/webp` and nosniff is already a global header, but refusing
 * a non-webp at the door is the cheaper half of that defense.
 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  return tag(0) === "RIFF" && tag(8) === "WEBP";
}

export async function POST(req: Request) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const file = form.get("avatar");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_avatar" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json({ error: "avatar_too_large" }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isWebp(bytes)) {
    return NextResponse.json({ error: "not_webp" }, { status: 400 });
  }

  const key = avatarKey(userSub);
  await putObject(key, bytes, "image/webp");

  // Record the key without disturbing anything else on the shop. Reading the
  // current profile first keeps display name, fills, and publish state exactly
  // as they were — this route only knows about the photo.
  const current = await ensureUserProfile(userSub, session?.user?.email ?? null);
  const profile = await setShop(userSub, {
    displayName: current.displayName,
    fillMaterials: current.fillMaterials,
    shopPublished: current.shopPublished,
    avatarKey: key,
    candidateShopId: generateShopId(),
  });
  return NextResponse.json({ profile });
}
