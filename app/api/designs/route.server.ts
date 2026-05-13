// CRUD endpoints for the designs nav. Named `route.server.ts` so the static
// export build's pageExtensions filter excludes it (see next.config.ts).
// In a standalone build the filename resolves to /app/api/designs.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { createDesign, listDesigns } from "@/lib/db/designs";
import type { Design } from "@/lib/types";

export const dynamic = "force-dynamic";

// Soft caps on writer requests. Generous for legitimate designs (panel
// colors run a few KB at most) but block accidental or malicious giant
// blobs from reaching the DB.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_NAME_CHARS = 200;

export async function GET() {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const designs = await listDesigns(userSub);
  return NextResponse.json({ designs });
}

interface CreateBody {
  name?: string;
  payload?: Design;
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

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.payload || body.payload.version !== 1) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  // Fallback when the client didn't send Content-Length (chunked transfer).
  if (JSON.stringify(body.payload).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  if (typeof body.name === "string" && body.name.length > MAX_NAME_CHARS) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  const email = session?.user?.email ?? null;
  const design = await createDesign(
    userSub,
    email,
    body.name?.trim() || "Untitled",
    body.payload,
  );
  return NextResponse.json({ design }, { status: 201 });
}
