"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";
import { FABRIC_GROUPS } from "@/lib/fabrics";
import {
  applyColor,
  applyColorToPanels,
  applyColorToUnpainted,
  restoreColors,
  sameColors,
  togglePanel,
  type PanelSelection,
} from "@/lib/designState";
import { isWavyPanel, type PaletteEntry, type PanelColors } from "@/lib/types";
import { useGlbDesign } from "@/lib/glb/useGlbDesign";
import { fetchGlbBytes } from "@/lib/glb/prefetch";
import { presetById } from "@/lib/topology/presets";
import { usePlayback } from "@/lib/kaleidoscope/usePlayback";
import { holeCountGapMm } from "@/lib/laser/template";
import { HOLE_BUNCHING_MM } from "@/lib/laser/constants";
import { templateLengthOffsets, type LengthOffset } from "@/lib/laser/lengthSlider";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openGlb, saveGlb } from "@/lib/files/glbFile";
import { useDesigns } from "@/lib/useDesigns";
import { ColorPalette } from "./ColorPalette";
import { LaserSettingsPanel } from "./LaserSettingsPanel";
import { LaserTemplatePane } from "./LaserTemplatePane";
import { ColorSummary } from "./ColorSummary";
import { DesignNav } from "./DesignNav";
import { EmptyDesignState } from "./EmptyDesignState";
import { ShapeParamsPanel } from "./ShapeParamsPanel";
import { PaneTools } from "./PaneTools";
import { TemplateGalleryModal } from "./TemplateGalleryModal";
import PanelerFlatView from "./PanelerFlatView";

interface AuthUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface TemplateEntry {
  slug: string;
  label: string;
  glbPath: string;
  /** Low-detail copy for the gallery thumbnail (absent in older manifests). */
  thumbPath?: string;
  panelCount: number;
  shapeSignature: string;
  /** Listed only in local development builds. */
  devOnly?: boolean;
}

interface PanelerDesignerProps {
  user: AuthUser | null;
  logoutAction?: () => Promise<void>;
  /** True when the app runs against Postgres. Drives the saved-designs nav. */
  dbEnabled: boolean;
  /**
   * The signed-in stitcher's stocked fabrics, resolved server-side in page.tsx.
   * Shown as a "My Fabrics" group above the built-in palettes. Empty in
   * files-only mode, where the group is omitted entirely.
   */
  fabrics?: PaletteEntry[];
}

// R3F can't run on the server. App Router disallows ssr:false in Server
// Components, so the dynamic import lives inside this 'use client' wrapper.
const PanelerCanvas = dynamic(() => import("./PanelerCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Initialising designer…
      </span>
    </div>
  ),
});

const PRESETS_BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/presets";

/** How many paint actions Undo can step back through. */
const UNDO_LIMIT = 100;

export function PanelerDesigner({
  user,
  logoutAction,
  dbEnabled,
  fabrics,
}: PanelerDesignerProps) {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [activeTemplateSlug, setActiveTemplateSlug] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PALETTE[4].color);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const suedeEnabled = true;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  // Persisted FileSystemFileHandle for save-in-place on FSA-capable browsers.
  // Lives in a ref so re-renders don't cycle the handle's permission state.
  const fileHandleRef = useRef<FileSystemHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const design = useGlbDesign();
  const {
    bytes,
    topology,
    panelColors,
    designInfo,
    loadFromUrl,
    loadFromBytes,
    setPanelColors,
    setDesignParam,
    laserSettings,
    setLaserSettings,
  } = design;

  // Panels grouped by their actual shape, as the Summary groups them (ids
  // keep their preset's default shape name, so they can't be used for this).
  const shapeClasses = useMemo(
    () => (topology ? groupPanelsByCongruence(topology) : []),
    [topology],
  );

  // Several panels at once: every panel of one shape ("Select all", with its
  // label) or panels shift-clicked one by one (no label). They stay selected
  // and the next palette color paints them all; a plain click goes back to one.
  const [selection, setSelection] = useState<PanelSelection | null>(null);
  const highlightedIds = useMemo(
    () => selection?.panelIds ?? (selectedPanelId ? [selectedPanelId] : []),
    [selection, selectedPanelId],
  );

  // Undo and Redo: each paint action saves the colors from before it; Undo
  // moves one step back (keeping it for Redo), and a new paint drops what
  // Redo had. Per design (cleared on load), capped so a long session stays small.
  const historyRef = useRef<{ undo: PanelColors[]; redo: PanelColors[] }>({ undo: [], redo: [] });
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const recordHistory = useCallback(() => {
    setHistory({ undo: historyRef.current.undo.length, redo: historyRef.current.redo.length });
  }, []);
  const paint = useCallback(
    (next: PanelColors) => {
      if (sameColors(panelColors, next)) return;
      historyRef.current = { undo: [...historyRef.current.undo, panelColors].slice(-UNDO_LIMIT), redo: [] };
      recordHistory();
      setPanelColors(next);
    },
    [panelColors, recordHistory, setPanelColors],
  );
  const step = useCallback(
    (from: "undo" | "redo") => {
      const to = from === "undo" ? "redo" : "undo";
      const state = historyRef.current[from].pop();
      if (!state) return;
      historyRef.current[to] = [...historyRef.current[to], panelColors].slice(-UNDO_LIMIT);
      recordHistory();
      setPanelColors(restoreColors(panelColors, state));
    },
    [panelColors, recordHistory, setPanelColors],
  );
  const handleUndo = useCallback(() => step("undo"), [step]);
  const handleRedo = useCallback(() => step("redo"), [step]);
  // Clicking off the ball or the net, or Esc, selects nothing.
  const clearSelection = useCallback(() => {
    setSelectedPanelId(null);
    setSelection(null);
  }, []);
  // Loading a design shows an overlay until the model is on screen (the
  // canvas's onModelSettled), or until the load fails.
  const [loadingDesign, setLoadingDesign] = useState(false);
  const handleModelSettled = useCallback(() => setLoadingDesign(false), []);
  // Each load gets a number, so a background step that finishes late (a new
  // template's save) can tell whether another design has been opened since.
  const loadTokenRef = useRef(0);
  // A new template's saved-design row, being created in the background.
  const pendingCreateRef = useRef<Promise<{ id: string } | null> | null>(null);
  /** Call first in every load: shows the overlay and disowns earlier loads' background steps. */
  const beginLoad = useCallback(() => {
    setLoadingDesign(true);
    loadTokenRef.current += 1;
    pendingCreateRef.current = null;
    return loadTokenRef.current;
  }, []);
  // A newly loaded design starts with nothing selected and nothing to undo.
  const startFresh = useCallback(() => {
    setSelectedPanelId(null);
    setSelection(null);
    historyRef.current = { undo: [], redo: [] };
    setHistory({ undo: 0, redo: 0 });
  }, []);
  // loadFromUrl/loadFromBytes report failure through design.error, not by
  // throwing; a new error ends the overlay (adjusted during render).
  const [seenError, setSeenError] = useState(design.error);
  if (design.error !== seenError) {
    setSeenError(design.error);
    if (design.error) setLoadingDesign(false);
  }
  const loadFailed = useCallback((message: string) => {
    setLoadingDesign(false);
    setUploadError(message);
    window.setTimeout(() => setUploadError(null), 5000);
  }, []);

  // Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z or Ctrl+Y redoes; Esc selects nothing.
  // Not while typing in a field, whose own undo wins there, and Esc that
  // closed a menu or dialog (already handled) is left alone.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!e.defaultPrevented) clearSelection();
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const redo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey);
      if (!redo && !(key === "z" && !e.shiftKey)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      if (redo) handleRedo();
      else handleUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, handleRedo, handleUndo]);

  // Palette groups for the sidebar. The stitcher's own fabrics lead — those are
  // the colors they can actually sew — with the built-ins below as reference.
  // Empty groups are dropped by ColorPalette, so an unconfigured account sees
  // exactly what it saw before this feature existed.
  /*
   * The sidebar is for painting, so it shows cloth. "Standard" is the
   * twenty-one generic colours that predate the fabric library — useful for
   * sketching a colourway you have not bought yet, which is a profile-page
   * job, not something to scroll past on the way to the fabric you own. It
   * stays in FABRIC_CATALOG so a stitcher can still add one to My Fabrics.
   */
  const paletteGroups = useMemo(
    () => [
      { label: "My Fabrics", entries: fabrics ?? [] },
      ...FABRIC_GROUPS.filter((g) => g.label !== "Standard"),
    ],
    [fabrics],
  );
  const fabricCount = useMemo(
    () => paletteGroups.reduce((n, g) => n + g.entries.length, 0),
    [paletteGroups],
  );

  // Shape param defs for the loaded design's preset, when it declares any.
  const shapeParamDefs = useMemo(() => {
    if (!designInfo) return null;
    const defs = presetById(designInfo.presetId)?.params;
    return defs && defs.length > 0 ? defs : null;
  }, [designInfo]);

  // Animated presets (the Kaleidoscope): Play advances the time param.
  const animation = designInfo ? presetById(designInfo.presetId)?.animation : undefined;
  const playback = usePlayback({
    timeParam: animation?.timeParam,
    period: animation?.period ?? Infinity,
    time: animation ? (designInfo?.params[animation.timeParam] ?? 0) : 0,
    frameKey: bytes,
    setDesignParam,
  });
  // While playing, the flat net and laser panes hold the last still frame:
  // re-flattening every animation frame would stall playback. They catch
  // up when paused.
  const [netTopology, setNetTopology] = useState(topology);
  if (!playback.playing && netTopology !== topology) setNetTopology(topology);

  // Per-preset laser template options (Orbita: anchor holes on sharp
  // star bends). Memoized so the pane's template memo doesn't churn.
  const laserTemplateOptions = useMemo(() => {
    const preset = designInfo ? presetById(designInfo.presetId) : undefined;
    if (
      !preset?.laserSharpBendAnchors &&
      !preset?.seamTrueFlatten &&
      !preset?.laserCornerHoles &&
      !preset?.laserHoleCount &&
      preset?.gatherCorrection === undefined
    ) {
      return undefined;
    }
    return {
      ...(preset.laserSharpBendAnchors ? { sharpBendAnchors: true } : {}),
      ...(preset.seamTrueFlatten ? { seamTrueBands: true } : {}),
      ...(preset.laserCornerHoles ? { cornerHoles: true } : {}),
      ...(preset.laserHoleCount ? { holeCount: preset.laserHoleCount } : {}),
      ...(preset.gatherCorrection !== undefined
        ? { gatherCorrection: preset.gatherCorrection }
        : {}),
    };
  }, [designInfo]);

  // Count-controlled stitch holes: the resulting hole-to-hole distance,
  // for the label under the Holes-per-hex-edge slider.
  const holeCount = useMemo(() => {
    if (!laserTemplateOptions?.holeCount || !netTopology) return undefined;
    const convention = designInfo ? presetById(designInfo.presetId)?.laserHoleCount : undefined;
    return {
      // Unbunched, so it reads as the pitch whatever the bunching.
      gapMm: holeCountGapMm(netTopology, { ...laserSettings, holeBunchingMm: 0 }, laserTemplateOptions),
      sliderLabel: convention?.sliderLabel ?? "Holes per hex edge",
      matchSide: convention?.matchSide ?? "matching side",
      markEdgeLabel: convention?.markEdge ? convention.markEdgeLabel : undefined,
    };
  }, [netTopology, laserSettings, laserTemplateOptions, designInfo]);

  // Hole bunching: the value a design cuts with until the slider moves
  // (see buildLaserTemplate), and a max of half the pitch. Hidden on
  // single closed-seam balls (Baseball, Spiral), whose loops aren't bunched.
  const bunching = useMemo(() => {
    const t = netTopology ?? topology;
    if (!t) return undefined;
    const neighbours = new Map<string, Set<string>>();
    for (const e of t.edges) {
      if (!e.panelB) continue;
      neighbours.set(e.panelA, (neighbours.get(e.panelA) ?? new Set()).add(e.panelB));
      neighbours.set(e.panelB, (neighbours.get(e.panelB) ?? new Set()).add(e.panelA));
    }
    if (![...neighbours.values()].some((s) => s.size > 1)) return undefined;
    const spacingLaid =
      !laserTemplateOptions?.holeCount &&
      !laserTemplateOptions?.cornerHoles &&
      t.panels.some((p) => !isWavyPanel(p, t));
    const pitch = holeCount?.gapMm ?? laserSettings.holeSpacingMm;
    return { defaultMm: spacingLaid ? HOLE_BUNCHING_MM : 0, maxMm: pitch / 2 };
  }, [netTopology, topology, laserTemplateOptions, holeCount, laserSettings.holeSpacingMm]);

  // Length sliders on count-controlled designs (GP(3,0)'s and the soccer
  // ball's Short edge) show, and step in, the short side as the templates
  // label it — corner stitch to corner stitch — not its bare seam length.
  // Measuring that across the slider takes a fraction of a second, so it
  // runs once laser settings settle, not per change.
  const lengthDef = shapeParamDefs?.find((d) => d.lengthAngle);
  const otherParams = designInfo && lengthDef
    ? JSON.stringify({ ...designInfo.params, [lengthDef.key]: undefined })
    : "";
  const [templateLengths, setTemplateLengths] = useState<Record<string, LengthOffset[]>>();
  useEffect(() => {
    const preset = designInfo ? presetById(designInfo.presetId) : undefined;
    const id = window.setTimeout(() => {
      setTemplateLengths(
        preset && lengthDef && laserTemplateOptions?.holeCount
          ? { [lengthDef.key]: templateLengthOffsets(preset, lengthDef, JSON.parse(otherParams), laserSettings, laserTemplateOptions) }
          : undefined,
      );
    }, 200);
    return () => window.clearTimeout(id);
    // designInfo is read through presetId and otherParams: a drag of the
    // length param itself must not re-measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designInfo?.presetId, lengthDef, otherParams, laserSettings, laserTemplateOptions]);

  // Panel types (template labels) for the per-type curvature sliders.
  const panelTypes = useMemo(
    () => (netTopology ? groupPanelsByCongruence(netTopology).map((c) => c.label) : []),
    [netTopology],
  );

  // Same preset knowledge for the flat net's unfold.
  const flattenOptions = useMemo(
    () =>
      designInfo && presetById(designInfo.presetId)?.seamTrueFlatten
        ? { seamTrueBands: true }
        : undefined,
    [designInfo],
  );

  // Design nav + persistence (DB mode only).
  const ds = useDesigns({ enabled: dbEnabled });
  const [navCollapsed, setNavCollapsed] = useState(false);
  const toggleNav = useCallback(() => setNavCollapsed((v) => !v), []);

  // Gallery modal — shown when user clicks "New Design" anywhere.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const handleLoadDesign = useCallback(
    async (id: string) => {
      beginLoad();
      try {
        const row = await ds.load(id);
        if (!row) {
          setLoadingDesign(false);
          return;
        }
        // Fetch the GLB bytes from R2 and load into the editor
        const glbBytes = await ds.fetchGlb(id);
        setActiveTemplateSlug(null);
        setUploadedName(row.name);
        startFresh();
        await loadFromBytes(glbBytes);
      } catch (err) {
        loadFailed(err instanceof Error ? err.message : "Couldn't open the design");
      }
    },
    [ds, beginLoad, loadFailed, loadFromBytes, startFresh],
  );

  // Open the gallery — the actual creation happens after the user picks a template.
  const handleOpenGallery = useCallback(() => {
    setGalleryOpen(true);
  }, []);

  // Create a new design from a gallery selection. The template opens at
  // once; in DB mode its saved-design row (a row, then the bytes uploaded to
  // R2) is created in the background — that used to hold the model back by
  // several round trips and a 1-2 MB upload. Save waits for it.
  const handleSelectTemplate = useCallback(
    async (slug: string) => {
      const entry = templates.find((t) => t.slug === slug);
      if (!entry) return;
      const url = PRESETS_BASE + entry.glbPath.replace(/^\/presets/, "");
      const token = beginLoad();
      try {
        if (dbEnabled) {
          // Reuses the download a hover over the card started.
          const bytes = await fetchGlbBytes(url);
          if (token !== loadTokenRef.current) return;
          // Not the previously open design's row: Save must not overwrite it.
          ds.setCurrentId(null);
          setActiveTemplateSlug(null);
          setUploadedName(entry.label);
          startFresh();
          const creating = ds
            .createFromUpload(
              {
                name: entry.label,
                bytes,
                panelCount: entry.panelCount,
                shapeSignature: entry.shapeSignature,
              },
              { select: false },
            )
            .then((row) => {
              // Only if this template is still the one open.
              if (row && token === loadTokenRef.current) {
                ds.setCurrentId(row.id);
                setUploadedName(row.name);
              }
              return row;
            })
            .catch((err: unknown) => {
              console.error(err);
              // Save will create the row from the edited design instead.
              return null;
            });
          pendingCreateRef.current = creating;
          await loadFromBytes(bytes);
        } else {
          setActiveTemplateSlug(slug);
          setUploadedName(null);
          startFresh();
          await loadFromUrl(url);
        }
      } catch (err) {
        loadFailed(err instanceof Error ? err.message : "Couldn't load the template");
      }
    },
    [templates, dbEnabled, ds, beginLoad, loadFailed, loadFromBytes, loadFromUrl, startFresh],
  );

  // One-shot template manifest fetch. The bake script writes
  // public/presets/index.json next to the GLBs. We no longer auto-load
  // any template on mount — the EmptyDesignState overlay prompts the
  // user to pick a starting point explicitly.
  useEffect(() => {
    let cancelled = false;
    void fetch(`${PRESETS_BASE}/index.json`)
      .then((r) => r.json() as Promise<TemplateEntry[]>)
      .then((list) => {
        if (cancelled) return;
        // devOnly presets stay off the live picker; NODE_ENV is inlined
        // at build time, so production bundles (k8s and the static
        // export) filter them and `npm run dev` shows them.
        setTemplates(
          list.filter(
            (e) => !e.devOnly || process.env.NODE_ENV === "development",
          ),
        );
      })
      .catch(() => {
        // Manifest fetch can fail in non-deployed test contexts; UI handles
        // the empty list gracefully.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allPanelIds = useMemo(
    () => topology?.panels.map((p) => p.id) ?? [],
    [topology],
  );

  const handlePanelClick = useCallback(
    (panelId: string, { shift = false }: { shift?: boolean } = {}) => {
      if (shift) {
        setSelection(togglePanel(selection, selectedPanelId, panelId));
        setSelectedPanelId(panelId);
        return;
      }
      setSelectedPanelId(panelId);
      setSelection(null);
      paint(applyColor(panelColors, panelId, selectedColor));
    },
    [panelColors, paint, selectedColor, selection, selectedPanelId],
  );

  // Picking a color with several panels selected paints them all.
  const handlePickColor = useCallback(
    (color: string) => {
      setSelectedColor(color);
      if (selection) paint(applyColorToPanels(panelColors, selection.panelIds, color));
    },
    [panelColors, paint, selection],
  );


  const handleGlbUpload = useCallback(
    async (file: File) => {
      beginLoad();
      try {
        const buf = await file.arrayBuffer();
        setUploadError(null);
        setActiveTemplateSlug(null);
        setUploadedName(file.name);
        startFresh();
        // A file-picker upload doesn't give us a writable handle, so saves
        // will need to re-prompt for a location. The "Open" flow does.
        fileHandleRef.current = null;
        await loadFromBytes(new Uint8Array(buf));
      } catch (err) {
        loadFailed(err instanceof Error ? err.message : "GLB load failed");
      }
    },
    [beginLoad, loadFailed, loadFromBytes, startFresh],
  );

  const handleOpen = useCallback(async () => {
    setUploadError(null);
    try {
      const opened = await openGlb();
      if (!opened) return;
      beginLoad();
      setActiveTemplateSlug(null);
      setUploadedName(opened.name);
      startFresh();
      fileHandleRef.current = opened.handle;
      await loadFromBytes(opened.bytes);
    } catch (err) {
      loadFailed(err instanceof Error ? err.message : "Open failed");
    }
  }, [beginLoad, loadFailed, loadFromBytes, startFresh]);

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      const serialized = await design.serialize();
      if (!serialized) {
        setSaveState("idle");
        return;
      }
      // A new template's row may still be being created in the background.
      const savedId =
        ds.currentId ?? (pendingCreateRef.current ? (await pendingCreateRef.current)?.id ?? null : null);
      if (dbEnabled && savedId) {
        // Save to DB/R2
        await ds.saveBytes(savedId, { bytes: serialized });
      } else if (dbEnabled) {
        // Create new design in DB
        await ds.createFromUpload({
          name: uploadedName ?? activeTemplateSlug ?? "Untitled",
          bytes: serialized,
          panelCount: topology?.panels.length,
        });
      } else {
        // File-based save
        const suggested =
          uploadedName ??
          (activeTemplateSlug ? `${activeTemplateSlug}.glb` : "design.glb");
        const handle = await saveGlb(serialized, suggested, fileHandleRef.current);
        if (handle) fileHandleRef.current = handle;
      }
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      console.error(err);
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), 2500);
      const limit = err instanceof Error ? SAVE_LIMIT_MESSAGES[err.message] : undefined;
      if (limit) {
        setUploadError(limit);
        window.setTimeout(() => setUploadError(null), 8000);
      }
    }
  }, [design, uploadedName, activeTemplateSlug, dbEnabled, ds, topology]);

  const handleResetSelected = useCallback(() => {
    if (!selectedPanelId) return;
    design.resetPanel(selectedPanelId);
  }, [design, selectedPanelId]);

  const handleFillUnpainted = useCallback(() => {
    setPanelColors((prev: PanelColors) =>
      applyColorToUnpainted(prev, allPanelIds, selectedColor),
    );
  }, [allPanelIds, selectedColor, setPanelColors]);

  return (
    // h-dvh (not flex-1 of a content-sized body): the designer is a
    // single-screen app — bounding it to the viewport is what lets the
    // inner min-h-0/overflow chain contain tall content (laser pane,
    // sidebar) instead of growing the page and causing scrolling.
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Identity strip — title bar spans the full width above the drawer. */}
      <div className="workshop-slab flex items-center justify-between border-b px-5 py-2">
        <div className="flex items-center gap-3">
          <Sigil />
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-base tracking-[0.22em] text-foreground">
              PANELER
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenGallery}
            className="h-7 gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-primary transition-colors hover:border-primary hover:bg-primary/20 hover:shadow-[0_0_12px_oklch(0.89_0.22_128/30%)]"
          >
            <NewIcon />
            New
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-7 gap-1.5 rounded-md border border-border bg-background/40 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          >
            <UploadGlyph />
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,model/gltf-binary"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleGlbUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleOpen()}
            className="h-7 gap-1.5 rounded-md border border-border bg-background/40 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          >
            <OpenIcon />
            Open
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saveState === "saving" || !bytes || playback.playing}
            title={playback.playing ? "Pause to save" : undefined}
            className={`h-7 gap-1.5 rounded-md border border-border bg-background/40 px-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary ${
              saveState === "error" ? "text-destructive" : ""
            }`}
          >
            <SaveIcon />
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : "Save"}
          </Button>
          <span className="h-5 w-px bg-border" aria-hidden />
          {user && (
            <UserMenu
              user={user}
              logoutAction={logoutAction}
              showProfile={dbEnabled}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {dbEnabled && (
          <DesignNav
            designs={ds.designs}
            currentId={ds.currentId}
            loading={ds.loading}
            collapsed={navCollapsed}
            onToggleCollapsed={toggleNav}
            onCreate={handleOpenGallery}
            onLoad={handleLoadDesign}
            onRename={ds.rename}
            onToggleStarred={ds.toggleStarred}
            onTogglePublished={ds.togglePublished}
            onDelete={ds.remove}
          />
        )}
        <div className="flex flex-1 flex-col">
          {!bytes ? (
            <div className="relative flex flex-1 flex-col">
              <EmptyDesignState
                dbEnabled={dbEnabled}
                onNew={handleOpenGallery}
                onOpen={() => void handleOpen()}
                onImport={() => fileInputRef.current?.click()}
              />
              {loadingDesign && <LoadingOverlay />}
            </div>
          ) : (
            <>
              {/* Active file status strip — slim, mono, no controls. */}
              <div className="workshop-slab flex flex-wrap items-center gap-3 border-b px-5 py-2.5">
                {uploadedName && (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-primary/90">
                    <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                    {uploadedName}
                    {topology && (
                      <>
                        <span className="text-muted-foreground/70">·</span>
                        <span className="text-muted-foreground">
                          {topology.panels.length} panels
                        </span>
                      </>
                    )}
                  </span>
                )}
                {uploadError && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-destructive">
                    {uploadError}
                  </span>
                )}
              </div>

              {/* Canvas stage + sidebar. */}
              <div className="flex flex-1 overflow-hidden">
                <div className="flex flex-1 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                    <CanvasFrame
                      label="3D · Sphere"
                      className="flex-1"
                      actions={
                        topology ? (
                          <PaneTools
                            classes={shapeClasses}
                            selection={selection}
                            onSelectAll={(c) => setSelection({ label: c.label, panelIds: c.panelIds })}
                            onClear={() => setSelection(null)}
                            canUndo={history.undo > 0}
                            canRedo={history.redo > 0}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                          />
                        ) : null
                      }
                    >
                      <PanelerCanvas
                        glbBytes={bytes}
                        panelColors={panelColors}
                        selectedPanelIds={highlightedIds}
                        suedeEnabled={suedeEnabled}
                        onPanelClick={handlePanelClick}
                        onBackgroundClick={clearSelection}
                        onModelSettled={handleModelSettled}
                      />
                      {loadingDesign && <LoadingOverlay />}
                    </CanvasFrame>
                    <div className="glow-divider" />
                    <CanvasFrame
                      label="2D · Flat net"
                      className="flex-1"
                    >
                      {netTopology ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <PanelerFlatView
                              topology={netTopology}
                              panelColors={panelColors}
                              selectedPanelIds={highlightedIds}
                              onPanelClick={handlePanelClick}
                              onBackgroundClick={clearSelection}
                              flattenOptions={flattenOptions}
                            />
                          </div>
                          <LaserTemplatePane
                            topology={netTopology}
                            laserSettings={laserSettings}
                            onSettingsChange={setLaserSettings}
                            designName={
                              uploadedName ?? activeTemplateSlug ?? "design"
                            }
                            templateOptions={laserTemplateOptions}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center justify-center">
                          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                            Loading…
                          </span>
                        </div>
                      )}
                    </CanvasFrame>
                  </div>
                </div>
                <aside className="hidden w-72 flex-col overflow-y-auto overflow-x-hidden border-l bg-[var(--sidebar)]/60 p-5 md:flex lg:w-80">
                  {shapeParamDefs && designInfo && (
                    <>
                      <ShapeParamsPanel
                        paramDefs={shapeParamDefs}
                        values={designInfo.params}
                        onChange={setDesignParam}
                        diameterIn={laserSettings.diameterIn}
                        templateLengths={templateLengths}
                        playback={
                          animation
                            ? {
                                playing: playback.playing,
                                onPlay: playback.play,
                                onPause: playback.pause,
                                speed: playback.speed,
                                onSpeedChange: playback.setSpeed,
                              }
                            : undefined
                        }
                      />
                      <div className="workshop-hairline my-5" />
                    </>
                  )}
                  {topology && (
                    <>
                      <LaserSettingsPanel
                        values={laserSettings}
                        onChange={setLaserSettings}
                        hasPolygonPanels={(netTopology ?? topology).panels.some(
                          (p) => !isWavyPanel(p, netTopology ?? topology),
                        )}
                        hasShortEdges={(() => {
                          const t = netTopology ?? topology;
                          const lens = t.edges.map((e) =>
                            t.vertices[e.vertexA].distanceTo(t.vertices[e.vertexB]),
                          );
                          const maxLen = Math.max(...lens);
                          return maxLen > 0 && lens.some((l) => l < 0.55 * maxLen);
                        })()}
                        holeCount={holeCount}
                        bunching={bunching}
                        panelTypes={panelTypes}
                      />
                      <div className="workshop-hairline my-5" />
                    </>
                  )}
                  {/* Palette */}
                  <section>
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
                        Palette
                      </h2>
                      {topology && (
                        <button
                          type="button"
                          onClick={() => setSummaryOpen(true)}
                          className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-primary transition-colors hover:border-primary hover:bg-primary/20"
                        >
                          Summary
                        </button>
                      )}
                    </div>
                    <ColorPalette
                      selected={selectedColor}
                      onSelect={handlePickColor}
                      groups={paletteGroups}
                    />
                  </section>
                  {topology && (
                    <>
                      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
                        <DialogContent className="max-w-sm border-border bg-[oklch(0.08_0_0)]">
                          <DialogHeader>
                            <div className="flex items-baseline justify-between">
                              <DialogTitle className="font-heading tracking-[0.18em] text-foreground">
                                Color Summary
                              </DialogTitle>
                              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                                {topology.panels.length} panels
                              </span>
                            </div>
                          </DialogHeader>
                          <ColorSummary
                            topology={topology}
                            panelColors={panelColors}
                            onSwatchClick={(color) => {
                              setSelectedColor(color);
                              setSummaryOpen(false);
                            }}
                          />
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                  <div className="workshop-hairline mt-5" />
                  <p className="mt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.15em] text-muted-foreground">
                    For supplies and materials, check out{" "}
                    <a
                      href="https://newyorkfootbag.com/shop?utm_source=paneler&utm_medium=referral&utm_campaign=panel-designer&utm_content=designer-sidebar"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary transition-colors hover:text-foreground"
                    >
                      newyorkfootbag.com
                    </a>
                  </p>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>

      <TemplateGalleryModal
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        templates={templates}
        onSelect={handleSelectTemplate}
      />
    </div>
  );
}

/** Server refusals on save that the user can act on (app/api/designs routes). */
const SAVE_LIMIT_MESSAGES: Record<string, string> = {
  too_many_designs: "You have 200 saved designs, the most allowed. Delete some to save new ones.",
  glb_too_large: "This design is over 32 MB, too large to save.",
};

/** Over the 3D pane while a design loads: the brand mark, spinning, and a word. */
function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#030610]/80 backdrop-blur-sm">
      <span className="animate-spin [animation-duration:1.6s]">
        <span className="block scale-[2.2]">
          <Sigil />
        </span>
      </span>
      <span className="mt-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Loading design…</span>
    </div>
  );
}

/** Brand-mark glyph — a tiny hexagon-pentagon cluster echoing the favicon. */
function Sigil() {
  return (
    <span className="flex size-6 items-center justify-center">
      <svg
        width="20"
        height="20"
        viewBox="0 0 64 64"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="32" cy="32" r="26" opacity="0.35" />
        <polygon points="32,23 40.56,29.22 37.29,39.28 26.71,39.28 23.44,29.22" />
        <polygon points="32,12 37.2,15 37.2,21 32,24 26.8,21 26.8,15" />
        <polygon points="44.12,19 49.32,22 49.32,28 44.12,31 38.92,28 38.92,22" />
        <polygon points="44.12,33 49.32,36 49.32,42 44.12,45 38.92,42 38.92,36" />
        <polygon points="32,40 37.2,43 37.2,49 32,52 26.8,49 26.8,43" />
        <polygon points="19.88,33 25.08,36 25.08,42 19.88,45 14.68,42 14.68,36" />
        <polygon points="19.88,19 25.08,22 25.08,28 19.88,31 14.68,28 14.68,22" />
      </svg>
    </span>
  );
}


function CanvasFrame({
  label,
  className,
  actions,
  children,
}: {
  label: string;
  className?: string;
  /** Tools pinned to the pane's top-right corner. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative flex min-h-0 flex-col bg-[#030610] ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-2">
        <span className="size-1 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/80">
          {label}
        </span>
      </div>
      {actions && <div className="absolute right-3 top-2 z-10">{actions}</div>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

function NewIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7" x2="12" y2="17" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function UserMenu({
  user,
  logoutAction,
  showProfile,
}: {
  user: AuthUser;
  logoutAction?: () => Promise<void>;
  /** Profile lives behind the database; files-only mode has nothing to show. */
  showProfile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const initial =
    (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex size-7 items-center justify-center overflow-hidden rounded-full border border-border bg-background/40 text-xs font-medium ring-1 ring-inset ring-white/[0.04] transition-all hover:border-primary/40 hover:ring-primary/30"
        aria-label={user.name ?? user.email ?? "Account"}
        title={user.name ?? user.email ?? "Account"}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-md border border-border bg-popover shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6)]"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="border-b border-hairline px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Signed in
            </div>
            <div className="mt-1 truncate text-sm font-medium leading-tight text-foreground">
              {user.name ?? "—"}
            </div>
            {user.email && (
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {user.email}
              </div>
            )}
          </div>
          {showProfile && (
            <Link
              href="/profile"
              className="block w-full px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              Profile
            </Link>
          )}
          {logoutAction && (
            <form action={logoutAction}>
              <button
                type="submit"
                className="w-full px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
