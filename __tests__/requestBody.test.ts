// @vitest-environment node
// Server code: Node's own Request/FormData, not jsdom's.
import { describe, expect, it, vi } from "vitest";

import { BodyTooLargeError, readBodyBytes, readFormBody, readJsonBody } from "@/lib/requestBody";

vi.mock("@/lib/dbMode", () => ({ isDbEnabled: () => true }));
vi.mock("@/lib/email", () => ({ isMailEnabled: () => true, sendMail: vi.fn() }));
vi.mock("@/lib/db/shop", () => ({
  getPublicShop: vi.fn(async () => null),
  getPublicItem: vi.fn(async () => null),
  getShopNotifyEmail: vi.fn(async () => null),
}));

/** A streamed body with no Content-Length, as a chunked request arrives. */
function chunkedRequest(totalBytes: number, contentType = "application/octet-stream"): Request {
  const chunk = new Uint8Array(64 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const n = Math.min(chunk.byteLength, totalBytes - sent);
      controller.enqueue(chunk.subarray(0, n));
      sent += n;
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    body,
    headers: { "content-type": contentType },
    // @ts-expect-error -- Node's fetch needs duplex for a streamed body
    duplex: "half",
  });
}

describe("readBodyBytes", () => {
  it("rejects a chunked body over the cap, which has no Content-Length to check", async () => {
    const req = chunkedRequest(200 * 1024);
    expect(req.headers.get("content-length")).toBeNull();
    await expect(readBodyBytes(req, 100 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects an honest Content-Length over the cap without reading", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: "x".repeat(10),
      headers: { "content-length": "999999" },
    });
    await expect(readBodyBytes(req, 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("returns a body at or under the cap", async () => {
    const bytes = await readBodyBytes(chunkedRequest(100 * 1024), 100 * 1024);
    expect(bytes.byteLength).toBe(100 * 1024);
  });

  it("parses JSON and form bodies", async () => {
    const json = new Request("http://localhost/x", { method: "POST", body: '{"a":1}' });
    expect(await readJsonBody(json, 1024)).toEqual({ a: 1 });

    const fd = new FormData();
    fd.set("shopId", "abc");
    fd.set("animation", new File([new Uint8Array(10)], "a.gif"));
    const req = new Request("http://localhost/x", { method: "POST", body: fd });
    const form = await readFormBody(req, 64 * 1024);
    expect(form.get("shopId")).toBe("abc");
    expect((form.get("animation") as File).size).toBe(10);
  });
});

describe("POST /api/orders", () => {
  it("answers 413 to a chunked body over the cap", async () => {
    const { POST } = await import("@/app/api/orders/route.server");
    const res = await POST(chunkedRequest(9 * 1024 * 1024, "multipart/form-data; boundary=x"));
    expect(res.status).toBe(413);
  });
});
