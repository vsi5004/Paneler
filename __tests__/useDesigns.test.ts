import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useDesigns } from "@/lib/useDesigns";
import type { DesignMeta } from "@/lib/types";

function row(overrides: Partial<DesignMeta> = {}): DesignMeta {
  return {
    id: "row-1",
    name: "Untitled",
    glb_key: "designs/row-1.glb",
    glb_etag: null,
    glb_size_bytes: null,
    thumbnail_key: null,
    panel_count: 32,
    shape_signature: "12p+20h",
    palette_hash: null,
    source: "template:soccer",
    template_slug: "soccer",
    starred: false,
    published: false,
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
    ...overrides,
  };
}

interface QueueEntry {
  matches: (url: string, init?: RequestInit) => boolean;
  respond: () => Response;
}

function installFetch(queue: QueueEntry[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const idx = queue.findIndex((q) => q.matches(url, init));
    if (idx < 0) {
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }
    const [entry] = queue.splice(idx, 1);
    return entry.respond();
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useDesigns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("stays inert when disabled (no fetch, no designs)", () => {
    const mock = vi.fn();
    global.fetch = mock as unknown as typeof fetch;
    const { result } = renderHook(() => useDesigns({ enabled: false }));
    expect(result.current.designs).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });

  it("fetches the list on mount when enabled", async () => {
    installFetch([
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [row()] }),
      },
    ]);
    const { result } = renderHook(() => useDesigns({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.designs).toHaveLength(1);
    expect(result.current.designs[0].id).toBe("row-1");
    expect(result.current.designs[0].glb_key).toBe("designs/row-1.glb");
  });

  it("createFromTemplate POSTs with templateSlug and selects the new row", async () => {
    installFetch([
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [] }),
      },
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && init?.method === "POST",
        respond: () => jsonRes({ design: row({ id: "row-2" }) }, 201),
      },
    ]);
    const { result } = renderHook(() => useDesigns({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createFromTemplate({
        name: "My Soccer",
        templateSlug: "soccer",
        panelCount: 32,
      });
    });
    expect(result.current.currentId).toBe("row-2");
    expect(result.current.designs.map((d) => d.id)).toEqual(["row-2"]);
  });

  it("rename updates the row in place", async () => {
    installFetch([
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [row()] }),
      },
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && init?.method === "PUT",
        respond: () => jsonRes({ design: row({ name: "Renamed" }) }),
      },
    ]);
    const { result } = renderHook(() => useDesigns({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.rename("row-1", "Renamed");
    });
    expect(result.current.designs[0].name).toBe("Renamed");
  });

  it("togglePublished flips the flag", async () => {
    installFetch([
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [row({ published: false })] }),
      },
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && init?.method === "PUT",
        respond: () => jsonRes({ design: row({ published: true }) }),
      },
    ]);
    const { result } = renderHook(() => useDesigns({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.togglePublished("row-1");
    });
    expect(result.current.designs[0].published).toBe(true);
  });

  it("remove drops the row and clears currentId when matching", async () => {
    installFetch([
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [row({ id: "row-1" })] }),
      },
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ design: row({ id: "row-1" }) }),
      },
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && init?.method === "DELETE",
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    const { result } = renderHook(() => useDesigns({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.load("row-1");
    });
    await act(async () => {
      await result.current.remove("row-1");
    });
    expect(result.current.designs).toHaveLength(0);
    expect(result.current.currentId).toBeNull();
  });

  it("surfaces API errors on the error state", async () => {
    installFetch([
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ error: "db_disabled" }, 503),
      },
    ]);
    const { result } = renderHook(() => useDesigns({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("db_disabled");
  });
});
