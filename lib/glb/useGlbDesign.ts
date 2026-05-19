"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseGlb, type ParsedGlb } from "@/lib/topology/gltf";
import { setMaterialColor, serializeDocument } from "@/lib/glb/mutate";
import { linearRgbaToHex } from "@/lib/glb/build";
import type { PanelColors, PanelTopology } from "@/lib/types";

export interface UseGlbDesignResult {
  /** Latest GLB bytes — kept so the renderer can pass them to GLTFLoader. */
  bytes: Uint8Array | null;
  topology: PanelTopology | null;
  panelColors: PanelColors;
  /** Bumps on every panelColors mutation so memoized derived state can invalidate. */
  version: number;
  loading: boolean;
  error: string | null;

  /** Load a GLB by HTTP URL — used for the preset/template list. */
  loadFromUrl: (url: string) => Promise<void>;
  /** Load from already-fetched bytes (file upload, R2 fetch). */
  loadFromBytes: (bytes: Uint8Array) => Promise<void>;

  /** Replace the entire panelColors map. Mirrors changes onto the GLB document. */
  setPanelColors: (next: PanelColors | ((prev: PanelColors) => PanelColors)) => void;
  /** Convenience: set one panel's color. */
  setPanelColor: (panelId: string, hex: string) => void;
  /** Reset a panel back to its template default (the linear baseColor on the parsed material). */
  resetPanel: (panelId: string) => void;
  /** Serialize the current GLB document back to bytes (for save). */
  serialize: () => Promise<Uint8Array | null>;
  /** Clear loaded design. */
  reset: () => void;
}

export function useGlbDesign(): UseGlbDesignResult {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [parsed, setParsed] = useState<ParsedGlb | null>(null);
  const [panelColors, setPanelColorsState] = useState<PanelColors>({});
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache template defaults so resetPanel can recover them after edits.
  const defaultsRef = useRef<PanelColors>({});

  // Parse bytes → topology + materials. Initialise panelColors from the
  // material's baseColorFactor so a freshly-loaded design starts at its
  // baked colors.
  useEffect(() => {
    if (!bytes) {
      setParsed(null);
      setPanelColorsState({});
      defaultsRef.current = {};
      return;
    }
    let cancelled = false;
    parseGlb(bytes)
      .then((p) => {
        if (cancelled) return;
        const defaults: PanelColors = {};
        for (const m of p.materials) {
          defaults[m.panelId] = linearRgbaToHex(m.baseColorLinear);
        }
        defaultsRef.current = defaults;
        setParsed(p);
        setPanelColorsState(defaults);
        setVersion((v) => v + 1);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to parse GLB");
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  // Mirror panelColors → gltf-transform document materials so the next
  // serialize() captures the latest edits without us having to thread the
  // doc through every callback.
  useEffect(() => {
    if (!parsed) return;
    for (const [panelId, hex] of Object.entries(panelColors)) {
      setMaterialColor(parsed.document, panelId, hex);
    }
  }, [panelColors, parsed]);

  const loadFromBytes = useCallback(async (newBytes: Uint8Array) => {
    setLoading(true);
    setError(null);
    // Trigger the parse effect — actual parse is async there.
    setBytes(newBytes);
    setLoading(false);
  }, []);

  const loadFromUrl = useCallback(
    async (url: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
        const buf = await res.arrayBuffer();
        setBytes(new Uint8Array(buf));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load GLB");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const setPanelColors = useCallback(
    (next: PanelColors | ((prev: PanelColors) => PanelColors)) => {
      setPanelColorsState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        return value;
      });
      setVersion((v) => v + 1);
    },
    [],
  );

  const setPanelColor = useCallback((panelId: string, hex: string) => {
    setPanelColors((prev) => ({ ...prev, [panelId]: hex }));
  }, [setPanelColors]);

  const resetPanel = useCallback(
    (panelId: string) => {
      const def = defaultsRef.current[panelId];
      if (def === undefined) return;
      setPanelColor(panelId, def);
    },
    [setPanelColor],
  );

  const serialize = useCallback(async () => {
    if (!parsed) return null;
    return serializeDocument(parsed.document);
  }, [parsed]);

  const reset = useCallback(() => {
    setBytes(null);
    setParsed(null);
    setPanelColorsState({});
    defaultsRef.current = {};
    setError(null);
  }, []);

  return {
    bytes,
    topology: parsed?.topology ?? null,
    panelColors,
    version,
    loading,
    error,
    loadFromUrl,
    loadFromBytes,
    setPanelColors,
    setPanelColor,
    resetPanel,
    serialize,
    reset,
  };
}
