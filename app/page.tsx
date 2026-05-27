import { auth } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
import { PanelerDesigner } from "@/components/paneler/PanelerDesigner";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";

// In static export builds, next.config.ts aliases @/lib/auth-actions to a
// no-op stub so the "use server" file never enters the build graph.
const isStaticExport = process.env.STATIC_EXPORT === "1";

// Ensure env vars (DATABASE_URL, AUTH_SECRET) are read at request time,
// not baked at build time when they aren't available.
export const dynamic = "force-dynamic";

// Mounted at basePath /app, so this renders at paneler.app/app.
// Read the session here (server side) and pass identity + a logout
// server-action handle down to the designer header.
export default async function DesignerPage() {
  const dbEnabled = isDbEnabled();

  // Auth is only used in DB mode (k8s deploy). Local dev and GH Pages
  // don't have AUTH_SECRET and don't need auth.
  const session = dbEnabled ? await auth() : null;
  const user = session?.user ?? null;

  if (dbEnabled && !getCurrentUserSub(session)) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Sign in to use the designer.
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <PanelerDesigner
        user={user}
        logoutAction={dbEnabled ? logout : undefined}
        dbEnabled={dbEnabled}
      />
    </main>
  );
}
