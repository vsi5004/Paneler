import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import {
  deleteDesign,
  getDesign,
  updateDesign,
} from "@/lib/db/designs";
import type { Design } from "@/lib/types";

export const dynamic = "force-dynamic";

// Match the caps in ../route.server.ts.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_NAME_CHARS = 200;

interface PatchBody {
  name?: string;
  payload?: Design;
  starred?: boolean;
  published?: boolean;
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

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.payload !== undefined && body.payload.version !== 1) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (
    body.payload !== undefined &&
    JSON.stringify(body.payload).length > MAX_BODY_BYTES
  ) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
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
  const ok = await deleteDesign(r.userSub, id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
