import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";

import { isDbEnabled } from "@/lib/dbMode";
import { getPublicShop } from "@/lib/db/shop";

// PUBLIC. This and the item page below are the only pages in the app that
// render for someone with no session — see the `shop/` exclusion in proxy.ts,
// without which this 307s to the landing before it ever runs.
//
// `.server.tsx` for the usual reason: it needs a database, so it must not enter
// the static-export build. See next.config.ts.

export const dynamic = "force-dynamic";

export default async function ShopRoute({
  params,
}: {
  params: Promise<{ shopId: string }>;
}) {
  await connection();
  if (!isDbEnabled()) notFound();

  const { shopId } = await params;
  // Null for "no such shop" AND for "not published", deliberately
  // indistinguishable — an unpublished shop shouldn't be discoverable by
  // watching which ids 404 differently.
  const shop = await getPublicShop(shopId);
  if (!shop) notFound();

  const items = shop.items.filter((i) => i.published);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8">
      <header className="flex flex-col items-center text-center">
        {shop.hasAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/shop/${shop.shopId}/avatar`}
            alt=""
            className="size-24 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-24 items-center justify-center rounded-full bg-muted font-heading text-3xl">
            {shop.displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <h1 className="mt-5 font-heading text-4xl tracking-[0.2em]">
          {shop.displayName.toUpperCase()}
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Design your own footbag. Pick a style below, choose your fabrics, and
          send it over.
        </p>
        {shop.fillMaterials.length > 0 && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Fills available: {shop.fillMaterials.join(" · ")}
          </p>
        )}
      </header>

      <div className="stitch-divider my-10" />

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          Nothing on offer just yet. Check back soon.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item, i) => (
            <li
              key={item.id}
              className="specimen-card"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <Link
                href={`/shop/${shop.shopId}/${item.id}`}
                className="block h-full rounded-md border border-border bg-[var(--sidebar)]/60 p-5 transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <h2 className="font-heading text-xl tracking-[0.14em]">
                  {item.title.toUpperCase()}
                </h2>
                {item.description && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                )}
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {item.sizes.length === 1
                    ? `${item.sizes[0].toFixed(1)}in`
                    : `${item.sizes[0].toFixed(1)}–${item.sizes[item.sizes.length - 1].toFixed(1)}in`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
