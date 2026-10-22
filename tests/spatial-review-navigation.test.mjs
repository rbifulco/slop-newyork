import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three';
import { SceneAssetRegistry } from '@alterno-dev/spatial-review';
import { buildNavigationReview } from '../spatial-review/navigation.mjs';

const cameraSource = readFileSync(new URL('../js/cameras.js', import.meta.url), 'utf8');

function loadCameras(bryantParkLawn) {
  const NYC = { THREE, bryantParkLawn };
  const noListeners = () => { throw new Error('Capture must not install camera input listeners.'); };
  vm.runInNewContext(cameraSource, {
    window: { NYC, addEventListener: noListeners },
    document: { addEventListener: noListeners },
  });
  return NYC;
}

test('scenic review uses source poses and FOV without creating interactive cameras', () => {
  const NYC = loadCameras();
  const { sequences, metadata } = buildNavigationReview(NYC);
  assert.equal(sequences.length, 8);
  assert.ok(sequences.every((sequence) => !['camera-chase', 'camera-action', 'camera-pov'].includes(sequence.id)));

  const fifthAve = sequences.find((sequence) => sequence.id === 'camera-fifthAve');
  assert.deepEqual(fifthAve.stops[0].camera, [0, 6.5, -20]);
  assert.deepEqual(fifthAve.stops[0].target, [-60, 150, 686]);
  assert.equal(fifthAve.stops[0].fov, 48);
  assert.equal(fifthAve.segments[0].aim.kind, 'fixed-target');

  const observatory = sequences.find((sequence) => sequence.id === 'camera-observatory');
  assert.deepEqual(observatory.stops[0].camera, [-58, 322, 660]);
  assert.deepEqual(observatory.stops[0].target, [420, 150, -200]);
  assert.equal(observatory.segments[0].aim.kind, 'curve');
  assert.equal(observatory.segments[0].aim.curve.kind, 'sampled');
  assert.notDeepEqual(observatory.stops[0].target, observatory.stops[1].target);
  assert.equal(metadata.durationSeconds, 30);
  assert.ok(metadata.limitations.some((limitation) => limitation.includes('no read-only flag for stops')));
});

test('Bryant Park resolves the constructed lawn instead of hard-coded fallback coordinates', () => {
  const NYC = loadCameras({ minX: -240, maxX: -130, minZ: 20, maxZ: 140, top: 2 });
  const before = { ...NYC.bryantParkLawn };
  const { sequences } = buildNavigationReview(NYC);
  const bryant = sequences.find((sequence) => sequence.id === 'camera-bryantPark');
  assert.deepEqual(bryant.stops[0].camera, [-222, 3.7, 80]);
  assert.deepEqual(bryant.stops[0].target, [130, 70, 20]);
  assert.deepEqual(NYC.bryantParkLawn, before);
});

test('navigation is deterministic and refreshed source data replaces its registered snapshot', () => {
  const NYC = loadCameras();
  const first = buildNavigationReview(NYC);
  const second = buildNavigationReview(NYC);
  assert.deepEqual(first, second);

  const registry = new SceneAssetRegistry('navigation-contract-test');
  for (const sequence of first.sequences) {
    assert.doesNotThrow(() => registry.registerNavigationSequence(sequence));
    const segment = sequence.segments[0];
    assert.equal(segment.camera.kind, 'sampled');
    assert.equal(segment.camera.samples.length, 61);
    assert.equal(segment.weight, 30);
    assert.deepEqual(segment.camera.samples[0], sequence.stops[0].camera);
    assert.deepEqual(segment.camera.samples.at(-1), sequence.stops[1].camera);
    assert.ok(cameraSource.includes(sequence.sourceRef.split('#')[1]));
    for (const point of segment.camera.samples) assert.ok(point.every(Number.isFinite));
  }
  // Replacing a registered route must retain its semantic ID and use the new
  // source-derived data, rather than duplicating the old snapshot.
  NYC.CAMERA_PRESETS.find((preset) => preset.id === 'centralPark').fov = 53;
  const refreshed = buildNavigationReview(NYC);
  for (const sequence of refreshed.sequences) registry.registerNavigationSequence(sequence);
  const registered = registry.toNavigationSequences();
  assert.equal(registered.length, 8);
  const centralPark = registered.find((sequence) => sequence.id === 'camera-centralPark');
  assert.equal(centralPark.stops[0].fov, 53);
  assert.equal(centralPark.stops[1].fov, 53);
  assert.deepEqual(registered.map(({ id }) => id), first.sequences.map(({ id }) => id));
});
