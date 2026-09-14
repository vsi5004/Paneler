// Static-export stub. See client-stub.ts.
//
// app/page.tsx imports the users repo to load the signed-in stitcher's fabric
// list. In the files-only build there is no database and no session, so the
// import must resolve to something that never pulls `pg` into the bundle.

import type { ProfileData } from "@/lib/types";

function unreachable(): never {
  throw new Error("users repo called in static export build — should be unreachable");
}

export async function ensureUserProfile(): Promise<ProfileData> { return unreachable(); }
export async function getUserProfile(): Promise<ProfileData | null> { return unreachable(); }
export async function setFabrics(): Promise<ProfileData | null> { return unreachable(); }
export async function rotateApiKey(): Promise<boolean> { return unreachable(); }
