// Real cross-origin browser acceptance: ordinary URL discovery, every source
// system, live texture bytes, stable refresh and teardown. Not an editor UI test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSpatialReviewServer } from './spatial-review-server.mjs';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});
const close = server => new Promise(resolve => server.close(resolve));
const peer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Spatial Review acceptance</title><h1>Local review peer</h1>');
});
const peerOrigin = await listen(peer);
const producer = createSpatialReviewServer({ loopbackEditorOrigins: [peerOrigin] });
let browser;
try {
  const websiteUrl = `${await listen(producer)}/`;
  browser = await chromium.launch({
    ...(process.env.SPATIAL_REVIEW_CHROMIUM ? { executablePath: process.env.SPATIAL_REVIEW_CHROMIUM } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { if (errors.length < 10) errors.push(String(error)); });
  await page.goto(peerOrigin);
  const first = await page.evaluate(async websiteUrl => {
    const discoveryUrl = new URL('.well-known/spatial-review.json', websiteUrl).href;
    const response = await fetch(discoveryUrl);
    if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
    const discovery = await response.json();
    const captureUrl = new URL(discovery.liveCapture, discoveryUrl);
    const frame = document.createElement('iframe');
    let id = 0;
    const rpc = (message, type, timeout = 120000) => new Promise((resolve, reject) => {
      const requestId = `smoke-${++id}`;
      const cleanup = () => { clearTimeout(timer); removeEventListener('message', receive); };
      const receive = event => {
        if (event.origin !== captureUrl.origin || event.source !== frame.contentWindow ||
            event.data?.type !== type || (message && event.data.requestId !== requestId)) return;
        cleanup(); resolve(event.data);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`No terminal ${type}`)); }, timeout);
      addEventListener('message', receive);
      if (message) frame.contentWindow.postMessage({ ...message, requestId }, captureUrl.origin);
    });
    const ready = rpc(null, 'alterno:spatial-review:ready');
    frame.src = captureUrl.href; document.body.append(frame); await ready;
    const catalogRequest = {
      type: 'alterno:spatial-review:request', profile: 'review', progressive: true,
      capabilities: ['asset-stream-v1', 'scene-assemblies-v1'],
      geometryTransfer: { capability: 'geometry-transfer-v1', maxBytes: 16777216 },
      resourceTransfer: { capability: 'resource-transfer-v1', maxBytes: 4194304 },
    };
    const catalog = await rpc(catalogRequest, 'alterno:spatial-review:catalog');
    const buildId = catalog.payload.buildId;
    const requestAsset = async (assetId, representationId = 'detail', profile = 'review') => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await rpc({ type: 'alterno:spatial-review:asset-request', buildId, assetId, profile,
          stream: { capability: 'asset-stream-v1', representationId, maxBytes: 16777216, priority: 'interactive' },
        }, 'alterno:spatial-review:asset-response');
        if (result.ok) return result;
        if (result.error !== 'busy') throw new Error(`Asset ${assetId}/${representationId} failed: ${result.error}`);
        await new Promise(resolve => setTimeout(resolve, result.retryAfterMs ?? 100));
      }
      throw new Error(`Unsettled demand for ${assetId} after three busy results`);
    };
    const esb = await requestAsset('landmark-design-esb');
    const gct = await requestAsset('landmark-design-gct');
    const gctScene = await requestAsset('landmark-design-gct', 'overview', 'scene');
    const textureMap = gct.asset.materials.flatMap(material => material.maps ?? []).find(map => map.slot === 'map');
    if (!textureMap?.resourceId) throw new Error('MetLife sign has no live texture resource');
    const sceneMap = gctScene.asset.materials.flatMap(material => material.maps ?? []).find(map => map.slot === 'map');
    if (sceneMap?.resourceId !== textureMap.resourceId) throw new Error('Scene and Asset must retain the shared MetLife sign texture');
    if (!gctScene.asset.geometries.some(entry => entry.geometry.uvs?.length)) throw new Error('Scene lost the texture UVs');
    const geometryBytes = asset => asset.geometries.reduce((total, entry) => total +
      ['positions', 'normals', 'uvs', 'colors', 'indices'].reduce((sum, key) => sum + (entry.geometry[key]?.byteLength ?? 0), 0), 0);
    const texture = await rpc({ type: 'alterno:spatial-review:resource-request', resourceId: textureMap.resourceId }, 'alterno:spatial-review:resource-response');
    if (!texture.ok) throw new Error(`Texture failed: ${texture.error}`);
    const image = await createImageBitmap(new Blob([texture.bytes], { type: texture.contentType }));
    const decodedTexture = { mime: texture.contentType, bytes: texture.bytes.byteLength, width: image.width, height: image.height,
      decodedRGBABytes: image.width * image.height * 4, estimatedGPUMipBytes: Math.ceil(image.width * image.height * 4 * 4 / 3),
      sharedAcrossProfiles: true }; image.close();
    const coverage = [];
    const systems = ['geography', 'boroughs', 'buildings', 'streets', 'traffic', 'highways', 'markings', 'players', 'people'];
    for (const system of systems) {
      const actor = catalog.payload.scene.actors.find(a => a.parentAssemblyId === `world-${system}`);
      if (!actor) throw new Error(`No registered ${system} actor`);
      const result = await requestAsset(actor.assetId);
      const overview = await requestAsset(actor.assetId, 'overview', 'scene');
      if (!result.asset.geometries?.length || !overview.asset.geometries?.length) throw new Error(`Empty ${system} geometry`);
      if (!result.asset.sourceRef?.startsWith('js/')) throw new Error(`Missing ${system} source mapping`);
      if (system === 'markings' && (!overview.asset.geometries.some(entry => entry.geometry.colors?.length) ||
          !overview.asset.materials.some(material => material.vertexColors))) throw new Error('Visible road-marking colors are missing');
      coverage.push({ system, actorId: actor.actorId, assetId: result.asset.id, nodes: result.asset.nodes.length, geometries: result.asset.geometries.length,
        detailGeometryBytes: geometryBytes(result.asset), sceneGeometryBytes: geometryBytes(overview.asset),
        colorBytes: overview.asset.geometries.reduce((sum, entry) => sum + (entry.geometry.colors?.byteLength ?? 0), 0) });
    }
    const refreshedReady = rpc(null, 'alterno:spatial-review:ready');
    frame.src = captureUrl.href; await refreshedReady;
    const refreshed = await rpc(catalogRequest, 'alterno:spatial-review:catalog');
    return { websiteUrl, discoveryUrl, captureUrl: captureUrl.href, catalog: catalog.payload, refreshed: refreshed.payload,
      coverage, esb: { id: esb.asset.id, sourceRef: esb.asset.sourceRef, nodes: esb.asset.nodes.map(({ id, name, sourceRef }) => ({ id, name, sourceRef })) },
      appearance: { assetId: gct.asset.id, detailGeometryBytes: geometryBytes(gct.asset), sceneGeometryBytes: geometryBytes(gctScene.asset),
        materialIdsStableAcrossProfiles: JSON.stringify(gct.asset.materials.map(m => m.id)) === JSON.stringify(gctScene.asset.materials.map(m => m.id)) }, texture: decodedTexture };
  }, websiteUrl);
  assert.equal(first.catalog.buildId, first.refreshed.buildId);
  assert.deepEqual(first.catalog.scene.actors, first.refreshed.scene.actors, 'complete inventory, IDs, transforms and bounds survive reload');
  assert.ok(first.catalog.scene.actors.length > 100, 'not the old 14-subject landmark-only capture');
  assert.equal(first.catalog.scene.assemblies.length, 10);
  assert.equal(first.catalog.scene.navigationSequences.length, 8);
  assert.equal(first.coverage.length, 9);
  assert.ok(first.esb.nodes.some(node => node.name === 'esb/podium'));
  assert.match(first.esb.sourceRef, /js\/landmarks\.js#name: 'esb'/);
  assert.deepEqual([first.texture.width, first.texture.height], [512, 128]);
  assert.match(first.texture.mime, /^image\//); assert.ok(first.texture.bytes > 100);
  const captureFrame = page.frames().find(frame => frame.url() === first.captureUrl);
  const lifecycle = await captureFrame.evaluate(() => {
    const { registry, diagnostics, dispose } = window.slopSpatialReview;
    const before = { actors: registry.size, phases: diagnostics.phases, world: diagnostics.world };
    dispose();
    return { before, after: { actors: registry.size, ready: diagnostics.ready, cache: registry.deferredCacheMetrics } };
  });
  const world = lifecycle.before.world;
  assert.ok(world.blockDetails.blocks > 4000, 'all source blocks rather than only a nearby radius');
  assert.ok(world.blockDetails.instances['water-tower-barrels'] > 10000);
  assert.equal(world.traffic.cars, 200); assert.equal(world.traffic.buses, 32);
  assert.ok(world.crowds > 300, 'CPU-baked posed people');
  assert.ok(world.highwayTraffic.visibleCars > 2000);
  for (const stats of Object.values(world.systems)) assert.equal(stats.exportedInstances, stats.sourceInstances, 'no missing source instances');
  assert.equal(lifecycle.after.actors, 0); assert.equal(lifecycle.after.ready, false);
  assert.equal(lifecycle.after.cache.entries, 0); assert.equal(lifecycle.after.cache.textureOwners, 0);
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/spatial-review-browser.json', `${JSON.stringify({ ...first, lifecycle, errors }, null, 2)}\n`);
  console.log(JSON.stringify({ result: 'PASS', actors: first.catalog.scene.actors.length, coverage: first.coverage,
    sequences: 8, texture: first.texture, stableRefresh: true, teardown: true, phases: lifecycle.before.phases,
    blocks: world.blockDetails.blocks, people: world.crowds, systems: world.systems }, null, 2));
} finally {
  await browser?.close(); await close(producer); await close(peer);
}
