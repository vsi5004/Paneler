"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TemplateEntry {
  slug: string;
  label: string;
  glbPath: string;
  panelCount: number;
  shapeSignature: string;
}

interface TemplateGalleryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateEntry[];
  onSelect: (slug: string) => void;
}

export function TemplateGalleryModal({
  open,
  onOpenChange,
  templates,
  onSelect,
}: TemplateGalleryModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl border-border bg-[oklch(0.08_0_0)] p-0">
        <DialogHeader className="border-b border-hairline px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            <DialogTitle className="font-heading text-xl tracking-[0.22em] text-foreground">
              SPECIMEN CATALOG
            </DialogTitle>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
            Select a topology to instantiate · {templates.length} archived
          </p>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {templates.map((t, i) => (
              <SpecimenCard
                key={t.slug}
                index={i}
                template={t}
                onSelect={() => {
                  onSelect(t.slug);
                  onOpenChange(false);
                }}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SpecimenCard({
  index,
  template,
  onSelect,
}: {
  index: number;
  template: TemplateEntry;
  onSelect: () => void;
}) {
  const serial = `TPL-${String(index + 1).padStart(3, "0")}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ animationDelay: `${index * 35}ms` }}
      className="specimen-card group relative flex flex-col items-stretch overflow-hidden rounded-sm border border-border bg-[oklch(0.1_0.003_85)] p-3 text-left transition-all duration-200 hover:border-primary/60 hover:bg-[oklch(0.12_0.005_85)]"
    >
      {/* Corner brackets — viewfinder feel */}
      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      {/* Serial header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/60 transition-colors group-hover:text-primary/80">
          {serial}
        </span>
        <span className="size-1 rounded-full bg-muted-foreground/30 transition-all group-hover:bg-primary group-hover:shadow-[0_0_6px_var(--primary)]" />
      </div>

      {/* Thumbnail */}
      <div className="relative mx-auto my-2 size-24">
        <SphereThumbnail signature={template.shapeSignature} />
      </div>

      {/* Label */}
      <div className="mt-2 text-center">
        <h3 className="font-heading text-base tracking-[0.18em] text-foreground/95 transition-colors group-hover:text-primary">
          {template.label}
        </h3>
      </div>

      {/* Spec sheet — divider + metadata strip */}
      <div className="mt-3 border-t border-hairline pt-2">
        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <span>Panels</span>
          <span className="text-foreground/80">{template.panelCount}</span>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <span>Shape</span>
          <span className="font-mono text-[9px] text-foreground/70">
            {template.shapeSignature}
          </span>
        </div>
      </div>

      {/* Select prompt — appears on hover */}
      <div className="absolute inset-x-0 bottom-0 translate-y-full bg-primary py-1 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-primary-foreground transition-transform duration-200 group-hover:translate-y-0">
        Instantiate →
      </div>
    </button>
  );
}

function CornerBracket({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const map = {
    tl: "left-1 top-1 border-l border-t",
    tr: "right-1 top-1 border-r border-t",
    bl: "left-1 bottom-1 border-l border-b",
    br: "right-1 bottom-1 border-r border-b",
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute size-2 border-primary/50 transition-colors duration-200 group-hover:border-primary ${map[position]}`}
    />
  );
}

/** A stylized "blueprint" thumbnail: the sphere silhouette with the
 *  dominant panel shape inscribed, an equator line, and a back-side
 *  meridian hint to suggest depth. Rotates subtly on hover. */
function SphereThumbnail({ signature }: { signature: string }) {
  const sides = dominantPolygonSides(signature);
  const cx = 48;
  const cy = 48;
  const sphereR = 40;
  const panelR = 22;

  // Front polygon points
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    points.push(`${cx + panelR * Math.cos(a)},${cy + panelR * Math.sin(a)}`);
  }

  // A few "background" face hints — smaller polygons offset
  const bgPolys: string[] = [];
  for (let j = 0; j < 3; j++) {
    const offsetA = (j / 3) * Math.PI * 2;
    const pts: string[] = [];
    const bgR = 11;
    const bgCx = cx + Math.cos(offsetA) * 24;
    const bgCy = cy + Math.sin(offsetA) * 24;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      pts.push(`${bgCx + bgR * Math.cos(a)},${bgCy + bgR * Math.sin(a)}`);
    }
    bgPolys.push(pts.join(" "));
  }

  return (
    <svg
      viewBox="0 0 96 96"
      className="size-full overflow-visible"
    >
      {/* Soft inner glow disc */}
      <defs>
        <radialGradient id="sphere-fill" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="oklch(0.18 0.01 85)" />
          <stop offset="60%" stopColor="oklch(0.1 0.005 85)" />
          <stop offset="100%" stopColor="oklch(0.06 0 0)" />
        </radialGradient>
      </defs>

      {/* Sphere body */}
      <circle
        cx={cx}
        cy={cy}
        r={sphereR}
        fill="url(#sphere-fill)"
        stroke="oklch(0.5 0.005 85 / 30%)"
        strokeWidth="0.5"
      />

      {/* Group that rotates on hover */}
      <g className="origin-center transition-transform duration-700 [transform-box:fill-box] group-hover:rotate-[24deg]">
        {/* Back-face hint polygons (dimmer) */}
        {bgPolys.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            stroke="oklch(0.89 0.22 128 / 18%)"
            strokeWidth="0.6"
            strokeDasharray="1.5 1.5"
            strokeLinejoin="round"
          />
        ))}

        {/* Equator ellipse — perspective hint */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={sphereR}
          ry={sphereR * 0.25}
          fill="none"
          stroke="oklch(0.89 0.22 128 / 25%)"
          strokeWidth="0.6"
        />

        {/* Front panel */}
        <polygon
          points={points.join(" ")}
          fill="oklch(0.89 0.22 128 / 8%)"
          stroke="oklch(0.89 0.22 128 / 90%)"
          strokeWidth="1.2"
          strokeLinejoin="round"
          className="drop-shadow-[0_0_4px_oklch(0.89_0.22_128/40%)]"
        />

        {/* Panel center dot */}
        <circle
          cx={cx}
          cy={cy}
          r="1.4"
          fill="oklch(0.89 0.22 128)"
        />
      </g>
    </svg>
  );
}

function dominantPolygonSides(signature: string): number {
  const parts = signature.split("+");
  let bestCount = 0;
  let bestShape = "h";
  for (const part of parts) {
    const m = part.match(/^(\d+)([a-z])$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > bestCount) {
      bestCount = n;
      bestShape = m[2];
    }
  }
  switch (bestShape) {
    case "t":
      return 3;
    case "q":
      return 4;
    case "p":
      return 5;
    case "h":
      return 6;
    default:
      return 6;
  }
}
