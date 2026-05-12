import { auth } from "@/lib/auth";
import { PanelerDesigner } from "@/components/paneler/PanelerDesigner";

// Mounted at basePath /app, so this renders at paneler.app/app.
// Read the session here (server side) and pass identity + a logout
// server-action handle down to the designer header.
export default async function DesignerPage() {
  const session = await auth();
  const user = session?.user ?? null;

  return (
    <main className="flex flex-1 flex-col">
      <PanelerDesigner user={user} />
    </main>
  );
}
