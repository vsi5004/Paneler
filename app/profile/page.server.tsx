import { connection } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { ensureUserProfile } from "@/lib/db/users";
import { ProfilePage } from "@/components/paneler/ProfilePage";

// `.server.tsx` keeps this out of the static-export build, the same trick the
// API routes use: pageExtensions there is ["tsx","ts"], so this file's basename
// reads as "page.server" and Next ignores it. The standalone build includes
// "server.tsx", so it registers as a normal page at /app/profile.
//
// That's the right split — the profile page is meaningless without a database.

export const dynamic = "force-dynamic";

export default async function ProfileRoute() {
  await connection();

  if (!isDbEnabled()) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Profile needs a database.
        </div>
      </main>
    );
  }

  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Sign in to use the designer.
        </div>
      </main>
    );
  }

  const profile = await ensureUserProfile(userSub, session?.user?.email ?? null);

  return (
    <main className="flex flex-1 flex-col">
      <ProfilePage initialProfile={profile} />
    </main>
  );
}
