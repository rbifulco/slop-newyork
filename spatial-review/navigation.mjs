// Capture-only adapter. The ordinary page never imports this module.
// Coordinates already use the site's metre-scale, Y-up world frame. The
// inverse mapping for feedback is the identity; rotations are not exported.
const DURATION_SECONDS = 30;
const SAMPLE_INTERVAL_SECONDS = 0.5;

function vectorArray(vector) {
  return [vector.x, vector.y, vector.z];
}

function distanceFromChord(midpoint, first, last) {
  return Math.hypot(...midpoint.map((value, axis) => value - (first[axis] + last[axis]) / 2));
}

function makeSampler(NYC, preset) {
  const { THREE, CameraSystem } = NYC;
  // Calling the constructor would attach pointer/window/document listeners.
  // This state runs the real update method without acquiring those resources.
  const state = Object.create(CameraSystem.prototype);
  Object.assign(state, {
    controllerManager: { getActiveEntity: () => ({ speed: 0, heading: 0 }) },
    camera: new THREE.PerspectiveCamera(preset.fov, 1, 0.35, 60000),
    activePresetId: preset.id,
    userOrbitTimer: 0,
    isDragging: false,
    orbitYawOffset: 0,
    smoothedSpeed: 0,
    _desiredPos: new THREE.Vector3(),
    _desiredLook: new THREE.Vector3(),
    currentPos: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
  });

  return (elapsed) => {
    // Snapshot the authored analytic pose. CameraSystem's interactive smoothing
    // depends on prior frame times and is deliberately outside this review.
    state.initialized = false;
    state.update(0, elapsed);
    return {
      camera: vectorArray(state.camera.position),
      target: vectorArray(state.currentLookAt),
      fov: state.camera.fov,
    };
  };
}

/**
 * Export each authored scenic preset as a separate finite excerpt, using its
 * actual runtime calculation rather than a second copy of the camera formulas.
 *
 * @param {object} NYC The capture page's namespace after cameras.js and the
 *   authoritative landmark construction (including bryantParkLawn) have loaded.
 * @returns {{sequences: object[], metadata: object}}
 */
export function buildNavigationReview(NYC) {
  if (!NYC?.THREE || !NYC.CameraSystem || !Array.isArray(NYC.CAMERA_PRESETS)) {
    throw new Error('Navigation review requires Three.js, CameraSystem, and CAMERA_PRESETS.');
  }

  const sources = [];
  const sequences = Array.from(NYC.CAMERA_PRESETS).filter((preset) => preset.category === 'scenic').map((preset) => {
    const id = `camera-${preset.id}`;
    const sourceRef = `js/cameras.js#case '${preset.id}'`;
    const sample = makeSampler(NYC, preset);
    const count = Math.round(DURATION_SECONDS / SAMPLE_INTERVAL_SECONDS);
    const snapshots = Array.from({ length: count + 1 }, (_, index) => sample(index * SAMPLE_INTERVAL_SECONDS));
    const first = snapshots[0];
    const last = snapshots[count];
    const fixedAim = snapshots.every(({ target }) => target.every((value, axis) => value === first.target[axis]));

    let cameraMidpointErrorM = 0;
    let aimMidpointErrorM = 0;
    for (let index = 0; index < count; index += 1) {
      const midpoint = sample((index + 0.5) * SAMPLE_INTERVAL_SECONDS);
      cameraMidpointErrorM = Math.max(cameraMidpointErrorM, distanceFromChord(midpoint.camera, snapshots[index].camera, snapshots[index + 1].camera));
      aimMidpointErrorM = Math.max(aimMidpointErrorM, distanceFromChord(midpoint.target, snapshots[index].target, snapshots[index + 1].target));
    }

    sources.push({
      sequenceId: id,
      presetId: preset.id,
      poseSourceRef: sourceRef,
      fovSourceRef: 'js/cameras.js#CAMERA_PRESETS',
      sampledMidpointDeviationM: { camera: cameraMidpointErrorM, aim: aimMidpointErrorM },
    });

    return {
      id,
      name: `${preset.name} · sampled 0–${DURATION_SECONDS} s`,
      category: 'Scenic camera excerpts · approximate context',
      sourceRef,
      stops: [
        { id: `${id}-start`, name: `${preset.name} · at 0 s`, ...first, sourceRef },
        { id: `${id}-end`, name: `${preset.name} · at ${DURATION_SECONDS} s`, ...last, sourceRef },
      ],
      segments: [{
        id: `${id}-excerpt`,
        fromStopId: `${id}-start`,
        toStopId: `${id}-end`,
        sourceRef,
        // Weight records the captured timeline span, never geometric distance.
        weight: DURATION_SECONDS,
        // Both endpoint FOVs are identical. No source lens transition exists.
        lensStart: 0,
        camera: { kind: 'sampled', samples: snapshots.map(({ camera }) => camera) },
        aim: fixedAim
          ? { kind: 'fixed-target', target: [...first.target] }
          : { kind: 'curve', curve: { kind: 'sampled', samples: snapshots.map(({ target }) => target) } },
      }],
    };
  });

  return {
    sequences,
    metadata: {
      durationSeconds: DURATION_SECONDS,
      sampleIntervalSeconds: SAMPLE_INTERVAL_SECONDS,
      units: 'm',
      coordinateConversion: 'Identity: source and review share the metre-scale Y-up world frame; apply feedback in that same frame.',
      sources,
      limitations: [
        'Each sequence is a separate 0–30 second excerpt of an ongoing scenic preset, not an authored tour linking presets.',
        'Sampled camera and aim curves are calculated, read-only output. Interpolation between samples approximates the analytic runtime; reported midpoint deviations are measurements, not global error bounds.',
        'Interactive camera smoothing, preset transitions, user-controlled follow cameras, and movement of the player are excluded.',
        'The protocol has no read-only flag for stops or FOV. These endpoints are derived snapshots; a proposed edit requires interpretation against the source formula and CAMERA_PRESETS, rather than direct coordinate replacement.',
        'Experience uses the capture page’s landmarks and geographic context proxies. Detailed surrounding buildings, street clutter, live lighting, and occlusion are not faithfully represented; use the ordinary website for final framing and appearance decisions.',
        'Segment weight preserves the 30-second excerpt span as relative timeline weight; the editor may choose its own playback duration.',
      ],
    },
  };
}
