// @vitest-environment jsdom
import { PerspectiveCamera, Vector3 } from 'three';
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

  /** Where the camera is actually looking, flattened to the ground plane. */
  function heading(camera: PerspectiveCamera): Vector3 {
    camera.updateMatrixWorld(true);
    const direction = camera.getWorldDirection(new Vector3());
    direction.y = 0;
    return direction.normalize();
  }

  it('walks the way the camera is looking, not the other way', () => {
    // W used to move along +Z while the camera looked down -Z, so the walker reversed.
    // Comparing against getWorldDirection is what makes this test independent of the
    // convention the implementation happens to use.
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    const before = walk.camera.position.clone();
    const facing = heading(walk.camera);
    walk.press('KeyW');
    walk.controls.update(0.1);
    const moved = walk.camera.position.clone().sub(before);
    expect(moved.length()).toBeGreaterThan(0.5);
    expect(moved.normalize().dot(facing)).toBeGreaterThan(0.99);
    walk.controls.dispose();
  });

  it('backs away from the view when S is held', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    const before = walk.camera.position.clone();
    const facing = heading(walk.camera);
    walk.press('KeyS');
    walk.controls.update(0.1);
    const moved = walk.camera.position.clone().sub(before).normalize();
    expect(moved.dot(facing)).toBeLessThan(-0.99);
    walk.controls.dispose();
  });

  it('strafes to the right of the view when D is held', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    const before = walk.camera.position.clone();
    const facing = heading(walk.camera);
    // For a Y-up right-handed frame, forward cross up is the camera's right.
    const right = new Vector3().crossVectors(facing, new Vector3(0, 1, 0)).normalize();
    walk.press('KeyD');
    walk.controls.update(0.1);
    const moved = walk.camera.position.clone().sub(before).normalize();
    expect(moved.dot(right)).toBeGreaterThan(0.99);
    walk.controls.dispose();
  });

  it('starts out facing the middle of town', () => {
    // Ask to start inside the building so the spawn search pushes the walker out; the
    // heading then has an actual direction to point in.
    const walk = harness(city, { x: 0, z: 0 });
    const toCentre = new Vector3(0, 0, 0).sub(walk.camera.position).setY(0).normalize();
    expect(toCentre.length()).toBeGreaterThan(0.5);
    expect(heading(walk.camera).dot(toCentre)).toBeGreaterThan(0.9);
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
    // Spawn beside the building and face it, so W actually drives into the wall. The
    // earlier version started behind the walker's heading and strolled away from town
    // for two hundred and sixty units without the collision code ever running.
    const walk = harness(city, { x: 0, z: 0 });
    walk.setLocked(true);
    const before = walk.camera.position.clone();
    walk.press('KeyW');
    for (let frame = 0; frame < 400; frame += 1) walk.controls.update(0.05);
    const { x, z } = walk.camera.position;
    expect(x > -9.9 && x < 9.9 && z > -9.9 && z < 9.9, `ended inside at ${x},${z}`).toBe(false);
    // It must have travelled toward the building rather than drifting off into the dark.
    expect(walk.camera.position.distanceTo(new Vector3(0, 1.7, 0)))
      .toBeLessThan(before.distanceTo(new Vector3(0, 1.7, 0)));
    walk.controls.dispose();
  });

  it('does not tunnel through a wall on a single slow frame', () => {
    const walk = harness(city, { x: 0, z: 0 });
    walk.setLocked(true);
    const start = walk.camera.position.clone();
    // Whichever axis the walker approaches along is the one it must not cross.
    const axis = Math.abs(start.x) >= Math.abs(start.z) ? 'x' : 'z';
    walk.press('KeyW');
    // A frame this long only happens after a stall, which is exactly when tunnelling
    // used to happen: the step would exceed the building's depth in one move.
    walk.controls.update(5);
    const { x, z } = walk.camera.position;
    expect(x > -9.9 && x < 9.9 && z > -9.9 && z < 9.9).toBe(false);
    expect(Math.sign(axis === 'x' ? x : z), 'crossed to the far side of the building')
      .toBe(Math.sign(axis === 'x' ? start.x : start.z));
    walk.controls.dispose();
  });

  it('turns with the mouse and still walks where it looks', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.look(400);
    expect(Math.abs(walk.camera.rotation.y)).toBeGreaterThan(0.5);
    const facing = heading(walk.camera);
    const before = walk.camera.position.clone();
    walk.press('KeyW');
    walk.controls.update(0.2);
    const moved = walk.camera.position.clone().sub(before).normalize();
    expect(moved.dot(facing)).toBeGreaterThan(0.99);
    walk.controls.dispose();
  });

  it('keeps walking while either bound key is still held', () => {
    const walk = harness({ buildings: [] }, { x: 0, z: 0 });
    walk.setLocked(true);
    walk.press('KeyW');
    walk.press('ArrowUp');
    walk.release('ArrowUp');
    const before = walk.camera.position.clone();
    walk.controls.update(0.2);
    expect(walk.camera.position.distanceTo(before)).toBeGreaterThan(0.5);
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
