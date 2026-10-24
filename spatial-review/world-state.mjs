// Capture-only adapters for source systems whose live renderer streams or skins
// geometry. No game module is patched and no gameplay input listener is installed.
import * as THREE from 'three/webgpu';
import { yieldForCapture } from './registration.mjs';

export function withCaptureSeed(seed, construct) {
  const previous = Math.random;
  let value = seed >>> 0;
  Math.random = () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ value >>> 15, value | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  // Never keep the replacement installed over an await or a browser event.
  try { return construct(); } finally { Math.random = previous; }
}

/** Annotate the original factories; retain all their actual source geometry. */
export function installMaterialHints(NYC) {
  const hints = {
    createPreWarBuildingMaterial: o => o?.stoneColor ?? 0xb6a78f,
    createCurtainWallMaterial: o => o?.glassTint ?? 0x537184,
    createWaterMaterial: () => 0x2c5967,
    createRoadSurfaceMaterial: () => 0x474b4e,
    createSidewalkMaterial: () => 0xa4a29b,
    createCurbMaterial: () => 0xaaa89e,
    createParkLawnMaterial: () => 0x4f7941,
    createBillboardMaterial: () => 0xbbced8,
  };
  for (const [name, color] of Object.entries(hints)) {
    const original = NYC[name];
    if (!original) continue;
    NYC[name] = (...args) => {
      const material = original(...args);
      material.userData.reviewColor = color(...args);
      material.userData.reviewSource = `js/tsl-materials.js#${name}`;
      return material;
    };
  }
  // These are shader-only lighting/particles, not missing physical objects.
  for (const name of ['createContactShadowMaterial', 'createSteamMaterial', 'createGodRayMaterial', 'createCarFlareMaterial', 'createHeadlightBeamMaterial']) {
    const original = NYC[name];
    if (!original) continue;
    NYC[name] = (...args) => {
      const material = original(...args);
      material.userData.reviewEffectOnly = name;
      return material;
    };
  }
}

/** Use the source's own update to obtain EVERY block's streamed detail, once.
 * Isolating queryRange avoids the live radius, distance priority and pool caps.
 * A block is a source ownership boundary, not an invented low-detail proxy. */
export async function captureAllBlockDetails(blocks, { signal } = {}) {
  const pools = blocks.group.children.filter(o => o.isInstancedMesh && !o.frustumCulled);
  const names = ['cornices', 'water-tower-legs', 'water-tower-barrels', 'water-tower-roofs',
    'hvac', 'fire-escapes', 'awnings', 'bistro-signs', 'pharmacy-signs', 'bookshop-signs', 'deli-signs', 'watch-signs', 'scaffolds'];
  if (pools.length !== names.length) throw new Error(`Building detail source changed: expected ${names.length} pools, found ${pools.length}.`);
  const originalQuery = blocks.quadtree.queryRange;
  const root = new THREE.Group();
  root.name = 'AllBlockArchitecturalDetails';
  const counts = Object.fromEntries(names.map(n => [n, 0]));
  let mark = performance.now();
  try {
    for (const block of blocks.allBlocks) {
      signal?.throwIfAborted();
      blocks.quadtree.queryRange = () => [block];
      blocks.update(block.cx, block.cz, true);
      for (let k = 0; k < pools.length; k++) {
        const source = pools[k];
        if (!source.count) continue;
        if (source.count >= source.instanceMatrix.count) throw new Error(`One block exhausted the ${names[k]} pool; refusing a truncated capture.`);
        const copy = new THREE.InstancedMesh(source.geometry, source.material, source.count);
        copy.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, source.count * 16));
        if (source.instanceColor) copy.instanceColor = new THREE.InstancedBufferAttribute(source.instanceColor.array.slice(0, source.count * 3), 3);
        copy.name = names[k];
        copy.userData.reviewSource = 'js/buildings.js#update';
        copy.userData.sourceBlock = { cx: block.cx, cz: block.cz, ry: block.ry || 0 };
        root.add(copy);
        counts[names[k]] += source.count;
      }
      if (performance.now() - mark > 12) { await yieldForCapture(signal); mark = performance.now(); }
    }
  } catch (error) {
    root.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    throw error;
  } finally {
    blocks.quadtree.queryRange = originalQuery;
  }
  for (const pool of pools) pool.removeFromParent();
  blocks.group.add(root);
  return { blocks: blocks.allBlocks.length, instances: counts, retiredPools: pools };
}

/** Keep the source's highest-detail tree designs and the exact source placement
 * rules, but remove camera-radius/LOD suppression from this frozen capture. */
export function installTreeCapture(NYC, ownership) {
  const original = NYC.createTreeField;
  NYC.createTreeField = (scene, sites) => {
    const oldBeforeRender = scene.onBeforeRender;
    const field = original(scene, sites);
    scene.onBeforeRender = oldBeforeRender;
    ownership.push(...field.meshes);
    const sourceMeshes = field.meshes.filter(m => /_lod0$/.test(m.name));
    if (sourceMeshes.length !== NYC.TREE_SPECIES.length * 2) throw new Error('Source tree LOD layout changed.');
    const buckets = sourceMeshes.map(() => []);
    const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const dummy = new THREE.Object3D(), tint = new THREE.Color();
    for (const t of sites) {
      const species = Math.min(NYC.TREE_SPECIES.length - 1, Math.max(0, t.species || 0));
      const r1 = hash(t.x, 1.3, t.z), r2 = hash(t.z, 7.1, t.x), r3 = hash(t.x + t.z, 3.3, 0.7);
      const variant = hash(t.x, 5.9, t.z) < 0.5 ? 0 : 1;
      const s = t.scale * (0.9 + r1 * 0.2);
      dummy.position.set(t.x, t.y || 0, t.z);
      dummy.rotation.set(0, t.yaw ?? r2 * Math.PI * 2, 0);
      dummy.scale.set(s * (0.9 + r3 * 0.2) * (t.sx || 1), s * (0.88 + r1 * 0.24), s * (0.9 + r2 * 0.2) * (t.sz || 1));
      dummy.updateMatrix();
      tint.setHex(NYC.TREE_SPECIES[species].tints[Math.floor(r3 * 2.999)]).multiplyScalar(0.82 + r1 * 0.36);
      buckets[species * 2 + variant].push({ matrix: dummy.matrix.clone(), color: tint.clone() });
    }
    // Independently compare against the live source's already-populated LOD0s.
    // Failure is explicit rather than silently exporting a drifted formula.
    const actual = new THREE.Matrix4();
    for (let k = 0; k < sourceMeshes.length; k++) {
      const positions = new Map(buckets[k].map(b => [`${Math.fround(b.matrix.elements[12])},${Math.fround(b.matrix.elements[14])}`, b]));
      const source = sourceMeshes[k];
      for (let i = 0; i < source.count; i++) {
        source.getMatrixAt(i, actual);
        const entry = positions.get(`${actual.elements[12]},${actual.elements[14]}`);
        if (!entry || actual.elements.some((v, j) => Math.abs(v - Math.fround(entry.matrix.elements[j])) > 1e-5)) throw new Error('Tree placement capture differs from source.');
      }
    }
    field.group.clear();
    buckets.forEach((entries, k) => {
      if (!entries.length) return;
      const source = sourceMeshes[k];
      const copy = new THREE.InstancedMesh(source.geometry, field.material, entries.length);
      copy.name = source.name;
      copy.userData.reviewTreeAtlas = field.atlas.texture;
      copy.userData.reviewOverviewGeometry = field.meshes.find(m => m.name === source.name.replace(/_v[01]_lod0$/, '_lod2')).geometry;
      copy.userData.reviewSource = 'js/trees.js#createTreeField';
      entries.forEach((e, i) => { copy.setMatrixAt(i, e.matrix); copy.setColorAt(i, e.color); });
      field.group.add(copy);
    });
    ownership.push(field.atlas.texture);
    field.update = () => false;
    return field;
  };
}

/** Intercept the original rig poses without replacing gait or animation code. */
export function installCrowdCapture(NYC, crowds) {
  const Original = NYC.PersonCrowd;
  NYC.PersonCrowd = class ReviewCrowd extends Original {
    constructor(...args) { super(...args); this.reviewPeople = []; crowds.push(this); }
    begin() { super.begin(); this.reviewPeople.length = 0; }
    add(rig, distance = 0) {
      super.add(rig, distance);
      const detail = distance > this.farDistance ? 1 : 0;
      this.reviewPeople.push({ geometry: this.lods[detail].mesh.geometry, pose: rig.pose.slice(), seed: rig.seed, x: rig.x, z: rig.z });
    }
  };
}

/** CPU equivalent of js/pedestrians.js#createPersonMaterial's positionNode.
 * The protocol cannot serialize arbitrary GPU storage-buffer skinning. */
export function bakePerson({ geometry, pose, seed, x = 0, z = 0 }) {
  const { position, normal, skin, extra, femaleDelta, hairDelta } = geometry.attributes;
  const info = pose.subarray(pose.length - 4), p = new THREE.Vector3(), n = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const positions = new Float32Array(position.count * 3), normals = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const amount = Math.max(0, Math.min(1, info[3] * 2 - (skin.getW(i) >= 6.5 ? 1 : 0)));
    p.fromBufferAttribute(position, i);
    p.x += extra.getX(i) * (info[2] - 1);
    p.z += extra.getY(i) * (info[2] - 1);
    p.addScaledVector(a.fromBufferAttribute(femaleDelta, i), info[1]);
    p.addScaledVector(a.fromBufferAttribute(hairDelta, i), amount);
    n.fromBufferAttribute(normal, i);
    const ia = Math.round(skin.getX(i)) * 8, ib = Math.round(skin.getY(i)) * 8, weight = skin.getZ(i);
    qa.fromArray(pose, ia); qb.fromArray(pose, ib);
    a.copy(p).applyQuaternion(qa).multiplyScalar(pose[ia + 7]).add(b.fromArray(pose, ia + 4));
    b.copy(p).applyQuaternion(qb).multiplyScalar(pose[ib + 7]).add(p.fromArray(pose, ib + 4));
    a.lerp(b, weight); a.x -= x; a.z -= z; a.toArray(positions, i * 3);
    na.copy(n).applyQuaternion(qa); nb.copy(n).applyQuaternion(qb);
    na.lerp(nb, weight).normalize().toArray(normals, i * 3);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  // Preserve actual body-part boundaries. Source skin/extra attributes encode
  // skeletal and shader inputs, so keep the declared body-part palette approximation.
  const buckets = Array.from({ length: 8 }, () => []);
  const count = geometry.index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map(k => geometry.index ? geometry.index.getX(i + k) : i + k);
    buckets[Math.max(0, Math.min(7, Math.round(skin.getW(tri[0]))))].push(...tri);
  }
  const indices = []; buckets.forEach((bucket, i) => { if (bucket.length) { result.addGroup(indices.length, bucket.length, i); indices.push(...bucket); } });
  result.setIndex(indices);
  const palette = [0x394e65, 0x343a43, 0x292927, 0x394e65, 0xb98867, 0xb98867, 0x3d3028, 0x3d3028];
  const materials = palette.map((color, i) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, name: `person-part-${i}-shader-approximation` }));
  const root = new THREE.Mesh(result, materials);
  root.position.set(x, 0, z);
  root.name = `person-seed-${seed}`;
  root.userData.reviewSource = 'js/pedestrians.js#createPersonMaterial';
  result.computeBoundingBox();
  return root;
}
