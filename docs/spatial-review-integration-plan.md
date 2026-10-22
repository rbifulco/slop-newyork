# Spatial Review integration plan

## Current scope and authorization

On 22 October 2026 the repository owner requested installation, explicitly approved `https://spatial-review.alterno.dev`, requested public GitHub Pages deployment, and then requested expansion to the complete world after finding that the initial integration omitted most assets. This plan supersedes the landmark-only scope at `bcf4bc4`.

The official editor may embed the dedicated capture and receive explicitly registered scene, asset, material, texture, navigation and source-reference data. Authorization remains in `spatial-review/capture.mjs`: `allowOfficialEditor: true`, no additional production origins, loopback peers enabled only on a loopback producer. Same-origin requests remain implicitly allowed. Ordinary DOM, cookies and storage are not registered. Texture URLs containing credentials or query strings are rejected by the world material adapter.

SDK 0.7.0 and Three.js 0.186.1 are retained without a dependency change. The new expansion edits only the capture adapters, capture HTML/discovery, tests and documentation. Ordinary `index.html`, all `js/` sources and the game's render loop remain unchanged from `bcf4bc4`.

## Review representation and authoritative sources

The dedicated capture constructs a complete frozen source world without starting `js/main.js`, WebGPURenderer, lighting/post-processing, gameplay listeners or an ongoing frame loop. Geometry is obtained from the actual source builders; the former flat geographic proxies are not registered.

| System / owner | Source mapping | Representation |
| --- | --- | --- |
| Ground, roads, parks and waterfront | `js/city-grid.js#buildCityGrid` | Actual ground, water, sidewalks, curbs, park and pier meshes |
| Boroughs, bridges and islands | `js/boroughs.js#buildBoroughs` | Source procedural buildings, bridge geometry and surrounding land |
| Landmarks | `js/landmarks.js#buildLandmarks`, semantic `name: '<key>'` fit calls | Existing eleven actors and component hierarchies |
| Manhattan buildings | `js/buildings.js#buildCityBlocks`, `js/buildings.js#update` | Real building massing plus detail from every source block |
| Trees and street furniture | `js/street-details.js#buildStreetDetails`, `js/trees.js#createTreeField` | All tree placements, source tree LODs, source street props |
| Traffic | `js/traffic.js#createTrafficSystem` | Source street cars and buses at a deterministic snapshot |
| Highway vehicles | `js/traffic.js#createHighwayTraffic` | Source highest-detail vehicle meshes and initial above-ground poses |
| Markings | `js/road-paint.js#buildRoadPaint` | Actual road-paint geometry from the same traffic network |
| Player vehicles and characters | `js/controllers.js#ThirdPersonControllerManager` | Source factories for person, taxi, bicycle/rider and helicopter |
| Posed people | `js/pedestrians.js#PersonRig`, `js/pedestrians.js#createPersonMaterial` | CPU-baked source skeletal poses, not bind-pose geometry |
| Experience | `js/cameras.js#CAMERA_PRESETS` and preset switch cases | Existing eight independently sampled scenic excerpts |

### Boundaries, identity and feedback

The eleven landmarks keep `landmark-<key>` actor IDs and `landmark-design-<key>` asset IDs. Their existing source mappings, ownership and component semantics are unchanged. The remaining world has nine transform-only source-system owners. Spatial regions are 1 km grid cells, split into bounded packets as necessary. IDs are `world-<system>-<x>-<z>-<packet>`; asset IDs append `-design`.

A region is a streaming/selection boundary, not an independently authored building. Source mesh components and individual instance transforms remain in its Asset representation. Repeated geometry/material designs are coalesced within a region; this does not establish a global canonical-asset record for every building or tree variant, nor a top-level Scene actor per placement. Fine-grained feedback must identify its component/instance and world location, then be interpreted against the referenced builder and placement inputs. Factory source references are searchable; generated component suffixes are identities, not JavaScript symbols.

All world axes and metre units match the game. A region root is translated to its cell origin; child/instance poses remain relative to that root. Apply source edits in the authoritative parent's frame, and do not apply an assembly transform twice to its children. Feedback XYZ degrees must be converted to source radians where appropriate. Region packing and component order may change when source geometry changes; that requires feedback migration rather than assuming a target still addresses the same object.

The three retired `context-*` flat proxy actors have no exact one-to-one replacement. Preserve their old review sets and migrate relevant comments to the real geography regions manually. Unresolved landmark feedback should retain its targets. Source-derived build IDs and immutable representation revisions change with source inputs. Texture resource IDs are session addresses, not feedback identities.

### Deterministic state and completeness

Each synchronous source constructor runs under a fixed seeded random generator, restored with `finally` before yielding. Street traffic uses three fixed 1/60-second source updates; zero dt is invalid because the source divides acceleration by dt. Highway capture observes the original highway update at deterministic nearby viewpoints with zero dt, collecting the source's above-ground initial vehicle matrices. Cars hidden underground by that source remain intentionally absent. Player models use their initial source poses.

The ordinary building-detail renderer only fills nearby pools. Capture invokes its actual update separately for every authoritative block and copies active instance data, checking that no block fills a pool to capacity. It restores the source query function even on failure. Tree capture preserves the exact placement formula and independently checks matrices against source-populated near trees before exposing all placements. It uses source near geometry for detail and source far geometry for overview. CPU crowd baking follows the source shader's two-bone transforms and morph inputs, then separates body-part material groups.

The capture fails explicitly on a changed source pool/LOD layout, unsafe texture URL, non-finite transform, unbaked GPU crowd or oversized negotiated representation. It does not mark a partly constructed catalog ready. Every system, representation descriptor, assembly and navigation sequence is registered before one capture bridge is attached.

## Materials and intentional exclusions

This is intentionally approximate for appearance and unsuitable for final TSL/shader, lighting or photorealistic comparisons. Supported base color, roughness, metalness, transparency and explicit texture slots survive in standard review materials. Custom TSL facade/window/interior shading, poster artwork, water displacement/reflection, wind, lighting and post-processing do not. Neutral shader base colors receive declared review colors rather than misleading white surfaces. Instance colors are quantized to limit material variants. People use a simplified body-part palette rather than the original procedural clothing/skin colors.

Tree bark and leaf surfaces retain separate material groups. The generated leaf atlas coverage is converted into an alpha map with the original flip orientation; the MetLife canvas sign is preserved. Source-code references are never used as texture URLs. Material-to-source mapping is recorded in `diagnostics.world.materialSources` and landmark diagnostics because the protocol has no material `sourceRef` field.

GPU-only steam, god rays, glare/beam sprites and contact-shadow planes are excluded as effects. Their physical trees, vehicles, street fixtures and buildings are retained. Duplicate source LODs and zero-count pools are not duplicated in the export. The capture is frozen, not gameplay replay. The full source water plane is retained, so whole-world bounds are much larger than Midtown; selecting a region or landmark is more useful than framing all content at once.

## Streaming, performance and lifecycle

Geometry delivery uses deferred `asset-stream-v1` representations. The compatibility target is the current official editor supporting that capability; legacy consumers do not receive deferred-only geometry. Consumers without assembly support use the SDK's flattened ownership fallback.

Overview and detail are distinct where source tree LODs exist. Other systems retain the same geometry in both families. The scene serialization profile intentionally omits surface texture evidence; Asset/review profile carries supported normals, UVs and maps. Large geometry is split along complete triangles while preserving material groups. Repeated instances stay instanced, not individually expanded into vertices.

Per-response geometry limit: 16 MiB. Texture limit: 4 MiB. Two concurrent asset requests, 32 MiB aggregate in flight, 64 queued requests. Region packing targets approximately 6 MiB plus metadata. Producers check cancellation and budget before serialization. SDK resource/snapshot caches and deferred-texture delivery grace remain authoritative; regenerate a representation to obtain current resource IDs after eviction. No unbounded representation cache is added.

Construction is not lazy and is not yet uniformly divided into sub-50 ms work. Source geography, building and tree constructors can block the capture document for hundreds of milliseconds or longer. Capture yields between systems and during block-detail, partition and pedestrian work. It does not add any of that work to the ordinary page. This is a substantial desktop-oriented scene, not a mobile performance qualification. Loading all detail has a large memory and transfer cost.

Cancellation, failure, page hide and refresh detach the bridge before unregistering. Capture-owned instances, geometry, materials and textures are disposed; the live game owns none of them. Back/forward-cache restoration starts a new complete registry. Bootstrap progress is shown in the capture HTML; SDK 0.7.0 does not provide a producer-controlled initial readiness gate.

## Transport and deployment

| Purpose | URL |
| --- | --- |
| Local website | `http://localhost:5173/` |
| Local capture | `http://localhost:5173/spatial-review.html` |
| Public website | `https://rbifulco.github.io/slop-newyork/` |
| Public capture | `https://rbifulco.github.io/slop-newyork/spatial-review.html` |
| Public discovery | `https://rbifulco.github.io/slop-newyork/.well-known/spatial-review.json` |
| Review | `https://spatial-review.alterno.dev/review?site=https%3A%2F%2Frbifulco.github.io%2Fslop-newyork%2F` |

Static discovery is the only discovery path. Ordinary pages load no review bridge. Local CORS and capture framing are scoped by the development server; exact loopback editor port 5174 is the default. GitHub Pages cannot reproduce per-route custom framing headers. Registered messaging remains origin-authorized, but all published source and geometry are public.

The existing Actions workflow tests, builds, checks project-prefix URLs, uploads and deploys `dist/`. It uses the same pinned upload-pages-artifact v5 pattern as the owner's Claude-of-Duty site, includes hidden files, and verifies the actual tar includes discovery and `.nojekyll`. Pages must use Actions as its source, and environment protection must allow `feat/spatial-review`. A competing branch/Jekyll deployment must not overwrite the built site.

## Evidence and outstanding checks

The original integration baseline recorded 97 source tests and 116 tests including its first adapters. Those are historical results, not a fresh full-suite result for this expansion.

Local expansion checks used Node 22.16 and Chromium with the pinned SDK/Three.js code extracted from the existing deployed bundle. External navigation and dependency downloads were unavailable in that local environment; the temporary offline harness injected source scripts into an isolated blank document and used a local geometry-utility implementation. GitHub CI must additionally validate the normal package installation, official Three.js utilities, build and cross-origin HTTP transport.

Local evidence before commit:

- Eight new unit tests passed: seed restoration, triangle/group conservation, source instance/world-pose conservation, invalid-source rejection, material/URL handling, overview/detail identity, CPU skeletal baking, and all-block detail collection.
- Two complete constructions produced identical inventories, source references, transforms, bounds, counts and byte estimates.
- Final capture: 761 entries, including the eleven landmarks; 4,858 Manhattan detail blocks; source builders reported 117,731 borough buildings and 70,301 trees; snapshot included 200 street cars, 32 buses, 2,569 visible highway cars and 336 posed people/riders.
- Every one of the 761 detailed representations was serialized by the SDK successfully. Largest payload: 6,197,207 bytes. Sum of detailed geometry payloads: 249,433,302 bytes, excluding texture resource bytes. This sum is not an initial download requirement.
- Coalescing repeated designs reduced building-detail transport nodes from 40,861 to 1,194 while retaining all source instances.
- One repeat construction plus registration measured about 10.4 seconds in the offline headless environment. This is an observation, not a performance target or estimate for another device.

`npm run test:browser` now requests both detail and overview geometry from every world system, decodes a generated texture, reloads the capture, compares the complete actor catalog and checks zero retained registry/cache ownership after disposal. CI job results are the source of truth for those normal browser checks.

The expanded scene's official-editor visual acceptance, real-device mobile performance, pixel parity with the game and a new editor feedback/source-edit round trip remain unverified unless separately recorded. The previous landmark-only editor acceptance does not prove these expanded checks. Preserve all existing user feedback; no disposable editor operation was applied in this expansion.
