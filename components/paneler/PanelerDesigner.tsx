"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { PRESETS } from "@/lib/topology/presets";
import { parseObjToTopology } from "@/lib/topology/obj";
import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";
import {
  applyColor,
  applyColorToUnpainted,
  applyShapeColor,
  decodeDesignFromHash,
  resetPanel,
} from "@/lib/designState";
import type { PanelColors, PanelTopology } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { useDesigns } from "@/lib/useDesigns";
import { ColorPalette } from "./ColorPalette";
import { ColorSummary } from "./ColorSummary";
import { DesignNav } from "./DesignNav";
import { PanelInfoBar } from "./PanelInfoBar";
import PanelerFlatView from "./PanelerFlatView";
import { ShareControls } from "./ShareControls";

interface AuthUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface PanelerDesignerProps {
  user: AuthUser | null;
  logoutAction?: () => Promise<void>;
  /** True when the app runs against Postgres. Drives the left-nav design list. */
  dbEnabled: boolean;
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

const DEFAULT_PRESET = "soccer";

export function PanelerDesigner({
  user,
  logoutAction,
  dbEnabled,
}: PanelerDesignerProps) {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PALETTE[4].color);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [panelColors, setPanelColors] = useState<PanelColors>({});
  const [suedeEnabled, setSuedeEnabled] = useState(true);
  const [customTopology, setCustomTopology] = useState<PanelTopology | null>(
    null,
  );
  const [customLabel, setCustomLabel] = useState<string>("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const preset =
    PRESETS.find((p) => p.id === presetId) ??
    PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
  const topology = useMemo(
    () => customTopology ?? preset.topology(),
    [customTopology, preset],
  );
  const allPanelIds = useMemo(
    () => topology.panels.map((p) => p.id),
    [topology],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.hash) return;
    // URL-hash share is the files-only/GH-Pages share mechanism. In DB mode
    // sharing happens via the per-design publish toggle, so stale hash links
    // are silently ignored.
    if (dbEnabled) return;
    try {
      const design = decodeDesignFromHash(window.location.hash);
      const match = PRESETS.find((p) => p.id === design.modelType);
      // One-shot hydration from URL hash on mount — set-state-in-effect is
      // the right pattern here (no other way to seed initial state from a
      // browser-only API).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (match) setPresetId(match.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPanelColors(design.panelColors);
    } catch {
      // ignore — preserves the default-empty design
    }
  }, [dbEnabled]);

  // Designs nav + persistence (DB modes only). The hook stays inert when
  // disabled, so it's safe to instantiate unconditionally.
  const snapshotCurrent = useCallback(
    () => ({ version: 1 as const, modelType: presetId, panelColors }),
    [presetId, panelColors],
  );
  const ds = useDesigns({ enabled: dbEnabled, snapshotCurrent });
  const { currentId } = ds;

  // Auto-save the current row when the design changes (debounced). Tiny
  // payloads, fine to write often; the debounce avoids one POST per
  // panel-click while painting.
  useEffect(() => {
    if (!dbEnabled || !currentId) return;
    const t = window.setTimeout(() => {
      ds.saveCurrent().catch(() => {
        // Surfacing a toast is overkill here; failures show up in DevTools
        // and the user will retry by interacting again.
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [dbEnabled, currentId, presetId, panelColors, ds]);

  const handleLoadDesign = useCallback(
    async (id: string) => {
      const row = await ds.load(id);
      if (!row) return;
      const match = PRESETS.find((p) => p.id === row.payload.modelType);
      if (match) setPresetId(match.id);
      setCustomTopology(null);
      setCustomLabel("");
      setPanelColors(row.payload.panelColors);
      setSelectedPanelId(null);
    },
    [ds],
  );

  const handleCreateDesign = useCallback(async () => {
    await ds.create("Untitled");
  }, [ds]);

  const handlePanelClick = useCallback(
    (panelId: string) => {
      setSelectedPanelId(panelId);
      setPanelColors((prev) => applyColor(prev, panelId, selectedColor));
    },
    [selectedColor],
  );

  const handlePresetChange = useCallback((newId: string) => {
    setPresetId(newId);
    setCustomTopology(null);
    setCustomLabel("");
    setPanelColors({});
    setSelectedPanelId(null);
  }, []);

  const handleObjUpload = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const topo = parseObjToTopology(text, 1);
      setCustomTopology(topo);
      setCustomLabel(file.name);
      setPanelColors({});
      setSelectedPanelId(null);
      setUploadError(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "OBJ parse failed");
      window.setTimeout(() => setUploadError(null), 5000);
    }
  }, []);

  const handleResetSelected = useCallback(() => {
    if (!selectedPanelId) return;
    setPanelColors((prev) => resetPanel(prev, selectedPanelId));
  }, [selectedPanelId]);

  const handlePaintShape = useCallback(
    (shape: string) => {
      setPanelColors((prev) =>
        applyShapeColor(prev, allPanelIds, shape, selectedColor),
      );
    },
    [allPanelIds, selectedColor],
  );

  const handleFillUnpainted = useCallback(() => {
    setPanelColors((prev) =>
      applyColorToUnpainted(prev, allPanelIds, selectedColor),
    );
  }, [allPanelIds, selectedColor]);

  const handleImport = useCallback(
    (importedModelType: string, importedColors: PanelColors) => {
      const match = PRESETS.find((p) => p.id === importedModelType);
      if (match) setPresetId(match.id);
      setPanelColors(importedColors);
      setSelectedPanelId(null);
    },
    [],
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {dbEnabled && (
        <DesignNav
          designs={ds.designs}
          currentId={ds.currentId}
          loading={ds.loading}
          onCreate={handleCreateDesign}
          onLoad={handleLoadDesign}
          onRename={ds.rename}
          onToggleStarred={ds.toggleStarred}
          onTogglePublished={ds.togglePublished}
          onDelete={ds.remove}
        />
      )}
      <div className="flex flex-1 flex-col">
      {/* Identity strip — thin, low-density. Brand + account. */}
      <div className="workshop-slab flex items-center justify-between border-b px-5 py-2">
        <div className="flex items-center gap-3">
          <Sigil />
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-base tracking-[0.22em] text-foreground">
              PANELER
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Designer
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SuedeToggle
            enabled={suedeEnabled}
            onChange={setSuedeEnabled}
          />
          {user && <UserMenu user={user} logoutAction={logoutAction} />}
        </div>
      </div>

      {/* Workspace toolbar — primary controls in a single comfortable row. */}
      <div className="workshop-slab flex flex-wrap items-center justify-between gap-4 border-b px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <PresetLabel />
          <ToggleGroup
            value={customTopology ? [] : [presetId]}
            onValueChange={(v) => v[0] && handlePresetChange(v[0])}
            variant="outline"
            size="sm"
            className="rounded-md border border-border bg-background/40 p-0.5"
          >
            {PRESETS.map((p) => (
              <ToggleGroupItem
                key={p.id}
                value={p.id}
                aria-label={p.label}
                className="h-7 gap-1.5 rounded-sm border-0 px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <span className="text-foreground/90 data-[state=on]:text-primary-foreground">
                  {p.label}
                </span>
                <span className="font-mono text-[10px] opacity-70">
                  {p.panels}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="h-5 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-7 gap-1.5 rounded-md border border-border bg-background/40 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          >
            <UploadGlyph />
            Upload OBJ
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".obj"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleObjUpload(file);
              e.target.value = "";
            }}
          />
          {customTopology && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-primary/90">
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              {customLabel}
              <span className="text-muted-foreground/70">·</span>
              <span className="text-muted-foreground">
                {customTopology.panels.length} panels
              </span>
            </span>
          )}
          {uploadError && (
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-destructive">
              {uploadError}
            </span>
          )}
        </div>
        <ShareControls
          modelType={presetId}
          panelColors={panelColors}
          onImport={handleImport}
        />
      </div>

      {/* Canvas stage + sidebar. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          <div className="grid flex-1 grid-cols-1 md:grid-cols-2">
            <CanvasFrame label="3D · Sphere">
              <PanelerCanvas
                topology={topology}
                panelColors={panelColors}
                selectedPanelId={selectedPanelId}
                suedeEnabled={suedeEnabled}
                onPanelClick={handlePanelClick}
              />
            </CanvasFrame>
            <CanvasFrame
              label="2D · Flat net"
              className="border-t md:border-l md:border-t-0"
            >
              <PanelerFlatView
                topology={topology}
                panelColors={panelColors}
                selectedPanelId={selectedPanelId}
                onPanelClick={handlePanelClick}
              />
            </CanvasFrame>
          </div>
          {/* Status bar — instrument readout + tool cluster. */}
          <div className="workshop-slab border-t px-5 py-2.5">
            <PanelInfoBar
              selectedPanelId={selectedPanelId}
              panelColors={panelColors}
              onReset={handleResetSelected}
              onPaintShape={handlePaintShape}
              onFillUnpainted={handleFillUnpainted}
            />
          </div>
        </div>
        <aside className="hidden w-80 flex-col gap-5 overflow-hidden border-l bg-[var(--sidebar)]/60 p-5 lg:flex">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
                Palette
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                21 fabrics
              </span>
            </div>
            <ColorPalette
              selected={selectedColor}
              onSelect={setSelectedColor}
            />
          </section>
          <div className="workshop-hairline" />
          <ColorSummary
            topology={topology}
            panelColors={panelColors}
            onSwatchClick={setSelectedColor}
          />
        </aside>
      </div>
      </div>
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

function PresetLabel() {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
      Topology
    </span>
  );
}

interface SuedeToggleProps {
  enabled: boolean;
  onChange: (v: boolean) => void;
}

function SuedeToggle({ enabled, onChange }: SuedeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="group flex h-7 items-center gap-2 rounded-md border border-border bg-background/40 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span
        className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors ${
          enabled ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block size-2.5 rounded-full bg-background shadow transition-transform ${
            enabled ? "translate-x-3" : "translate-x-0.5"
          }`}
        />
      </span>
      <span className={enabled ? "text-foreground" : ""}>Suede</span>
    </button>
  );
}

/**
 * Wrapper for each canvas pane: floats a small mono label in the top-left
 * corner so the canvas content reads as the primary surface, not a
 * heading-and-content stack.
 */
function CanvasFrame({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative flex min-h-0 flex-col bg-gradient-to-b from-background to-[oklch(0.06_0_0)] ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-2">
        <span className="size-1 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/80">
          {label}
        </span>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
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

function UserMenu({ user, logoutAction }: { user: AuthUser; logoutAction?: () => Promise<void> }) {
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
