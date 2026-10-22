import * as THREE from 'three/webgpu';
import { SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY } from '@alterno-dev/spatial-review';

// Metadata describes the real capture root; placement never gets baked into the
// canonical asset geometry. The SDK reconstructs the same frame on delivery.
export function describeSubject(subject) {
  const root = subject.root;
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error(`Review subject ${subject.actorId} has no geometry.`);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  root.matrixWorld.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  const geometries = new Set();
  const attributes = new Set();
  let triangles = 0, nodes = 0, geometryBytes = 0, instanceBytes = 0;
  root.traverse((object) => {
    nodes++;
    if (object.isInstancedMesh) instanceBytes += object.count * 256;
    const geometry = object.geometry;
    if (!geometry?.attributes?.position) return;
    triangles += Math.floor((geometry.index?.count ?? geometry.attributes.position.count) / 3) * (object.isInstancedMesh ? object.count : 1);
    if (geometries.has(geometry)) return;
    geometries.add(geometry);
    for (const key of ['position', 'normal', 'uv']) {
      const attribute = geometry.getAttribute(key);
      if (attribute) {
        attributes.add(key);
        geometryBytes += attribute.count * attribute.itemSize * 4;
      }
    }
    if (geometry.index) geometryBytes += geometry.index.count * 4;
  });
  // Includes typed geometry, component/material metadata and structured clone
  // overhead. The SDK checks the actual transfer size against the request cap.
  const estimatedBytes = Math.ceil(geometryBytes * 1.1 + instanceBytes + nodes * 4096 + 32768);
  return {
    transform: { position: position.toArray(), rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg), scale: scale.toArray() },
    bounds: { center: box.getCenter(new THREE.Vector3()).toArray(), size: box.getSize(new THREE.Vector3()).toArray() },
    estimatedBytes, geometryBytes, instanceBytes, triangles, nodes, attributes: [...attributes],
  };
}

export async function yieldForCapture(signal) {
  signal?.throwIfAborted();
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else await new Promise((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}

export function registerReviewSubject(registry, subject, buildId, parentAssemblyId) {
  const metadata = describeSubject(subject);
  const overview = subject.overviewRoot ? describeSubject({ ...subject, root: subject.overviewRoot }) : metadata;
  const revision = `${buildId}:${subject.assetId}`;
  const registration = {
    actorId: subject.actorId, assetId: subject.assetId, name: subject.name,
    category: subject.category, sourceRef: subject.sourceRef,
    tags: subject.tags ?? [], parentAssemblyId,
    transform: metadata.transform, bounds: metadata.bounds,
    stream: {
      capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
      revision,
      representations: ['overview', 'detail'].map((purpose) => ({
        id: purpose, purpose, revision: `${revision}:${purpose}`,
        estimatedBytes: (purpose === 'overview' ? overview : metadata).estimatedBytes,
        triangles: (purpose === 'overview' ? overview : metadata).triangles,
        attributes: (purpose === 'overview' ? overview : metadata).attributes,
        geometricError: purpose === 'overview' && overview.triangles !== metadata.triangles ? Math.hypot(...metadata.bounds.size) : 0,
      })),
    },
    async produceRepresentation({ signal, maxBytes, reportProgress, representation }) {
      signal.throwIfAborted();
      if ((representation.id === 'overview' ? overview : metadata).estimatedBytes > maxBytes) throw new RangeError(`${subject.name} exceeds the negotiated geometry limit.`);
      // Roots are deterministic capture-owned source geometry. Heavy copying and
      // serialization happens only after demand, inside the SDK's bounded queue.
      await yieldForCapture(signal);
      reportProgress({ phase: 'serializing' });
      signal.throwIfAborted();
      return representation.id === 'overview' ? (subject.overviewRoot ?? subject.root) : subject.root;
    },
  };
  registry.registerDeferred(registration);
  return { registration, metadata };
}
