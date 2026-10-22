# Slop New York

A New York City simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore Manhattan on foot, by car, by bicycle, or by helicopter.

[Try it live](https://mrdoob.github.io/slop-newyork/)

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## Spatial Review

This branch adds a separate development capture for [Alterno Spatial Review](https://spatial-review.alterno.dev). It uses the released SDK **0.7.0** and a pinned Three.js **0.186.1** for capture. The ordinary game keeps its existing renderer and imports; it does not load the review SDK.

With Node.js 22.11 or later:

```sh
npm ci
npm run dev
```

Keep the development server running, then open:

- **Game:** [http://localhost:5173/](http://localhost:5173/)
- **Review:** [Open Slop New York in Spatial Review](https://spatial-review.alterno.dev/review?site=http%3A%2F%2Flocalhost%3A5173%2F)
- **Capture status:** [http://localhost:5173/spatial-review.html](http://localhost:5173/spatial-review.html)

Start the editor with the ordinary game URL. Static discovery at `.well-known/spatial-review.json` locates the capture document automatically. The official editor is authorized to receive the deliberately registered scene, asset, source-reference, material, and texture data. Local editor peers can also connect; the development server permits capture framing from port 5174 by default.

### What the capture contains

- **Scene and Asset:** the eleven authored landmarks, with independent placements, component hierarchies, and source mappings. Grand Central/MetLife and Bryant Park/NYPL retain their authored compound structure.
- **Geographic context:** explicitly labeled proxies derived from the site's geographic data, for orientation and scale.
- **Experience:** deterministic samples of the eight authored scenic cameras, including their FOV. Camera formulas remain authoritative in `js/cameras.js`.

The review materials approximate the game's procedural TSL shaders. Geometry and placement can be reviewed, but façade interiors, procedural window patterns, lighting, reflections, and other shader effects are not reproduced faithfully. Detailed surrounding procedural buildings, moving traffic, pedestrians, and gameplay-driven follow cameras are outside this capture. The context proxies therefore do not support complete street-level occlusion or gameplay review.

Geometry is delivered on demand. The consumer must support **`asset-stream-v1`**; older consumers without it do not receive a complete geometry catalog. The capture includes the generated MetLife sign texture through the live-resource transport.

Export feedback from the editor, apply it to the referenced source, rebuild, and refresh the review. Source-derived build IDs change with review inputs while semantic target IDs remain stable. `npm run dev` builds once at startup; restart it after changing source, or run `npm run build` while `npm run preview` serves the existing `dist/` directory.

For a different local port or project path:

```sh
npm run dev -- --port 5183 --base-path /slop-newyork/
```

Use the corresponding ordinary website URL in the editor. `--editor-origin http://localhost:5184` adds an exact local editor framing origin.

This branch does not deploy the integration to production. The upstream live demo linked above is separate from this development capture. See the [integration plan](docs/spatial-review-integration-plan.md) for authorization, scope, source mappings, verification evidence, and remaining limitations.

### Verification

```sh
npm test
npx playwright install chromium
npm run test:browser
```

The browser smoke test starts its own two local servers. It verifies discovery from the ordinary URL, streamed landmark geometry, decoded MetLife texture bytes, stable IDs and transforms after refresh, and capture cleanup. It writes evidence to `test-results/spatial-review-browser.json`. Set `SPATIAL_REVIEW_CHROMIUM` to an existing Chromium executable when using a separately installed browser. The integration plan records the separate checks in the official editor and the limits of the game-rendering comparison.

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Third-party data and dependencies retain their respective licenses.
