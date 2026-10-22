import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { buildLandmarkReview } from '../spatial-review/landmarks.mjs';
import { buildGeographicContext } from '../spatial-review/context.mjs';

function captureSource() {
  const context2D = { fillRect() {}, strokeRect() {}, fillText() {} };
  const document = { createElement: () => ({ getContext: () => context2D }) };
  const unsupported = () => { throw new Error('Capture must not construct unsupported TSL shader resources'); };
  const NYC = { THREE, createPreWarBuildingMaterial: unsupported,
    createCurtainWallMaterial: unsupported, createChryslerCrownMaterial: unsupported,
    createBillboardMaterial: unsupported, createFacadeBoxes: unsupported,
    batchStaticGroupMeshes: unsupported };
  const context = vm.createContext({ window: { NYC }, document });
  for (const file of ['nyc-geodata.js', 'city-config.js', 'landmarks.js']) {
    vm.runInContext(readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  return NYC;
}

test('landmark capture retains source model parts, fitted heights, colors and generated sign map', async () => {
  const NYC = captureSource();
  const result = await buildLandmarkReview(NYC);
  assert.equal(result.subjects.length, 11);
  assert.equal(new Set(result.subjects.map((entry) => entry.actorId)).size, 11);
  const heights = { esb: 443, chrysler: 319, vanderbilt: 427, gct: 246, bryant: 30,
    timessquare: 120, rockefeller: 259, citigroup: 279, flatiron: 87, seagram: 157, owtc: 541 };
  for (const subject of result.subjects) {
    const bounds = new THREE.Box3().setFromObject(subject.root);
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - heights[subject.key]) < 0.001, `${subject.key} source height`);
    assert.ok(subject.root.children.length > 0, `${subject.key} keeps an independent hierarchy`);
    const names = [];
    subject.root.traverse((object) => {
      if (object.isMesh) {
        names.push(object.name);
        assert.ok(subject.componentSources[object.name]?.startsWith('js/landmarks.js#'));
        assert.ok(!object.material.isNodeMaterial, 'capture exports standard supported materials');
      }
    });
    assert.equal(new Set(names).size, names.length, `${subject.key} components have semantic identities`);
  }
  const esb = result.subjects.find((entry) => entry.key === 'esb');
  const podium = esb.root.getObjectByName('esb/podium');
  assert.deepEqual([podium.geometry.parameters.width, podium.geometry.parameters.height, podium.geometry.parameters.depth], [68, 22, 50]);
  assert.deepEqual(podium.position.toArray(), [0, 11, 0]);
  assert.equal(podium.material.color.getHex(), 0xdad0bc, 'stone source tint survives the procedural material fallback');
  const gct = result.subjects.find((entry) => entry.key === 'gct');
  const sign = gct.root.getObjectByName('gct/signBand');
  assert.equal(sign.material.map.image.width, 512);
  assert.equal(sign.material.map.image.height, 128);
  assert.equal(sign.material.map.name, 'metlifeSignTex');
  assert.equal(sign.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(result.diagnostics.textureCount, 1);

  const geometries = new Set(), materials = new Set(), textures = new Set();
  result.group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
    if (object.material?.map) textures.add(object.material.map);
  });
  const counts = new Map();
  for (const resource of [...geometries, ...materials, ...textures]) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  result.dispose();
  result.dispose();
  for (const count of counts.values()) assert.equal(count, 1, 'owned resources disposed once');
  assert.equal(result.group.children.length, 0);
});

test('landmark identities and placement transforms are reproducible across fresh captures', async () => {
  const first = await buildLandmarkReview(captureSource());
  const second = await buildLandmarkReview(captureSource());
  const inventory = (result) => result.subjects.map(({ actorId, assetId, sourceRef, root, componentSources }) => ({
    actorId, assetId, sourceRef, position: root.position.toArray(), scale: root.scale.toArray(), componentSources
  }));
  assert.equal(JSON.stringify(inventory(first)), JSON.stringify(inventory(second)));
  first.dispose(); second.dispose();
});

test('geographic proxies retain actual Manhattan extent without the source 60 km water plane', async () => {
  const NYC = captureSource();
  const result = await buildGeographicContext(NYC);
  assert.equal(result.subjects.length, 3);
  const land = result.subjects.find((entry) => entry.actorId === 'context-manhattan-coastline');
  const bounds = land.root.geometry.boundingBox;
  assert.equal(bounds.min.x, NYC.ISLAND_BOUNDS.minX);
  assert.equal(bounds.max.x, NYC.ISLAND_BOUNDS.maxX);
  assert.equal(bounds.min.z, NYC.ISLAND_BOUNDS.minZ);
  assert.equal(bounds.max.z, NYC.ISLAND_BOUNDS.maxZ);
  assert.equal(bounds.min.y, 0);
  assert.ok(result.diagnostics.triangleCount > 1000);
  assert.ok(result.subjects.every((entry) => entry.tags.includes('context-proxy')));
  result.dispose();
  assert.equal(result.group.children.length, 0);
});

test('cancelled geographic capture constructs no publishable representation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildGeographicContext(captureSource(), { signal: controller.signal }), { name: 'AbortError' });
});

test('landmark cancellation between source-building steps disposes partial geometry, materials and the unused sign texture', async () => {
  const NYC = captureSource();
  const originalSteps = NYC.buildLandmarkSteps;
  const disposals = new Map();
  const track = (resource) => {
    if (!resource || disposals.has(resource)) return;
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
  };
  let textureCount = 0;
  NYC.buildLandmarkSteps = (scene, options) => originalSteps(scene, {
    ...options,
    onReviewObject: (object) => {
      track(object.geometry);
      track(object.material);
      options.onReviewObject(object);
    },
    onReviewMaterial: (material) => {
      track(material);
      if (material.map && !disposals.has(material.map)) { track(material.map); textureCount++; }
      options.onReviewMaterial(material);
    }
  });
  const controller = new AbortController();
  const pending = buildLandmarkReview(NYC, { signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(disposals.size > 10, 'some source geometry was constructed before cancellation');
  assert.equal(textureCount, 1, 'the initial sign texture is tracked even before Grand Central is built');
  for (const count of disposals.values()) assert.equal(count, 1);
});
