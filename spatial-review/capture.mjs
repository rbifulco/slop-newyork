import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  createSpatialReviewEditorAuthorization,
  spatialReviewEditorUrl,
} from '@alterno-dev/spatial-review';
import { buildLandmarkReview } from './landmarks.mjs';
import { buildGeographicContext } from './context.mjs';
import { buildNavigationReview } from './navigation.mjs';
import { registerReviewSubject, yieldForCapture } from './registration.mjs';

const BUILD_ID = __SPATIAL_REVIEW_BUILD_ID__;
const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const authorization = createSpatialReviewEditorAuthorization({
  allowOfficialEditor: true, // Repository owner explicitly approved this editor.
  allowedOrigins: [],
  allowLoopbackPeers: isLoopback,
  advertiseEditorOriginPolicy: { publicOrigins: ['https://spatial-review.alterno.dev'] },
});
const scripts = ['nyc-geodata', 'city-config', 'tsl-materials', 'landmarks', 'cameras'];
const status = document.getElementById('capture-status');
document.getElementById('capture-build').textContent = BUILD_ID;
const link = document.getElementById('review-link');
link.href = spatialReviewEditorUrl(new URL('./', location.href).href);
link.hidden = false;

function loadScript(name, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const script = document.createElement('script');
    script.src = new URL(`./js/${name}.js`, location.href).href;
    script.async = false;
    const cleanup = () => { signal.removeEventListener('abort', abort); script.onload = script.onerror = null; script.remove(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    script.onload = () => { cleanup(); resolve(); };
    script.onerror = () => { cleanup(); reject(new Error(`Could not load ${name}.js`)); };
    signal.addEventListener('abort', abort, { once: true });
    document.head.appendChild(script);
  });
}

let active;
async function startCapture() {
  active?.dispose();
  const controller = new AbortController();
  const owned = [];
  let detach;
  let disposed = false;
  const diagnostics = { buildId: BUILD_ID, ready: false, phases: {}, subjects: [], navigation: null };
  const registry = new SceneAssetRegistry(BUILD_ID);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort(new DOMException('Capture closed', 'AbortError'));
    detach?.();
    // Unregister only after detaching, never expose a partially refreshed catalog.
    for (const { actorId } of diagnostics.subjects) registry.unregister(actorId);
    for (const representation of owned.reverse()) representation.dispose();
    diagnostics.ready = false;
  };
  active = { dispose };
  // Diagnostics stay on the capture document; no registry is installed on the game.
  window.slopSpatialReview = { registry, diagnostics, dispose };
  const adopt = (representation) => {
    if (disposed || controller.signal.aborted) {
      representation.dispose();
      controller.signal.throwIfAborted();
    }
    owned.push(representation);
    return representation;
  };
  try {
    window.NYC = { THREE, TSL };
    for (const name of scripts) await loadScript(name, controller.signal);
    await document.fonts.ready;
    controller.signal.throwIfAborted();
    let mark = performance.now();
    const landmarks = adopt(await buildLandmarkReview(window.NYC, { signal: controller.signal }));
    diagnostics.phases.landmarksMs = performance.now() - mark;
    await yieldForCapture(controller.signal);
    mark = performance.now();
    const context = adopt(await buildGeographicContext(window.NYC, { signal: controller.signal }));
    diagnostics.phases.contextMs = performance.now() - mark;
    await yieldForCapture(controller.signal);
    const navigation = buildNavigationReview(window.NYC);
    diagnostics.navigation = navigation.metadata;
    diagnostics.materials = landmarks.diagnostics;
    diagnostics.context = context.diagnostics;
    registry.registerAssembly({
      assemblyId: 'manhattan-landmarks', name: 'Manhattan landmarks',
      sourceRef: 'js/landmarks.js#buildLandmarks',
      localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    for (const representation of [landmarks, context]) {
      for (const subject of representation.subjects) {
        const { metadata } = registerReviewSubject(registry, subject, BUILD_ID, representation === landmarks ? 'manhattan-landmarks' : undefined);
        diagnostics.subjects.push({ actorId: subject.actorId, assetId: subject.assetId,
          sourceRef: subject.sourceRef, placementSourceRef: subject.placementSourceRef,
          componentSources: subject.componentSources, ...metadata });
      }
    }
    for (const sequence of navigation.sequences) registry.registerNavigationSequence(sequence);
    controller.signal.throwIfAborted();
    // This is intentionally last: the first consumer request sees the entire
    // catalog, including every deferred descriptor and navigation sequence.
    detach = attachSceneAssetRegistryBridge(registry, {
      authorization,
      maxGeometryBytes: 16 * 1024 * 1024,
      maxResourceBytes: 4 * 1024 * 1024,
      maxConcurrentAssetRequests: 2,
      maxInFlightBytes: 32 * 1024 * 1024,
      maxQueuedAssetRequests: 24,
    });
    diagnostics.ready = true;
    status.textContent = `Ready · ${registry.size} review subjects · ${registry.navigationSize} scenic camera sequences`;
    console.info('[spatial-review] Ready', { buildId: BUILD_ID, actors: registry.size, sequences: registry.navigationSize, phases: diagnostics.phases });
  } catch (error) {
    dispose();
    if (error?.name === 'AbortError') return;
    diagnostics.error = String(error?.stack ?? error);
    status.textContent = `Capture could not start: ${error?.message ?? error}`;
    console.error('[spatial-review]', error);
  }
}

addEventListener('pagehide', () => active?.dispose());
addEventListener('pageshow', (event) => { if (event.persisted) void startCapture(); });
void startCapture();
