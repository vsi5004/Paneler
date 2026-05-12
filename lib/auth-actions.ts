"use server";

import { signOut } from "@/lib/auth";

// Auth.js v5 signOut requires a POST with CSRF. Wrap it in a server
// action so the designer header can fire it from a `<form action={...}>`.
// Both this app and the landing share AUTH_SECRET, so clearing the
// session cookie here logs the user out of both surfaces.
export async function logout() {
  await signOut({ redirectTo: "/" });
}
