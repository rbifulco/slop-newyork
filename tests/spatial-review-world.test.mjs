import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { SceneAssetRegistry } from '@alterno-dev/spatial-review';
import { withCaptureSeed, captureAllBlockDetails, bakePerson } from '../spatial-review/world-state.mjs';
import { splitReviewGeometry, partitionWorldSystems, createWorldMaterialAdapter } from '../spatial-review/world-partition.mjs';
import { describeSubject, registerReviewSubject } from '../spatial-review/registration.mjs';

const near = (a, b) => { assert.equal(a.length, b.length); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${v} != ${b[i]}`)); };
const dispose = items => new Set(items).forEach(o => o.dispose?.());

test('seeded construction repeats exactly and restores Math.random after failure', () => {
  const original = Math.random;
  const sample = () => Array.from({ length: 10 }, () => Math.random());
  assert.deepEqual(withCaptureSeed(123, sample), withCaptureSeed(123, sample));
  assert.notDeepEqual(withCaptureSeed(123, sample), withCaptureSeed(124, sample));
  assert.throws(() => withCaptureSeed(42, () => { throw Error('construction failed'); }));
  assert.equal(Math.random, original);
});

test('large geometry splitting preserves triangles, normals, UVs and material groups', () => {
  const geometry = new THREE.BoxGeometry(2, 3, 4);
  const parts = splitReviewGeometry(geometry, 9);
  assert.equal(parts.length, 4);
  const expected = [], actual = [];
  for (let i = 0; i < geometry.index.count; i++) {
    const v = geometry.index.getX(i);
    for (const k of ['position', 'normal', 'uv']) {
      const a = geometry.getAttribute(k);
      for (let j = 0; j < a.itemSize; j++) expected.push(a.getComponent(v, j));
    }
  }
  for (const part of parts) for (let i = 0; i < part.attributes.position.count; i++) {
    for (const k of ['position', 'normal', 'uv']) {
      const a = part.getAttribute(k);
      for (let j = 0; j < a.itemSize; j++) actual.push(a.getComponent(i, j));
    }
  }
  assert.deepEqual(actual, expected);
  const counts = parts.flatMap(g => g.groups).reduce((map, g) => map.set(g.materialIndex, (map.get(g.materialIndex) ?? 0) + g.count), new Map());
  for (const g of geometry.groups) assert.equal(counts.get(g.materialIndex), g.count);
  dispose([geometry, ...parts]);
});

function instancedFixture() {
  const root = new THREE.Group(); root.position.set(30, 2, -10);
  const geometry = new THREE.BoxGeometry(4, 6, 8), material = new THREE.MeshStandardMaterial({ color: 0x345678 });
  const mesh = new THREE.InstancedMesh(geometry, material, 3); mesh.name = 'source-buildings';
  const positions = [[10, 3, 10], [2010, 3, 10], [-2010, 3, -2010]];
  positions.forEach((p, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p)));
  root.add(mesh);
  return { root, mesh, geometry, material, positions };
}

test('spatial regions conserve every instance and its exact world placement', async () => {
  const f = instancedFixture(), owned = [], diagnostics = {};
  const subjects = await partitionWorldSystems([{ id: 'buildings', name: 'Buildings', sourceRef: 'js/buildings.js#buildCityBlocks', roots: [f.root] }], owned, diagnostics);
  assert.equal(subjects.length, 3);
  assert.equal(diagnostics.systems.buildings.sourceInstances, 3);
  assert.equal(diagnostics.systems.buildings.exportedInstances, 3);
  const worldPositions = [];
  for (const subject of subjects) {
    subject.root.updateMatrixWorld(true);
    assert.equal(subject.parentAssemblyId, 'world-buildings');
    assert.equal(subject.sourceRef, 'js/buildings.js#buildCityBlocks');
    for (const mesh of subject.root.children) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix); matrix.premultiply(mesh.matrixWorld);
      worldPositions.push(new THREE.Vector3().setFromMatrixPosition(matrix).toArray());
    }
  }
  assert.deepEqual(worldPositions.sort(), f.positions.map(p => [p[0] + 30, p[1] + 2, p[2] - 10]).sort());
  const again = await partitionWorldSystems([{ id: 'buildings', name: 'Buildings', sourceRef: 'js/buildings.js#buildCityBlocks', roots: [f.root] }], owned, {});
  assert.deepEqual(subjects.map(s => [s.actorId, describeSubject(s).bounds]), again.map(s => [s.actorId, describeSubject(s).bounds]));
  dispose([...owned, f.mesh, f.geometry, f.material]);
});

test('capture refuses non-finite source transforms and unbaked GPU crowds', async () => {
  const f = instancedFixture(), owned = [];
  const run = () => partitionWorldSystems([{ id: 'fixture', name: 'Fixture', sourceRef: 'js/fixture.js#build', roots: [f.root] }], owned, {});
  f.mesh.instanceMatrix.array[12] = NaN;
  await assert.rejects(run(), /Non-finite source transform/);
  f.mesh.instanceMatrix.array[12] = 0;
  f.geometry.setAttribute('skin', new THREE.Float32BufferAttribute(new Float32Array(f.geometry.attributes.position.count * 4), 4));
  await assert.rejects(run(), /Unbaked GPU crowd/);
  dispose([...owned, f.mesh, f.geometry, f.material]);
});

test('source shader approximations preserve supported material fields and reject secret-bearing texture URLs', () => {
  const source = new THREE.MeshStandardNodeMaterial({ color: 0x123456, roughness: .8, metalness: .2, transparent: true, opacity: .6 });
  const owned = [], diagnostics = {}, adapter = createWorldMaterialAdapter(owned, diagnostics);
  const converted = adapter.convert(source, 'js/fixture.js#material');
  assert.equal(converted.color.getHex(), 0x123456);
  assert.equal(converted.roughness, .8); assert.equal(converted.metalness, .2); assert.equal(converted.opacity, .6);
  assert.equal(converted.isNodeMaterial, undefined);
  const unsafe = source.clone(); unsafe.map = new THREE.Texture(); unsafe.map.userData.sourceRef = 'https://example.com/a.png?token=private';
  assert.throws(() => adapter.convert(unsafe, 'js/fixture.js#unsafe'), /Unsafe texture URL/);
  dispose([...owned, source, unsafe, unsafe.map]);
});

test('deferred overview and detail deliver different source geometries without changing actor identity', async () => {
  const nearRoot = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.MeshStandardMaterial());
  const farRoot = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 4), nearRoot.material);
  nearRoot.position.set(100, 0, -50); farRoot.position.copy(nearRoot.position);
  const subject = { actorId: 'tree-region', assetId: 'tree-region-design', name: 'Tree region', category: 'Trees', sourceRef: 'js/trees.js#createTreeField', root: nearRoot, overviewRoot: farRoot };
  const registry = new SceneAssetRegistry('world-test'); const release = registry.retainLiveReviewSession();
  try {
    const { registration } = registerReviewSubject(registry, subject, 'world-test');
    const [overview, detail] = registration.stream.representations;
    assert.ok(overview.triangles < detail.triangles); assert.ok(overview.estimatedBytes < detail.estimatedBytes);
    for (const id of ['overview', 'detail']) {
      const result = await registry.produceAssetRepresentation(subject.assetId, 'review', id, 16 * 1024 * 1024, 'interactive', new AbortController().signal);
      assert.equal(result.asset.id, subject.assetId); near(result.asset.sourceTransform.position, [100, 0, -50]);
      const triangles = result.asset.geometries.reduce((n, g) => n + (g.geometry.indices?.length ?? g.geometry.positions.length / 3) / 3, 0);
      assert.equal(triangles, id === 'overview' ? overview.triangles : detail.triangles);
    }
  } finally { release(); dispose([nearRoot.geometry, farRoot.geometry, nearRoot.material]); }
});

test('CPU crowd baking preserves a known two-bone pose and source pivot', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('skin', new THREE.Float32BufferAttribute([0, 1, .5, 4, 0, 1, .5, 4, 0, 1, .5, 4], 4));
  geometry.setAttribute('extra', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  for (const key of ['femaleDelta', 'hairDelta']) geometry.setAttribute(key, new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  const pose = new Float32Array([0, 0, 0, 1, 10, 2, 20, 1, 0, 0, 0, 1, 12, 4, 22, 1, 0, 0, 1, 0]);
  const person = bakePerson({ geometry, pose, seed: 7, x: 10, z: 20 });
  near(Array.from(person.geometry.attributes.position.array), [1, 3, 1, 2, 3, 1, 1, 4, 1]);
  near(person.position.toArray(), [10, 0, 20]);
  assert.equal(person.geometry.getAttribute('skin'), undefined);
  assert.equal(person.geometry.groups[0].materialIndex, 4);
  dispose([geometry, person.geometry, ...person.material]);
});

test('every block is captured independently of the ordinary radius and query function is restored', async () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const pools = Array.from({ length: 13 }, () => { const m = new THREE.InstancedMesh(geometry, material, 10); m.frustumCulled = false; m.count = 0; group.add(m); return m; });
  const original = () => []; const blocks = { group, allBlocks: [{ cx: 10, cz: 20 }, { cx: 3010, cz: -2020 }], quadtree: { queryRange: original }, update() {
    const block = this.quadtree.queryRange()[0]; pools[0].count = 1;
    pools[0].setMatrixAt(0, new THREE.Matrix4().makeTranslation(block.cx, 5, block.cz));
  } };
  const result = await captureAllBlockDetails(blocks);
  assert.equal(result.blocks, 2); assert.equal(result.instances.cornices, 2);
  assert.equal(blocks.quadtree.queryRange, original); assert.equal(group.children.length, 1);
  assert.equal(group.children[0].children.length, 2);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(partitionWorldSystems([], [], {}, { signal: abort.signal }), { name: 'AbortError' });
  dispose([...pools, ...group.children[0].children, geometry, material]);
});
