"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ColorPalette } from "./ColorPalette";
import { ColorSummary } from "./ColorSummary";
import { PanelInfoBar } from "./PanelInfoBar";
import { ShareControls } from "./ShareControls";

// R3F can't run on the server. App Router disallows ssr:false in Server
// Components, so the dynamic import lives inside this 'use client' wrapper.
const PanelerCanvas = dynamic(() => import("./PanelerCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      Loading designer…
    </div>
  ),
});

const DEFAULT_PRESET = "soccer";

export function PanelerDesigner() {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PALETTE[4].color); // red
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [panelColors, setPanelColors] = useState<PanelColors>({});
  const [suedeEnabled, setSuedeEnabled] = useState(false);
  const [customTopology, setCustomTopology] = useState<PanelTopology | null>(null);
  const [customLabel, setCustomLabel] = useState<string>("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const preset =
    PRESETS.find((p) => p.id === presetId) ??
    PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
  // If a custom OBJ is loaded, it takes precedence over the preset.
  const topology = useMemo(
    () => (customTopology ?? preset.topology()),
    [customTopology, preset],
  );
  const allPanelIds = useMemo(
    () => topology.panels.map((p) => p.id),
    [topology],
  );

  // On mount, decode any design pre-loaded via the URL hash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.hash) return;
    try {
      const design = decodeDesignFromHash(window.location.hash);
      const match = PRESETS.find((p) => p.id === design.modelType);
      if (match) setPresetId(match.id);
      setPanelColors(design.panelColors);
    } catch {
      // ignore — preserves the default-empty design
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            value={customTopology ? [] : [presetId]}
            onValueChange={(v) => v[0] && handlePresetChange(v[0])}
            variant="outline"
            size="sm"
          >
            {PRESETS.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id} aria-label={p.label}>
                {p.label}{" "}
                <span className="text-muted-foreground">({p.panels})</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
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
            <span className="text-xs text-muted-foreground">
              Custom: <code className="font-mono">{customLabel}</code> ({customTopology.panels.length})
            </span>
          )}
          {uploadError && (
            <span className="text-xs text-destructive">{uploadError}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={suedeEnabled}
              onChange={(e) => setSuedeEnabled(e.target.checked)}
              className="size-4 cursor-pointer"
            />
            Suede texture
          </label>
          <ShareControls
            modelType={presetId}
            panelColors={panelColors}
            onImport={handleImport}
          />
        </div>
      </header>

      <div className="flex flex-1">
        <div className="flex flex-1 flex-col">
          <PanelerCanvas
            topology={topology}
            panelColors={panelColors}
            selectedPanelId={selectedPanelId}
            suedeEnabled={suedeEnabled}
            onPanelClick={handlePanelClick}
          />
          <div className="border-t bg-background/95 px-6 py-3">
            <PanelInfoBar
              selectedPanelId={selectedPanelId}
              panelColors={panelColors}
              onReset={handleResetSelected}
              onPaintShape={handlePaintShape}
              onFillUnpainted={handleFillUnpainted}
            />
          </div>
        </div>
        <aside className="flex w-80 flex-col gap-3 border-l p-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Color</CardTitle>
            </CardHeader>
            <CardContent>
              <ColorPalette
                selected={selectedColor}
                onSelect={setSelectedColor}
              />
            </CardContent>
          </Card>
          <ColorSummary
            topology={topology}
            panelColors={panelColors}
            onSwatchClick={setSelectedColor}
          />
        </aside>
      </div>
    </div>
  );
}
