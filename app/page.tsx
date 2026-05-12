import { redirect } from "next/navigation";

// Marketing lives at paneler.app/ (the paneler-business app); this repo only
// needs to serve the designer. Any hit to / inside this app — local dev,
// direct service access — goes straight to /app.
export default function Home() {
  redirect("/app");
}
