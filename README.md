# Slop New York

A New York City simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore Manhattan on foot, by car, by bicycle, or by helicopter.

[Open this fork](https://rbifulco.github.io/slop-newyork/) · [Upstream demo](https://mrdoob.github.io/slop-newyork/)

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## Spatial Review: full world capture

[Open the published site in Spatial Review](https://spatial-review.alterno.dev/review?site=https%3A%2F%2Frbifulco.github.io%2Fslop-newyork%2F)

The separate capture document now calls the actual city builders, rather than exporting only landmarks and flat map proxies. It includes Manhattan buildings and architectural details, surrounding boroughs, bridges and islands, roads and markings, parks, trees, street furniture, frozen traffic, posed pedestrians, and player vehicles. The eleven landmark identities and eight scenic camera sequences are retained.

The ordinary game does not load the review SDK. Capture uses Spatial Review **0.8.0** and Three.js **0.186.1**. The protocol upgrade preserves the existing capture adapters, ordinary-page HTML, and game sources under `js/`.

### What is selectable

Landmarks retain their independent semantic actors. The larger world is divided into source-system layers and spatial streaming regions. Each region contains the real geometry and instance transforms; it is **not** a box or flat-map substitute. Repeated designs are instanced within each region to reduce draw nodes. This does not give every procedural building or tree a separate top-level Scene actor. Inspect the region's Asset components/instances for more detailed feedback.

Tree overview representations use the source's far geometry, while detail representations retain its highest-detail geometry. The capture includes every planted tree, not only those near the initial camera. Building details are collected for every source block, bypassing the ordinary renderer's radius and pool limits. Shader-skinned pedestrians are baked into their captured poses on the CPU.

A local browser run of the complete source produced **761 review entries**, with geometry for 4,858 Manhattan blocks, 117,731 borough buildings, 70,301 trees, 200 street cars, 32 buses, 2,569 visible highway vehicles, and 336 posed people/riders. Counts describe this source revision and snapshot, not permanent API guarantees.

### Deliberate differences from the game

The review is a geometry/composition snapshot, not a second game renderer. Street traffic advances through three fixed 1/60-second source updates and then freezes. Highway cars use their source initial state; underground-hidden cars stay excluded. Player models use their initial poses. Physics, gameplay input, animation playback, procedural facade/window shading, billboard artwork, wind, lighting, reflections and post-processing are not reproduced.

Standard review materials preserve supported scalar fields and available texture maps. Instance tints are quantized; people use a declared simplified body-part palette. The tree leaf-coverage atlas and MetLife sign remain exportable. GPU-only steam, god rays, flares and contact-shadow effects are excluded, not physical street objects.

This is a large, desktop-oriented capture. Construction is not fully lazy: some source builders perform long synchronous work, while geometry serialization and delivery are on demand. Loading every detailed region is substantially heavier than viewing an overview. Mobile performance and pixel parity with the game's TSL renderer are not qualified.

### Local use

With Node.js 22.11 or later:

```sh
npm ci
npm run dev
```

Game: `http://localhost:5173/`  
Capture: `http://localhost:5173/spatial-review.html`  
[Review the local game](https://spatial-review.alterno.dev/review?site=http%3A%2F%2Flocalhost%3A5173%2F)

Start the editor with the ordinary website URL. Static discovery at `.well-known/spatial-review.json` locates the capture automatically. Keep the capture alive while the editor requests geometry and generated textures. Consumers need `asset-stream-v1`; legacy complete-catalog consumers do not receive deferred-only geometry.

`npm run dev` builds once at startup. Restart after changes, or run `npm run build` while `npm run preview` serves `dist/`. For a project prefix, use `npm run dev -- --base-path /slop-newyork/`. Local editor framing defaults to port 5174; `--editor-origin http://localhost:5184` adds another exact loopback origin.

### Tests and feedback

```sh
npm test
npx playwright install chromium
npm run test:browser
```

The browser test starts producer and consumer on different ports, discovers from the ordinary URL, requests detail and overview geometry from all nine world systems, decodes the MetLife texture, checks deterministic inventory/placements after reload, and checks teardown. Evidence is written to `test-results/spatial-review-browser.json`. Set `SPATIAL_REVIEW_CHROMIUM` to use a separately installed Chromium executable.

Export feedback from the editor, follow the source reference to the authoritative builder, apply the change in source, rebuild and refresh. Existing landmark IDs remain stable. The three old flat-context actors are retired: preserve any old feedback and migrate those targets manually. Region packet boundaries can change when their contents change, so preserve previous review sets rather than blindly reapplying their component operations.

See [the integration plan](docs/spatial-review-integration-plan.md) for authorization, source mapping, performance evidence, migration and unverified checks.

### GitHub Pages

Pushes to `feat/spatial-review` run [.github/workflows/spatial-review-pages.yml](.github/workflows/spatial-review-pages.yml). It tests, builds and publishes `dist/`; `main` is unchanged. Repository Settings → Pages must use **GitHub Actions**, not a competing branch-source/Jekyll deployment. The `github-pages` environment must allow this branch.

The workflow uses pinned `upload-pages-artifact` v5 with `include-hidden-files: true`, and verifies that the actual tar archive contains `.well-known/spatial-review.json` and `.nojekyll`.

Public capture: `https://rbifulco.github.io/slop-newyork/spatial-review.html`  
Discovery: `https://rbifulco.github.io/slop-newyork/.well-known/spatial-review.json`

The approved official editor and implicit same-origin consumers can request registered data. GitHub Pages cannot reproduce the local server's route-specific framing restrictions. Public source and geometry are not private; never add credentials or private assets to this capture.

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Third-party data and dependencies retain their respective licenses.
