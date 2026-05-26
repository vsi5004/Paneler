import { auth } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
import { PanelerDesigner } from "@/components/paneler/PanelerDesigner";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";

// In static export builds, next.config.ts aliases @/lib/auth-actions to a
// no-op stub so the "use server" file never enters the build graph.
const isStaticExport = process.env.STATIC_EXPORT === "1";

// Mounted at basePath /app, so this renders at paneler.app/app.
// Read the session here (server side) and pass identity + a logout
// server-action handle down to the designer header.
export default async function DesignerPage() {
  const session =
    isStaticExport || !process.env.AUTH_SECRET ? null : await auth();
  const user = session?.user ?? null;

  // dbEnabled drives the left-nav design list. When DATABASE_URL is set we
  // require an identity (real OIDC session, or AUTH_DISABLED=true dev mode);
  // anonymous DB writes would share a "public" scope and aren't desirable.
  const dbEnabled = isDbEnabled();
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
        logoutAction={isStaticExport ? undefined : logout}
        dbEnabled={dbEnabled}
      />
    </main>
  );
}
