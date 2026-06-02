"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";
import {
  applyColor,
  applyColorToUnpainted,
  applyShapeColor,
  getPanelShape,
} from "@/lib/designState";
import type { PanelColors } from "@/lib/types";
import { useGlbDesign } from "@/lib/glb/useGlbDesign";

import { Button } from "@/components/ui/button";
import { openGlb, saveGlb } from "@/lib/files/glbFile";
import { useDesigns } from "@/lib/useDesigns";
import { ColorPalette } from "./ColorPalette";
import { ColorSummary } from "./ColorSummary";
import { DesignNav } from "./DesignNav";
import { EmptyDesignState } from "./EmptyDesignState";
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
  panelCount: number;
  shapeSignature: string;
}

interface PanelerDesignerProps {
  user: AuthUser | null;
  logoutAction?: () => Promise<void>;
  /** True when the app runs against Postgres. Drives the saved-designs nav. */
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

const PRESETS_BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/presets";

export function PanelerDesigner({
  user,
  logoutAction,
  dbEnabled,
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
    loadFromUrl,
    loadFromBytes,
    setPanelColors,
  } = design;

  // Design nav + persistence (DB mode only).
  const ds = useDesigns({ enabled: dbEnabled });
  const [navCollapsed, setNavCollapsed] = useState(false);
  const toggleNav = useCallback(() => setNavCollapsed((v) => !v), []);

  // Gallery modal — shown when user clicks "New Design" anywhere.
  const [galleryOpen, setGalleryOpen] = useState(false);

  const handleLoadDesign = useCallback(
    async (id: string) => {
      const row = await ds.load(id);
      if (!row) return;
      // Fetch the GLB bytes from R2 and load into the editor
      const glbBytes = await ds.fetchGlb(id);
      setActiveTemplateSlug(null);
      setUploadedName(row.name);
      setSelectedPanelId(null);
      await loadFromBytes(glbBytes);
    },
    [ds, loadFromBytes],
  );

  // Open the gallery — the actual creation happens after the user picks a template.
  const handleOpenGallery = useCallback(() => {
    setGalleryOpen(true);
  }, []);

  // Create a new design from a gallery selection. In DB mode this writes
  // a new row + uploads the template bytes; in files-only mode it just
  // loads the template into the editor.
  const handleSelectTemplate = useCallback(
    async (slug: string) => {
      const entry = templates.find((t) => t.slug === slug);
      if (!entry) return;
      const url = PRESETS_BASE + entry.glbPath.replace(/^\/presets/, "");

      if (dbEnabled) {
        // Fetch the template bytes, then create a new design row
        // backed by those bytes in R2.
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const row = await ds.createFromUpload({
          name: entry.label,
          bytes,
          panelCount: entry.panelCount,
          shapeSignature: entry.shapeSignature,
        });
        if (row) {
          setActiveTemplateSlug(null);
          setUploadedName(row.name);
          setSelectedPanelId(null);
          await loadFromBytes(bytes);
        }
      } else {
        setActiveTemplateSlug(slug);
        setUploadedName(null);
        setSelectedPanelId(null);
        await loadFromUrl(url);
      }
    },
    [templates, dbEnabled, ds, loadFromBytes, loadFromUrl],
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
        setTemplates(list);
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
    (panelId: string) => {
      setSelectedPanelId(panelId);
      setPanelColors((prev: PanelColors) => applyColor(prev, panelId, selectedColor));
    },
    [selectedColor, setPanelColors],
  );


  const handleGlbUpload = useCallback(
    async (file: File) => {
      try {
        const buf = await file.arrayBuffer();
        setUploadError(null);
        setActiveTemplateSlug(null);
        setUploadedName(file.name);
        setSelectedPanelId(null);
        // A file-picker upload doesn't give us a writable handle, so saves
        // will need to re-prompt for a location. The "Open" flow does.
        fileHandleRef.current = null;
        await loadFromBytes(new Uint8Array(buf));
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "GLB load failed");
        window.setTimeout(() => setUploadError(null), 5000);
      }
    },
    [loadFromBytes],
  );

  const handleOpen = useCallback(async () => {
    setUploadError(null);
    try {
      const opened = await openGlb();
      if (!opened) return;
      setActiveTemplateSlug(null);
      setUploadedName(opened.name);
      setSelectedPanelId(null);
      fileHandleRef.current = opened.handle;
      await loadFromBytes(opened.bytes);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Open failed");
      window.setTimeout(() => setUploadError(null), 5000);
    }
  }, [loadFromBytes]);

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      const serialized = await design.serialize();
      if (!serialized) {
        setSaveState("idle");
        return;
      }
      if (dbEnabled && ds.currentId) {
        // Save to DB/R2
        await ds.saveBytes(ds.currentId, { bytes: serialized });
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
    }
  }, [design, uploadedName, activeTemplateSlug, dbEnabled, ds, topology]);

  const handleResetSelected = useCallback(() => {
    if (!selectedPanelId) return;
    design.resetPanel(selectedPanelId);
  }, [design, selectedPanelId]);

  const handlePaintShape = useCallback(
    (shape: string) => {
      setPanelColors((prev: PanelColors) =>
        applyShapeColor(prev, allPanelIds, shape, selectedColor),
      );
    },
    [allPanelIds, selectedColor, setPanelColors],
  );

  const handleFillUnpainted = useCallback(() => {
    setPanelColors((prev: PanelColors) =>
      applyColorToUnpainted(prev, allPanelIds, selectedColor),
    );
  }, [allPanelIds, selectedColor, setPanelColors]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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
            disabled={saveState === "saving" || !bytes}
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
          {user && <UserMenu user={user} logoutAction={logoutAction} />}
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
            <EmptyDesignState
              dbEnabled={dbEnabled}
              onNew={handleOpenGallery}
              onOpen={() => void handleOpen()}
              onImport={() => fileInputRef.current?.click()}
            />
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
                  <div className="flex flex-1 flex-col md:flex-row">
                    <CanvasFrame label="3D · Sphere" className="flex-1">
                      <PanelerCanvas
                        glbBytes={bytes}
                        panelColors={panelColors}
                        selectedPanelId={selectedPanelId}
                        suedeEnabled={suedeEnabled}
                        onPanelClick={handlePanelClick}
                      />
                    </CanvasFrame>
                    <div className="glow-divider" />
                    <CanvasFrame
                      label="2D · Flat net"
                      className="flex-1"
                    >
                      {topology ? (
                        <PanelerFlatView
                          topology={topology}
                          panelColors={panelColors}
                          selectedPanelId={selectedPanelId}
                          onPanelClick={handlePanelClick}
                        />
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
                <aside className="hidden w-80 flex-col overflow-y-auto overflow-x-hidden border-l bg-[var(--sidebar)]/60 p-5 lg:flex">
                  {/* Palette */}
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
                  <div className="workshop-hairline mt-5" />
                  {topology && (
                    <div className="mt-5 flex flex-1 flex-col overflow-hidden">
                      <ColorSummary
                        topology={topology}
                        panelColors={panelColors}
                        onSwatchClick={setSelectedColor}
                      />
                    </div>
                  )}
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
  children,
}: {
  label: string;
  className?: string;
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
