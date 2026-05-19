"use client";

import { useCallback, useEffect, useState } from "react";
import type { DesignMeta } from "@/lib/types";

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

export interface CreateFromTemplateInput {
  name: string;
  templateSlug: string;
  panelCount?: number;
  shapeSignature?: string;
  paletteHash?: string;
}

export interface CreateFromUploadInput {
  name: string;
  bytes: Uint8Array;
  panelCount?: number;
  shapeSignature?: string;
  paletteHash?: string;
}

export interface SaveBytesInput {
  bytes: Uint8Array;
  panelCount?: number;
  shapeSignature?: string;
  paletteHash?: string;
}

interface UseDesignsOptions {
  /** True only in DB-enabled modes. When false the hook stays inert. */
  enabled: boolean;
}

export function useDesigns({ enabled }: UseDesignsOptions) {
  const [designs, setDesigns] = useState<DesignMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) return [];
    try {
      setLoading(true);
      const { designs } = await jsonFetch<{ designs: DesignMeta[] }>(
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();
  }, [refetch]);

  /** Direct upload of bytes to R2 via a presigned PUT URL. */
  const uploadBytes = useCallback(
    async (id: string, bytes: Uint8Array): Promise<{ etag: string | null; size: number }> => {
      const { url } = await jsonFetch<{ url: string; key: string }>(
        `/api/designs/${id}/glb-upload-url`,
        { method: "POST" },
      );
      // Important: do NOT set Content-Type here — the presigned PUT URL was
      // minted without Content-Type in the signed headers, so anything we set
      // here would mismatch and R2 would 403.
      const res = await fetch(url, {
        method: "PUT",
        body: new Uint8Array(bytes),
      });
      if (!res.ok) {
        throw new Error(`R2 PUT failed: ${res.status} ${res.statusText}`);
      }
      const etag = res.headers.get("etag");
      return {
        etag: etag ? etag.replace(/"/g, "") : null,
        size: bytes.byteLength,
      };
    },
    [],
  );

  const patchMeta = useCallback(
    async (id: string, patch: Record<string, unknown>): Promise<DesignMeta> => {
      const { design } = await jsonFetch<{ design: DesignMeta }>(
        `/api/designs/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      setDesigns((prev) => prev.map((d) => (d.id === design.id ? design : d)));
      return design;
    },
    [],
  );

  const createFromTemplate = useCallback(
    async (input: CreateFromTemplateInput): Promise<DesignMeta | null> => {
      if (!enabled) return null;
      const { design } = await jsonFetch<{ design: DesignMeta }>(
        "/api/designs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            source: "template",
            templateSlug: input.templateSlug,
            panelCount: input.panelCount,
            shapeSignature: input.shapeSignature,
            paletteHash: input.paletteHash,
          }),
        },
      );
      setDesigns((prev) => [design, ...prev]);
      setCurrentId(design.id);
      return design;
    },
    [enabled],
  );

  const createFromUpload = useCallback(
    async (input: CreateFromUploadInput): Promise<DesignMeta | null> => {
      if (!enabled) return null;
      const { design } = await jsonFetch<{ design: DesignMeta }>(
        "/api/designs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            source: "upload",
            panelCount: input.panelCount,
            shapeSignature: input.shapeSignature,
            paletteHash: input.paletteHash,
          }),
        },
      );
      // Two-step: row first (so we have an id + glb_key), then bytes via
      // presigned PUT. After upload, patch the etag/size so list views can
      // tell at a glance whether the upload landed.
      const { etag, size } = await uploadBytes(design.id, input.bytes);
      const final = await patchMeta(design.id, {
        glb_etag: etag,
        glb_size_bytes: size,
      });
      setDesigns((prev) => [final, ...prev.filter((d) => d.id !== final.id)]);
      setCurrentId(final.id);
      return final;
    },
    [enabled, uploadBytes, patchMeta],
  );

  /** Persist the current GLB bytes back to its row (overwrite in R2 + bump mirror). */
  const saveBytes = useCallback(
    async (id: string, input: SaveBytesInput): Promise<DesignMeta> => {
      const { etag, size } = await uploadBytes(id, input.bytes);
      return patchMeta(id, {
        glb_etag: etag,
        glb_size_bytes: size,
        panel_count: input.panelCount,
        shape_signature: input.shapeSignature,
        palette_hash: input.paletteHash,
      });
    },
    [uploadBytes, patchMeta],
  );

  const load = useCallback(
    async (id: string): Promise<DesignMeta | null> => {
      if (!enabled) return null;
      const { design } = await jsonFetch<{ design: DesignMeta }>(
        `/api/designs/${id}`,
      );
      setCurrentId(design.id);
      return design;
    },
    [enabled],
  );

  /** Fetch the current GLB bytes from R2 (via the 302-redirect endpoint). */
  const fetchGlb = useCallback(async (id: string): Promise<Uint8Array> => {
    const res = await fetch(`${BASE}/api/designs/${id}/glb`);
    if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }, []);

  const rename = useCallback(
    async (id: string, name: string) => {
      if (!enabled) return;
      await patchMeta(id, { name });
    },
    [enabled, patchMeta],
  );

  const toggleStarred = useCallback(
    async (id: string) => {
      if (!enabled) return;
      const row = designs.find((d) => d.id === id);
      if (!row) return;
      await patchMeta(id, { starred: !row.starred });
    },
    [enabled, designs, patchMeta],
  );

  const togglePublished = useCallback(
    async (id: string) => {
      if (!enabled) return;
      const row = designs.find((d) => d.id === id);
      if (!row) return;
      await patchMeta(id, { published: !row.published });
    },
    [enabled, designs, patchMeta],
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
    createFromTemplate,
    createFromUpload,
    load,
    fetchGlb,
    saveBytes,
    rename,
    toggleStarred,
    togglePublished,
    remove,
  };
}
