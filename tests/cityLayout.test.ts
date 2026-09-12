import { describe, expect, it } from 'vitest';
import type { Repository } from '../src/domain/model/Repository';
import { BUILDING_RULES, WINDOW_LIT, byRecency, depthOf, footprintOf, heightOf, windowLitRatioOf } from '../src/domain/services/buildingRules';
import { CITY_GRID, MAX_FOOTPRINT, isRoadCell, plotCells } from '../src/domain/services/cityGrid';
import { layoutCity } from '../src/domain/services/cityLayout';
import { colorForLanguage, UNKNOWN_LANGUAGE_COLOR } from '../src/domain/services/languageColors';

const REFERENCE = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    name: 'starscraper',
    stars: 0,
    forks: 0,
    language: 'TypeScript',
    pushedAt: REFERENCE - DAY,
    isFork: false,
    sizeKb: 500,
    description: null,
    htmlUrl: 'https://github.com/example/starscraper',
    ...overrides,
  };
}

function city(count: number, overrides: (index: number) => Partial<Repository> = () => ({})) {
  const repositories = Array.from({ length: count }, (_unused, index) => repository({
    name: `repo-${String(index).padStart(3, '0')}`,
    stars: index * 7,
    sizeKb: 50 + index * 37,
    pushedAt: REFERENCE - index * DAY,
    ...overrides(index),
  }));
  return layoutCity(repositories, REFERENCE);
}

describe('grid placement keeps the streets clear', () => {
  it.each([1, 2, 7, 25, 100])('never lets a building of %i reach its cell edge', count => {
    for (const building of city(count).buildings) {
      // The building is centred in its cell, so half its span must fit inside the margin.
      expect(Math.max(building.width, building.depth) / 2)
        .toBeLessThanOrEqual(CITY_GRID.cellSize / 2 - CITY_GRID.buildingMargin);
    }
  });

  it('caps the footprint rule below the width the grid can hold', () => {
    // A repository far larger than any real one must still clamp inside the plot.
    expect(footprintOf(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(MAX_FOOTPRINT);
    expect(MAX_FOOTPRINT + CITY_GRID.buildingMargin * 2).toBeLessThanOrEqual(CITY_GRID.cellSize);
  });

  it.each([1, 2, 7, 25, 100])('places %i buildings without overlapping any other', count => {
    const buildings = city(count).buildings;
    for (let left = 0; left < buildings.length; left += 1) {
      for (let right = left + 1; right < buildings.length; right += 1) {
        const a = buildings[left]!;
        const b = buildings[right]!;
        const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2
          || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2;
        expect(apart, `${a.x},${a.z} overlaps ${b.x},${b.z}`).toBe(true);
      }
    }
  });

  it('never puts a building on a road cell', () => {
    for (const building of city(100).buildings) {
      const gx = building.x / CITY_GRID.cellSize;
      const gz = building.z / CITY_GRID.cellSize;
      expect(Number.isInteger(gx) && Number.isInteger(gz)).toBe(true);
      expect(isRoadCell(gx, gz)).toBe(false);
    }
  });

  it('leaves the road network connected across the built area', () => {
    const buildings = city(100).buildings;
    const extent = Math.max(...buildings.map(building =>
      Math.max(Math.abs(building.x), Math.abs(building.z)))) / CITY_GRID.cellSize + 1;
    const roads = new Set<string>();
    for (let gx = -extent; gx <= extent; gx += 1) {
      for (let gz = -extent; gz <= extent; gz += 1) {
        if (isRoadCell(gx, gz)) roads.add(`${gx},${gz}`);
      }
    }
    // Flood fill from one road cell; a disconnected block would leave cells unvisited.
    const start = roads.values().next().value;
    expect(start).toBeDefined();
    const seen = new Set<string>([start!]);
    const queue = [start!];
    while (queue.length > 0) {
      const [gx, gz] = queue.pop()!.split(',').map(Number) as [number, number];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = `${gx + dx},${gz + dz}`;
        if (roads.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
    expect(seen.size).toBe(roads.size);
  });

  it('produces exactly one plot per repository', () => {
    expect(plotCells(0)).toHaveLength(0);
    expect(plotCells(37)).toHaveLength(37);
    expect(new Set(plotCells(80).map(cell => `${cell.gx},${cell.gz}`)).size).toBe(80);
  });
});

describe('height and footprint compress the long tail', () => {
  it('grows height per doubling rather than per star', () => {
    const at = (stars: number) => heightOf(repository({ stars }));
    // The whole point of the log scale: one more star must matter far more to a repository
    // with none than to one with ten thousand, or a single famous project flattens the rest.
    expect(at(1) - at(0)).toBeGreaterThan((at(10_000) - at(9_999)) * 1000);
    // Every doubling is worth the same rise, which is what keeps the skyline readable.
    for (const [lower, upper] of [[0, 1], [1, 3], [3, 7], [7, 15], [1_023, 2_047]] as const) {
      expect(at(upper) - at(lower)).toBeCloseTo(BUILDING_RULES.heightPerDoubling, 6);
    }
    expect(at(0)).toBe(BUILDING_RULES.baseHeight);
  });

  it('keeps every plausible repository inside a legible height band', () => {
    expect(heightOf(repository({ stars: 200_000 }))).toBeLessThan(130);
    expect(heightOf(repository({ stars: 0 }))).toBeGreaterThan(0);
  });

  it('holds forks below their originals', () => {
    const stars = 500;
    expect(heightOf(repository({ stars, isFork: true })))
      .toBeCloseTo(heightOf(repository({ stars })) * BUILDING_RULES.forkHeightScale);
  });

  it('clamps footprints at both ends', () => {
    expect(footprintOf(0)).toBe(BUILDING_RULES.minFootprint);
    expect(footprintOf(-5)).toBe(BUILDING_RULES.minFootprint);
    expect(footprintOf(10 ** 9)).toBe(BUILDING_RULES.maxFootprint);
  });
});

describe('windows report when the work stopped', () => {
  it.each([
    ['pushed today', 0, WINDOW_LIT.freshRatio],
    ['pushed within the fresh window', WINDOW_LIT.freshDays, WINDOW_LIT.freshRatio],
    ['a year untouched', WINDOW_LIT.staleDays, WINDOW_LIT.staleRatio],
    ['five years untouched', WINDOW_LIT.abandonedDays, WINDOW_LIT.abandonedRatio],
    ['a decade untouched', WINDOW_LIT.abandonedDays * 2, WINDOW_LIT.abandonedRatio],
  ])('%s', (_name, ageDays, expected) => {
    const pushedAt = REFERENCE - ageDays * DAY;
    expect(windowLitRatioOf(repository({ pushedAt }), REFERENCE)).toBeCloseTo(expected, 5);
  });

  it('darkens monotonically as a repository ages', () => {
    const ratios = [0, 45, 90, 180, 365, 900, 1825, 4000].map(days =>
      windowLitRatioOf(repository({ pushedAt: REFERENCE - days * DAY }), REFERENCE));
    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index]!).toBeLessThanOrEqual(ratios[index - 1]!);
    }
  });

  it('treats a missing push date as fully dark and stays within range', () => {
    expect(windowLitRatioOf(repository({ pushedAt: null }), REFERENCE)).toBe(WINDOW_LIT.abandonedRatio);
    // A clock skewed behind the data must not produce a ratio above one.
    expect(windowLitRatioOf(repository({ pushedAt: REFERENCE + DAY }), REFERENCE))
      .toBe(WINDOW_LIT.freshRatio);
  });
});

describe('language decides the wall', () => {
  it.each([
    ['TypeScript', '#3178c6'],
    ['typescript', '#3178c6'],
    ['  Rust  ', '#dea584'],
  ])('maps %s regardless of casing or padding', (language, expected) => {
    expect(colorForLanguage(language)).toBe(expected);
  });

  it.each([null, 'Brainfuck', ''])('falls back to grey for %s', language => {
    expect(colorForLanguage(language)).toBe(UNKNOWN_LANGUAGE_COLOR);
  });

  it('pulls a fork toward grey without changing its shape family', () => {
    const original = layoutCity([repository({ language: 'Rust' })], REFERENCE).buildings[0]!;
    const forked = layoutCity([repository({ language: 'Rust', isFork: true })], REFERENCE).buildings[0]!;
    expect(forked.color).not.toBe(original.color);
    expect(forked.width).toBe(original.width);
  });
});

describe('the same data and instant always build the same city', () => {
  it('is byte-identical across builds', () => {
    const repositories = Array.from({ length: 40 }, (_unused, index) => repository({
      name: `repo-${index}`, stars: index * 13, sizeKb: index * 91, pushedAt: REFERENCE - index * DAY,
    }));
    const first = JSON.stringify(layoutCity(repositories, REFERENCE));
    const shuffled = [...repositories].reverse();
    expect(JSON.stringify(layoutCity(shuffled, REFERENCE))).toBe(first);
    expect(JSON.stringify(layoutCity(repositories, REFERENCE))).toBe(first);
  });

  it('breaks ties on name so equal push times never swap places', () => {
    const pushedAt = REFERENCE - 5 * DAY;
    const names = ['zebra', 'alpha', 'middle'];
    const built = layoutCity(names.map(name => repository({ name, pushedAt })), REFERENCE);
    expect(built.buildings.map(building => building.name)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('sorts repositories without a push date to the edge of town', () => {
    const built = layoutCity([
      repository({ name: 'undated', pushedAt: null }),
      repository({ name: 'recent', pushedAt: REFERENCE - DAY }),
    ], REFERENCE);
    expect(built.buildings.map(building => building.name)).toEqual(['recent', 'undated']);
  });

  it('orders by recency, newest downtown', () => {
    const sorted = [
      repository({ name: 'old', pushedAt: REFERENCE - 900 * DAY }),
      repository({ name: 'new', pushedAt: REFERENCE - DAY }),
    ].sort(byRecency);
    expect(sorted.map(entry => entry.name)).toEqual(['new', 'old']);
    const [downtown] = layoutCity(sorted, REFERENCE).buildings;
    expect(Math.abs(downtown!.x) + Math.abs(downtown!.z))
      .toBeLessThan(CITY_GRID.cellSize * CITY_GRID.roadPeriod);
  });

  it('builds an empty city without throwing', () => {
    expect(layoutCity([], REFERENCE).buildings).toEqual([]);
  });
});

describe('size and name stay legible across a real account', () => {
  it('spreads footprints across the sizes repositories actually have', () => {
    // A rule that saturates at a few hundred KB gives almost every real repository the
    // same plot, which throws the size signal away entirely.
    const widths = [100, 1_000, 10_000, 50_000].map(footprintOf);
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]!).toBeGreaterThan(widths[index - 1]! + 0.5);
    }
    expect(footprintOf(BUILDING_RULES.footprintSaturationKb)).toBeCloseTo(BUILDING_RULES.maxFootprint, 6);
  });

  it('keeps distinct depths at the widest footprint', () => {
    // Scaling then clamping collapsed here: every name above the midpoint produced the
    // maximum depth, so large repositories all became the same box.
    const huge = 900_000;
    const depths = ['frontend', 'backend', 'website', 'zeta'].map(name =>
      depthOf(repository({ name, sizeKb: huge })));
    expect(new Set(depths).size).toBe(depths.length);
    for (const depth of depths) {
      expect(depth).toBeLessThanOrEqual(BUILDING_RULES.maxFootprint);
      expect(depth).toBeGreaterThanOrEqual(BUILDING_RULES.minFootprint);
    }
  });

  it('keeps distinct depths at the smallest footprint too', () => {
    const depths = ['a', 'bb', 'ccc', 'dddd'].map(name => depthOf(repository({ name, sizeKb: 0 })));
    expect(new Set(depths).size).toBe(depths.length);
    for (const depth of depths) expect(depth).toBeGreaterThanOrEqual(BUILDING_RULES.minFootprint);
  });

  it('does not flatten an account of large repositories into identical boxes', () => {
    const built = layoutCity(['frontend', 'backend', 'website'].map((name, index) => repository({
      name, sizeKb: [1_024, 10_240, 102_400][index]!, stars: 0, pushedAt: REFERENCE - DAY,
    })), REFERENCE);
    const shapes = built.buildings.map(building => `${building.width}x${building.depth}`);
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

describe('inputs the grid must refuse', () => {
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects a plot count of %s', count => {
    // The spiral stops on an exact length match, so a fractional count would never halt.
    expect(() => plotCells(count)).toThrow(RangeError);
  });
});

describe('language lookup ignores inherited keys', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('treats %s as unknown', language => {
    expect(colorForLanguage(language)).toBe(UNKNOWN_LANGUAGE_COLOR);
  });

  it('does not throw when such a name reaches the fork path', () => {
    const built = layoutCity([repository({ language: 'constructor', isFork: true })], REFERENCE);
    expect(built.buildings[0]!.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('the snapshot carries what the viewer will read', () => {
  it('keeps each repository attached to its own building after sorting', () => {
    const repositories = [
      repository({ name: 'oldest', htmlUrl: 'https://example.test/oldest', stars: 3, pushedAt: REFERENCE - 400 * DAY }),
      repository({ name: 'newest', htmlUrl: 'https://example.test/newest', stars: 9, pushedAt: REFERENCE - DAY }),
    ];
    const built = layoutCity(repositories, REFERENCE);
    // Placement reorders, so the input index cannot recover the pairing later.
    expect(built.buildings.map(building => [building.name, building.htmlUrl, building.stars]))
      .toEqual([['newest', 'https://example.test/newest', 9], ['oldest', 'https://example.test/oldest', 3]]);
  });
});
