import { auth } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
import { PanelerDesigner } from "@/components/paneler/PanelerDesigner";

// Static export (GitHub Pages) ships with no auth — skip the session read and
// don't pass the logout server action. Next.js disallows server action
// references in the client bundle during static export, so logoutAction must
// be undefined rather than the real function when STATIC_EXPORT=1.
const isStaticExport = process.env.STATIC_EXPORT === "1";

// Mounted at basePath /app, so this renders at paneler.app/app.
// Read the session here (server side) and pass identity + a logout
// server-action handle down to the designer header.
export default async function DesignerPage() {
  const session = isStaticExport ? null : await auth();
  const user = session?.user ?? null;

  return (
    <main className="flex flex-1 flex-col">
      <PanelerDesigner
        user={user}
        logoutAction={isStaticExport ? undefined : logout}
      />
    </main>
  );
}
