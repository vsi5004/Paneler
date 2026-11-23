import { NextResponse } from "next/server";

/**
 * Request bodies read with a hard byte cap.
 *
 * A Content-Length check alone is not a cap: a chunked request has no such
 * header, and req.json()/req.formData() then buffer whatever arrives. These
 * count the bytes actually streamed and stop at the limit.
 */

export class BodyTooLargeError extends Error {
  constructor() {
    super("body_too_large");
  }
}

export async function readBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  // Cheap early refusal when the client is honest about the size.
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The response for a body that failed to read: 413 when over the cap, else 400 with `invalidCode`. */
export function bodyErrorResponse(err: unknown, invalidCode = "invalid_json"): NextResponse {
  return err instanceof BodyTooLargeError
    ? NextResponse.json({ error: "body_too_large" }, { status: 413 })
    : NextResponse.json({ error: invalidCode }, { status: 400 });
}

/** JSON body, at most maxBytes. Throws BodyTooLargeError or a parse error. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBodyBytes(req, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Multipart or urlencoded body, at most maxBytes. Throws BodyTooLargeError or a parse error. */
export async function readFormBody(req: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyBytes(req, maxBytes);
  return new Response(bytes, {
    headers: { "content-type": req.headers.get("content-type") ?? "" },
  }).formData();
}
