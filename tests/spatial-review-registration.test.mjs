import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { SceneAssetRegistry } from '@alterno-dev/spatial-review';
import { describeSubject, registerReviewSubject } from '../spatial-review/registration.mjs';

function near(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-8, `${message}: component ${index}, ${value} != ${expected[index]}`);
  });
}

function poseMatrix(pose) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pose.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation.map(THREE.MathUtils.degToRad), 'XYZ')),
    new THREE.Vector3(...pose.scale),
  );
}

function fixture() {
  const parent = new THREE.Group();
  parent.position.set(10, 1, -5);
  parent.rotation.y = Math.PI / 2;
  parent.scale.setScalar(2);
  const root = new THREE.Group();
  root.name = 'fixture-place';
  root.position.set(1, 2, 3);
  root.rotation.y = Math.PI / 2;
  root.scale.set(1, 2, 3);
  const geometry = new THREE.BoxGeometry(2, 4, 6);
  const material = new THREE.MeshStandardMaterial({ color: 0xaa7733 });
  material.name = 'fixture-stone';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'fixture-shaft';
  mesh.position.y = 1;
  root.add(mesh);
  parent.add(root);
  const subject = {
    actorId: 'fixture-placement', assetId: 'fixture-design', name: 'Fixture landmark',
    category: 'Landmarks', sourceRef: "js/landmarks.js#name: 'esb'", root,
  };
  return { subject, root, parent, mesh, geometry, dispose: () => { geometry.dispose(); material.dispose(); } };
}

test('metadata preserves an offset source pivot, world bounds and nonuniform scale', () => {
  const f = fixture();
  try {
    const metadata = describeSubject(f.subject);
    // Independent arithmetic: parent = T(10,1,-5) Ry(90) S(2), child =
    // T(1,2,3) Ry(90) S(1,2,3); shaft centre is one local metre above the pivot.
    near(metadata.transform.position, [16, 5, -7], 'source pivot');
    near(metadata.transform.scale, [2, 4, 6], 'world scale');
    near(metadata.bounds.center, [16, 9, -7], 'bounds centre differs from pivot');
    near(metadata.bounds.size, [4, 16, 36], 'world dimensions');
    const matrix = poseMatrix(metadata.transform);
    near(new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).toArray(), [14, 5, -7], 'world X');
    near(new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).toArray(), [16, 9, -7], 'world Y');
    near(new THREE.Vector3(0, 0, 1).applyMatrix4(matrix).toArray(), [16, 5, -13], 'world Z');
    assert.equal(metadata.triangles, 12);
    assert.ok(metadata.estimatedBytes > metadata.geometryBytes);
  } finally { f.dispose(); }
});

test('assembly catalog preserves parent-local placement and independently computed subtree bounds', () => {
  const f = fixture();
  try {
    const registry = new SceneAssetRegistry('ownership-fixture');
    registry.registerAssembly({
      assemblyId: 'fixture-owner', name: 'Fixture owner', sourceRef: 'js/landmarks.js#buildLandmarks',
      localTransform: { position: [10, 1, -5], rotation: [0, 90, 0], scale: [2, 2, 2] },
    });
    registerReviewSubject(registry, f.subject, 'ownership-fixture', 'fixture-owner');
    const scene = registry.toScene(true, true);
    assert.equal(scene.actors.length, 1);
    assert.equal(scene.assemblies.length, 1);
    const actor = scene.actors[0];
    assert.equal(actor.parentAssemblyId, 'fixture-owner');
    assert.equal(actor.actorId, 'fixture-placement');
    assert.equal(actor.assetId, 'fixture-design');
    near(actor.localTransform.position, [1, 2, 3], 'parent-local position');
    near(actor.localTransform.scale, [1, 2, 3], 'parent-local scale');
    near(scene.assemblies[0].bounds.center, [16, 9, -7], 'owner bounds centre');
    near(scene.assemblies[0].bounds.size, [4, 16, 36], 'owner bounds size');
    assert.equal('assetId' in scene.assemblies[0], false);

    const flat = registry.toScene(false, true);
    assert.equal(flat.ownership.mode, 'flattened');
    assert.equal(flat.actors[0].actorId, actor.actorId);
    assert.equal(flat.actors[0].parentAssemblyId, undefined);
    near(flat.actors[0].transform.position, [16, 5, -7], 'flat world placement');
  } finally { f.dispose(); }
});

test('deferred delivery keeps canonical geometry local and does not transfer source buffers', async () => {
  const f = fixture();
  const registry = new SceneAssetRegistry('delivery-fixture');
  const release = registry.retainLiveReviewSession();
  try {
    const { metadata } = registerReviewSubject(registry, f.subject, 'delivery-fixture');
    const catalog = registry.toReviewIndex('review', false, true, true, true);
    assert.equal(catalog.scene.actors.length, 1);
    assert.equal(catalog.assetCatalog.assets.length, 1);
    assert.equal(catalog.assetCatalog.assets[0].geometries, undefined);
    assert.equal(registry.deferredCacheMetrics.entries, 0);

    const result = await registry.produceAssetRepresentation(
      f.subject.assetId, 'review', 'detail', metadata.estimatedBytes, 'interactive', new AbortController().signal,
    );
    assert.equal(result.asset.id, 'fixture-design');
    assert.ok(result.bytes > 0 && result.bytes <= metadata.estimatedBytes);
    const shaft = result.asset.nodes.find((node) => node.name === 'fixture-shaft');
    near(shaft.position, [0, 1, 0], 'canonical component position');
    const geometry = result.asset.geometries.find((entry) => entry.id === shaft.geometryId).geometry;
    for (let axis = 0; axis < 3; axis += 1) {
      const values = Array.from(geometry.positions).filter((_, index) => index % 3 === axis);
      assert.equal(Math.min(...values), -[1, 2, 3][axis]);
      assert.equal(Math.max(...values), [1, 2, 3][axis]);
    }
    near(result.asset.sourceTransform.position, [16, 5, -7], 'separate source placement');
    assert.equal(result.transfer.includes(f.geometry.attributes.position.array.buffer), false);
    assert.ok(f.geometry.attributes.position.array.byteLength > 0);
    assert.equal(registry.toReviewIndex('review', false, false, false, false).scene.actors.length, 0,
      'deferred-only actors are intentionally absent for unsupported legacy peers');
  } finally { release(); f.dispose(); }
});

test('deferred cancellation stops before serialization and a subsequent request can succeed', async () => {
  const f = fixture();
  const registry = new SceneAssetRegistry('cancel-fixture');
  const release = registry.retainLiveReviewSession();
  try {
    const { metadata } = registerReviewSubject(registry, f.subject, 'cancel-fixture');
    const controller = new AbortController();
    const progress = [];
    const request = registry.produceAssetRepresentation(
      f.subject.assetId, 'review', 'detail', metadata.estimatedBytes, 'interactive', controller.signal,
      (event) => progress.push(event),
    );
    controller.abort(new DOMException('Fixture cancelled', 'AbortError'));
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(registry.deferredCacheMetrics.entries, 0);
    assert.deepEqual(progress, []);
    const retry = await registry.produceAssetRepresentation(
      f.subject.assetId, 'review', 'detail', metadata.estimatedBytes, 'interactive', new AbortController().signal,
    );
    assert.equal(retry.asset.id, f.subject.assetId);
  } finally { release(); f.dispose(); }
});

test('negotiated byte limits reject before allocating a representation', async () => {
  const f = fixture();
  try {
    const registry = new SceneAssetRegistry('budget-fixture');
    const { metadata } = registerReviewSubject(registry, f.subject, 'budget-fixture');
    let progressCalled = false;
    await assert.rejects(registry.produceAssetRepresentation(
      f.subject.assetId, 'review', 'detail', metadata.estimatedBytes - 1, 'interactive',
      new AbortController().signal, () => { progressCalled = true; },
    ), RangeError);
    assert.equal(progressCalled, false);
    assert.equal(registry.deferredCacheMetrics.entries, 0);
  } finally { f.dispose(); }
});

test('representation metadata does not advertise attributes absent from source geometry', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const material = new THREE.MeshBasicMaterial();
  const root = new THREE.Mesh(geometry, material);
  try {
    const registry = new SceneAssetRegistry('attributes-fixture');
    const { registration } = registerReviewSubject(registry, {
      actorId: 'triangle', assetId: 'triangle-design', name: 'Untextured triangle',
      category: 'Context', sourceRef: 'spatial-review/context.mjs#appendPolygon', root,
    }, 'attributes-fixture');
    for (const descriptor of registration.stream.representations) {
      assert.deepEqual(descriptor.attributes, ['position']);
    }
  } finally { geometry.dispose(); material.dispose(); }
});
