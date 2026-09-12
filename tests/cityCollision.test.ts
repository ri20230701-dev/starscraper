import { describe, expect, it } from 'vitest';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';
import { BuildCity } from '../src/application/usecases/BuildCity';
import type { BuildingSnapshot, CitySnapshot } from '../src/application/dto/CitySnapshot';
import { CityCollision } from '../src/presentation/input/CityCollision';

const RADIUS = 0.9;

function building(overrides: Partial<BuildingSnapshot> = {}): BuildingSnapshot {
  return {
    id: 0, x: 0, z: 0, width: 18, depth: 18, height: 40,
    color: '#3178c6', windowLitRatio: 0.5, name: 'repo',
    htmlUrl: 'https://github.com/example/repo', description: null,
    language: null, stars: 0, pushedAt: null, isFork: false,
    ...overrides,
  };
}

const oneBuilding: CitySnapshot = { buildings: [building()] };
const sampleCity = new BuildCity().execute(SAMPLE_REPOSITORY_PAGE.repositories, SAMPLE_REFERENCE_TIME);

function inside(city: CitySnapshot, point: { x: number; z: number }): boolean {
  // Deliberately independent of the collision code: a direct test against every footprint.
  return city.buildings.some(item =>
    point.x > item.x - item.width / 2 && point.x < item.x + item.width / 2
    && point.z > item.z - item.depth / 2 && point.z < item.z + item.depth / 2);
}

describe('a walker cannot enter a building', () => {
  it('stops at the facade when walking straight at it', () => {
    const collision = new CityCollision(oneBuilding, RADIUS);
    const result = collision.move({ x: 0, z: 30 }, 0, -40);
    expect(result.z).toBeGreaterThanOrEqual(9 + RADIUS);
    expect(inside(oneBuilding, result)).toBe(false);
  });

  it('refuses a single huge step rather than tunnelling through', () => {
    // At a low frame rate an undivided step would jump clean through an eighteen unit
    // building, which is exactly the failure that makes walking feel broken.
    const collision = new CityCollision(oneBuilding, RADIUS);
    const result = collision.move({ x: 0, z: 400 }, 0, -800);
    expect(result.z).toBeGreaterThan(9);
    expect(inside(oneBuilding, result)).toBe(false);
  });

  it.each([1, 4, 17, 60, 250, 1_000])('never lands inside after a step of %i units', distance => {
    const collision = new CityCollision(oneBuilding, RADIUS);
    for (let angle = 0; angle < 36; angle += 1) {
      const radians = (angle / 36) * Math.PI * 2;
      const from = { x: Math.cos(radians) * 40, z: Math.sin(radians) * 40 };
      const result = collision.move(from, -Math.cos(radians) * distance, -Math.sin(radians) * distance);
      expect(inside(oneBuilding, result), `angle ${angle} step ${distance}`).toBe(false);
    }
  });

  it('slides along a wall instead of sticking to it', () => {
    const collision = new CityCollision(oneBuilding, RADIUS);
    // Walking diagonally into the north face: the blocked axis stops, the free one moves.
    const start = { x: 0, z: 12 };
    const result = collision.move(start, 6, -6);
    expect(result.z).toBeGreaterThanOrEqual(9 + RADIUS);
    expect(result.x).toBeGreaterThan(start.x + 3);
  });

  it('walks freely down an empty street', () => {
    const collision = new CityCollision(oneBuilding, RADIUS);
    const result = collision.move({ x: 40, z: 40 }, 0, -60);
    // Subdividing the step accumulates a little floating point drift, so this compares
    // the arrival rather than demanding bit equality.
    expect(result.x).toBeCloseTo(40, 9);
    expect(result.z).toBeCloseTo(-20, 9);
  });

  it('keeps a thousand random walks out of every building, and actually meets some', () => {
    const collision = new CityCollision(sampleCity, RADIUS);
    // Start against a facade and stay among the buildings. An earlier version of this
    // test wandered away from town on its first step and never touched a wall: it
    // called the collision check four thousand times without one of them returning true.
    const first = sampleCity.buildings[0]!;
    let point = { x: first.x, z: first.z + first.depth / 2 + RADIUS + 0.2 };
    let seed = 12_345;
    const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
    let refused = 0;
    for (let step = 0; step < 1_000; step += 1) {
      const target = sampleCity.buildings[step % sampleCity.buildings.length]!;
      // Aim at a building most of the time so the walk keeps running into walls.
      const towards = Math.atan2(target.z - point.z, target.x - point.x);
      const radians = towards + (next() - 0.5) * 1.2;
      const distance = 1 + next() * 6;
      const wanted = { x: point.x + Math.cos(radians) * distance, z: point.z + Math.sin(radians) * distance };
      const moved = collision.move(point, wanted.x - point.x, wanted.z - point.z);
      if (Math.hypot(moved.x - wanted.x, moved.z - wanted.z) > 1e-9) refused += 1;
      point = moved;
      expect(inside(sampleCity, point), `step ${step} at ${point.x},${point.z}`).toBe(false);
    }
    // Without this the test proves only that walking in open ground is safe.
    expect(refused, 'the walk never met a wall, so it proved nothing').toBeGreaterThan(50);
  });

  it('never crosses a building even when a step is wider than one', () => {
    // The narrowest footprint the rules can produce is seven units; a step capped at
    // half a bucket was larger, so both ends of a move could be legal with the middle
    // of it inside the building.
    const narrow: CitySnapshot = { buildings: [building({ x: 120, z: 72, width: 7, depth: 7 })] };
    const collision = new CityCollision(narrow, RADIUS);
    const result = collision.move({ x: 115, z: 72 }, 10, 0);
    expect(result.x).toBeLessThan(120);
    expect(inside(narrow, result)).toBe(false);
  });

  it.each([2, 5, 9, 40, 400])('stays on one side of a narrow building for a step of %i', distance => {
    const narrow: CitySnapshot = { buildings: [building({ x: 0, z: 0, width: 7, depth: 7 })] };
    const collision = new CityCollision(narrow, RADIUS);
    for (const sign of [-1, 1]) {
      const from = { x: sign * -20, z: 0 };
      const result = collision.move(from, sign * distance * 2, 0);
      // Crossing the centre line would mean it passed through.
      expect(Math.sign(result.x - 0) === Math.sign(from.x) || result.x === from.x,
        `crossed from ${from.x} to ${result.x}`).toBe(true);
    }
  });
});

describe('the walker starts somewhere sensible', () => {
  it('spawns clear of every building', () => {
    const collision = new CityCollision(sampleCity, RADIUS);
    const first = sampleCity.buildings[0]!;
    // Ask to start inside a building; the search has to push out to open ground.
    const spawn = collision.spawn({ x: first.x, z: first.z });
    expect(collision.blocked(spawn)).toBe(false);
    expect(inside(sampleCity, spawn)).toBe(false);
  });

  it('leaves an already free request untouched', () => {
    const collision = new CityCollision(oneBuilding, RADIUS);
    expect(collision.spawn({ x: 200, z: 200 })).toEqual({ x: 200, z: 200 });
  });

  it('copes with a city that has no buildings at all', () => {
    const collision = new CityCollision({ buildings: [] }, RADIUS);
    expect(collision.blocked({ x: 0, z: 0 })).toBe(false);
    expect(collision.move({ x: 0, z: 0 }, 5, 5)).toEqual({ x: 5, z: 5 });
  });
});
