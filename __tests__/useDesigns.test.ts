import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useDesigns, type DesignRow } from "@/lib/useDesigns";
import type { Design } from "@/lib/types";

const SOCCER_DESIGN: Design = {
  version: 1,
  modelType: "soccer",
  panelColors: { panel_001_pentagon: "#ff0000" },
};

function row(overrides: Partial<DesignRow> = {}): DesignRow {
  return {
    id: "row-1",
    name: "Untitled",
    payload: SOCCER_DESIGN,
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

function installFetch(queue: QueueEntry[]): vi.Mock {
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

const snapshotCurrent = () => SOCCER_DESIGN;

describe("useDesigns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("stays inert when disabled (no fetch, no designs)", () => {
    const mock = vi.fn();
    global.fetch = mock as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useDesigns({ enabled: false, snapshotCurrent }),
    );
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
    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.designs).toHaveLength(1);
    expect(result.current.designs[0].id).toBe("row-1");
  });

  it("seeds an Untitled row when the initial list is empty (first login)", async () => {
    installFetch([
      // First GET returns no rows.
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [] }),
      },
      // Hook auto-creates one with the current canvas snapshot.
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && init?.method === "POST",
        respond: () => jsonRes({ design: row({ id: "seeded", name: "Untitled" }) }, 201),
      },
    ]);
    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
    await waitFor(() => expect(result.current.designs).toHaveLength(1));
    expect(result.current.designs[0].id).toBe("seeded");
    expect(result.current.currentId).toBe("seeded");
  });

  it("create auto-saves the current row first, then POSTs and selects the new one", async () => {
    installFetch([
      // Initial list — one existing row, currently selected via load().
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ designs: [row({ id: "row-1" })] }),
      },
      // load("row-1") to set currentId
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && (init?.method ?? "GET") === "GET",
        respond: () => jsonRes({ design: row({ id: "row-1" }) }),
      },
      // Auto-save before create
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && init?.method === "PUT",
        respond: () => jsonRes({ design: row({ id: "row-1" }) }),
      },
      // Actual create
      {
        matches: (url, init) =>
          url.endsWith("/api/designs") && init?.method === "POST",
        respond: () =>
          jsonRes({ design: row({ id: "row-2", name: "Untitled" }) }, 201),
      },
    ]);

    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.load("row-1");
    });
    expect(result.current.currentId).toBe("row-1");

    await act(async () => {
      await result.current.create("Untitled");
    });
    expect(result.current.currentId).toBe("row-2");
    expect(result.current.designs.map((d) => d.id)).toEqual([
      "row-2",
      "row-1",
    ]);
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
    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
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
    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
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
          url.endsWith("/api/designs/row-1") && init?.method === "PUT",
        respond: () => jsonRes({ design: row({ id: "row-1" }) }),
      },
      {
        matches: (url, init) =>
          url.endsWith("/api/designs/row-1") && init?.method === "DELETE",
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
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
    const { result } = renderHook(() =>
      useDesigns({ enabled: true, snapshotCurrent }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("db_disabled");
  });
});
