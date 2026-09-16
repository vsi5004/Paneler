"use client";

/**
 * The public order form: a customer recolors a stitcher's design and sends it in.
 *
 * A SIBLING of PanelerDesigner rather than a mode of it. The two share leaves —
 * PanelerCanvas, Swatch, useGlbDesign, applyColor — but almost none of the
 * chrome: no toolbar, no design list, no shape sliders, no laser panes, no flat
 * net. Threading a "simplified" flag through 790 lines to hide all of that would
 * make both harder to read than keeping them apart.
 *
 * Designed at 390px first and widened. This is a link opened from a phone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { Swatch } from "@/components/paneler/ColorPalette";
import { applyColor } from "@/lib/designState";
import { useGlbDesign } from "@/lib/glb/useGlbDesign";
import {
  FILL_STYLES,
  ORDER_STASH_PREFIX,
  type FillStyle,
} from "@/lib/orderForm";
import type { OrderItem, PublicShop } from "@/lib/types";
import { cn } from "@/lib/utils";

// R3F cannot server-render, and the App Router forbids ssr:false inside a
// Server Component — so the dynamic() call has to live in a "use client" file.
const PanelerCanvas = dynamic(() => import("./PanelerCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Loading…
      </span>
    </div>
  ),
});

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface OrderDesignerProps {
  shop: PublicShop;
  item: OrderItem;
  signedIn: boolean;
}

/**
 * Survives the sign-in round trip. Colors are a small map, not the GLB.
 *
 * sessionStorage is the whole mechanism, and it works because the round trip
 * (paneler.app -> dex -> provider -> dex -> paneler.app) happens in ONE TAB and
 * the shop pages share an origin with /app. So the return path never has to
 * travel through the auth flow: no callbackUrl parameter, no change to the
 * landing repo's hardcoded redirectTo, and no open-redirect surface to get
 * wrong. `returnTo` is read back only by ResumeOrder, which validates it.
 */
interface StashedOrder {
  returnTo: string;
  panelColors: Record<string, string>;
  size: number;
  fill: FillStyle;
  note: string;
}


export function OrderDesigner({ shop, item, signedIn }: OrderDesignerProps) {
  const design = useGlbDesign();
  const [selectedColor, setSelectedColor] = useState(
    shop.fabrics[0]?.color ?? "#c41e3a",
  );
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [size, setSize] = useState<number>(item.sizes[0] ?? 1.8);
  const [fill, setFill] = useState<FillStyle>("freestyle");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const stashKey = `${ORDER_STASH_PREFIX}${item.id}`;
  const restored = useRef(false);

  // Load the pinned design. Public route: no session required to look.
  useEffect(() => {
    void design.loadFromUrl(`${BASE}/api/shop/${shop.shopId}/${item.id}/glb`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.shopId, item.id]);

  // Restore whatever the customer had before signing in. Runs once, after the
  // GLB has parsed — setPanelColors before that would be overwritten by the
  // parse, which seeds colors from the file's own materials.
  // Restoring state that outlived a full page navigation is exactly the
  // external-system sync effects exist for, and the `restored` guard makes it
  // strictly one-shot — hence the targeted disable below.
  useEffect(() => {
    if (restored.current || !design.bytes) return;
    restored.current = true;
    const raw = sessionStorage.getItem(stashKey);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as StashedOrder;
      /* eslint-disable react-hooks/set-state-in-effect */
      if (s.panelColors) design.setPanelColors(s.panelColors);
      if (typeof s.size === "number") setSize(s.size);
      if (s.fill) setFill(s.fill);
      if (typeof s.note === "string") setNote(s.note);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // A malformed stash is not worth surfacing; the form still works.
    }
    sessionStorage.removeItem(stashKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.bytes]);

  // Size IS diameterIn. Writing it straight into the GLB is the whole mechanism:
  // the stitcher opens the order and their laser templates are already scaled.
  useEffect(() => {
    design.setLaserSettings({ diameterIn: size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, design.bytes]);

  const handlePanelClick = useCallback(
    (panelId: string) => {
      setSelectedPanelId(panelId);
      design.setPanelColors((prev) => applyColor(prev, panelId, selectedColor));
    },
    [design, selectedColor],
  );

  const paintedCount = useMemo(
    () => Object.keys(design.panelColors).length,
    [design.panelColors],
  );

  async function handleSubmit() {
    setError(null);

    if (!signedIn) {
      // Stash everything, including where to come back to, then hand off to the
      // landing service, which owns sign-in. It always lands people on /app;
      // ResumeOrder there reads this back and returns them here.
      sessionStorage.setItem(
        stashKey,
        JSON.stringify({
          returnTo: `${BASE}/shop/${shop.shopId}/${item.id}`,
          panelColors: design.panelColors,
          size,
          fill,
          note,
        } satisfies StashedOrder),
      );
      window.location.href = "/";
      return;
    }

    setSubmitting(true);
    try {
      const bytes = await design.serialize();
      if (!bytes) throw new Error("Nothing to send — the design didn't load.");

      const form = new FormData();
      form.append(
        "glb",
        new Blob([bytes as BlobPart], { type: "model/gltf-binary" }),
        "order.glb",
      );
      form.append("shopId", shop.shopId);
      form.append(
        "order",
        JSON.stringify({ itemId: item.id, size, fill, note }),
      );

      const res = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.detail ?? errorText(body.error) ?? "Couldn't place the order.",
        );
      }
      setOrderId(body.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't place the order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (orderId) {
    return <OrderPlaced shop={shop} item={item} orderId={orderId} />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Canvas. Fixed share of the viewport on a phone so the controls below
          are always reachable without scrolling past the ball. */}
      <div className="relative flex h-[46vh] shrink-0 flex-col md:h-auto md:flex-1">
        <ShopHeader shop={shop} item={item} />
        {design.bytes ? (
          <PanelerCanvas
            glbBytes={design.bytes}
            panelColors={design.panelColors}
            selectedPanelId={selectedPanelId}
            suedeEnabled
            onPanelClick={handlePanelClick}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              {design.error ?? "Loading…"}
            </span>
          </div>
        )}
      </div>

      {/* Controls. Scrolls independently of the canvas — the page itself never
          scrolls, so a drag on the ball can't move the document. */}
      <div className="flex flex-1 flex-col overflow-hidden border-t border-hairline bg-[var(--sidebar)]/60 md:w-[380px] md:border-l md:border-t-0">
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <Field label="Fabric" hint={`${paintedCount} painted`}>
            {/* Horizontal run rather than a grid: one-handed on a phone, and
                44px targets instead of the designer's mouse-sized 28px. */}
            <div className="-mx-5 overflow-x-auto px-5">
              <div className="flex min-w-min gap-2 pb-1">
                {shop.fabrics.map((entry) => (
                  <Swatch
                    key={entry.id}
                    entry={entry}
                    selected={selectedColor}
                    onSelect={setSelectedColor}
                    sizeClass="size-11 shrink-0"
                  />
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Tap a fabric, then tap a panel. Drag to spin the ball.
            </p>
          </Field>

          <Field label="Size">
            <div className="flex flex-wrap gap-2">
              {item.sizes.map((s) => (
                <Chip key={s} active={s === size} onClick={() => setSize(s)}>
                  {s.toFixed(1)}in
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Fill">
            <div className="flex flex-wrap gap-2">
              {FILL_STYLES.map((f) => (
                <Chip key={f} active={f === fill} onClick={() => setFill(f)}>
                  {f}
                </Chip>
              ))}
            </div>
            {shop.fillMaterials.length > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {shop.displayName} stocks{" "}
                {shop.fillMaterials.join(", ")}. Want a particular one? Say so
                below.
              </p>
            )}
          </Field>

          <Field label="Special requests" hint="optional">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Anything the stitcher should know."
              className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
        </div>

        <div className="border-t border-hairline bg-background/85 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
          {error && (
            <p className="mb-3 text-xs leading-relaxed text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !design.bytes}
            className="w-full rounded-md bg-primary px-4 py-3 font-mono text-[11px] uppercase tracking-[0.25em] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
          >
            {submitting
              ? "Sending…"
              : signedIn
                ? "Place order"
                : "Sign in to place order"}
          </button>
          {!signedIn && (
            <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
              Your design is kept while you sign in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function errorText(code: string | undefined): string | null {
  switch (code) {
    case "rate_limited":
      return "You've sent several orders for this item already. Try again in an hour.";
    case "size_not_offered":
      return "That size isn't offered any more. Pick another.";
    case "item_not_found":
      return "This item is no longer available.";
    case "glb_too_large":
      return "That design is too large to send.";
    default:
      return null;
  }
}

function ShopHeader({ shop, item }: { shop: PublicShop; item: OrderItem }) {
  return (
    <div className="flex items-center gap-3 border-b border-hairline px-5 py-3">
      {shop.hasAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${BASE}/api/shop/${shop.shopId}/avatar`}
          alt=""
          className="size-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-sm">
          {shop.displayName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate font-heading text-base tracking-[0.14em]">
          {item.title.toUpperCase()}
        </div>
        <div className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {shop.displayName}
        </div>
      </div>
    </div>
  );
}

function OrderPlaced({
  shop,
  item,
  orderId,
}: {
  shop: PublicShop;
  item: OrderItem;
  orderId: string;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <span className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span className="size-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        Order placed
      </span>
      <h1 className="font-heading text-4xl tracking-[0.2em]">THANK YOU</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {shop.displayName} has your {item.title.toLowerCase()} and will be in
        touch. Keep this reference &mdash; it&apos;s how they&apos;ll find your
        design.
      </p>
      <div className="mt-6 rounded-md border border-border bg-background/40 p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Reference
        </div>
        <code className="mt-1 block break-all font-mono text-sm text-foreground">
          {orderId}
        </code>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-7">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
        {hint && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // min-h-11 keeps every chip a comfortable touch target regardless of
        // its label length.
        "min-h-11 rounded-md border px-3.5 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
