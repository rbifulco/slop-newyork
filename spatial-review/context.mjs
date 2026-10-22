// Flat geographic context from the same coastline and curb-island polygons used
// by buildCityGrid. These are explicitly 2D proxies, not the rendered city.
export async function buildGeographicContext(NYC, { signal } = {}) {
  const { THREE, MANHATTAN_COASTLINE, BLOCKS } = NYC;
  const started = performance.now();
  const group = new THREE.Group();
  group.name = 'Geographic context (flat proxies)';
  const geometries = new Set();
  const materials = new Set();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    group.clear();
  };
  const abortIfNeeded = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Context capture cancelled', 'AbortError');
  };
  let chunkStart = performance.now();
  let maxChunkMs = 0;
  const yieldIfNeeded = async (force = false) => {
    abortIfNeeded();
    const elapsed = performance.now() - chunkStart;
    maxChunkMs = Math.max(maxChunkMs, elapsed);
    if (!force && elapsed < 8) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    chunkStart = performance.now();
    abortIfNeeded();
  };

  // The source uses (x, -z) in ShapeGeometry and rotates -PI/2 onto the XZ plane.
  // Emit the same winding directly, preserving metre units and upward normals.
  function appendPolygon(vertices, points, height) {
    if (points.length < 3) return;
    const contour = points.map((point) => new THREE.Vector2(point.x, -point.z));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const triangle of triangles) {
      for (const index of triangle) {
        const point = contour[index];
        vertices.push(point.x, height, -point.y);
      }
    }
  }

  function subject(key, label, vertices, color, sourceRef) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = key;
    geometries.add(geometry);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    material.name = `context-${key}`;
    materials.add(material);
    const root = new THREE.Mesh(geometry, material);
    root.name = key;
    root.userData.reviewSourceRef = sourceRef;
    group.add(root);
    return {
      actorId: `context-${key}`,
      assetId: `context-design-${key}`,
      name: label,
      category: 'Geographic context (flat proxies)',
      sourceRef,
      root,
      componentSources: { [key]: sourceRef },
      tags: ['context-proxy', 'flat-geography', 'source-polygons']
    };
  }

  try {
    abortIfNeeded();
    const land = [];
    appendPolygon(land, MANHATTAN_COASTLINE, 0);
    const subjects = [subject('manhattan-coastline', 'Manhattan land and roads (flat proxy)', land,
      0x3c454e, 'js/city-config.js#MANHATTAN_COASTLINE')];
    await yieldIfNeeded(true);

    const blocks = [];
    const parks = [];
    let blockCount = 0;
    let parkCount = 0;
    for (const block of BLOCKS) {
      const isPark = block.park > 0.6 && !block.median;
      appendPolygon(isPark ? parks : blocks, block.poly, NYC.ISLAND_BOUNDS.sidewalkHeight);
      if (isPark) parkCount += 1;
      else blockCount += 1;
      await yieldIfNeeded();
    }
    // Curb islands are flat filled polygons. Their gaps expose the source road grid.
    subjects.push(subject('curb-islands', 'Manhattan blocks and street gaps (flat proxy)', blocks,
      0x707873, 'js/city-config.js#BLOCKS'));
    await yieldIfNeeded(true);
    subjects.push(subject('park-outlines', 'Manhattan parks (flat proxy)', parks,
      0x3e6948, 'js/city-config.js#BLOCKS'));
    await yieldIfNeeded();
    group.updateMatrixWorld(true);
    return {
      subjects, group, dispose,
      diagnostics: {
        constructionMs: performance.now() - started,
        maxChunkMs,
        blockCount,
        parkCount,
        triangleCount: (land.length + blocks.length + parks.length) / 9,
        limitations: [
          'Coastline and curb-island polygons preserve the source world coordinates in metres.',
          'Block footprints and park outlines are flat context proxies; they contain no building height, sidewalk detail, trees, terrain relief or occlusion.',
          'Roads appear as gaps between curb islands over the island deck; elevated roadways, bridges and street furniture are omitted.',
          'Water, outlying boroughs and the 60 km source water plane are excluded so review bounds remain useful.'
        ]
      }
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
