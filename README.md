# Paneler

An online tool for designing and producing cutting templates for sewn spherical objects — footbags, juggling balls, and similar.

Live demo: **[paneler.app](https://paneler.app)**.

## What it does

- **3D Designer** — interactive 3D viewer for spherical panel layouts. Click panels to paint them with a 21-color fabric palette (or any custom hex); per-shape paint tools ("paint all hexagons", "fill unpainted", reset); panel coloring carried over from [Footbag-3D-Visualizer](https://github.com/gwbischof/Footbag-3D-Visualizer).
- **Runtime panel generation** — 10 built-in shapes generated in JS at load: tetrahedron (4), cube (6), octahedron (8), dodecahedron (12), cuboctahedron (14), icosahedron (20), soccer ball (32), GP(2,0)/42, GP(3,0)/92, GP(4,0)/162. No pre-baked models.
- **OBJ upload** — drop a `.obj` file; each face becomes a clickable panel. Vertices are projected to the sphere; n-gon polygons are preserved (no fan-triangulation). The "right" mechanism for fully custom panel shapes is still an [open question](#open-design-questions) — OBJ upload is the simplest path and works now.
- **2D cutting patterns** *(coming)* — unfold the 3D design into a flat SVG cutting template with seam allowance and stitch holes, ready for laser cutting.

## Open design questions

These need to be settled before the corresponding implementation work starts. See [PLAN.md](./PLAN.md#open-design-questions) for context and trade-offs.

- **How do users define custom panel shapes?** Two candidates:
  1. **OBJ upload** — user uploads a polyhedron file; each face becomes a clickable panel. Familiar pattern, leans on existing OBJ tools (Blender, MeshLab, etc.). Limited to whatever the user can build in another program.
  2. **Coloring on the sphere surface** — user paints arbitrary regions directly on the sphere with a brush; each contiguous region becomes a panel. No external tool needed; very approachable. Implementation is harder (region extraction, boundary tracing, topology emerging from paint strokes).

  The two are not mutually exclusive — we could support both. Decision pending.

## Status

**Phase 1 (in progress):** 3D designer + optional auth. See [PLAN.md](./PLAN.md) for the full roadmap and phase-by-phase scope.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| 3D | `three.js`, `@react-three/fiber` ^9, `@react-three/drei` |
| UI | Tailwind v4, shadcn/ui, framer-motion |
| Auth | Auth.js v5 (optional, OIDC) |
| Tests | Vitest |

## Repo layout

```
app/
  page.tsx               # Redirects / → /app
  app/page.tsx           # The 3D designer (gated by /app/* proxy when auth is enabled)
  layout.tsx, globals.css
components/
  paneler/               # PanelerDesigner (client wrapper), PanelerCanvas (R3F)
  ui/                    # shadcn primitives
lib/
  topology/              # Panel-graph generators (presets, Goldberg, OBJ parser)
  mesh/                  # subdivide → projectToSphere → buildMeshGroup
  utils.ts               # cn() helper
public/textures/         # Suede normal + roughness maps
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

## License

See [LICENSE](./LICENSE).
