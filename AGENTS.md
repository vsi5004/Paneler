<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:paneler-data-model -->
# GLB is the source of truth

A Paneler design is a binary glTF (`.glb`). Geometry, panel boundaries, and per-panel colors all live inside the GLB — one mesh primitive per panel, one material per primitive, colors as `baseColorFactor`. The `__seams` node is a single LINES primitive baked alongside the panels; it has no `panelId`.

- Canonical panel identity is on `node.extras.panelId` (e.g. `"panel_001_pentagon"`) and mirrored in the material name (`panel_001_pentagon_mat`). Not on `primitive.extras` — Three.js GLTFLoader can drop those when geometry attributes are shared (issues #14343, #29768, #29753).
- The Postgres `designs` row is metadata only (`name`, `glb_key`, `panel_count`, `palette_hash`, `shape_signature`, `starred`, `published`, …). The GLB itself lives in Cloudflare R2 at `designs/{id}.glb`. Bytes flow client ↔ R2 directly via short-lived presigned URLs minted by `app/api/designs/[id]/glb*` routes — never proxied through the pod.
- Static-export mode is files-only: templates ship in `/public/presets/` (output of `npm run bake:glb`), the user saves/opens designs from their own disk via the File System Access API (`browser-fs-access` wraps the fallback for Firefox/Safari).
- There is no `modelType` field, no `panelColors` JSON record, no OBJ parser, no URL-hash share codec. If you find yourself reaching for any of those, you are reaching for a deleted concept.
- `PanelTopology` is a runtime structure parsed from the GLB by `lib/topology/gltf.ts` — used by the flat unwrap view. It is not persisted.
- Color mutation: `material.color.set(hex)` on the live Three.js material for instant render, and `setMaterialColor(document, panelId, hex)` on the parallel `@gltf-transform/core` Document so the next `serialize()` captures the change. `useGlbDesign` keeps both in sync; React state (`panelColors`) is the source of truth at edit time and gets mirrored into the GLB document by an effect.
- R2 client config sets `requestChecksumCalculation: "WHEN_REQUIRED"` (AWS SDK v3 ≥ 3.729 sends CRC32 by default that R2 historically rejected) and presigned PUT URLs do not include `Content-Type` in signed headers (otherwise browsers trip silent `SignatureDoesNotMatch` 403s).
<!-- END:paneler-data-model -->

<!-- BEGIN:paneler-shape-params -->
# Shape params + meshing rules

- Parameterized presets (Shape sliders) store `{ version, presetId, params }` on the GLB's **asset extras** under the `paneler` key (`lib/glb/build.ts` writes, `lib/topology/gltf.ts` reads → `ParsedGlb.design`). It rides every save path (file download and R2) with zero DB changes. GLBs without it (Blender uploads) simply get no sliders. Template defaults are whatever the baked template GLB carries — change them by re-baking.
- Runtime slider moves regenerate geometry in the browser via `lib/glb/generate.ts` (same pipeline as `npm run bake:glb`). Always regenerate at full quality — reduced-resolution draft meshes showed visible creases and could stick after a drag.
- **Panel ids are frozen to each preset's default shapes** (e.g. the cuboctahedron's degenerate hexagons stay `panel_001_triangle` at every slider value; soccer stays `_hexagon`/`_pentagon`). NEVER rebuild an id from a panel's current `shape` — stable ids are what keep painted colors, selection, and saved designs valid across shape-parameter changes.
- Subdivision (`lib/mesh/subdivide.ts`) picks a mesher per panel: star-shaped panels fan-triangulate from the centroid; concave panels (Trionda pinwheels, any wavy import) get a constrained Delaunay triangulation (poly2tri) in a Lambert tangent plane with uniform interior Steiner points. Fan-line vertices are deduplicated between sectors. The puff bevel ramps by true distance-to-boundary, capped at ~7°.
- Imported balls (`scripts/import-ball-topology.ts`) emit thin wrappers over `lib/topology/importedBall.ts`, which re-densifies RDP-sparse boundary edges (>3°) with shared great-arc midpoints — required by the concave mesher. See `scripts/IMPORTING_BALLS.md`.
- The selection outline is the panel mesh's open edges after position-welding (`buildOpenEdgesGeometry` in `PanelerCanvas.tsx`) — never use angle-threshold `EdgesGeometry`, which sprays lines on steep puff bevels.
<!-- END:paneler-shape-params -->
