"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PRESETS } from "@/lib/topology/presets";

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

export function PanelerDesigner() {
  const [presetId, setPresetId] = useState(PRESETS[5].id); // default to icosahedron
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[5];
  const topology = useMemo(() => preset.topology(), [preset]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b px-6 py-3">
        <ToggleGroup
          value={[presetId]}
          onValueChange={(v) => v[0] && setPresetId(v[0])}
          variant="outline"
          size="sm"
        >
          {PRESETS.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} aria-label={p.label}>
              {p.label} <span className="text-muted-foreground">({p.panels})</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>
      <div className="flex flex-1">
        <PanelerCanvas topology={topology} />
      </div>
    </div>
  );
}
