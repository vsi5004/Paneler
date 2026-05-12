"use client";

import dynamic from "next/dynamic";

// R3F can't run on the server. App Router disallows ssr:false in Server
// Components, so the dynamic import lives inside this 'use client' wrapper.
const PanelerCanvas = dynamic(() => import("./PanelerCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      Loading designer…
    </div>
  ),
});

export function PanelerDesigner() {
  return (
    <div className="flex flex-1">
      <PanelerCanvas />
    </div>
  );
}
