// No "use server" directive — this stub is swapped in for static export builds
// via next.config.ts (turbopack.resolveAlias / webpack.resolve.alias).
// Auth is disabled in static builds so logout is never called; this just
// satisfies the import shape without adding a server action to the manifest.
export async function logout() {}
