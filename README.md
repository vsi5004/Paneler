# Paneler

An online tool for designing and producing cutting templates for sewn spherical objects — footbags, juggling balls, and similar.

Live demo: **[paneler.app](https://paneler.app)**.

## What it does

- **GLB is the source of truth.** A design is a binary glTF (`.glb`) with one mesh primitive per panel and per-panel materials. Geometry, panel boundaries, and the colors all live inside the file. Everything else — sphere projection, the flat unfold view, the SVG laser templates — is derived on demand from the GLB.
- **3D Designer** — interactive 3D viewer for spherical panel layouts. Click panels to paint them with a 21-color fabric palette (or any custom hex); per-shape paint tools ("paint all hexagons", "fill unpainted", reset); panel coloring carried over from [Footbag-3D-Visualizer](https://github.com/gwbischof/Footbag-3D-Visualizer).
- **Template library** — pre-baked GLBs covering tetrahedron (4), cube (6), octahedron (8), dodecahedron (12), cuboctahedron (14), icosahedron (20), soccer ball (32), GP(2,0)/42, GP(3,0)/92, GP(4,0)/162. New designs fork a template; you can also start from a Blender-authored `.glb` upload.
- **GLB upload** — drop a `.glb` file from Blender (or any glTF exporter); each mesh primitive becomes a clickable panel.
- **Saved designs** *(server mode)* — designs persist as `glb_key` rows in Postgres + `.glb` blobs in Cloudflare R2. Rows are isolated per signed-in user via Row-Level Security. Bytes flow client ↔ R2 directly via short-lived presigned URLs; the server only mints them.
- **Saved designs** *(files-only mode / GH Pages)* — templates are served as static files; the user picks "Save" to write a `.glb` to their own disk via the File System Access API (with a download fallback in browsers that don't ship FSA), and "Open" to load a previously-saved file. No DB required.
- **2D cutting patterns** *(coming)* — unfold the 3D design into a flat SVG cutting template with seam allowance and stitch holes, ready for laser cutting.

## Status

**Phase 1 (in progress):** 3D designer + optional auth. See [PLAN.md](./PLAN.md) for the full roadmap and phase-by-phase scope.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| 3D | `three.js`, `@react-three/fiber` ^9, `@react-three/drei`, `@gltf-transform/core` |
| UI | Tailwind v4, shadcn/ui, framer-motion |
| Auth | Auth.js v5 (optional, OIDC) |
| Database (optional) | Postgres 17 + CNPG (k8s) / docker-compose (local) |
| Blob storage (optional) | Cloudflare R2 via `@aws-sdk/client-s3` |
| File picker | `browser-fs-access` (File System Access API + fallback) |
| Tests | Vitest |

## Repo layout

```
app/
  page.tsx               # Redirects / → /app
  app/page.tsx           # The 3D designer (gated by /app/* proxy when auth is enabled)
  api/designs/           # CRUD endpoints for the designs nav (server build only)
    [id]/glb/            # 302 redirect to presigned R2 GET
    [id]/glb-upload-url/ # mints presigned R2 PUT for save uploads
  api/health/live|ready/ # Split probes; ready gates on migration status
  layout.tsx, globals.css
components/
  paneler/               # PanelerDesigner (client wrapper), PanelerCanvas (R3F), DesignNav
  ui/                    # shadcn primitives
lib/
  db/                    # pg client, repo, schema.sql, migration runner (+ static stubs)
  topology/              # Goldberg generators (used by the bake script) + GLB parser (gltf.ts)
  mesh/                  # subdivide → projectToSphere → buildMeshGroup (bake-time only)
  glb/                   # @gltf-transform helpers: build, mutate, useGlbDesign hook
  files/                 # browser-fs-access wrapper for GH-Pages save/open
  r2/                    # @aws-sdk/client-s3 wrapper for Cloudflare R2 (+ static stub)
  useDesigns.ts          # Client hook for the designs API
  utils.ts               # cn() helper
scripts/
  bake-template-glbs.ts  # Build-time: emits one .glb per template into public/presets/
public/
  presets/               # Pre-baked template GLBs + index.json manifest
  textures/              # Suede normal + roughness maps
instrumentation.ts       # Next.js startup hook; runs migrations on boot
docker-compose.yml       # Local Postgres for development
__tests__/               # Vitest
```

## Development

Requires Node 20+ and npm.

```bash
npm install
npm run dev              # http://localhost:3000
npm run build            # production build
npm test                 # vitest
npm run lint             # eslint
```

**No auth setup needed for local dev.** The `/app/*` route is open by default in development — the auth proxy only activates when `AUTH_SECRET` is set and `AUTH_DISABLED` is not `true`. Just `npm install && npm run dev` and the full designer works.

**With a local database (optional).** Persistence is opt-in. To enable the saved-designs nav locally:

```bash
docker compose up -d
DATABASE_URL=postgres://paneler:paneler@localhost:5432/paneler \
  AUTH_DISABLED=true npm run dev
```

Migrations run automatically on server boot. With `AUTH_DISABLED=true`, all designs are scoped to a fixed `dev-local` user. Without `DATABASE_URL`, the app runs files-only (use Export/Import in the share controls), same as the GitHub Pages preview.

## Building a container

The repo ships a multi-stage `Dockerfile` that produces a small standalone image (`node:20-alpine`, non-root user, runs on port 3000):

```bash
docker build -t paneler .
docker run -p 3000:3000 paneler
```

For a static-export preview (no server needed), set `STATIC_EXPORT=1` before `npm run build` — output lands in `out/` and can be served by any static host. A static export ships without the auth proxy by construction (no server to enforce it).

## Deployment

Paneler is a standard Next.js standalone server. It runs anywhere that runs Docker — managed PaaS (Fly.io, Railway, Render, etc.), a Kubernetes cluster, a single VPS, your laptop. The container is configurable entirely via env vars (below).

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `HOSTNAME` | `0.0.0.0` | Bind address for the Next.js server. |
| `PORT` | `3000` | Port for the Next.js server. |
| `AUTH_DISABLED` | unset | If `true`, the auth proxy is short-circuited and every request is admitted. Use for local dev and public-preview deploys. |
| `AUTH_SECRET` | unset | Auth.js v5 secret used to encrypt the session JWT. Required to enable auth. Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | inferred | Full public URL of the deployment (e.g. `https://paneler.example.com`). Set if Auth.js can't infer it from request headers. |
| `AUTH_TRUST_HOST` | `false` | Set to `true` when running behind a reverse proxy (Cloudflare, Traefik, nginx, etc.) so Auth.js trusts forwarded headers. |
| `DATABASE_URL` | unset | Postgres connection string (the CNPG-generated `<cluster>-app` Secret's `uri` value, or your local docker-compose URL). When set, the saved-designs nav is enabled and migrations run on boot. When unset, the app is files-only — save designs to your own disk via the file picker. |
| `R2_BUCKET` | unset | Name of the Cloudflare R2 bucket that stores `.glb` blobs (kube mode only). Should be `paneler` in production. |
| `R2_ACCOUNT_ID` | unset | Cloudflare account ID — used to derive the S3 endpoint when `R2_ENDPOINT` is unset. |
| `R2_ENDPOINT` | unset | `https://{accountId}.r2.cloudflarestorage.com`. Required when `R2_BUCKET` is set. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | unset | Credentials for a bucket-scoped R2 API token (`Object Read and Write` on the configured bucket). |

Auth flow (when enabled): an OIDC sign-in flow at `/api/auth/...` sets a session JWT cookie; the `/app/*` proxy validates that cookie on every request and 307-redirects unauthed traffic to `/`.

### Authentication providers

Out of the box, `lib/auth.ts` is configured to *read* sessions but ships no providers (`providers: []`), so the sign-in flow is inert until you wire one up. Any OIDC-compliant provider works — Google, GitHub, Auth0, Authentik, Keycloak, [Dex](https://dexidp.io/) as a broker, etc. Add providers to `lib/auth.ts`:

```ts
// lib/auth.ts
export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Google({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }),
    // ...
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
});
```

See the [Auth.js v5 docs](https://authjs.dev/) for provider-specific setup.

## Data persistence

Paneler runs in one of three modes depending on env vars:

| Mode | Triggered by | Designs nav | Storage |
|---|---|---|---|
| Files-only | `DATABASE_URL` unset (and/or `STATIC_EXPORT=1`) | hidden | Templates from `/public/presets/`, designs saved to the user's disk as `.glb` via the File System Access API (download fallback on Firefox/Safari) |
| DB without auth | `DATABASE_URL` + `R2_*` set, `AUTH_DISABLED=true` | shown | Postgres rows + R2 `.glb` blobs, scoped to `dev-local` |
| DB with auth | `DATABASE_URL`, `AUTH_SECRET`, and `R2_*` set | shown | Postgres rows + R2 `.glb` blobs, RLS-scoped per OIDC `sub` |

The Postgres schema is a single `designs` table whose rows hold metadata only (`glb_key`, `name`, `panel_count`, `palette_hash`, `shape_signature`, etc.); the binary `.glb` lives in Cloudflare R2 at `designs/{id}.glb`. The schema includes a non-owner `paneler_app` runtime role and a fail-closed RLS policy keyed on the session GUC `app.user_sub`. See [`lib/db/schema.sql`](./lib/db/schema.sql). Migrations are idempotent and run on server boot via [`instrumentation.ts`](./instrumentation.ts); the `/api/health/ready` endpoint reports un-ready until they succeed.

The static GitHub Pages preview is built with `STATIC_EXPORT=1`. [`next.config.ts`](./next.config.ts) flips `pageExtensions` so files named `*.server.ts` (the `/api/designs` route handlers) aren't discovered, and aliases the `lib/db/*` and `lib/r2/client` modules to no-op stubs. The preview is files-only.

## License

See [LICENSE](./LICENSE).
