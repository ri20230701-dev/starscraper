// @vitest-environment jsdom
import { PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildingSnapshot, CitySnapshot } from '../src/application/dto/CitySnapshot';
import { WalkControls } from '../src/presentation/input/WalkControls';

function building(overrides: Partial<BuildingSnapshot> = {}): BuildingSnapshot {
  return {
    id: 0, x: 0, z: 0, width: 18, depth: 18, height: 40,
    color: '#3178c6', windowLitRatio: 0.5, name: 'repo',
    htmlUrl: 'https://github.com/example/repo', description: null,
    language: null, stars: 0, pushedAt: null, isFork: false,
    ...overrides,
  };
}

const city: CitySnapshot = { buildings: [building()] };

/**
 * Pointer lock cannot be granted in an automated browser, so the lock state is driven
 * directly here. Everything downstream of it — keys, look, collision — is the real code.
 */
function harness(snapshot: CitySnapshot = city, centre = { x: 0, z: 60 }) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const camera = new PerspectiveCamera(43, 1.78, 0.5, 2000);
  const locks: boolean[] = [];
  const controls = new WalkControls(camera, canvas, snapshot, centre, locked => locks.push(locked));
  controls.attach();

  function setLocked(locked: boolean): void {
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true, get: () => (locked ? canvas : null),
    });
    document.dispatchEvent(new Event('pointerlockchange'));
  }

  return {
    camera, controls, locks, canvas, setLocked,
    press(code: string): void { document.dispatchEvent(new KeyboardEvent('keydown', { code })); },
    release(code: string): void { document.dispatchEvent(new KeyboardEvent('keyup', { code })); },
    look(movementX: number, movementY = 0): void {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY }));
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('walking the streets', () => {
  it('stays put until the pointer is locked', () => {
    const walk = harness();
    const before = walk.camera.position.clone();
    walk.press('KeyW');
    walk.controls.update(0.5);
    expect(walk.camera.position.equals(before)).toBe(true);
    walk.controls.dispose();
  });

  it('walks forward once locked', () => {
    const walk = harness();
    walk.setLocked(true);
    const before = walk.camera.position.clone();
    walk.press('KeyW');
    walk.controls.update(0.1);
    expect(walk.camera.position.distanceTo(before)).toBeGreaterThan(0.5);
    walk.controls.dispose();
  });

  it('keeps the eye at head height rather than drifting up or down', () => {
    const walk = harness();
    walk.setLocked(true);
    walk.press('KeyW');
    for (let frame = 0; frame < 30; frame += 1) walk.controls.update(0.016);
    expect(walk.camera.position.y).toBeCloseTo(1.7, 5);
    walk.controls.dispose();
  });

  it('cannot walk into a building however long it pushes', () => {
    const walk = harness(city, { x: 0, z: 40 });
    walk.setLocked(true);
    walk.press('KeyW');
    for (let frame = 0; frame < 400; frame += 1) walk.controls.update(0.05);
    const { x, z } = walk.camera.position;
    const insideFootprint = x > -9 && x < 9 && z > -9 && z < 9;
    expect(insideFootprint, `ended inside at ${x},${z}`).toBe(false);
    walk.controls.dispose();
  });

  it('does not tunnel through a wall on a single slow frame', () => {
    const walk = harness(city, { x: 0, z: 40 });
    walk.setLocked(true);
    walk.press('KeyW');
    // A frame this long only happens after a stall, which is exactly when tunnelling
    // used to happen: the step would exceed the building's depth in one move.
    walk.controls.update(5);
    const { x, z } = walk.camera.position;
    expect(x > -9 && x < 9 && z > -9 && z < 9).toBe(false);
    expect(z).toBeGreaterThan(0);
    walk.controls.dispose();
  });

  it('turns with the mouse and walks the way it is facing', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.look(400);
    const yaw = walk.camera.rotation.y;
    expect(Math.abs(yaw)).toBeGreaterThan(0.5);
    const before = walk.camera.position.clone();
    walk.press('KeyW');
    walk.controls.update(0.2);
    const moved = walk.camera.position.clone().sub(before);
    // Moving along the facing direction: the step and the heading must agree.
    expect(Math.atan2(moved.x, moved.z)).toBeCloseTo(yaw, 1);
    walk.controls.dispose();
  });

  it('never tips far enough to flip the horizon', () => {
    const walk = harness();
    walk.setLocked(true);
    walk.look(0, -100_000);
    expect(walk.camera.rotation.x).toBeLessThanOrEqual(Math.PI / 2);
    walk.look(0, 200_000);
    expect(walk.camera.rotation.x).toBeGreaterThanOrEqual(-Math.PI / 2);
    walk.controls.dispose();
  });

  it('drops held keys when the window loses focus', () => {
    // Otherwise the walker keeps strolling into a wall while the visitor is elsewhere.
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.press('KeyW');
    window.dispatchEvent(new Event('blur'));
    const before = walk.camera.position.clone();
    walk.controls.update(0.5);
    expect(walk.camera.position.equals(before)).toBe(true);
    walk.controls.dispose();
  });

  it('drops held keys when the lock is released', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.press('KeyW');
    walk.setLocked(false);
    walk.setLocked(true);
    const before = walk.camera.position.clone();
    walk.controls.update(0.5);
    expect(walk.camera.position.equals(before)).toBe(true);
    expect(walk.locks).toEqual([true, false, true]);
    walk.controls.dispose();
  });

  it('does not let a diagonal outrun a straight line', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.press('KeyW');
    walk.controls.update(0.2);
    const straight = walk.camera.position.length();
    walk.controls.dispose();

    const diagonal = harness({ buildings: [] }, { x: 0, z: 0 });
    diagonal.setLocked(true);
    diagonal.press('KeyW');
    diagonal.press('KeyD');
    diagonal.controls.update(0.2);
    expect(diagonal.camera.position.length()).toBeCloseTo(straight, 5);
    diagonal.controls.dispose();
  });

  it('stops when the key is released', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.press('KeyW');
    walk.controls.update(0.1);
    walk.release('KeyW');
    const after = walk.camera.position.clone();
    walk.controls.update(0.5);
    expect(walk.camera.position.equals(after)).toBe(true);
    walk.controls.dispose();
  });

  it('removes its listeners on dispose', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.controls.dispose();
    const before = walk.camera.position.clone();
    walk.press('KeyW');
    walk.controls.update(0.5);
    expect(walk.camera.position.equals(before)).toBe(true);
  });
});
