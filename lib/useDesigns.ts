"use client";

import { useCallback, useEffect, useState } from "react";
import type { Design } from "@/lib/types";

export interface DesignRow {
  id: string;
  name: string;
  payload: Design;
  starred: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface UseDesignsOptions {
  /** True only in DB-enabled modes. When false the hook stays inert. */
  enabled: boolean;
  /** Reads the current in-memory design so we can auto-save it before switching. */
  snapshotCurrent: () => Design;
}

export function useDesigns({ enabled, snapshotCurrent }: UseDesignsOptions) {
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) return [];
    try {
      setLoading(true);
      const { designs } = await jsonFetch<{ designs: DesignRow[] }>(
        "/api/designs",
      );
      setDesigns(designs);
      setError(null);
      return designs;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    // One-shot fetch on mount + whenever `enabled` flips on. Refetch's
    // setState writes happen asynchronously after the fetch, not
    // synchronously in the effect body, but lint can't tell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();
  }, [refetch]);

  // Save the current in-memory design back to its row. No-op when nothing is
  // selected — the URL-hash → in-memory case isn't materialized in the nav.
  const saveCurrent = useCallback(async () => {
    if (!enabled || !currentId) return;
    const payload = snapshotCurrent();
    const { design } = await jsonFetch<{ design: DesignRow }>(
      `/api/designs/${currentId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      },
    );
    setDesigns((prev) =>
      prev.map((d) => (d.id === design.id ? design : d)),
    );
  }, [enabled, currentId, snapshotCurrent]);

  const create = useCallback(
    async (name = "Untitled") => {
      if (!enabled) return null;
      // BlogLM pattern: auto-save current first so unsaved tweaks aren't lost.
      try {
        await saveCurrent();
      } catch {
        // Don't block creation on a save failure — the user explicitly asked
        // for a fresh design.
      }
      const payload = snapshotCurrent();
      const { design } = await jsonFetch<{ design: DesignRow }>(
        "/api/designs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, payload }),
        },
      );
      setDesigns((prev) => [design, ...prev]);
      setCurrentId(design.id);
      return design;
    },
    [enabled, saveCurrent, snapshotCurrent],
  );

  const load = useCallback(
    async (id: string) => {
      if (!enabled) return null;
      try {
        await saveCurrent();
      } catch {
        // Same as create — don't block the user from switching away.
      }
      const { design } = await jsonFetch<{ design: DesignRow }>(
        `/api/designs/${id}`,
      );
      setCurrentId(design.id);
      return design;
    },
    [enabled, saveCurrent],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      if (!enabled) return;
      const { design } = await jsonFetch<{ design: DesignRow }>(
        `/api/designs/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      setDesigns((prev) => prev.map((d) => (d.id === id ? design : d)));
    },
    [enabled],
  );

  const toggleStarred = useCallback(
    async (id: string) => {
      if (!enabled) return;
      const row = designs.find((d) => d.id === id);
      if (!row) return;
      const { design } = await jsonFetch<{ design: DesignRow }>(
        `/api/designs/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: !row.starred }),
        },
      );
      setDesigns((prev) => prev.map((d) => (d.id === id ? design : d)));
    },
    [enabled, designs],
  );

  const togglePublished = useCallback(
    async (id: string) => {
      if (!enabled) return;
      const row = designs.find((d) => d.id === id);
      if (!row) return;
      const { design } = await jsonFetch<{ design: DesignRow }>(
        `/api/designs/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ published: !row.published }),
        },
      );
      setDesigns((prev) => prev.map((d) => (d.id === id ? design : d)));
    },
    [enabled, designs],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!enabled) return;
      await jsonFetch(`/api/designs/${id}`, { method: "DELETE" });
      setDesigns((prev) => prev.filter((d) => d.id !== id));
      if (currentId === id) {
        setCurrentId(null);
      }
    },
    [enabled, currentId],
  );

  return {
    designs,
    currentId,
    setCurrentId,
    loading,
    error,
    refetch,
    create,
    load,
    saveCurrent,
    rename,
    toggleStarred,
    togglePublished,
    remove,
  };
}
