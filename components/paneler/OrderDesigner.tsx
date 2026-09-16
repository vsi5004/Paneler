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
  MAX_CONTACT_CHARS,
  orderBlocker,
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
  /** Rendered inside a stitcher's own checkout, in an iframe. */
  embedded?: boolean;
  /**
   * Light theme, for embedding in a light site. Scoped to this component's
   * container — the rest of the app stays dark.
   */
  light?: boolean;
  /**
   * Origins this page may hand the reference back to. Mirrors the
   * frame-ancestors allow-list, so a page that cannot frame us also cannot
   * receive a message from us.
   */
  allowedParents?: string[];
}

/**
 * What an unchosen panel looks like.
 *
 * The pinned design arrives with the stitcher's own colors baked into its
 * materials, so every panel would otherwise start out looking finished and
 * there would be nothing for the customer to complete. Blanking them is what
 * makes "colour every panel" a real requirement rather than a formality.
 */
const BLANK_PANEL = "#d8d5cf";


export function OrderDesigner({
  shop,
  item,
  embedded = false,
  light = false,
  allowedParents = [],
}: OrderDesignerProps) {
  const design = useGlbDesign();
  const [selectedColor, setSelectedColor] = useState(
    shop.fabrics[0]?.color ?? "#c41e3a",
  );
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  // Both start unchosen on purpose. Defaulting them would let a customer submit
  // a size and fill they never actually looked at.
  const [size, setSize] = useState<number | null>(null);
  const [fill, setFill] = useState<FillStyle | null>(null);
  const [painted, setPainted] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  // Populated by the canvas once its renderer exists.
  const captureRef = useRef<((rotateY: number) => Promise<string | null>) | null>(
    null,
  );

  const blanked = useRef(false);

  // Load the pinned design. Public route: no session required to look.
  useEffect(() => {
    void design.loadFromUrl(`${BASE}/api/shop/${shop.shopId}/${item.id}/glb`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.shopId, item.id]);

  const allPanelIds = useMemo(
    () => design.topology?.panels.map((p) => p.id) ?? [],
    [design.topology],
  );

  // Blank the ball once the GLB has parsed.
  //
  // useGlbDesign seeds panelColors from the file's own materials, so a pinned
  // design arrives wearing the stitcher's colours and would look finished
  // before the customer touched it. Blanking is what makes "colour every
  // panel" a real requirement rather than a formality.
  useEffect(() => {
    if (blanked.current || !design.bytes || allPanelIds.length === 0) return;
    blanked.current = true;
    const blank: Record<string, string> = {};
    for (const id of allPanelIds) blank[id] = BLANK_PANEL;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    design.setPanelColors(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.bytes, allPanelIds]);

  // Size IS diameterIn. Writing it straight into the GLB is the whole mechanism:
  // the stitcher opens the order and their laser templates are already scaled.
  useEffect(() => {
    if (size === null) return;
    design.setLaserSettings({ diameterIn: size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, design.bytes]);

  const handlePanelClick = useCallback(
    (panelId: string) => {
      setSelectedPanelId(panelId);
      design.setPanelColors((prev) => applyColor(prev, panelId, selectedColor));
      // Tracked separately from panelColors, which is never empty — every panel
      // holds BLANK_PANEL from the start, so the colors map cannot tell us what
      // the customer has actually chosen.
      setPainted((prev) => new Set(prev).add(panelId));
    },
    [design, selectedColor],
  );

  // Backstop. The profile route refuses to publish a shop with no fabrics, but
  // a shelf emptied after publishing would otherwise leave the customer
  // painting the hardcoded fallback color.
  const hasFabrics = shop.fabrics.length > 0;

  const blockedBy = orderBlocker({
    loaded: design.bytes !== null,
    fabricCount: shop.fabrics.length,
    totalPanels: allPanelIds.length,
    paintedPanels: painted.size,
    size,
    fill,
  });
  const complete = blockedBy === null;

  async function handleSubmit() {
    setError(null);
    if (size === null || fill === null) return;

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("shopId", shop.shopId);
      form.append(
        "order",
        JSON.stringify({
          itemId: item.id,
          size,
          fill,
          note,
          contact,
          panelColors: design.panelColors,
        }),
      );

      // Two opposite views. Best-effort: a browser that refuses to hand over
      // the framebuffer should cost the pictures, not the order - the fabric
      // breakdown in the email is what the stitcher actually cuts from.
      const capture = captureRef.current;
      if (capture) {
        const shots: [string, number][] = [
          ["viewFront", 0],
          ["viewBack", Math.PI],
        ];
        for (const [field, angle] of shots) {
          const url = await capture(angle);
          if (!url) continue;
          const blob = await (await fetch(url)).blob();
          form.append(field, blob, field + ".png");
        }
      }

      const res = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ref?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.detail ??
            errorText(body.error) ??
            `Couldn't place the order (error ${res.status}). Try again - if it keeps happening, let ${shop.displayName} know.`,
        );
      }
      setRef(body.ref ?? null);

      // Hand the reference to the host page so it can carry it into checkout.
      //
      // Targeted per allowed origin, never "*": postMessage only delivers when
      // the target matches the real parent's origin, so looping the allow-list
      // reaches the genuine host and nobody else. With "*" any page that
      // managed to frame this would be handed the reference.
      if (embedded && body.ref) {
        for (const origin of allowedParents) {
          window.parent.postMessage(
            { type: "paneler:order", ref: body.ref, itemId: item.id },
            origin,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't place the order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (ref) {
    return (
      <OrderPlaced
        shop={shop}
        item={item}
        orderRef={ref}
        embedded={embedded}
        light={light}
      />
    );
  }

  return (
    <div
      className={`flex h-dvh flex-col overflow-hidden md:flex-row${light ? " paneler-light" : ""}`}
    >
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
            onCaptureReady={(fn) => {
              captureRef.current = fn;
            }}
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
          <Field
            label="Fabric"
            hint={`${painted.size}/${allPanelIds.length} panels`}
          >
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
              {hasFabrics
                ? "Tap a fabric, then tap a panel. Drag to spin the ball."
                : `${shop.displayName} hasn't listed any fabrics yet, so there's nothing to choose from. Check back soon.`}
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

          {/* Absent when embedded: the stitcher's own checkout collects
              contact details, and asking twice invites two different answers
              for the same customer. */}
          {!embedded && (
          <Field label="How should they reach you?" hint="optional">
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={MAX_CONTACT_CHARS}
              placeholder="@yourhandle, email, phone"
              className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              However you prefer. You can skip this &mdash; your order reference
              is what links it to your payment.
            </p>
          </Field>
          )}

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
          {/* Says what is missing rather than leaving a dead button unexplained
              — on a phone the unfinished panel is usually round the back. */}
          {!error && blockedBy && (
            <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {blockedBy}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !complete}
            className="w-full rounded-md bg-primary px-4 py-3 font-mono text-[11px] uppercase tracking-[0.25em] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Place order"}
          </button>
        </div>
      </div>
    </div>
  );
}

function errorText(code: string | undefined): string | null {
  switch (code) {
    case "duplicate":
      return "You've already sent this exact design. Change something, or check with the maker if you think it didn't arrive.";
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
  orderRef,
  embedded,
  light,
}: {
  shop: PublicShop;
  item: OrderItem;
  orderRef: string;
  embedded: boolean;
  light: boolean;
}) {
  return (
    <div
      className={`${
        embedded
          ? "mx-auto flex max-w-md flex-col justify-center px-6 py-10"
          : "mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16"
      }${light ? " paneler-light" : ""}`}
    >
      <span className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span className="size-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        Order placed
      </span>
      <h1 className="font-heading text-4xl tracking-[0.2em]">THANK YOU</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {embedded
          ? `Your design is saved. Carry on with checkout \u2014 ${shop.displayName} will match it to your payment by this reference.`
          : `${shop.displayName} has your ${item.title.toLowerCase()}. Include this reference when you pay, so they can match the order to your payment.`}
      </p>
      <div className="mt-6 rounded-md border border-border bg-background/40 p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Reference
        </div>
        <code className="mt-1 block font-mono text-2xl tracking-[0.15em] text-foreground">
          {orderRef}
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
