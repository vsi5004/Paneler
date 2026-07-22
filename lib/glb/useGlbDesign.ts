"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseGlb, parseDocument, type ParsedGlb } from "@/lib/topology/gltf";
import { setMaterialColor, serializeDocument } from "@/lib/glb/mutate";
import { linearRgbaToHex } from "@/lib/glb/build";
import {
  generateTemplateDocument,
  TARGET_TOTAL_TRIANGLES,
  DRAFT_TOTAL_TRIANGLES,
} from "@/lib/glb/generate";
import { presetById, type PresetParams } from "@/lib/topology/presets";
import type { PanelColors, PanelTopology } from "@/lib/types";

/** Preset provenance + current shape param values for the loaded design. */
export interface DesignInfo {
  presetId: string;
  params: PresetParams;
}

/** Draft = coarse mesh while a slider drags; full = final quality on release. */
export type RegenQuality = "draft" | "full";

const DRAFT_DEBOUNCE_MS = 100;

export interface UseGlbDesignResult {
  /** Latest GLB bytes — kept so the renderer can pass them to GLTFLoader. */
  bytes: Uint8Array | null;
  topology: PanelTopology | null;
  panelColors: PanelColors;
  /**
   * Preset id + shape param values parsed from the GLB's asset extras, or null
   * for custom uploads. Non-null only enables Shape sliders when the preset is
   * known and declares params.
   */
  designInfo: DesignInfo | null;
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
  /**
   * Set one shape param and regenerate the design's geometry from its preset.
   * Colors survive because panel ids are stable across param values.
   */
  setDesignParam: (key: string, value: number, quality: RegenQuality) => void;
  /** Serialize the current GLB document back to bytes (for save). */
  serialize: () => Promise<Uint8Array | null>;
  /** Clear loaded design. */
  reset: () => void;
}

export function useGlbDesign(): UseGlbDesignResult {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [parsed, setParsed] = useState<ParsedGlb | null>(null);
  const [panelColors, setPanelColorsState] = useState<PanelColors>({});
  const [designInfo, setDesignInfo] = useState<DesignInfo | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache template defaults so resetPanel can recover them after edits.
  const defaultsRef = useRef<PanelColors>({});
  // Latest panelColors, readable inside async regen callbacks.
  const panelColorsRef = useRef<PanelColors>({});
  // Latest designInfo so rapid setDesignParam calls compound before re-render.
  const designInfoRef = useRef<DesignInfo | null>(null);
  // When > 0, the bytes-parse effect skips a run: a param regen already set
  // `parsed` from the freshly generated document, and re-parsing would clobber
  // defaultsRef (template default colors) and reset panelColors from materials.
  const skipParseRef = useRef(0);
  // Trailing-debounce timer for draft-quality regens while a slider drags.
  const regenTimerRef = useRef<number | null>(null);
  // Monotonic counter; stale async regen completions are dropped.
  const regenCounterRef = useRef(0);

  useEffect(() => {
    panelColorsRef.current = panelColors;
  }, [panelColors]);

  // Parse bytes → topology + materials. Initialise panelColors from the
  // material's baseColorFactor so a freshly-loaded design starts at its
  // baked colors.
  useEffect(() => {
    if (skipParseRef.current > 0) {
      skipParseRef.current -= 1;
      return;
    }
    if (!bytes) {
      setParsed(null);
      setPanelColorsState({});
      setDesignInfo(null);
      designInfoRef.current = null;
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
        const info = p.design ?? null;
        setDesignInfo(info);
        designInfoRef.current = info;
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

  // Invalidate any in-flight or pending param regen (e.g. before loading a
  // different design) so a stale completion can't clobber the new state.
  const cancelRegen = useCallback(() => {
    regenCounterRef.current += 1;
    if (regenTimerRef.current !== null) {
      window.clearTimeout(regenTimerRef.current);
      regenTimerRef.current = null;
    }
  }, []);

  const loadFromBytes = useCallback(async (newBytes: Uint8Array) => {
    cancelRegen();
    setLoading(true);
    setError(null);
    // Trigger the parse effect — actual parse is async there.
    setBytes(newBytes);
    setLoading(false);
  }, [cancelRegen]);

  const loadFromUrl = useCallback(
    async (url: string) => {
      cancelRegen();
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
    [cancelRegen],
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

  // Regenerate geometry from the preset at the given params, carrying the
  // current colors over (panel ids are stable across param values). Replaces
  // both `parsed` (topology/materials/document) and `bytes` (canvas) directly;
  // the bytes-parse effect is skipped via skipParseRef.
  const applyGenerated = useCallback(
    async (info: DesignInfo, targetTriangles: number) => {
      const generation = ++regenCounterRef.current;
      try {
        const doc = generateTemplateDocument(
          info.presetId,
          info.params,
          panelColorsRef.current,
          { targetTriangles },
        );
        const newBytes = await serializeDocument(doc);
        if (generation !== regenCounterRef.current) return; // superseded
        skipParseRef.current += 1;
        setParsed(parseDocument(doc));
        setBytes(newBytes);
        setVersion((v) => v + 1);
        setError(null);
      } catch (err) {
        if (generation !== regenCounterRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to regenerate design",
        );
      }
    },
    [],
  );

  const setDesignParam = useCallback(
    (key: string, value: number, quality: RegenQuality) => {
      const info = designInfoRef.current;
      if (!info || !presetById(info.presetId)) return;
      const next: DesignInfo = {
        presetId: info.presetId,
        params: { ...info.params, [key]: value },
      };
      designInfoRef.current = next;
      setDesignInfo(next);

      if (regenTimerRef.current !== null) {
        window.clearTimeout(regenTimerRef.current);
        regenTimerRef.current = null;
      }
      if (quality === "full") {
        void applyGenerated(next, TARGET_TOTAL_TRIANGLES);
      } else {
        regenTimerRef.current = window.setTimeout(() => {
          regenTimerRef.current = null;
          void applyGenerated(next, DRAFT_TOTAL_TRIANGLES);
        }, DRAFT_DEBOUNCE_MS);
      }
    },
    [applyGenerated],
  );

  // Drop any pending draft regen on unmount.
  useEffect(() => {
    return () => {
      if (regenTimerRef.current !== null) {
        window.clearTimeout(regenTimerRef.current);
      }
    };
  }, []);

  const serialize = useCallback(async () => {
    if (!parsed) return null;
    return serializeDocument(parsed.document);
  }, [parsed]);

  const reset = useCallback(() => {
    cancelRegen();
    setBytes(null);
    setParsed(null);
    setPanelColorsState({});
    setDesignInfo(null);
    designInfoRef.current = null;
    defaultsRef.current = {};
    setError(null);
  }, [cancelRegen]);

  return {
    bytes,
    topology: parsed?.topology ?? null,
    panelColors,
    designInfo,
    version,
    loading,
    error,
    loadFromUrl,
    loadFromBytes,
    setPanelColors,
    setPanelColor,
    resetPanel,
    setDesignParam,
    serialize,
    reset,
  };
}
