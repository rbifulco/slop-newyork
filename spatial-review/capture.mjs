import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  createSpatialReviewEditorAuthorization,
  spatialReviewEditorUrl,
} from '@alterno-dev/spatial-review';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWorldReview, configureWorldSource, WORLD_SOURCE_SCRIPTS } from './world.mjs';
import { buildNavigationReview } from './navigation.mjs';
import { registerReviewSubject } from './registration.mjs';

const BUILD_ID = __SPATIAL_REVIEW_BUILD_ID__;
const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const authorization = createSpatialReviewEditorAuthorization({
  allowOfficialEditor: true, // Repository owner explicitly approved this editor.
  allowedOrigins: [],
  allowLoopbackPeers: isLoopback,
  advertiseEditorOriginPolicy: { publicOrigins: ['https://spatial-review.alterno.dev'] },
});
const scripts = WORLD_SOURCE_SCRIPTS;
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
    const adapterState = { owned: [], crowds: [] };
    window.NYC = { THREE, TSL, Addons: { mergeGeometries, mergeVertices } };
    for (const name of scripts) {
      await loadScript(name, controller.signal);
      configureWorldSource(name, window.NYC, adapterState);
    }
    await document.fonts.ready;
    controller.signal.throwIfAborted();
    const mark = performance.now();
    const world = adopt(await buildWorldReview(window.NYC, {
      signal: controller.signal, state: adapterState,
      onProgress: name => { status.textContent = `Preparing ${name.toLowerCase()}…`; },
    }));
    diagnostics.phases.worldMs = performance.now() - mark;
    diagnostics.world = world.diagnostics;
    diagnostics.materials = world.diagnostics.landmarks;
    const navigation = buildNavigationReview(window.NYC);
    diagnostics.navigation = navigation.metadata;
    for (const assembly of world.assemblies) registry.registerAssembly(assembly);
    registry.registerAssembly({
      assemblyId: 'manhattan-landmarks', name: 'Manhattan landmarks',
      sourceRef: 'js/landmarks.js#buildLandmarks',
      localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    for (const representation of [world]) {
      for (const subject of representation.subjects) {
        const { metadata } = registerReviewSubject(registry, subject, BUILD_ID, subject.parentAssemblyId ?? 'manhattan-landmarks');
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
      maxQueuedAssetRequests: 64,
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
