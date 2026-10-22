// Capture-only adapter. All shapes and placement transforms come from buildLandmarks;
// this file supplies review identity, source mapping and declared material fallbacks.
export const LANDMARK_REVIEW_NAMES = Object.freeze({
  esb: 'Empire State Building',
  chrysler: 'Chrysler Building',
  vanderbilt: 'One Vanderbilt',
  gct: 'Grand Central Terminal and MetLife Building',
  bryant: 'Bryant Park and New York Public Library',
  timessquare: 'One Times Square',
  rockefeller: '30 Rockefeller Plaza',
  citigroup: 'Citigroup Center',
  flatiron: 'Flatiron Building',
  seagram: 'Seagram Building',
  owtc: 'One World Trade Center'
});

const TEXTURE_SLOTS = ['map', 'alphaMap', 'normalMap', 'emissiveMap', 'aoMap',
  'roughnessMap', 'metalnessMap', 'bumpMap', 'lightMap'];

function collectResources(root, geometries, materials, textures) {
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const candidates = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of candidates) {
      if (!material) continue;
      materials.add(material);
      for (const key of TEXTURE_SLOTS) if (material[key]?.isTexture) textures.add(material[key]);
    }
  });
}

export async function buildLandmarkReview(NYC, { signal } = {}) {
  const { THREE } = NYC;
  const started = performance.now();
  const scene = new THREE.Scene();
  const geometries = new Set();
  const sourceMaterials = new Set();
  const textures = new Set();
  const replacements = new Map();
  const materialSources = {};
  let group;
  let steps;
  let maxChunkMs = 0;
  const abortIfNeeded = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Landmark capture cancelled', 'AbortError');
  };
  const ownMaterial = (material) => {
    sourceMaterials.add(material);
    for (const key of TEXTURE_SLOTS) if (material[key]?.isTexture) textures.add(material[key]);
    return material;
  };
  const billboardMaterials = new Map();
  const reviewMaterialFactories = {
    createPreWarBuildingMaterial: (options) => ownMaterial(new THREE.MeshStandardMaterial({
      color: options.stoneColor, roughness: 0.76, metalness: 0.06
    })),
    createCurtainWallMaterial: (options) => ownMaterial(new THREE.MeshStandardMaterial({
      color: options.glassTint, roughness: 0.12, metalness: 0.72
    })),
    createChryslerCrownMaterial: () => ownMaterial(new THREE.MeshStandardMaterial({
      color: 0xe4edf5, roughness: 0.11, metalness: 0.86
    })),
    createBillboardMaterial: (theme) => {
      const key = ((theme % 6) + 6) % 6;
      if (billboardMaterials.has(key)) return billboardMaterials.get(key);
      const material = ownMaterial(new THREE.MeshBasicMaterial({ color: 0xdce8ef }));
      material.userData.reviewMaterial = {
        sourceSymbol: `createBillboardMaterial-theme-${key}`,
        sourceRef: 'js/tsl-materials.js#createBillboardMaterial',
        themeKey: key,
        unsupported: 'Poster art, LED pattern, light sweeps and ticker animation'
      };
      billboardMaterials.set(key, material);
      return material;
    }
  };
  const reviewMaterial = (source, component) => {
    if (replacements.has(source)) return replacements.get(source);
    const hint = source.userData.reviewMaterial;
    const sourceSymbol = hint?.sourceSymbol || component.name;
    const basic = source.isMeshBasicNodeMaterial || source.isMeshBasicMaterial;
    const material = basic ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial();
    material.name = sourceSymbol;
    if (hint?.color !== undefined) material.color.setHex(hint.color);
    else if (source.color) material.color.copy(source.color);
    if (!basic) {
      material.roughness = source.roughness ?? 0.7;
      material.metalness = source.metalness ?? 0;
      if (source.emissive) material.emissive.copy(source.emissive);
      material.emissiveIntensity = source.emissiveIntensity ?? 1;
    }
    for (const property of ['opacity', 'transparent', 'alphaTest', 'side', 'depthWrite',
      'depthTest', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits']) {
      if (source[property] !== undefined) material[property] = source[property];
    }
    for (const key of TEXTURE_SLOTS) {
      if (!source[key]?.isTexture) continue;
      const texture = source[key];
      // These sources are locally generated canvases. Never turn a code reference
      // into a texture URL or copy arbitrary source metadata into the export.
      const image = texture.image;
      if (image?.src || image?.currentSrc || texture.userData.sourceRef || texture.userData.requestUrl) {
        throw new Error(`Unexpected URL-bearing texture in landmark capture: ${component.name}/${key}`);
      }
      material[key] = texture;
    }
    materialSources[material.name] = {
      sourceRef: hint?.sourceRef || component.userData.reviewSourceRef,
      shadingSourceRef: hint?.shadingSourceRef,
      approximation: Boolean(hint?.shadingSourceRef || hint?.unsupported || source.colorNode || source.emissiveNode || source.normalNode),
      textureSlots: TEXTURE_SLOTS.filter((key) => material[key]?.isTexture)
    };
    replacements.set(source, material);
    return material;
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    steps?.return();
    group?.removeFromParent();
    geometries.forEach((geometry) => geometry.dispose());
    sourceMaterials.forEach((material) => material.dispose());
    replacements.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    group?.clear();
  };

  try {
    abortIfNeeded();
    steps = NYC.buildLandmarkSteps(scene, {
      preserveReviewHierarchy: true,
      reviewMaterialFactories,
      onReviewObject: (object) => collectResources(object, geometries, sourceMaterials, textures),
      onReviewMaterial: ownMaterial
    });
    let step;
    do {
      abortIfNeeded();
      const chunkStart = performance.now();
      step = steps.next();
      group = step.value.group;
      maxChunkMs = Math.max(maxChunkMs, performance.now() - chunkStart);
      if (!step.done) await new Promise((resolve) => setTimeout(resolve, 0));
    } while (!step.done);
    abortIfNeeded();
    const reviewSubjects = step.value.reviewSubjects;
    const conversionStart = performance.now();
    const subjects = reviewSubjects.map(({ key, root, sourceRef }) => {
      if (!LANDMARK_REVIEW_NAMES[key]) throw new Error(`Unnamed landmark review subject: ${key}`);
      const componentSources = {};
      root.traverse((object) => {
        if (!object.isMesh) return;
        if (!object.name || componentSources[object.name]) {
          throw new Error(`Landmark components require unique source names: ${key}/${object.name}`);
        }
        componentSources[object.name] = object.userData.reviewSourceRef;
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => reviewMaterial(material, object))
          : reviewMaterial(object.material, object);
      });
      return {
        actorId: `landmark-${key}`,
        assetId: `landmark-design-${key}`,
        key,
        name: LANDMARK_REVIEW_NAMES[key],
        category: 'Landmarks',
        sourceRef,
        placementSourceRef: key === 'bryant'
          ? 'js/landmarks.js#blockSite'
          : key === 'gct' ? 'js/landmarks.js#unionSite' : 'js/city-config.js#LANDMARK_SITES',
        root,
        componentSources,
        tags: ['source-geometry', 'material-approximation', 'landmark']
      };
    });
    group.updateMatrixWorld(true);
    maxChunkMs = Math.max(maxChunkMs, performance.now() - conversionStart);
    return {
      subjects, group, dispose,
      diagnostics: {
        constructionMs: performance.now() - started,
        maxChunkMs,
        subjectCount: subjects.length,
        componentCount: subjects.reduce((count, subject) => count + Object.keys(subject.componentSources).length, 0),
        materialSources,
        textureCount: textures.size,
        limitations: [
          'TSL facade windows, room interiors, procedural surface relief and lighting are replaced by source-colored standard materials.',
          'Times Square billboard poster art, LED effects and animation are not exported; screen geometry remains selectable.',
          'The MetLife sign canvas is preserved as a texture. Its rasterization depends on the capture browser font.',
          'Grand Central/MetLife and Bryant Park/NYPL retain the compound design boundaries in buildLandmarks.'
        ]
      }
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
