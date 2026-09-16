"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Copy, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Swatch } from "./ColorPalette";
import {
  FABRIC_CATALOG,
  FABRIC_GROUPS,
  MAX_FABRICS,
  MAX_LABEL_CHARS,
  newCustomFabricId,
} from "@/lib/fabrics";
import {
  FillMaterialsPanel,
  ItemsPanel,
  ShopPanel,
} from "./ShopSettings";
import type { FabricEntry, PaletteEntry, ProfileData } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(body.detail ?? body.error ?? `${res.status}`);
  }
  return (await res.json()) as T;
}

/** A stored entry paired with what it takes to draw it. */
interface ShelfItem {
  entry: FabricEntry;
  display: PaletteEntry;
}

function toShelf(entries: FabricEntry[]): ShelfItem[] {
  const items: ShelfItem[] = [];
  for (const entry of entries) {
    if (entry.kind === "catalog") {
      const found = FABRIC_CATALOG.get(entry.id);
      // A retired catalog fabric disappears rather than becoming a blank hole.
      if (found) items.push({ entry, display: found });
    } else {
      items.push({
        entry,
        display: { id: entry.id, label: entry.label, color: entry.color },
      });
    }
  }
  return items;
}

export function ProfilePage({
  initialProfile,
}: {
  initialProfile: ProfileData;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [fabrics, setFabrics] = useState<FabricEntry[]>(initialProfile.fabrics);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Shop state is tracked separately from fabrics because it saves separately:
  // the two halves of the profile change at very different rates, and bundling
  // them would mean every swatch tap re-sends the shop.
  const [shopName, setShopName] = useState(initialProfile.displayName ?? "");
  const [fillMaterials, setFillMaterials] = useState<string[]>(
    initialProfile.fillMaterials,
  );
  const [shopPublished, setShopPublished] = useState(
    initialProfile.shopPublished,
  );

  const shelf = useMemo(() => toShelf(fabrics), [fabrics]);
  const selectedIds = useMemo(
    () => new Set(fabrics.map((f) => f.id)),
    [fabrics],
  );
  const customCount = fabrics.filter((f) => f.kind === "custom").length;

  // Debounced save. Skips the very first render so simply opening the page
  // doesn't write.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        const { profile: updated } = await jsonFetch<{ profile: ProfileData }>(
          "/api/profile",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fabrics }),
          },
        );
        setProfile(updated);
        setSaveError(null);
        setSaveState("saved");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed");
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [fabrics]);

  const mutate = useCallback((next: FabricEntry[]) => {
    dirty.current = true;
    setFabrics(next);
  }, []);

  // Same debounced-PUT shape as the fabric list, its own dirty guard.
  const shopDirty = useRef(false);
  useEffect(() => {
    if (!shopDirty.current) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        const { profile: updated } = await jsonFetch<{ profile: ProfileData }>(
          "/api/profile",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shop: {
                displayName: shopName.trim() || null,
                fillMaterials,
                shopPublished,
              },
            }),
          },
        );
        setProfile(updated);
        setSaveError(null);
        setSaveState("saved");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed");
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [shopName, fillMaterials, shopPublished]);

  const mutateShop = useCallback(<T,>(set: (v: T) => void, value: T) => {
    shopDirty.current = true;
    set(value);
  }, []);

  const toggleCatalog = useCallback(
    (id: string) => {
      if (selectedIds.has(id)) {
        mutate(fabrics.filter((f) => f.id !== id));
      } else if (fabrics.length < MAX_FABRICS) {
        mutate([...fabrics, { kind: "catalog", id }]);
      }
    },
    [fabrics, mutate, selectedIds],
  );

  const remove = useCallback(
    (id: string) => mutate(fabrics.filter((f) => f.id !== id)),
    [fabrics, mutate],
  );

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= fabrics.length) return;
      const next = [...fabrics];
      [next[index], next[target]] = [next[target], next[index]];
      mutate(next);
    },
    [fabrics, mutate],
  );

  const addCustom = useCallback(
    (label: string, color: string) => {
      if (fabrics.length >= MAX_FABRICS) return;
      mutate([
        ...fabrics,
        { kind: "custom", id: newCustomFabricId(), label, color },
      ]);
    },
    [fabrics, mutate],
  );

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-5 pb-24 sm:px-8">
      {/* Header — leaving is the primary action here, so it leads. */}
      <header className="sticky top-0 z-20 -mx-5 mb-10 flex items-center justify-between border-b border-hairline bg-background/85 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Designer
        </Link>
        <SaveIndicator state={saveState} error={saveError} />
      </header>

      <div className="mb-1 flex items-center gap-2">
        <span className="size-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/70">
          Account
        </span>
      </div>
      <h1 className="font-heading text-4xl tracking-[0.2em] text-foreground">
        PROFILE
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Your shop, the fabrics you stock, and what customers can order
        {profile.apiKeyEnabled ? ", plus the key your website uses." : "."}
      </p>

      <Section title="Shop">
        <ShopPanel
          profile={profile}
          displayName={shopName}
          onDisplayName={(v) => mutateShop(setShopName, v)}
          published={shopPublished}
          onPublished={(v) => mutateShop(setShopPublished, v)}
          onProfile={setProfile}
        />
      </Section>

      <Section
        title="Fills you have"
        meta={fillMaterials.length ? `${fillMaterials.length}` : undefined}
      >
        <FillMaterialsPanel
          value={fillMaterials}
          onChange={(v) => mutateShop(setFillMaterials, v)}
        />
      </Section>

      <Section title="Order form items">
        <ItemsPanel shopReady={profile.shopPublished} />
      </Section>

      <Section
        title="Your fabrics"
        meta={`${shelf.length} total${customCount ? ` · ${customCount} custom` : ""}`}
      >
        <Shelf items={shelf} onRemove={remove} onMove={move} />
      </Section>

      <Section
        title="Catalog"
        meta={
          fabrics.length >= MAX_FABRICS ? `${MAX_FABRICS} max reached` : undefined
        }
      >
        <p className="mb-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Tap a fabric to add it to your shelf. Anything you add shows up in the
          designer&apos;s palette.
        </p>
        <div className="flex flex-col gap-6">
          {FABRIC_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={
                      selectedIds.has(entry.id)
                        ? "rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : undefined
                    }
                  >
                    <Swatch
                      entry={entry}
                      selected=""
                      onSelect={() => toggleCatalog(entry.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Custom fabric">
        <p className="mb-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          For material that isn&apos;t in the catalog. Give it the name you use
          when you order it.
        </p>
        <CustomFabricForm
          disabled={fabrics.length >= MAX_FABRICS}
          onAdd={addCustom}
        />
      </Section>

      {/* Absent, not disabled, for accounts without key access — a control you
          can never use is noise, and "request access" would imply a request
          flow that doesn't exist. */}
      {profile.apiKeyEnabled && (
        <Section title="Website key">
          <ApiKeyPanel profile={profile} onProfile={setProfile} />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="stitch-divider mb-7" />
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-xl tracking-[0.18em] text-foreground">
          {title.toUpperCase()}
        </h2>
        {meta && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function SaveIndicator({
  state,
  error,
}: {
  state: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  if (state === "idle") return null;
  const text =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved";
  return (
    <span
      role="status"
      title={state === "error" && error ? error : undefined}
      className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
        state === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {text}
    </span>
  );
}

/**
 * The shelf. Strips butt against each other with a hairline seam and square
 * corners so the run reads as a length of material rather than a row of chips —
 * which is also why these use the 800px fabric photographs instead of the 64px
 * thumbs the rest of the app renders.
 */
function Shelf({
  items,
  onRemove,
  onMove,
}: {
  items: ShelfItem[];
  onRemove: (id: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Pick fabrics from the catalog below and they&apos;ll
          show up in the designer&apos;s palette.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <ul className="flex min-w-min">
        {items.map((item, i) => {
          const src = item.display.swatchLarge ?? item.display.swatch;
          return (
            <li
              key={item.entry.id}
              className="specimen-card group relative h-44 w-[86px] shrink-0 border-r border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] last:border-r-0"
              style={{
                backgroundColor: item.display.color,
                animationDelay: `${Math.min(i, 12) * 28}ms`,
              }}
            >
              {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={BASE + src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover"
                />
              )}

              {/* Scrim: labels have to stay readable on LX White as well as
                  LX Purple, so the text sits on its own gradient.
                  No "Ultrasuede LX" tag here — the names already carry it
                  ("LX Red"), and the photograph is what actually distinguishes
                  a real fabric from a flat color. A second line also wrapped
                  at this width and left the shelf's bottom edge ragged. */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-2 pt-5">
                <div className="truncate text-[11px] font-medium leading-tight text-white">
                  {item.display.label}
                </div>
              </div>

              {/* Ordinal — honest: this position is the palette order. */}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1 font-mono text-[9px] tracking-wider text-white/80">
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* Controls stay out of the way on pointer devices and are always
                  present on touch, where there is no hover to reveal them. */}
              <div className="absolute inset-x-0 top-1.5 flex justify-end px-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onRemove(item.entry.id)}
                  aria-label={`Remove ${item.display.label}`}
                  className="inline-flex size-5 items-center justify-center rounded bg-black/60 text-white/80 transition-colors hover:bg-destructive hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 pb-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onMove(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${item.display.label} earlier`}
                  className="inline-flex size-5 items-center justify-center rounded bg-black/60 text-white/80 transition-colors hover:bg-black/85 disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <ChevronLeft className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(i, 1)}
                  disabled={i === items.length - 1}
                  aria-label={`Move ${item.display.label} later`}
                  className="inline-flex size-5 items-center justify-center rounded bg-black/60 text-white/80 transition-colors hover:bg-black/85 disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <ChevronRight className="size-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CustomFabricForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (label: string, color: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#8a6a4a");

  const trimmed = label.trim();
  const canAdd = !disabled && trimmed.length > 0 && trimmed.length <= MAX_LABEL_CHARS;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canAdd) return;
        onAdd(trimmed, color);
        setLabel("");
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-[200px] flex-1">
        <label
          htmlFor="custom-fabric-name"
          className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
        >
          Name
        </label>
        <Input
          id="custom-fabric-name"
          value={label}
          maxLength={MAX_LABEL_CHARS}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Seafoam suede"
        />
      </div>
      <div>
        <label
          htmlFor="custom-fabric-color"
          className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
        >
          Color
        </label>
        <input
          id="custom-fabric-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-16 cursor-pointer rounded-md border border-border bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0"
        />
      </div>
      <Button type="submit" disabled={!canAdd}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add fabric
      </Button>
    </form>
  );
}

function ApiKeyPanel({
  profile,
  onProfile,
}: {
  profile: ProfileData;
  onProfile: (p: ProfileData) => void;
}) {
  const [minted, setMinted] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await jsonFetch<{ key: string; profile: ProfileData }>(
        "/api/profile/key",
        { method: "POST" },
      );
      setMinted(res.key);
      onProfile(res.profile);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key");
    } finally {
      setBusy(false);
    }
  }, [onProfile]);

  return (
    <div className="workshop-slab rounded-md border p-5">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Lets your website send custom orders into this account. Your site keeps
        it on the server — it should never appear in a web page.
      </p>

      {minted && (
        <div className="mt-5">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            Your new key
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={minted}
              aria-label="Your new API key"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-[280px] flex-1 rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[13px] tracking-wider text-foreground"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(minted);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? (
                <Check className="mr-1.5 h-4 w-4" />
              ) : (
                <Copy className="mr-1.5 h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-sm text-foreground/80">
            Copy this now — it won&apos;t be shown again.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {profile.hasApiKey ? (
          <>
            <Readout label="Created" value={formatWhen(profile.apiKeyCreatedAt)} />
            {/* The one line that answers "is my site actually connected?" */}
            <Readout
              label="Last used"
              value={profile.apiKeyLastUsed ? formatWhen(profile.apiKeyLastUsed) : "Never"}
            />
          </>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            No key yet
          </span>
        )}
      </div>

      <div className="mt-5">
        {!profile.hasApiKey ? (
          <Button type="button" onClick={generate} disabled={busy}>
            {busy ? "Creating…" : "Generate key"}
          </Button>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="max-w-prose text-sm text-foreground/80">
              Your old key stops working in 24 hours. Update your site before
              then.
            </p>
            <Button type="button" onClick={generate} disabled={busy}>
              {busy ? "Regenerating…" : "Regenerate key"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirming(true)}
          >
            Regenerate
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xs text-foreground/80">{value}</div>
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
