import * as THREE from 'three/webgpu';
import { buildLandmarkReview } from './landmarks.mjs';
import { yieldForCapture } from './registration.mjs';
import { withCaptureSeed, installMaterialHints, installTreeCapture, installCrowdCapture, captureAllBlockDetails, bakePerson } from './world-state.mjs';
import { partitionWorldSystems } from './world-partition.mjs';

export const WORLD_SOURCE_SCRIPTS = ['nyc-geodata', 'city-config', 'tsl-materials', 'trees',
  'actor-models', 'vehicle-lights', 'pedestrians', 'city-grid', 'boroughs', 'buildings',
  'landmarks', 'street-details', 'road-network', 'road-paint', 'traffic', 'controllers', 'cameras'];

// Must run immediately after each defining script, BEFORE downstream scripts
// capture references to its factories. Only the dedicated document calls this.
export function configureWorldSource(name, NYC, state) {
  if (name === 'tsl-materials') installMaterialHints(NYC);
  if (name === 'trees') installTreeCapture(NYC, state.owned);
  if (name === 'pedestrians') installCrowdCapture(NYC, state.crowds);
}

function allResources(root, set) {
  if (!root) return;
  if (root.isTexture || root.isMaterial || root.isBufferGeometry) set.add(root);
  if (!root.traverse) return;
  root.traverse(o => {
    if (o.isInstancedMesh) set.add(o);
    if (o.geometry) set.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      set.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) set.add(value);
    }
  });
}

// Observe the source update from fixed nearby viewpoints to collect its highest
// detail highway model for every above-ground car. dt=0 keeps lane state fixed;
// transforms, slope, underpass dips and wheels come from the actual renderer.
async function captureHighwayTraffic(highway, owned, signal) {
  const source = highway.group.children.filter(o => o.isInstancedMesh).slice(0, 9);
  if (source.length !== 9) throw new Error('Highway source LOD layout changed.');
  const near = [source[0], source[3], source[6]], collections = near.map(() => new Map());
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60000), cells = new Map();
  for (const c of highway.cars) {
    let i = 0; while (i < c.lane.cum.length - 2 && c.lane.cum[i + 1] < c.u) i++;
    const a = c.lane.pts[i], b = c.lane.pts[i + 1];
    const t = (c.u - c.lane.cum[i]) / (c.lane.cum[i + 1] - c.lane.cum[i]);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    const key = `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
    if (!cells.has(key)) cells.set(key, new THREE.Vector3(Math.floor(x / 100) * 100 + 50, y + 5, Math.floor(z / 100) * 100 + 50));
  }
  let mark = performance.now();
  const matrix = new THREE.Matrix4();
  for (const position of cells.values()) {
    signal?.throwIfAborted(); camera.position.copy(position); camera.lookAt(position.x, position.y, position.z + 1); camera.updateMatrixWorld(true);
    highway.update(0, camera, null, 'helicopter');
    near.forEach((mesh, k) => {
      const paint = mesh.geometry.getAttribute('paintColor');
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const key = matrix.elements.join(',');
        collections[k].set(key, { matrix: matrix.clone(), color: new THREE.Color().setRGB(paint.getX(i), paint.getY(i), paint.getZ(i)) });
      }
    });
    if (performance.now() - mark > 12) { await yieldForCapture(signal); mark = performance.now(); }
  }
  const group = new THREE.Group(); group.name = 'AllHighwayCars';
  collections.forEach((entries, k) => {
    const mesh = new THREE.InstancedMesh(near[k].geometry, near[k].material, entries.size);
    mesh.name = `highway-${['taxi', 'sedan', 'suv'][k]}`;
    [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([, e], i) => { mesh.setMatrixAt(i, e.matrix); mesh.setColorAt(i, e.color); });
    group.add(mesh);
  });
  owned.push(highway.group); highway.group.removeFromParent();
  return { group, sourceCars: highway.cars.length, visibleCars: collections.reduce((n, m) => n + m.size, 0) };
}

/** Construct real source systems; partition and serialize only in this iframe.
 * Initial bridge attachment happens after ALL catalog entries have been built. */
export async function buildWorldReview(NYC, { signal, onProgress = () => {}, state = { owned: [], crowds: [] } } = {}) {
  const scene = new THREE.Scene(), systems = [], owned = state.owned, diagnostics = { seed: 20261022, snapshotSeconds: 0.05, stages: {}, crowds: 0 };
  let landmarks, subjects = [], disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    const resources = new Set(); allResources(scene, resources);
    for (const item of owned) allResources(item, resources);
    for (const s of subjects) { allResources(s.root, resources); allResources(s.overviewRoot, resources); }
    for (const crowd of state.crowds) for (const mesh of crowd.meshes) allResources(mesh, resources);
    for (const resource of resources) resource.dispose?.();
    scene.clear(); landmarks?.dispose();
    state.crowds.length = 0;
  };
  async function stage(id, name, sourceRef, build) {
    signal?.throwIfAborted(); onProgress(name); await yieldForCapture(signal);
    const before = new Set(scene.children), start = performance.now();
    const result = withCaptureSeed(20261022 + systems.length * 997, build);
    diagnostics.stages[id] = { constructionMs: performance.now() - start };
    systems.push({ id, name, sourceRef, roots: scene.children.filter(o => !before.has(o)) });
    return result;
  }
  try {
    const grid = await stage('geography', 'Ground, roads, parks and waterfront', 'js/city-grid.js#buildCityGrid', () => NYC.buildCityGrid(scene));
    const boroughs = await stage('boroughs', 'Boroughs, bridges and islands', 'js/boroughs.js#buildBoroughs', () => NYC.buildBoroughs(scene, { sidewalks: grid.sidewalks }));
    boroughs.update(0.05);
    onProgress('Authored landmarks'); landmarks = await buildLandmarkReview(NYC, { signal });
    const blocks = await stage('buildings', 'Manhattan buildings', 'js/buildings.js#buildCityBlocks', () => NYC.buildCityBlocks(scene));
    onProgress('Architectural detail in every block');
    const detailsStart = performance.now();
    const details = await captureAllBlockDetails(blocks, { signal });
    owned.push(...details.retiredPools); delete details.retiredPools;
    diagnostics.blockDetails = details;
    diagnostics.stages.blockDetails = { constructionMs: performance.now() - detailsStart };
    const streets = await stage('streets', 'Trees and street furniture', 'js/street-details.js#buildStreetDetails', () => NYC.buildStreetDetails(scene));
    const colliders = [...landmarks.colliders, ...blocks.colliders, ...boroughs.colliders, ...(grid.colliders || [])];
    const traffic = await stage('traffic', 'Traffic and pedestrians', 'js/traffic.js#createTrafficSystem', () => NYC.createTrafficSystem(scene, grid.sidewalks,
      [...grid.footprints, ...streets.footprints, ...colliders.filter(c => !c.obb)]));
    // The source divides acceleration by dt: use three fixed 1/60 s steps,
    // then freeze. Zero dt would produce NaN vehicle transforms.
    withCaptureSeed(912731, () => { for (let i = 0; i < 3; i++) traffic.update(1 / 60, (i + 1) / 60, new THREE.Vector3(0, 0, 140)); });
    diagnostics.traffic = { cars: traffic.cars.length, buses: traffic.buses.length, pedestrians: traffic.peds.filter(p => p.placed).length };
    const highway = await stage('highways', 'Highway vehicles', 'js/traffic.js#createHighwayTraffic', () => NYC.createHighwayTraffic(scene, grid.highwayLanes));
    const highwaySnapshot = await captureHighwayTraffic(highway, owned, signal);
    scene.add(highwaySnapshot.group);
    systems.find(s => s.id === 'highways').roots = [highwaySnapshot.group];
    diagnostics.highwayTraffic = { sourceCars: highwaySnapshot.sourceCars, visibleCars: highwaySnapshot.visibleCars };
    await stage('markings', 'Road markings', 'js/road-paint.js#buildRoadPaint', () => NYC.buildRoadPaint(scene, traffic.network));
    await stage('players', 'Player vehicles and characters', 'js/controllers.js#ThirdPersonControllerManager', () => {
      // Call source factories without the constructor that binds keyboard input.
      const manager = Object.assign(Object.create(NYC.ThirdPersonControllerManager.prototype), { scene, colliders: [], activeMode: 'car' });
      manager.entities = { person: manager.createPersonEntity(), car: manager.createCarEntity(), cyclist: manager.createCyclistEntity(), helicopter: manager.createHelicopterEntity() };
      for (const entity of Object.values(manager.entities)) { entity.mesh.position.copy(entity.position); entity.mesh.rotation.y = entity.heading; }
      scene.updateMatrixWorld(true); manager.poseCharacters(0);
      return manager;
    });
    onProgress('Baking posed pedestrians');
    const people = new THREE.Group(); people.name = 'PosedPeople'; scene.add(people);
    for (const crowd of state.crowds) {
      for (const mesh of crowd.meshes) { mesh.removeFromParent(); owned.push(mesh); }
      for (const person of crowd.reviewPeople) {
        signal?.throwIfAborted(); people.add(bakePerson(person)); diagnostics.crowds++;
        if (diagnostics.crowds % 16 === 0) await yieldForCapture(signal);
      }
    }
    // Mesh references captured before removal must not re-export bind poses.
    for (const system of systems) system.roots = system.roots.filter(r => r.parent === scene);
    systems.push({ id: 'people', name: 'Posed pedestrians and riders', sourceRef: 'js/pedestrians.js#PersonRig', roots: [people] });
    onProgress('Preparing complete spatial catalog');
    subjects = await partitionWorldSystems(systems, owned, diagnostics, { signal });
    diagnostics.subjects = subjects.length + landmarks.subjects.length;
    diagnostics.landmarks = landmarks.diagnostics;
    diagnostics.scope = 'Source geometry for all world construction systems; deterministic 0.05 s traffic snapshot; TSL appearance approximated.';
    return { subjects: [...landmarks.subjects, ...subjects], assemblies: systems.map(s => ({ assemblyId: `world-${s.id}`, name: s.name, sourceRef: s.sourceRef,
      localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } })), diagnostics, dispose };
  } catch (error) { dispose(); throw error; }
}
