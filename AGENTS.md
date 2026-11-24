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

<!-- BEGIN:paneler-stitch-holes -->
# Stitch holes by count (footbag-rule templates)

- On footbag-rule balls (soccer, GP(3,0), circle soccers, Hex-Capped 38, Cube-and-Corner 38, Star Bag), each main panel is stitched on every side. Fillers meet each other only along short unstitched sides (bleed holes). A preset opts in with `laserHoleCount`, and its `isFiller` decides which panels are fillers. Use the id suffix when only fillers have that shape; when a shape is both main and filler (GP(3,0), Hex-Capped, Cube-and-Corner), use adjacency instead.
- The slider value N counts the **filler's** side of each stitched seam. The main panel's side of that seam gets N − 2. The filler's two extra holes sit on the corner extensions at the seam's ends and stitch it to the next filler across the short side. That gives soccer its pentagon 6 / hexagon 8.
- A seam is a run of edges shared with one neighbour, not one polygon side. A Star Bag star meets a hexagon along two sides, which is one seam: N on the star, N − 2 on the hexagon, spread evenly over both sides. Name the slider after what N counts (`sliderLabel`, default "Holes per hex edge"), and name `matchSide` after the N − 2 side.
- `lib/topology/footbagRule.ts` builds this kind of ball: a regular main polygon on each vertex of a parent solid, with fillers filling the gaps. Each size slider needs a range box where every short side stays over 2° and under the shortest stitched side. `footbagRule.test.ts` checks the corners of that box.
- Concave fillers (stars) need densified seams (`maxSegment`), like Bagzuca's. Densified panels count as wavy, so they get no curvature sliders and their templates are labelled generically (Panel A/B).
- Hole bunching (`holeBunchingMm`, the Hole bunching slider) has one rule in every mode (`fixedEndOffsets`): each side's end holes stay fixed, and pairs (end, 2nd), (3rd, 4th) … count in from them, each pair closing up by b (capped at half the pitch) while the gaps between pairs grow to compensate. The end holes are a filler's tip holes, the corner extras, and the anchors on corner-anchored runs. A side that has a tip at one end only (a Star Bag star) counts pairs from the tip; other sides count from both ends. Each panel bunches its own sides, as Footbag-Panel-Generator does, so the two panels on a seam don't pair hole for hole. At 0, every template lays out exactly as it did without bunching. When unset, each design keeps its default (0.4mm on spacing-laid polygon seams, 0 elsewhere). Closed single-seam loops (Baseball, Spiral) aren't bunched.
- `public/presets/index.json` is served `no-cache`, so new templates show as soon as they deploy; the GLBs are cached for an hour.
<!-- END:paneler-stitch-holes -->
