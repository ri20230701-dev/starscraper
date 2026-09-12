import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BuildingSnapshot, CitySnapshot } from '../src/application/dto/CitySnapshot';
import { frameCity } from '../src/presentation/three/cityFraming';

const FOV = 43;

function building(overrides: Partial<BuildingSnapshot> = {}): BuildingSnapshot {
  return {
    id: 0, x: 0, z: 0, width: 18, depth: 18, height: 12,
    color: '#3178c6', windowLitRatio: 0.5, name: 'repo',
    htmlUrl: 'https://github.com/example/repo', description: null,
    language: null, stars: 0, pushedAt: null, isFork: false,
    ...overrides,
  };
}

function city(buildings: readonly BuildingSnapshot[]): CitySnapshot {
  return { buildings };
}

const block = city(Array.from({ length: 100 }, (_unused, index) => building({
  x: (index % 10) * 24 + 48, z: Math.floor(index / 10) * 24 + 48, height: 12 + index,
})));

/** An account whose repositories all reach the widest plot, which spreads the city out. */
const wideBlock = city(Array.from({ length: 100 }, (_unused, index) => building({
  x: (index % 10) * 24 + 48, z: Math.floor(index / 10) * 24 + 48, width: 18, depth: 18, height: 12,
})));

/** Every corner of every building, in world space. */
function corners(snapshot: CitySnapshot): Vector3[] {
  return snapshot.buildings.flatMap(item => [-1, 1].flatMap(sx => [0, 1].flatMap(sy => [-1, 1].map(sz =>
    new Vector3(item.x + (sx * item.width) / 2, sy * item.height, item.z + (sz * item.depth) / 2)))));
}

/**
 * Project the city with a real camera placed exactly where the framing says, then report
 * the worst normalised device coordinate. Anything past 1 is off the edge of the screen.
 */
function worstProjection(snapshot: CitySnapshot, aspect: number) {
  const framing = frameCity(snapshot, FOV, aspect);
  const camera = new PerspectiveCamera(FOV, aspect, 0.5, framing.far);
  camera.position.set(...framing.position);
  camera.lookAt(new Vector3(...framing.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  let worstX = 0;
  let worstY = 0;
  let furthest = 0;
  for (const corner of corners(snapshot)) {
    const ndc = corner.clone().project(camera);
    worstX = Math.max(worstX, Math.abs(ndc.x));
    worstY = Math.max(worstY, Math.abs(ndc.y));
    furthest = Math.max(furthest, camera.position.distanceTo(corner));
  }
  return { framing, worstX, worstY, furthest };
}

describe('the opening shot actually contains the city', () => {
  it.each([
    ['a single low building', city([building()]), 1.78],
    ['one 200k-star tower on a small plot', city([building({ height: 117.66, width: 7, depth: 7 })]), 1.78],
    ['a portrait phone', city([building({ height: 117.66 })]), 0.42],
    ['a very narrow window', city([building({ height: 117.66 })]), 0.1],
    ['an ultrawide display', block, 5],
    ['a hundred buildings off the origin', block, 2.65],
    ['a hundred buildings on a phone', block, 0.42],
  ])('keeps every corner on screen: %s', (_name, snapshot, aspect) => {
    const { worstX, worstY } = worstProjection(snapshot, aspect);
    // Asserting the projection is the point: arithmetic that merely looked sufficient
    // still cropped the roof of a tall tower by twelve percent of the screen.
    expect(worstX).toBeLessThanOrEqual(1);
    expect(worstY).toBeLessThanOrEqual(1);
  });

  it.each([
    ['a hundred buildings on a phone', block, 0.42],
    ['a hundred wide plots on a phone', wideBlock, 0.42],
    ['a hundred wide plots on a desktop', wideBlock, 1.78],
  ])('keeps the whole city inside the far plane at full zoom-out: %s', (_name, snapshot, aspect) => {
    const framing = frameCity(snapshot, FOV, aspect);
    const target = new Vector3(...framing.target);
    // Distance from the pivot to the furthest corner. At maximum zoom the camera sits
    // maxDistance from that pivot, so the deepest point is the sum of the two. A far
    // plane fixed for a small scene let an entire city vanish at the allowed zoom.
    const cityRadius = Math.max(...corners(snapshot).map(corner => corner.distanceTo(target)));
    expect(framing.far).toBeGreaterThan(framing.maxDistance + cityRadius);
  });

  it('leaves the city visible through the fog at the opening distance', () => {
    const { framing, furthest } = worstProjection(block, 1.78);
    // FogExp2 keeps exp(-(density * depth)^2) of the original colour. A density fixed for
    // a small scene left 0.002% of it at this distance, which is indistinguishable from
    // the background.
    const survival = Math.exp(-((framing.fogDensity * furthest) ** 2));
    expect(survival).toBeGreaterThan(0.15);
  });
});

describe('framing stays well formed', () => {
  it.each([
    ['no buildings at all', city([]), 1.78],
    ['a single low building', city([building()]), 1.78],
    ['a hundred buildings', block, 2.65],
  ])('%s', (_name, snapshot, aspect) => {
    const framing = frameCity(snapshot, FOV, aspect);
    const numbers = [...framing.position, ...framing.target, framing.minDistance, framing.maxDistance,
      framing.far, framing.fogDensity];
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(framing.minDistance).toBeLessThan(framing.maxDistance);

    // The camera must start inside its own orbit limits, or the controls snap the view on
    // the first frame and the page looks like it glitched on load.
    const distance = Math.hypot(
      framing.position[0] - framing.target[0],
      framing.position[1] - framing.target[1],
      framing.position[2] - framing.target[2],
    );
    expect(distance).toBeGreaterThanOrEqual(framing.minDistance);
    expect(distance).toBeLessThanOrEqual(framing.maxDistance);
  });

  it('looks at the city rather than the world origin', () => {
    const framing = frameCity(block, FOV, 1.78);
    expect(framing.target[0]).toBeGreaterThan(100);
    expect(framing.target[2]).toBeGreaterThan(100);
  });

  it('pulls back further for a larger city', () => {
    const spanOf = (snapshot: CitySnapshot) => {
      const framing = frameCity(snapshot, FOV, 1.78);
      return Math.hypot(
        framing.position[0] - framing.target[0],
        framing.position[1] - framing.target[1],
        framing.position[2] - framing.target[2],
      );
    };
    expect(spanOf(block)).toBeGreaterThan(spanOf(city([building()])) * 2);
  });
});
