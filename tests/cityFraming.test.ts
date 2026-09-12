import { describe, expect, it } from 'vitest';
import type { BuildingSnapshot, CitySnapshot } from '../src/application/dto/CitySnapshot';
import { frameCity } from '../src/presentation/three/cityFraming';

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

describe('the opening shot fits whatever city it is given', () => {
  it.each([
    ['no buildings at all', city([]), 1.78],
    ['a single low building', city([building()]), 1.78],
    ['one 200k-star tower on a small plot', city([building({ height: 117.66, width: 7, depth: 7 })]), 1.78],
    ['a portrait phone', city([building({ height: 117.66 })]), 0.42],
    ['an ultrawide display', city([building({ height: 117.66 })]), 5],
    ['a hundred buildings off the origin', block, 2.65],
  ])('%s', (_name, snapshot, aspect) => {
    const framing = frameCity(snapshot, 43, aspect);
    const numbers = [...framing.position, ...framing.target, framing.minDistance, framing.maxDistance];
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(framing.minDistance).toBeLessThan(framing.maxDistance);

    // The camera must start inside its own orbit limits. Outside them the controls snap
    // the view on the first frame, which reads as the page glitching on load.
    const distance = Math.hypot(
      framing.position[0] - framing.target[0],
      framing.position[1] - framing.target[1],
      framing.position[2] - framing.target[2],
    );
    expect(distance).toBeGreaterThanOrEqual(framing.minDistance);
    expect(distance).toBeLessThanOrEqual(framing.maxDistance);
  });

  it('looks at the city rather than the world origin', () => {
    // The grid starts inside a block, so a city never straddles the origin evenly.
    const framing = frameCity(block, 43, 1.78);
    expect(framing.target[0]).toBeGreaterThan(100);
    expect(framing.target[2]).toBeGreaterThan(100);
  });

  it('pulls back further for a larger city', () => {
    const near = frameCity(city([building()]), 43, 1.78);
    const far = frameCity(block, 43, 1.78);
    const spanOf = (framing: ReturnType<typeof frameCity>) => Math.hypot(
      framing.position[0] - framing.target[0],
      framing.position[1] - framing.target[1],
      framing.position[2] - framing.target[2],
    );
    expect(spanOf(far)).toBeGreaterThan(spanOf(near) * 2);
  });
});
