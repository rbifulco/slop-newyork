import * as THREE from 'three/webgpu';
import { yieldForCapture } from './registration.mjs';

const CELL = 1000;
const MAX_ASSET_ESTIMATE = 6 * 1024 * 1024;
const MAX_GEOMETRY_VERTICES = 60000;
const MAP_SLOTS = ['map', 'alphaMap', 'normalMap', 'emissiveMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'bumpMap'];
const slug = text => text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'part';

function hashValues(values) {
  let h = 2166136261;
  for (const value of values) { h ^= Math.round(value * 10000); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Keep the established region packet boundaries: adding color transport must
// not retarget existing actor/component feedback. This is an identity partition
// weight, not a transfer estimate. describeSubject() counts all exported color
// bytes and the SDK enforces the unchanged 16 MiB actual response ceiling.
function partitionWeight(g) {
  return ['position', 'normal', 'uv'].reduce((n, k) => n + (g.getAttribute(k)?.count ?? 0) * (g.getAttribute(k)?.itemSize ?? 0) * 4, 0) + (g.index?.count ?? 0) * 4;
}

/** Split oversized geometry without dropping any triangles or material groups. */
export function splitReviewGeometry(source, maxVertices = MAX_GEOMETRY_VERTICES) {
  const count = source.index?.count ?? source.attributes.position.count;
  if (count <= maxVertices) return [source];
  const limit = Math.max(3, Math.floor(maxVertices / 3) * 3), result = [];
  for (let start = 0; start < count; start += limit) {
    const end = Math.min(count, start + limit), geometry = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'uv', 'color']) {
      const input = source.getAttribute(key);
      if (!input) continue;
      const values = new Float32Array((end - start) * input.itemSize);
      for (let i = start; i < end; i++) {
        const vertex = source.index ? source.index.getX(i) : i;
        for (let k = 0; k < input.itemSize; k++) values[(i - start) * input.itemSize + k] = input.getComponent(vertex, k);
      }
      geometry.setAttribute(key, new THREE.BufferAttribute(values, input.itemSize));
    }
    for (const group of source.groups) {
      const lo = Math.max(start, group.start), hi = Math.min(end, group.start + group.count);
      if (hi > lo) geometry.addGroup(lo - start, hi - lo, group.materialIndex);
    }
    geometry.name = `${source.name || source.type}-triangles-${start / 3}-${end / 3}`;
    result.push(geometry);
  }
  return result;
}

function treeGeometry(source) {
  const g = source.clone(), tree = g.getAttribute('aTree');
  const count = g.index?.count ?? g.attributes.position.count;
  const groups = [[], []];
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map(k => g.index ? g.index.getX(i + k) : i + k);
    groups[tree.getX(tri[0]) > 0.5 ? 1 : 0].push(...tri);
  }
  g.clearGroups();
  g.setIndex(groups.flat());
  let offset = 0;
  groups.forEach((indices, i) => { if (indices.length) g.addGroup(offset, indices.length, i); offset += indices.length; });
  return g;
}

/** Export supported appearance fields. Custom TSL is deliberately not evaluated. */
export function createWorldMaterialAdapter(owned, diagnostics) {
  const converted = new Map(), treeGeometries = new Map(), alphaMaps = new Map();
  const sources = diagnostics.materialSources = {};
  function convert(source, sourceRef, tint = null) {
    const tintKey = tint ? tint.map(v => Math.round(Math.max(0, Math.min(1, v)) * 15)).join('-') : '';
    let variants = converted.get(source);
    if (!variants) converted.set(source, variants = new Map());
    if (variants.has(tintKey)) return variants.get(tintKey);
    const basic = source.isMeshBasicMaterial || source.isMeshBasicNodeMaterial;
    const material = basic ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial();
    material.color.copy(source.color ?? new THREE.Color(0x8e9598));
    if (source.userData.reviewColor !== undefined) material.color.setHex(source.userData.reviewColor);
    else if (source.isNodeMaterial && source.colorNode && !source.vertexColors && material.color.getHex() === 0xffffff) material.color.setHex(0x929b9f);
    if (tint) material.color.setRGB(...tintKey.split('-').map(v => Number(v) / 15));
    if (!basic) {
      material.roughness = source.roughness ?? 0.7; material.metalness = source.metalness ?? 0;
      if (source.emissive) material.emissive.copy(source.emissive);
      material.emissiveIntensity = source.emissiveIntensity ?? 1;
    }
    // Road-marking RGB is visible color; paint/side are custom shader inputs.
    // Preserve the source opt-in without interpreting every attribute as color.
    for (const key of ['vertexColors', 'opacity', 'transparent', 'alphaTest', 'side', 'depthWrite', 'depthTest', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits']) {
      if (source[key] !== undefined) material[key] = source[key];
    }
    for (const slot of MAP_SLOTS) {
      const texture = source[slot];
      if (!texture?.isTexture) continue;
      for (const url of [texture.userData?.sourceRef, texture.userData?.requestUrl, texture.image?.src, texture.image?.currentSrc].filter(Boolean)) {
        const parsed = new URL(url, globalThis.document?.baseURI ?? 'https://capture.invalid/');
        if (parsed.username || parsed.password || parsed.search || !['https:', 'http:', 'data:', 'blob:'].includes(parsed.protocol)) throw new Error(`Unsafe texture URL in ${sourceRef}/${slot}`);
      }
      material[slot] = texture;
    }
    const ref = source.userData.reviewSource ?? sourceRef;
    // Keep the pre-upgrade material ID even when visible road RGB now replaces
    // its former neutral approximation. Names are feedback identity inputs.
    const identityColor = !tint && source.vertexColors && source.isNodeMaterial && source.colorNode &&
      source.userData.reviewColor === undefined && source.color?.getHex() === 0xffffff ? '929b9f' : material.color.getHexString();
    material.name = `${source.name || ref.split('#')[1] || source.type}-${identityColor}${source.isNodeMaterial ? '-approximation' : ''}`;
    sources[material.name] = { sourceRef: ref, customShaderApproximation: Boolean(source.isNodeMaterial), quantizedInstanceTint: Boolean(tint), maps: MAP_SLOTS.filter(k => material[k]) };
    variants.set(tintKey, material); owned.push(material);
    return material;
  }
  function materialsAndGeometry(object, sourceRef, tint) {
    const atlas = object.userData.reviewTreeAtlas;
    if (!atlas) return { geometry: object.geometry, materials: (Array.isArray(object.material) ? object.material : [object.material]).map(m => convert(m, sourceRef, tint)) };
    let geometry = treeGeometries.get(object.geometry);
    if (!geometry) { geometry = treeGeometry(object.geometry); treeGeometries.set(object.geometry, geometry); owned.push(geometry); }
    // The atlas's alpha is coverage, not its color. Convert it to alphaMap's
    // luminance channel, and keep bark opaque with a separate material group.
    let alpha = alphaMaps.get(atlas);
    if (!alpha) {
      const source = atlas.image;
      const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!source.data) ctx.drawImage(source, 0, 0);
      const pixels = source.data ? new ImageData(new Uint8ClampedArray(source.data), source.width, source.height) : ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) { const v = pixels.data[i + 3]; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255; }
      ctx.putImageData(pixels, 0, 0);
      alpha = new THREE.CanvasTexture(canvas); alpha.flipY = atlas.flipY; alpha.name = 'TreeLeafCoverage'; alphaMaps.set(atlas, alpha); owned.push(alpha);
    }
    const bark = convert(object.material, 'js/trees.js#buildTreeGeometries', [0.13, 0.10, 0.07]);
    const leaves = convert(object.material, 'js/trees.js#createTreeField', tint ?? [0.14, 0.28, 0.08]);
    leaves.alphaMap = alpha; leaves.transparent = true; leaves.side = THREE.DoubleSide;
    let overviewGeometry = treeGeometries.get(object.userData.reviewOverviewGeometry);
    if (!overviewGeometry) { overviewGeometry = treeGeometry(object.userData.reviewOverviewGeometry); treeGeometries.set(object.userData.reviewOverviewGeometry, overviewGeometry); owned.push(overviewGeometry); }
    return { geometry, overviewGeometry, materials: [bark, leaves] };
  }
  return { convert, materialsAndGeometry };
}

// Coalesce repeated source designs within each streaming region. The original
// per-block detail pools otherwise create tens of thousands of draw nodes.
function coalesceInstances(meshes, owned) {
  const groups = new Map(), output = [];
  for (const mesh of meshes) {
    if (!mesh.isInstancedMesh) { output.push(mesh); continue; }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const key = `${mesh.geometry.id}:${materials.map(m => m.id).join(',')}:${mesh.userData.sourceNode}:${mesh.userData.reviewSource}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  }
  const matrix = new THREE.Matrix4();
  for (const sources of groups.values()) {
    if (sources.length === 1) { output.push(sources[0]); continue; }
    const first = sources[0], total = sources.reduce((n, m) => n + m.count, 0);
    let sourceIndex = 0, instanceIndex = 0;
    for (let start = 0; start < total; start += 8192) {
      const count = Math.min(8192, total - start);
      const mesh = new THREE.InstancedMesh(first.geometry, first.material, count);
      mesh.name = `${first.name}-batch-${start / 8192}`;
      mesh.userData.reviewSource = first.userData.reviewSource;
      mesh.userData.sourceNode = first.userData.sourceNode;
      const far = first.userData.reviewOverview;
      const overview = far ? new THREE.InstancedMesh(far.geometry, far.material, count) : null;
      for (let i = 0; i < count; i++) {
        while (instanceIndex >= sources[sourceIndex].count) { sourceIndex++; instanceIndex = 0; }
        sources[sourceIndex].getMatrixAt(instanceIndex++, matrix);
        mesh.setMatrixAt(i, matrix); overview?.setMatrixAt(i, matrix);
      }
      if (overview) { overview.name = mesh.name; mesh.userData.reviewOverview = overview; owned.push(overview); }
      output.push(mesh); owned.push(mesh);
    }
  }
  return output;
}

/** Spatial batching preserves actual mesh/instance geometry, not box proxies.
 * Instance transforms remain in Asset nodes; regions are streaming/selection
 * units and are not misrepresented as independently authored buildings. */
export async function partitionWorldSystems(systems, owned, diagnostics, { signal } = {}) {
  const adapter = createWorldMaterialAdapter(owned, diagnostics);
  signal?.throwIfAborted();
  const subjects = [], splitCache = new Map(), nodeOccurrences = new Map();
  diagnostics.systems = {};
  const geometryParts = geometry => {
    if (!splitCache.has(geometry)) {
      const parts = splitReviewGeometry(geometry);
      if (parts[0] !== geometry) owned.push(...parts);
      splitCache.set(geometry, parts);
    }
    return splitCache.get(geometry);
  };
  for (const system of systems) {
    signal?.throwIfAborted();
    const cells = new Map(), stats = { transportNodes: 0, sourceMeshes: 0, sourceInstances: 0, exportedMeshes: 0, exportedInstances: 0, excludedEffects: {}, triangles: 0 };
    diagnostics.systems[system.id] = stats;
    const add = (key, object) => { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(object); };
    const list = [];
    for (const root of system.roots) { root.updateWorldMatrix(true, true); root.traverse(o => { if (o.isMesh && o.geometry?.getAttribute('position')) list.push(o); }); }
    let mark = performance.now();
    for (const object of list) {
      signal?.throwIfAborted();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const effect = materials.find(m => m?.userData.reviewEffectOnly)?.userData.reviewEffectOnly;
      if (effect || materials.some(m => m?.isSpriteNodeMaterial)) { const why = effect || 'GPU sprite'; stats.excludedEffects[why] = (stats.excludedEffects[why] ?? 0) + 1; continue; }
      if (object.isInstancedMesh && object.count === 0) continue;
      if (!object.visible) continue;
      // Raw storage-buffer crowds must have been CPU baked, never silently
      // serialized as a single bind-pose mesh at the origin.
      if (object.geometry.getAttribute('skin')) throw new Error(`Unbaked GPU crowd: ${object.name}`);
      stats.sourceMeshes++;
      const sourceRef = object.userData.reviewSource || system.sourceRef;
      const matrix = new THREE.Matrix4(), world = new THREE.Matrix4(), center = new THREE.Vector3();
      const groups = new Map();
      const count = object.isInstancedMesh ? object.count : 1;
      if (object.isInstancedMesh) stats.sourceInstances += count;
      const colorAttr = object.instanceColor ?? object.geometry.getAttribute('paintColor') ?? object.geometry.getAttribute('bTint');
      const bounds = object.geometry.boundingBox ?? (object.geometry.computeBoundingBox(), object.geometry.boundingBox);
      for (let i = 0; i < count; i++) {
        if (object.isInstancedMesh) object.getMatrixAt(i, matrix); else matrix.identity();
        world.multiplyMatrices(object.matrixWorld, matrix);
        if (!world.elements.every(Number.isFinite)) throw new Error(`Non-finite source transform: ${system.id}/${object.name || object.type}/${i}`);
        if (Math.abs(world.determinant()) < 1e-15) continue; // source warmup placeholder, not a placement
        bounds.getCenter(center).applyMatrix4(world);
        const x = Math.floor(center.x / CELL), z = Math.floor(center.z / CELL), cell = `${x},${z}`;
        const tint = colorAttr && object.isInstancedMesh ? [colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i)] : null;
        const tintKey = tint ? tint.map(v => Math.round(Math.max(0, Math.min(1, v)) * 15)).join('-') : '';
        const key = `${cell}:${tintKey}`;
        if (!groups.has(key)) groups.set(key, { cell, x, z, tint, matrices: [], sourceIndices: [] });
        const entry = groups.get(key);
        const local = world.clone(); local.elements[12] -= x * CELL; local.elements[14] -= z * CELL;
        entry.matrices.push(local); entry.sourceIndices.push(i);
      }
      for (const entry of groups.values()) {
        const converted = adapter.materialsAndGeometry(object, sourceRef, entry.tint);
        const parts = geometryParts(converted.geometry);
        if (converted.overviewGeometry && parts.length !== 1) throw new Error('Tree source geometry exceeded the supported overview boundary.');
        for (let p = 0; p < parts.length; p++) {
          const geometry = parts[p];
          const mesh = object.isInstancedMesh ? new THREE.InstancedMesh(geometry, converted.materials, entry.matrices.length) : new THREE.Mesh(geometry, converted.materials);
          if (mesh.isInstancedMesh) entry.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          else entry.matrices[0].decompose(mesh.position, mesh.quaternion, mesh.scale);
          mesh.name = `${slug(object.name || system.id)}-${hashValues(entry.matrices[0].elements)}-surface-${p}`;
          // Same-pivot surfaces (for example facade and trim) still need unique,
          // deterministic component names. Source traversal order is fixed.
          const nodeKey = `${system.id}:${entry.cell}:${mesh.name}`;
          const occurrence = nodeOccurrences.get(nodeKey) ?? 0;
          nodeOccurrences.set(nodeKey, occurrence + 1);
          if (occurrence) mesh.name += `-part-${occurrence}`;
          mesh.userData.reviewSource = sourceRef;
          mesh.userData.sourceIndices = entry.sourceIndices;
          mesh.userData.sourceNode = object.name || object.type;
          if (converted.overviewGeometry) {
            const overview = new THREE.InstancedMesh(converted.overviewGeometry, converted.materials, entry.matrices.length);
            entry.matrices.forEach((m, i) => overview.setMatrixAt(i, m)); overview.name = mesh.name;
            mesh.userData.reviewOverview = overview; owned.push(overview);
          }
          add(entry.cell, mesh); owned.push(mesh);
          stats.exportedMeshes++;
          if (mesh.isInstancedMesh && p === 0) stats.exportedInstances += mesh.count;
          stats.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
        }
      }
      if (performance.now() - mark > 12) { await yieldForCapture(signal); mark = performance.now(); }
    }
    for (const [cell, sourceMeshes] of [...cells.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const meshes = coalesceInstances(sourceMeshes, owned);
      stats.transportNodes += meshes.length;
      const [x, z] = cell.split(',').map(Number);
      meshes.sort((a, b) => a.name.localeCompare(b.name));
      let root, overviewRoot, size, geometries, packet = 0;
      function beginPacket() {
        root = new THREE.Group(); root.position.set(x * CELL, 0, z * CELL); root.name = `${system.name} · region ${cell} · ${packet}`;
        overviewRoot = new THREE.Group(); overviewRoot.position.copy(root.position); overviewRoot.name = root.name;
        size = 16384; geometries = new Set();
        const id = `world-${system.id}-${x}-${z}-${packet++}`;
        subjects.push({ actorId: id, assetId: `${id}-design`, name: root.name, category: system.name,
          sourceRef: system.sourceRef, root, overviewRoot, tags: ['source-geometry', 'spatial-streaming-region', 'material-approximation'],
          componentSources: {}, parentAssemblyId: `world-${system.id}` });
      }
      beginPacket();
      for (const mesh of meshes) {
        const bytes = (geometries.has(mesh.geometry) ? 0 : partitionWeight(mesh.geometry)) + (mesh.isInstancedMesh ? mesh.count * 256 : 0) + 4096;
        if (root.children.length && (size + bytes > MAX_ASSET_ESTIMATE || root.children.length >= 160)) beginPacket();
        root.add(mesh);
        const overview = mesh.userData.reviewOverview ?? mesh.clone(false);
        overviewRoot.add(overview); owned.push(overview);
        geometries.add(mesh.geometry); size += bytes;
        subjects.at(-1).componentSources[mesh.name] = mesh.userData.reviewSource;
      }
    }
    await yieldForCapture(signal);
  }
  return subjects;
}
