"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { PRESETS } from "@/lib/topology/presets";
import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";
import {
  applyColor,
  applyColorToUnpainted,
  applyShapeColor,
  decodeDesignFromHash,
  resetPanel,
} from "@/lib/designState";
import type { PanelColors } from "@/lib/types";

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

  const preset =
    PRESETS.find((p) => p.id === presetId) ??
    PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
  const topology = useMemo(() => preset.topology(), [preset]);
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
    setPanelColors({});
    setSelectedPanelId(null);
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
        <ToggleGroup
          value={[presetId]}
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
        <ShareControls
          modelType={presetId}
          panelColors={panelColors}
          onImport={handleImport}
        />
      </header>

      <div className="flex flex-1">
        <div className="flex flex-1 flex-col">
          <PanelerCanvas
            topology={topology}
            panelColors={panelColors}
            selectedPanelId={selectedPanelId}
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
