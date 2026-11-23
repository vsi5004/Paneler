// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/dbMode", () => ({ isDbEnabled: () => true, getCurrentUserSub: () => "u1" }));
const countDesigns = vi.fn(async () => 0);
const createDesign = vi.fn();
vi.mock("@/lib/db/designs", () => ({
  countDesigns: () => countDesigns(),
  createDesign: (...args: unknown[]) => createDesign(...args),
  listDesigns: vi.fn(),
  getDesign: vi.fn(async () => ({ glb_key: "designs/x.glb" })),
}));

process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
process.env.R2_ACCESS_KEY_ID = "test";
process.env.R2_SECRET_ACCESS_KEY = "test";
process.env.R2_BUCKET = "test";

const ctx = { params: Promise.resolve({ id: "d1" }) };
const json = (body: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  countDesigns.mockResolvedValue(0);
  createDesign.mockReset();
});

describe("POST /api/designs/[id]/glb-upload-url", () => {
  it("signs the URL for exactly the declared size", async () => {
    const { POST } = await import("@/app/api/designs/[id]/glb-upload-url/route.server");
    const res = await POST(json({ size: 1234 }), ctx);
    expect(res.status).toBe(200);
    const url = new URL((await res.json()).url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  });

  it("refuses a GLB over the cap and a missing or bad size", async () => {
    const { POST } = await import("@/app/api/designs/[id]/glb-upload-url/route.server");
    const { MAX_GLB_BYTES } = await import("@/lib/r2/client");
    expect((await POST(json({ size: MAX_GLB_BYTES + 1 }), ctx)).status).toBe(413);
    expect((await POST(json({}), ctx)).status).toBe(400);
    expect((await POST(json({ size: -5 }), ctx)).status).toBe(400);
    expect((await POST(json({ size: 1.5 }), ctx)).status).toBe(400);
  });
});

describe("presignedGetUrl", () => {
  it("fixes the served type, whatever the uploader sent", async () => {
    const { presignedGetUrl } = await import("@/lib/r2/client");
    const url = new URL(await presignedGetUrl("designs/x.glb"));
    expect(url.searchParams.get("response-content-type")).toBe("model/gltf-binary");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
  });
});

describe("POST /api/designs", () => {
  it("refuses a new design once the account is at the cap", async () => {
    const { POST } = await import("@/app/api/designs/route.server");
    countDesigns.mockResolvedValue(200);
    const res = await POST(json({ source: "upload", name: "x" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("too_many_designs");
    expect(createDesign).not.toHaveBeenCalled();
  });

  it("refuses a template slug that could leave the presets folder", async () => {
    const { POST } = await import("@/app/api/designs/route.server");
    const res = await POST(json({ source: "template", templateSlug: "../presets/gp3" }));
    expect(res.status).toBe(404);
    expect(createDesign).not.toHaveBeenCalled();
  });
});
