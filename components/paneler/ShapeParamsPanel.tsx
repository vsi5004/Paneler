"use client";

import { Slider } from "@/components/ui/slider";
import type { PresetParamDef, PresetParams } from "@/lib/topology/presets";
import type { RegenQuality } from "@/lib/glb/useGlbDesign";

interface ShapeParamsPanelProps {
  paramDefs: PresetParamDef[];
  values: PresetParams;
  onChange: (key: string, value: number, quality: RegenQuality) => void;
}

/**
 * One slider per shape degree of freedom the loaded design's preset declares.
 * Dragging emits draft-quality updates (coarse mesh, debounced); releasing
 * emits a full-quality update.
 */
export function ShapeParamsPanel({
  paramDefs,
  values,
  onChange,
}: ShapeParamsPanelProps) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
          Shape
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {paramDefs.length} {paramDefs.length === 1 ? "param" : "params"}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {paramDefs.map((def) => {
          const value = values[def.key] ?? def.defaultValue;
          return (
            <div key={def.key}>
              <div className="mb-2 flex items-baseline justify-between">
                <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {def.label}
                </label>
                <span className="font-mono text-[10px] tabular-nums text-foreground">
                  {value.toFixed(def.step >= 1 ? 0 : 2)}
                  {def.unit ?? ""}
                </span>
              </div>
              <Slider
                value={[value]}
                min={def.min}
                max={def.max}
                step={def.step}
                onValueChange={(next) => {
                  const v = Array.isArray(next) ? next[0] : next;
                  onChange(def.key, v, "draft");
                }}
                onValueCommitted={(next) => {
                  const v = Array.isArray(next) ? next[0] : next;
                  onChange(def.key, v, "full");
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
