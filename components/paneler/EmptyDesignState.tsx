"use client";

interface EmptyDesignStateProps {
  onNew: () => void;
  onOpen: () => void;
  onImport: () => void;
  dbEnabled: boolean;
}

export function EmptyDesignState({
  onNew,
  onOpen,
  onImport,
  dbEnabled,
}: EmptyDesignStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="relative w-full max-w-2xl">
        {/* Corner brackets — viewfinder frame */}
        <Bracket position="tl" />
        <Bracket position="tr" />
        <Bracket position="bl" />
        <Bracket position="br" />

        <div className="px-10 py-12 text-center">
          {/* Header */}
          <div className="mb-1 flex items-center justify-center gap-2">
            <span className="size-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/70">
              Workbench
            </span>
          </div>
          <h1 className="font-heading text-4xl tracking-[0.2em] text-foreground">
            NO DESIGN LOADED
          </h1>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Start from a template, open a saved file, or import a GLB
          </p>

          {/* Action triad */}
          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ActionCard
              primary
              label="New design"
              hint={dbEnabled ? "Choose a topology" : "Pick a starting shape"}
              onClick={onNew}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5">
                  <circle cx="12" cy="12" r="9" />
                  <line x1="12" y1="7" x2="12" y2="17" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                </svg>
              }
            />
            <ActionCard
              label="Open"
              hint="Load a saved GLB"
              onClick={onOpen}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              }
            />
            <ActionCard
              label="Import"
              hint="Upload an external file"
              onClick={onImport}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  label,
  hint,
  onClick,
  icon,
  primary,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  icon: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "group flex flex-col items-center gap-2 rounded-sm border border-primary/60 bg-primary/5 px-4 py-5 transition-all hover:border-primary hover:bg-primary/10 hover:shadow-[0_0_20px_oklch(0.89_0.22_128/20%)]"
          : "group flex flex-col items-center gap-2 rounded-sm border border-border bg-background/40 px-4 py-5 transition-all hover:border-primary/50 hover:bg-background/80"
      }
    >
      <span
        className={
          primary
            ? "text-primary transition-transform group-hover:scale-110"
            : "text-foreground/70 transition-colors group-hover:text-primary"
        }
      >
        {icon}
      </span>
      <span
        className={
          primary
            ? "font-heading text-base tracking-[0.18em] text-primary"
            : "font-heading text-base tracking-[0.18em] text-foreground/90 group-hover:text-primary"
        }
      >
        {label}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
        {hint}
      </span>
    </button>
  );
}

function Bracket({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const map = {
    tl: "left-0 top-0 border-l-2 border-t-2",
    tr: "right-0 top-0 border-r-2 border-t-2",
    bl: "left-0 bottom-0 border-l-2 border-b-2",
    br: "right-0 bottom-0 border-r-2 border-b-2",
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute size-5 border-primary/60 ${map[position]}`}
    />
  );
}
