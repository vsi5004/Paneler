import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Paneler</h1>
        <p className="mt-3 text-muted-foreground">
          Design and generate cutting templates for sewn spherical objects.
        </p>
      </div>
      <Button>
        <Link href="/app">Open the designer</Link>
      </Button>
    </main>
  );
}
