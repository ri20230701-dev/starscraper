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
    expect(result).toEqual({ x: 40, z: -20 });
  });

  it('keeps a thousand random walks out of every building in the sample city', () => {
    const collision = new CityCollision(sampleCity, RADIUS);
    let point = collision.spawn({ x: 0, z: 0 });
    // A cheap deterministic sequence: no clock, no Math.random, reproducible on failure.
    let seed = 12_345;
    const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
    for (let step = 0; step < 1_000; step += 1) {
      const radians = next() * Math.PI * 2;
      const distance = next() * 40;
      point = collision.move(point, Math.cos(radians) * distance, Math.sin(radians) * distance);
      expect(inside(sampleCity, point), `step ${step} at ${point.x},${point.z}`).toBe(false);
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
