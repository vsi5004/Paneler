"use client";

/**
 * Sends a customer back to the order they were part-way through.
 *
 * The landing repo owns sign-in and always lands people on /app — `redirectTo`
 * and the `redirect()` callback there are both hardcoded. Rather than change
 * another repo's auth flow (and take on a callbackUrl to validate, which is an
 * open-redirect surface), this reads the return path the order form already
 * stashed in sessionStorage before handing off.
 *
 * That works because the whole sign-in round trip happens in one tab, and the
 * shop pages share an origin with /app, so the tab's sessionStorage is intact
 * on arrival.
 */

import { useEffect, useState } from "react";

import { ORDER_STASH_PREFIX } from "@/lib/orderForm";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function ResumeOrder() {
  const [target, setTarget] = useState<string | null>(null);

  // Reading sessionStorage has to wait for the client: it does not exist during
  // the server render, so this cannot be a lazy useState initializer.
  useEffect(() => {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(ORDER_STASH_PREFIX)) continue;
      try {
        const { returnTo } = JSON.parse(
          sessionStorage.getItem(key) ?? "{}",
        ) as { returnTo?: string };
        // Validate even though we wrote it: this is read from storage any page
        // on the origin can write, and it becomes a navigation. Must be one of
        // our own shop paths, and must not be protocol-relative.
        if (
          typeof returnTo === "string" &&
          returnTo.startsWith(`${BASE}/shop/`) &&
          !returnTo.startsWith("//")
        ) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTarget(returnTo);
          return;
        }
      } catch {
        // A malformed stash just means no resume offer.
      }
    }
  }, []);

  if (!target) return null;

  return (
    // An offer, not an automatic redirect. Someone who signed in for an
    // unrelated reason should still land in the designer they asked for.
    <div className="flex items-center justify-center gap-3 border-b border-hairline bg-primary/10 px-5 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        You have an order in progress
      </span>
      <a
        href={target}
        className="rounded-md bg-primary px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Finish it
      </a>
    </div>
  );
}
