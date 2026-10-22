# Spatial Review integration

## Authorization and scope

On 22 October 2026 the user requested this integration on a new
branch and explicitly authorized `https://spatial-review.alterno.dev`.
`allowOfficialEditor: true` records that decision. The capture route permits
that editor to frame it and receive the deliberately registered geometry,
materials, generated texture bytes, navigation and source references. The
ordinary application does not run a bridge. Local cross-port development peers
are enabled only on a loopback website. No additional production editor origins
or production deployment are part of this change.

The integration follows `rbifulco/alterno-spatial-review/agents/install.md`.
The source baseline is `0049a497be6e36c79f854771f3018f8f41f07fab`.

## Review representation

The dedicated `spatial-review.html` document constructs a deterministic review
state without running the game renderer, simulation, controllers or animation
loop. Static discovery is the only discovery path. The initial scope includes
the eleven authored landmark places and their canonical geometry, geographic
context derived from the authoritative map, and the eight scenic camera
presets. Procedural shading is explicitly approximated; this representation is
for geometry, placement and camera-intent feedback. It is not a photorealistic
replacement for the game. Detailed surrounding buildings, moving traffic,
pedestrians, vehicle control, runtime lighting and post-processing are excluded.
Missing surrounding detail limits occlusion and street-level appearance review.

| Inventory | Decision |
| --- | --- |
| Actors and assets | Stable semantic landmark keys from `fitToSite`; one design per landmark and one actor per independent place. Context is explicitly labelled as a proxy. |
| Ownership | Landmark placements belong to an explicit transform-only Manhattan landmarks owner; cross-place geographic context belongs to World. |
| Components | Construction names and stable hierarchy preserve canonical local geometry. Compound Grand Central/MetLife and Bryant Park/NYPL places remain coordinated subjects. |
| Materials | Capture-only standard materials approximate TSL appearance. Preserve supported scalar fields and the MetLife canvas sign. No external credential-bearing texture URLs. |
| Experience | Separate finite excerpts of the eight real scenic presets; sampled analytic motion is read-only. Interactive follow cameras are excluded. |
| Capture baseline | Empire State placement/asset, Grand Central MetLife sign, and Fifth Avenue scenic preset. |
| Source mapping | `js/landmarks.js#buildLandmarks`, each semantic fit key and component source; `js/city-config.js`, `js/nyc-geodata.js`; `js/cameras.js` preset and case. |
| Coordinates | One unit is one metre; +Y up, +X Manhattan-grid east, +Z Manhattan-grid south. No axis conversion. Apply parent-local feedback once; convert XYZ degrees to source radians. |
| Identity | Build identity is derived from content and lockfile; stable IDs survive refresh. Build and semantic target IDs are deterministic. SDK timestamps and session texture resource IDs are not feedback identities. Hierarchy changes require explicit feedback migration. |
| Capture lifecycle | Complete registrations before bridge attachment; detach before refresh/teardown; release only capture-owned resources. |
| Transport | Static `.well-known/spatial-review.json`, local development on port 5173, cross-port consumer on 5174, approved official editor. |
| Deferred trigger | Measure construction/serialization and transfer size; defer geometry to keep the initial catalog bounded. Record measurements in final evidence. |
| Compatibility | SDK 0.7.0 and an editor supporting asset-stream-v1. No legacy consumer compatibility claim. |

## Baseline

The existing project has no dependency manifest or build step; it is served
directly as static files. Before dependencies changed, all **97 existing tests
passed** using Node 24.19.0. An initial sandbox run blocked test subprocesses
with EPERM; rerunning the unchanged tests with subprocess support passed.
The newly added build packages the review route while copying the original
ordinary page unchanged. The only shared runtime edit is the landmark builder:
its ordinary entry remains synchronous and drains the same construction steps,
while capture can preserve semantic groups and yield between landmarks.

## Source mapping and feedback

The capture exports 14 actors and 14 canonical assets: 11 landmark places and
three explicitly named flat context proxies. The landmarks have 227 named mesh
components and one transform-only `manhattan-landmarks` owner. Geographic
context remains in World because it crosses authored places.

| Actor suffix | Landmark | Searchable placement/construction key |
| --- | --- | --- |
| `esb` | Empire State Building | `js/landmarks.js#name: 'esb'` |
| `chrysler` | Chrysler Building | `js/landmarks.js#name: 'chrysler'` |
| `vanderbilt` | One Vanderbilt | `js/landmarks.js#name: 'vanderbilt'` |
| `gct` | Grand Central and MetLife | `js/landmarks.js#name: 'gct'`, `unionSite` |
| `bryant` | Bryant Park and NYPL | `js/landmarks.js#name: 'bryant'`, `blockSite` |
| `timessquare` | One Times Square | `js/landmarks.js#name: 'timessquare'` |
| `rockefeller` | 30 Rockefeller Plaza | `js/landmarks.js#name: 'rockefeller'` |
| `citigroup` | Citigroup Center | `js/landmarks.js#name: 'citigroup'` |
| `flatiron` | Flatiron Building | `js/landmarks.js#name: 'flatiron'` |
| `seagram` | Seagram Building | `js/landmarks.js#name: 'seagram'` |
| `owtc` | One World Trade Center | `js/landmarks.js#name: 'owtc'` |

Actor IDs use `landmark-<key>` and canonical asset IDs use
`landmark-design-<key>`. Most fitted placement inputs originate in
`js/city-config.js#LANDMARK_SITES`. The fit call controls height, horizontal
scale and offsets; use that call rather than overwriting a derived world pose.
Geographic inputs come from `MANHATTAN_COASTLINE` and `BLOCKS`, derived from
`js/nyc-geodata.js` by `js/city-config.js`.

For component feedback, the exported node name is the construction key, for
example `esb/podium` or `owtc/finNS[-20]`. Search that name in
`js/landmarks.js` or use `componentSources[node.name]` in the capture's subject
diagnostics. The installed serializer appends a synthetic node ID to the actor
source reference. That suffix is an identity, not an additional JavaScript
symbol. Resolve the actor reference, then its named component. Node IDs also
include the hierarchy path, so reordering components requires explicit target
migration even when the actor identity stays stable.

Material names map through `diagnostics.materials.materialSources`; the protocol
does not give materials a sourceRef field. For example
`landmarkLimestoneCrownMat` maps to the constant and
`createPreWarBuildingMaterial`, `landmarkSilverCurtainMat` to
`createCurtainWallMaterial`, and `metlifeSignMat`/`map` to the locally generated
MetLife canvas. Source material scalars and maps are preserved where supported;
TSL color, normal and emission graphs are intentionally replaced by named,
source-colored standard materials. This is an **intentionally approximate**
geometry/composition representation and **unsuitable** for final shader,
lighting, window/interior, billboard artwork or reflected appearance judgments.
No credential-bearing texture URL is accepted by this adapter.

The eight `camera-<presetId>` sequences invoke the actual scenic camera formulas
in `CameraSystem.update`. Each represents its own 0–30 second interval at
0.5-second samples. They do not invent a tour between unrelated cameras.
Pose references point to the real switch case, and FOV references point to
`CAMERA_PRESETS`. Sampled curves are read-only; the protocol cannot make stops
or FOV read-only, so proposals on these derived endpoints require interpretation
against the original formula. Playback uses relative segment weight and may
run at the editor's chosen speed. Interactive smoothing, preset transitions
and player-driven follow cameras are excluded.

Source and capture use identical world axes and metre units. For a component,
apply edits in its parent-local frame. For a landmark placement, preserve the
source fitting rule and convert an intended world-space change into its local
offset/scale parameters. Rotation fields in feedback use XYZ degrees; source
Three.js rotations use radians. Do not apply a parent/assembly operation again
to its children. Keep unresolved feedback when refreshing; retire applied local
operations only after checking the changed source.

## Capture, transport and resource decisions

The capture first constructs source geometry in abortable chunks, registers the
complete metadata set, and only then attaches one bridge. Initial bootstrap
status is displayed in the capture page, not advertised as SDK readiness.
Producer-controlled initial SDK progress is unsupported in version 0.7.0. The
first catalog request promotes the source to catalog-ready. No partial catalog
is exposed during refresh.

Serialization and transfer are deferred; source construction is **not** lazy.
Every asset advertises an overview and detail representation of the same
canonical capture geometry. This is not an LOD simplification. Scene profile
omits texture/normal/UV appearance as the SDK specifies; Asset review profile
preserves the supported surface fields. Representation revisions include the
content-derived build ID and asset identity. Identical source inputs produce
the same build and target IDs; changed inputs produce a different build.

The initial unchunked browser construction took 98.7 ms, exceeding the guide's
50 ms trigger. The final capture yields between source landmark constructions
and polygon batches. One accepted browser sample measured 44.8 ms total for
landmarks and 37.0 ms for context, with largest synchronous chunks of 6.3 ms and
8.6 ms respectively. A separate measurement of individual detailed geometry
serialization was 0.3–6.1 ms per subject, with approximately 2.27 MB of typed
asset payloads in total and a largest subject of about 924 KB. These are local
development measurements, not a production performance qualification.

The bridge caps one geometry response at 16 MiB, one texture at 4 MiB, aggregate
in-flight geometry at 32 MiB, concurrent requests at two and queued requests at
24. Deferred producers check cancellation and budget before returning roots.
The SDK owns bounded snapshot/resource caches and its 60-second deferred
texture delivery grace. No additional representation cache is introduced.
Regenerate a representation for a fresh resource ID after eviction. Texture
resource IDs are session addresses, never feedback identities.

Page hide, failure and refresh abort construction, detach the bridge, unregister
actors and dispose capture-owned geometry/materials/textures. The ordinary page
never owns these resources. Back/forward-cache restoration reconstructs a fresh
complete registry. The selected compatibility target is a current consumer with
`asset-stream-v1`; older consumers intentionally receive no deferred-only
geometry. Consumers lacking assembly negotiation receive the SDK's flattened
metadata and lose coordinated owner editing.

Development URLs:

- Website: `http://localhost:5173/`
- Capture: `http://localhost:5173/spatial-review.html`
- Review: `https://spatial-review.alterno.dev/review?site=http%3A%2F%2Flocalhost%3A5173%2F`
- Static discovery: `http://localhost:5173/.well-known/spatial-review.json`

The review URL is generated with `spatialReviewEditorUrl(websiteUrl)`. Static
discovery resolves correctly from root and project-subdirectory URLs. It has
CORS for the official editor and local peers when the producer is loopback.
Capture framing permits the official editor and exact local consumer origins
(port 5174 by default; configurable). Ordinary routes retain same-origin framing
in the new development server. The existing repository had no deployed framing
configuration. No production headers, hosting, DNS or deployment were changed.
Before a future production deployment, configure the advertised origin policy
for that deployment, including the producer's implicit same-origin allowance,
and verify its actual CORS and framing responses separately.

## Acceptance evidence

Environment: Node 24.19.0; headless Chromium 145 with software rendering. Tests
and browser tooling required permitted subprocess/localhost access. The browser
smoke test is reproducible with `npm run test:browser` after installing Chromium;
it writes `test-results/spatial-review-browser.json`.

| Check | Result and evidence |
| --- | --- |
| Existing baseline | 97 tests passed before dependency installation. No pre-existing build command. |
| Complete test suite | 116 tests passed, including source geometry, deterministic IDs, cancellation, parent-local bounds, streaming budget, navigation and HTTP transport checks. |
| Build | Passed; ordinary `dist/index.html` is byte-identical to the source page. |
| Ordinary source/state parity | Original and changed default landmark builders produced identical geometry, transforms, hierarchy, material scalars/sharing, instances, colliders, fitted placement and Bryant Park lawn. 83 objects and 28 material identities; hash below. |
| Ordinary visual/interaction comparison | **Unverified.** The unchanged baseline fails on this environment's software WebGPU device before a usable frame. GPU buffer allocation and device errors prevent a reliable screenshot/startup/interaction comparison. No game-rendering fix was made as part of the review integration. |
| Runtime isolation | Verified by imports/build and source inspection. `index.html` loads no SDK, capture registry, capture listener, serializer or review animation loop. Shared landmark construction remains synchronous in ordinary mode. |
| Cross-origin discovery | Passed in Chromium, starting with ordinary website URL and fetching static discovery from a second loopback port, then embedding the advertised capture. Project-relative discovery also passes HTTP/protocol tests. |
| Geometry transport | Passed: real streamed Empire State and Grand Central/MetLife representations, stable actor/source identities and canonical component names. |
| Generated texture | Passed: live-resource response is decodable `image/png`, 3,657 bytes, 512 × 128 pixels. No direct texture URL is needed. |
| Reload | Passed: unchanged build, actor IDs, transforms and bounds after capture reload. |
| Cancellation and final teardown | Passed: cancellation releases partially built source resources; teardown leaves zero actors, deferred snapshots and texture owners. |
| Official editor | Passed discovery, representative Scene/Asset/Experience review, feedback export and preservation, and an authoritative source-edit/rebuild/refresh cycle. Details below. |
| Production deployment | Outside scope and unverified. |

Default landmark geometry/state parity SHA-256:
`0b948cebeaeb2a19e50bee662654ee62cc8ee5bb9ad0f708d06205fcc523232d`.
The comparison used real Three.js, TSL, facade conversion and mesh batching;
canvas drawing was stubbed. It establishes geometry/state parity, not pixel
identity or equal shader rendering.

### Ordinary-page performance screen

The screen is triggered by the shared landmark builder edit. It remains partly
unverified because the unchanged baseline cannot reach a stable rendered state
on the available software GPU. CPU construction samples with different warmup
states are not presented as a speed improvement or as valid regression evidence.

| Check | Before | After | Result or limitation |
| --- | --- | --- | --- |
| Startup to stable visible game frame | Baseline GPU failure | Not compared to a failed baseline | Unverified |
| Representative movement/time/map interaction | No usable baseline frame | Not compared | Unverified |
| Continuous review runtime work | None | None on ordinary page | Source boundary verified |
| Visual parity | No usable baseline frame | Not compared | Unverified; geometry/state parity passes independently |

### Official editor evidence

These checks reached terminal results on 22 October 2026 in the approved
`https://spatial-review.alterno.dev` editor, using an isolated browser profile
and the ordinary website URL `http://127.0.0.1:5173/`.

| Check | Result |
| --- | --- |
| Discovery and Scene | Passed. The editor discovered and embedded the capture, rendered the 14 subjects and eight paths, and selected Empire State with the expected owner, parent-local placement and source reference. |
| Asset | Passed. Grand Central/MetLife opened with 1,156 triangles, 50 named hierarchy nodes and seven materials. Geometry was ready and its one texture was ready; the MetLife sign was visible. |
| Experience | Passed. The eight authored excerpts were available. Fifth Avenue displayed 48-degree FOV at both stops, in the timeline and in POV. Auto-Director Aerial playback also worked. |
| Feedback | Passed. An Empire State placement note exported actor ID `landmark-esb`, asset ID `landmark-design-esb` and searchable source reference `js/landmarks.js#name: 'esb'`. The unresolved note and its target survived a full editor reload and both source refreshes below. |
| Source edit and refresh | Passed. Temporarily changing the Fifth Avenue FOV in authoritative `js/cameras.js` from 48 to 49 degrees changed the build ID to `slop-newyork-a07df3845aecf0a3cc03`; the refreshed editor displayed 49 degrees. Restoring the exact original file bytes and rebuilding restored build `slop-newyork-8344dd0950607c782e7c` and visible 48-degree FOV. |

The temporary FOV edit is not part of this branch. The restored `js/cameras.js`
matches the baseline byte for byte (SHA-256
`4240e7e41e5649b1d5bf6779afdb560468839ae7c38b112d49313e6bf94a950f`).
The annotation and source-change checks used a disposable review session; no
existing user feedback was modified.

One editor UI issue was observed separately from the website integration: at
1440 × 1000, the collaborator widget overlapped the note form's Save control.
Keyboard activation completed the feedback action.


## GitHub Pages publishing task (22 October 2026)

The repository's `feat/spatial-review` branch now carries
`.github/workflows/spatial-review-pages.yml`, a static GitHub Actions
deployment for `https://rbifulco.github.io/slop-newyork/`.
On every branch push, the workflow installs the pinned dependencies,
executes unit and browser transport tests, builds the site, validates
repository-subpath discovery/capture URLs, and uploads `dist/` with
`.nojekyll`. The workflow's deploy job uses the `github-pages`
environment and official Pages deployment action. No automatic merge or
default-branch change is involved.

GitHub Pages was disabled (`has_pages: false`) when this task started.
Publishing requires the repository owner to select GitHub Actions as the
Pages source in Settings → Pages; the connected GitHub tool does not have
administration access to enable Pages. If fork Actions are disabled, they
also require enabling. Do not claim a public deployment or production
editor round trip until the workflow and live URLs are verified.

GitHub Pages does not support configurable CSP or framing response headers.
It cannot reproduce the local server's capture-only
`frame-ancestors` restriction. SDK-level origin authorization continues
to gate postMessage scene/texture requests, but public source geometry and
asset URLs must be considered public. The deployed discovery file continues
to authorize the official editor, and relative URLs preserve the
`/slop-newyork/` repository prefix. After activation, independently
verify public CORS, framing, discovery, Scene/Asset/Experience,
texture delivery and feedback refresh from the public website URL.

## GitHub Pages discovery 404 correction

The first successful Pages deployment completed its build, tests and deploy job,
but `/slop-newyork/.well-known/spatial-review.json` returned 404. This was
caused by the GitHub Pages upload action version 4 excluding dot-prefixed paths
by default, including the intended `.well-known/` directory and `.nojekyll`
file. Local and build-only discovery checks did not exercise that packaging
behavior.

The Pages workflow now sets `include-hidden-files: true` on
`actions/upload-pages-artifact@v4` and checks that both files exist
immediately before packaging. All other review access constraints remain
unchanged. The top-level
`https://rbifulco.github.io/.well-known/spatial-review.json` lookup is an
editor fallback and is not the required route for this repository-path website.
Verify the deployed nested discovery endpoint after the new workflow completes.
