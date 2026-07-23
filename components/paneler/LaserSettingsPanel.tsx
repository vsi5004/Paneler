"use client";

import { Slider } from "@/components/ui/slider";
import {
  MAX_BITE_DEPTH_MM,
  MAX_CURVATURE_PCT,
  MAX_DIAMETER_IN,
  MIN_BITE_DEPTH_MM,
  MIN_CURVATURE_PCT,
  MIN_DIAMETER_IN,
} from "@/lib/laser/constants";
import type { LaserSettings } from "@/lib/laser/types";

interface LaserSettingsPanelProps {
  values: LaserSettings;
  onChange: (partial: Partial<LaserSettings>) => void;
}

/**
 * Sidebar "Laser" section: footbag size and bite depth. Everything else
 * (hole size/spacing/bunching, gather correction) is hard-coded to proven
 * values in lib/laser/constants.ts.
 */
export function LaserSettingsPanel({ values, onChange }: LaserSettingsPanelProps) {
  const first = (v: number | readonly number[]) =>
    Array.isArray(v) ? v[0] : (v as number);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
          Laser
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          cut templates
        </span>
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Footbag size
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.diameterIn.toFixed(2)}in
            </span>
          </div>
          <Slider
            value={[values.diameterIn]}
            min={MIN_DIAMETER_IN}
            max={MAX_DIAMETER_IN}
            step={0.05}
            onValueChange={(v) => onChange({ diameterIn: first(v) })}
          />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Bite depth
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.biteDepthMm.toFixed(2)}mm
            </span>
          </div>
          <Slider
            value={[values.biteDepthMm]}
            min={MIN_BITE_DEPTH_MM}
            max={MAX_BITE_DEPTH_MM}
            step={0.25}
            onValueChange={(v) => onChange({ biteDepthMm: first(v) })}
          />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Curvature
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.curvaturePct.toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[values.curvaturePct]}
            min={MIN_CURVATURE_PCT}
            max={MAX_CURVATURE_PCT}
            step={5}
            onValueChange={(v) => onChange({ curvaturePct: first(v) })}
          />
        </div>
      </div>
    </section>
  );
}
