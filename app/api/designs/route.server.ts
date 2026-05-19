// CRUD endpoints for the designs nav. Named `route.server.ts` so the static
// export build's pageExtensions filter excludes it (see next.config.ts).
// In a standalone build the filename resolves to /app/api/designs.

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { createDesign, listDesigns } from "@/lib/db/designs";
import { designKey, putObject } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

const MAX_NAME_CHARS = 200;
const TEMPLATES_DIR = join(process.cwd(), "public", "presets");

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
  /** Required. Either a template slug or "upload". */
  source: "template" | "upload";
  /** Required when source = "template". */
  templateSlug?: string;
  /** Optional client-computed mirror metadata. */
  panelCount?: number;
  shapeSignature?: string;
  paletteHash?: string;
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

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.source !== "template" && body.source !== "upload") {
    return NextResponse.json({ error: "invalid_source" }, { status: 400 });
  }
  if (body.source === "template" && !body.templateSlug) {
    return NextResponse.json({ error: "missing_template_slug" }, { status: 400 });
  }
  if (typeof body.name === "string" && body.name.length > MAX_NAME_CHARS) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  // Mint the row id ahead of time so the GLB lands in R2 at the matching key.
  const id = randomUUID();
  const key = designKey(id);

  let etag: string | null = null;
  let size: number | null = null;

  if (body.source === "template") {
    // Server-side fork: read the template GLB off disk and upload it under
    // the new design's key. Cheap because templates are small (<1 MB) and
    // bundled with the deployment image.
    const templatePath = join(TEMPLATES_DIR, `${body.templateSlug}.glb`);
    let bytes: Buffer;
    try {
      bytes = await readFile(templatePath);
    } catch {
      return NextResponse.json(
        { error: "template_not_found" },
        { status: 404 },
      );
    }
    const put = await putObject(key, new Uint8Array(bytes));
    etag = put.etag ?? null;
    size = put.size;
  }
  // For source === "upload" the client uploads via a presigned PUT URL after
  // this endpoint returns; the row is created with the key pre-filled but
  // no bytes in R2 yet. The client then PATCHes etag/size on completion.

  const email = session?.user?.email ?? null;
  const design = await createDesign(userSub, email, {
    name: body.name?.trim() || "Untitled",
    glbKey: key,
    source: body.source === "template" ? `template:${body.templateSlug}` : "upload",
    templateSlug: body.source === "template" ? (body.templateSlug ?? null) : null,
    panelCount: body.panelCount ?? null,
    shapeSignature: body.shapeSignature ?? null,
    paletteHash: body.paletteHash ?? null,
    glbEtag: etag,
    glbSizeBytes: size,
  });
  return NextResponse.json({ design }, { status: 201 });
}
