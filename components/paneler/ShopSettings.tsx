"use client";

/**
 * The stitcher's side of the order-form feature: shop identity, the fills they
 * stock, and the items their shop offers.
 *
 * Rendered by ProfilePage inside its <Section> wrapper — these export bare
 * panels rather than sections so the wrapper stays in one place and this file
 * doesn't import back out of its own parent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_DISPLAY_NAME_CHARS,
  MAX_FILL_MATERIALS,
  MAX_ITEMS,
  ORDER_SIZES,
} from "@/lib/orderForm";
import type { DesignMeta, OrderItem, ProfileData } from "@/lib/types";
import { cn } from "@/lib/utils";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Longest edge of the stored avatar. Displayed at 96px, so 256 covers 2x. */
const AVATAR_PX = 256;

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

// ---------------------------------------------------------------------------
// Shop identity
// ---------------------------------------------------------------------------

export function ShopPanel({
  profile,
  displayName,
  onDisplayName,
  published,
  onPublished,
  onProfile,
}: {
  profile: ProfileData;
  displayName: string;
  onDisplayName: (v: string) => void;
  published: boolean;
  onPublished: (v: boolean) => void;
  onProfile: (p: ProfileData) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);

  const shopUrl = profile.shopId
    ? `${window.location.origin}${BASE}/shop/${profile.shopId}`
    : null;

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const blob = await cropToSquareWebp(file, AVATAR_PX);
      const form = new FormData();
      form.append("avatar", blob, "avatar.webp");
      const res = await fetch(`${BASE}/api/profile/avatar`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "avatar_too_large"
            ? "That image is too large."
            : "Upload failed.",
        );
      }
      const { profile: updated } = (await res.json()) as {
        profile: ProfileData;
      };
      onProfile(updated);
      // The URL is stable, so a fresh upload would otherwise show the cached
      // old image until the 5-minute Cache-Control expires.
      setAvatarVersion((v) => v + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Your shop is one link you can share anywhere. Customers design a footbag
        on it and the order lands at the top of your designs.
      </p>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col items-center gap-2">
          {profile.hasAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${BASE}/api/shop/${profile.shopId}/avatar?v=${avatarVersion}`}
              alt=""
              className="size-24 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-24 items-center justify-center rounded-full border border-dashed border-border font-heading text-2xl text-muted-foreground">
              {displayName.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading || !profile.shopId}
            onClick={() => fileRef.current?.click()}
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
          >
            {uploading ? "Uploading…" : profile.hasAvatar ? "Replace" : "Add photo"}
          </Button>
        </div>

        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor="shop-name"
            className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            Shop name
          </label>
          <Input
            id="shop-name"
            value={displayName}
            maxLength={MAX_DISPLAY_NAME_CHARS}
            placeholder="Footbags"
            onChange={(e) => onDisplayName(e.target.value)}
          />
          {!profile.shopId && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Save a name to get your shop link.
            </p>
          )}
          {uploadError && (
            <p className="mt-2 text-xs leading-relaxed text-destructive">
              {uploadError}
            </p>
          )}
        </div>
      </div>

      {shopUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">
            {shopUrl}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(shopUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
          >
            {copied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
              </>
            )}
          </Button>
        </div>
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => onPublished(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span className="text-sm leading-relaxed">
          Shop is live
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {/* Says what actually happens, because unpublishing is not
                reversible by itself — setShop() unpublishes every item too. */}
            Turning this off hides the link and unpublishes all your items.
          </span>
        </span>
      </label>
    </div>
  );
}

/**
 * Center-crop to a square and re-encode as webp, in the browser.
 *
 * Doing it here rather than server-side means no image library in the
 * deployment and no untrusted decode in the pod — the route only has to check
 * that what arrives is a small webp.
 */
async function cropToSquareWebp(file: File, px: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't an image."));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      px,
      px,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    if (!blob) throw new Error("Couldn't process that image.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Fill materials
// ---------------------------------------------------------------------------

export function FillMaterialsPanel({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || value.includes(v) || value.length >= MAX_FILL_MATERIALS) return;
    onChange([...value, v]);
    setDraft("");
  }

  return (
    <div>
      <p className="mb-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
        What you fill with — plastic pellets, sand, steel shot. Shown as a note
        on your order form so customers can ask for one.
      </p>
      {value.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {value.map((m) => (
            <li
              key={m}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 py-1 pl-3 pr-1.5 text-sm"
            >
              {m}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== m))}
                aria-label={`Remove ${m}`}
                className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="fill-material"
            className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            Add a fill
          </label>
          <Input
            id="fill-material"
            value={draft}
            maxLength={40}
            placeholder="Plastic pellets"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button
          type="button"
          onClick={add}
          disabled={!draft.trim() || value.length >= MAX_FILL_MATERIALS}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function ItemsPanel({ shopReady }: { shopReady: boolean }) {
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [designs, setDesigns] = useState<DesignMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        jsonFetch<{ items: OrderItem[] }>("/api/items"),
        jsonFetch<{ designs: DesignMeta[] }>("/api/designs"),
      ]);
      setItems(a.items);
      // Orders are designs too; offering one as the basis for a new item would
      // be confusing, so only the stitcher's own work is pickable.
      setDesigns(b.designs.filter((d) => !d.source?.startsWith("order:")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load items.");
    }
  }, []);

  // reload() is async, so nothing is set synchronously here; the rule cannot
  // see past the useCallback. Fetching a list on mount is the ordinary case.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  async function save(item: OrderItem) {
    await jsonFetch(`/api/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: {
          title: item.title,
          description: item.description,
          sizes: item.sizes,
          published: item.published,
        },
      }),
    });
    await reload();
  }

  async function create(designId: string) {
    setAdding(true);
    try {
      await jsonFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designId,
          item: {
            title: designs.find((d) => d.id === designId)?.name ?? "Footbag",
            sizes: [1.8],
            published: false,
          },
        }),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    await jsonFetch(`/api/items/${id}`, { method: "DELETE" });
    await reload();
  }

  if (items === null) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        Loading…
      </p>
    );
  }

  return (
    <div>
      <p className="mb-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Each item is one of your designs a customer can order. They pick the
        fabrics and size; you get the finished design.
      </p>

      {error && (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      )}

      {items.length === 0 ? (
        <p className="mb-6 rounded-md border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
          No items yet. Add one from a design below.
        </p>
      ) : (
        <ul className="mb-6 flex flex-col gap-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onSave={save}
              onRemove={remove}
              shopReady={shopReady}
            />
          ))}
        </ul>
      )}

      {items.length < MAX_ITEMS && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="new-item-design"
              className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              Add from a design
            </label>
            <select
              id="new-item-design"
              disabled={adding || designs.length === 0}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) void create(e.target.value);
                e.target.value = "";
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>
                {designs.length === 0 ? "No saved designs" : "Choose a design…"}
              </option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item,
  onSave,
  onRemove,
  shopReady,
}: {
  item: OrderItem;
  onSave: (item: OrderItem) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  shopReady: boolean;
}) {
  const [draft, setDraft] = useState(item);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-sync the draft when a save returns a fresh row. React's documented
  // adjust-state-during-render pattern rather than an effect: this runs before
  // children render, so there is no flash of the stale draft and no second pass.
  const [lastSeen, setLastSeen] = useState(item);
  if (item !== lastSeen) {
    setLastSeen(item);
    setDraft(item);
  }
  const changed = JSON.stringify(draft) !== JSON.stringify(item);

  function toggleSize(size: number) {
    setDraft((d) => ({
      ...d,
      sizes: d.sizes.includes(size)
        ? d.sizes.filter((s) => s !== size)
        : [...d.sizes, size].sort((a, b) => a - b),
    }));
  }

  return (
    <li className="rounded-md border border-border bg-background/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm">{item.title}</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {item.published ? "Live" : "Draft"} ·{" "}
              {item.sizes.map((s) => s.toFixed(1)).join(", ")}in
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void onRemove(item.id)}
          aria-label={`Remove ${item.title}`}
          className="rounded p-1.5 text-muted-foreground hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-5 border-t border-hairline px-4 py-4">
          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Title
            </label>
            <Input
              value={draft.title}
              maxLength={80}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Description
            </label>
            <Input
              value={draft.description ?? ""}
              maxLength={400}
              placeholder="32 panel, hand stitched"
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Sizes you make
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ORDER_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSize(s)}
                  aria-pressed={draft.sizes.includes(s)}
                  className={cn(
                    "min-h-9 rounded-md border px-2.5 font-mono text-[11px] tabular-nums transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    draft.sizes.includes(s)
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/30",
                  )}
                >
                  {s.toFixed(1)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={draft.published}
              disabled={!shopReady}
              onChange={(e) =>
                setDraft((d) => ({ ...d, published: e.target.checked }))
              }
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span className="text-sm leading-relaxed">
              Show on my shop
              {!shopReady && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Make your shop live first.
                </span>
              )}
            </span>
          </label>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={!changed || busy || draft.sizes.length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSave(draft);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Save item"}
            </Button>
            {draft.sizes.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Pick at least one size.
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
