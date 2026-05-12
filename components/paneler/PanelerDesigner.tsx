"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { PRESETS } from "@/lib/topology/presets";
import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";
import { applyColor } from "@/lib/designState";
import type { PanelColors } from "@/lib/types";

import { ColorPalette } from "./ColorPalette";

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

const DEFAULT_PRESET = "icosa";

export function PanelerDesigner() {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PALETTE[4].color); // red
  const [panelColors, setPanelColors] = useState<PanelColors>({});

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[5];
  const topology = useMemo(() => preset.topology(), [preset]);

  const handlePanelClick = useCallback(
    (panelId: string) => {
      setPanelColors((prev) => applyColor(prev, panelId, selectedColor));
    },
    [selectedColor],
  );

  const handlePresetChange = useCallback((newId: string) => {
    setPresetId(newId);
    setPanelColors({}); // Reset colors on shape change. UI confirmation is Phase 1+.
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
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
      </header>

      <div className="flex flex-1">
        <div className="flex-1">
          <PanelerCanvas
            topology={topology}
            panelColors={panelColors}
            onPanelClick={handlePanelClick}
          />
        </div>
        <aside className="w-80 border-l p-4">
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
        </aside>
      </div>
    </div>
  );
}
