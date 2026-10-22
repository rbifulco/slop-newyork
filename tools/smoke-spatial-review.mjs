// A real cross-origin browser peer. This focused transport check complements,
// rather than substitutes for, the documented official-editor acceptance test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSpatialReviewServer } from './spatial-review-server.mjs';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});
const close = (server) => new Promise((resolve) => server.close(resolve));
const peer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Spatial Review integration smoke</title><h1>Local review peer</h1>');
});
const peerOrigin = await listen(peer);
const producer = createSpatialReviewServer({ loopbackEditorOrigins: [peerOrigin] });
let browser;
try {
  const websiteUrl = `${await listen(producer)}/`;
  browser = await chromium.launch({
    ...(process.env.SPATIAL_REVIEW_CHROMIUM ? { executablePath: process.env.SPATIAL_REVIEW_CHROMIUM } : {}),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => { if (errors.length < 10) errors.push(String(error)); });
  await page.goto(peerOrigin);
  const first = await page.evaluate(async (websiteUrl) => {
    const discoveryUrl = new URL('.well-known/spatial-review.json', websiteUrl).href;
    const response = await fetch(discoveryUrl);
    if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
    const discovery = await response.json();
    const captureUrl = new URL(discovery.liveCapture, discoveryUrl);
    const frame = document.createElement('iframe');
    let id = 0;
    const rpc = (message, type, timeout = 20000) => new Promise((resolve, reject) => {
      const requestId = `smoke-${++id}`;
      const cleanup = () => { clearTimeout(timer); removeEventListener('message', receive); };
      const receive = (event) => {
        if (event.origin !== captureUrl.origin || event.source !== frame.contentWindow ||
            event.data?.type !== type || (message && event.data.requestId !== requestId)) return;
        cleanup(); resolve(event.data);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`No terminal ${type}`)); }, timeout);
      addEventListener('message', receive);
      if (message) frame.contentWindow.postMessage({ ...message, requestId }, captureUrl.origin);
    });
    const ready = rpc(null, 'alterno:spatial-review:ready');
    frame.src = captureUrl.href;
    document.body.append(frame);
    await ready;
    const catalogRequest = {
      type: 'alterno:spatial-review:request', profile: 'review', progressive: true,
      capabilities: ['asset-stream-v1', 'scene-assemblies-v1'],
      geometryTransfer: { capability: 'geometry-transfer-v1', maxBytes: 16777216 },
      resourceTransfer: { capability: 'resource-transfer-v1', maxBytes: 4194304 },
    };
    const catalog = await rpc(catalogRequest, 'alterno:spatial-review:catalog');
    const buildId = catalog.payload.buildId;
    const requestAsset = async (assetId) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await rpc({
          type: 'alterno:spatial-review:asset-request', buildId, assetId, profile: 'review',
          stream: { capability: 'asset-stream-v1', representationId: 'detail', maxBytes: 16777216, priority: 'interactive' },
        }, 'alterno:spatial-review:asset-response');
        if (result.ok || result.error !== 'busy') return result;
        await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs ?? 100));
      }
      throw new Error(`Unsettled demand for ${assetId} after three busy results`);
    };
    const esb = await requestAsset('landmark-design-esb');
    const gct = await requestAsset('landmark-design-gct');
    if (!esb.ok || !gct.ok) throw new Error(`Asset failure: ${esb.error || gct.error}`);
    const map = gct.asset.materials.flatMap((material) => material.maps ?? []).find((map) => map.slot === 'map');
    if (!map?.resourceId) throw new Error('MetLife sign has no live texture resource');
    const texture = await rpc({ type: 'alterno:spatial-review:resource-request', resourceId: map.resourceId }, 'alterno:spatial-review:resource-response');
    if (!texture.ok) throw new Error(`Texture failed: ${texture.error}`);
    const image = await createImageBitmap(new Blob([texture.bytes], { type: texture.contentType }));
    const decodedTexture = { mime: texture.contentType, bytes: texture.bytes.byteLength, width: image.width, height: image.height };
    image.close();
    const refreshedReady = rpc(null, 'alterno:spatial-review:ready');
    frame.src = captureUrl.href;
    await refreshedReady;
    const refreshed = await rpc(catalogRequest, 'alterno:spatial-review:catalog');
    return {
      websiteUrl, discoveryUrl, captureUrl: captureUrl.href,
      catalog: catalog.payload, refreshed: refreshed.payload,
      esb: { id: esb.asset.id, sourceRef: esb.asset.sourceRef, nodes: esb.asset.nodes.map(({ id, name, sourceRef }) => ({ id, name, sourceRef })) },
      texture: decodedTexture,
    };
  }, websiteUrl);
  assert.equal(first.catalog.buildId, first.refreshed.buildId, 'unchanged source keeps build identity');
  assert.deepEqual(first.catalog.scene.actors, first.refreshed.scene.actors, 'IDs, transforms and bounds survive reload');
  assert.equal(first.catalog.scene.actors.length, 14);
  assert.equal(first.catalog.scene.assemblies.length, 1);
  assert.equal(first.catalog.scene.navigationSequences.length, 8);
  assert.equal(first.esb.id, 'landmark-design-esb');
  assert.ok(first.esb.nodes.some((node) => node.name === 'esb/podium'));
  assert.match(first.esb.sourceRef, /js\/landmarks\.js#name: 'esb'/);
  assert.deepEqual([first.texture.width, first.texture.height], [512, 128]);
  assert.match(first.texture.mime, /^image\//);
  assert.ok(first.texture.bytes > 100);
  const captureFrame = page.frames().find((frame) => frame.url() === first.captureUrl);
  const lifecycle = await captureFrame.evaluate(() => {
    const { registry, diagnostics, dispose } = window.slopSpatialReview;
    const before = { actors: registry.size, phases: diagnostics.phases, materials: diagnostics.materials, context: diagnostics.context };
    dispose();
    return { before, after: { actors: registry.size, ready: diagnostics.ready, cache: registry.deferredCacheMetrics } };
  });
  assert.equal(lifecycle.after.actors, 0);
  assert.equal(lifecycle.after.ready, false);
  assert.equal(lifecycle.after.cache.entries, 0);
  assert.equal(lifecycle.after.cache.textureOwners, 0);
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/spatial-review-browser.json', `${JSON.stringify({ ...first, lifecycle, errors }, null, 2)}\n`);
  console.log(JSON.stringify({
    result: 'PASS', actors: first.catalog.scene.actors.length, sequences: first.catalog.scene.navigationSequences.length,
    texture: first.texture, stableRefresh: true, teardown: true,
    phases: lifecycle.before.phases, maxLandmarkChunkMs: lifecycle.before.materials.maxChunkMs,
    maxContextChunkMs: lifecycle.before.context.maxChunkMs,
  }, null, 2));
} finally {
  await browser?.close();
  await close(producer);
  await close(peer);
}
