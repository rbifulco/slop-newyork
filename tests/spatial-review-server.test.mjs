import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { editorOriginPolicyAllows, normalizeSpatialReviewDiscovery } from '@alterno-dev/spatial-review';
import { createSpatialReviewServer, OFFICIAL_EDITOR } from '../tools/spatial-review-server.mjs';

async function fixture(t, options = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'slop-review-transport-'));
  const root = path.join(temporary, 'public');
  await mkdir(path.join(root, '.well-known'), { recursive: true });
  await mkdir(path.join(root, 'js'));
  const discovery = { schema: 'spatial-review-discovery/v1', version: 1, name: 'Slop New York', websiteUrl: '../', liveCapture: '../spatial-review.html' };
  await writeFile(path.join(root, 'index.html'), '<h1>Ordinary game</h1>');
  await writeFile(path.join(root, 'spatial-review.html'), '<h1>Capture</h1>');
  await writeFile(path.join(root, '.well-known/spatial-review.json'), JSON.stringify(discovery));
  await writeFile(path.join(root, 'js/main.js'), 'window.game = true;');
  const server = createSpatialReviewServer({ rootDirectory: root, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  });
  return { root, temporary, origin: `http://127.0.0.1:${server.address().port}` };
}

test('discovery works from a project subpath and allows only the approved editor or local peers', async (t) => {
  const { origin } = await fixture(t, { basePath: '/slop-newyork/' });
  const url = `${origin}/slop-newyork/.well-known/spatial-review.json`;
  const response = await fetch(url, { headers: { Origin: OFFICIAL_EDITOR } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), OFFICIAL_EDITOR);
  const document = await response.json();
  assert.equal(new URL(document.liveCapture, url).href, `${origin}/slop-newyork/spatial-review.html`);
  assert.equal(new URL(document.websiteUrl, url).href, `${origin}/slop-newyork/`);
  assert.equal((await fetch(`${origin}/.well-known/spatial-review.json`)).status, 404);
  const local = await fetch(url, { headers: { Origin: 'http://localhost:5174' } });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  const other = await fetch(url, { headers: { Origin: 'https://example.com' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: OFFICIAL_EDITOR, 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
});

test('framing permission is scoped to capture and does not change ordinary page bytes', async (t) => {
  const { origin } = await fixture(t);
  const ordinary = await fetch(`${origin}/`);
  assert.equal(await ordinary.text(), '<h1>Ordinary game</h1>');
  assert.equal(ordinary.headers.get('content-security-policy'), "frame-ancestors 'self'");
  assert.equal(ordinary.headers.get('x-frame-options'), 'SAMEORIGIN');
  const capture = await fetch(`${origin}/spatial-review.html`);
  assert.equal(capture.status, 200);
  assert.match(capture.headers.get('content-security-policy'), /https:\/\/spatial-review\.alterno\.dev/);
  assert.match(capture.headers.get('content-security-policy'), /http:\/\/localhost:5174/);
  assert.equal(capture.headers.get('x-frame-options'), null);
  const script = await fetch(`${origin}/js/main.js`);
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  const missing = await fetch(`${origin}/missing.js`);
  assert.equal(missing.status, 404, 'missing files never return an HTML fallback');
});

test('server does not expose repository files or follow symlinks outside the built site', async (t) => {
  const { origin, root, temporary } = await fixture(t);
  await writeFile(path.join(temporary, 'private.js'), 'not public');
  await symlink(path.join(temporary, 'private.js'), path.join(root, 'js/escape.js'));
  for (const relative of ['.git/config', 'package-lock.json', 'node_modules/three/package.json', 'tools/data/osm_piers.json', 'js/escape.js']) {
    assert.equal((await fetch(`${origin}/${relative}`)).status, 404, relative);
  }
  const status = await new Promise((resolve, reject) => {
    const req = request(`${origin}/`, { path: '/js/%2e%2e/%2e%2e/private.js' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 400);
  assert.equal((await fetch(`${origin}/spatial-review.html`, { method: 'POST' })).status, 405);
});

test('additional framing origins must be exact local-development origins', () => {
  assert.throws(() => createSpatialReviewServer({ loopbackEditorOrigins: ['https://example.com'] }), /loopback/);
  assert.throws(() => createSpatialReviewServer({ loopbackEditorOrigins: ['http://localhost:*'] }), /loopback/);
});

test('repository discovery matches the installed protocol and development authorization', async () => {
  const payload = JSON.parse(await readFile(new URL('../.well-known/spatial-review.json', import.meta.url), 'utf8'));
  for (const base of ['http://localhost:5173/', 'http://localhost:5173/slop-newyork/']) {
    const discovery = normalizeSpatialReviewDiscovery(payload, `${base}.well-known/spatial-review.json`);
    assert.equal(discovery.websiteUrl, base);
    assert.equal(discovery.liveCapture, `${base}spatial-review.html`);
    const policy = discovery.capabilities.liveCapture.editorOriginPolicy;
    for (const origin of [OFFICIAL_EDITOR, 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://[::1]:5174']) {
      assert.equal(editorOriginPolicyAllows(policy, origin, discovery.liveCapture), true);
    }
    assert.equal(editorOriginPolicyAllows(policy, 'https://example.com', discovery.liveCapture), false);
  }
});
