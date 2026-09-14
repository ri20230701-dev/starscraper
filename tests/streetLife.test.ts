import { describe, expect, it } from 'vitest';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';
import { BuildCity } from '../src/application/usecases/BuildCity';
import type { Repository } from '../src/domain/model/Repository';
import { FORK_SATURATION, shopGradeOf, streetActivityOf, windowLitRatioOf } from '../src/domain/services/buildingRules';
import { CITY_GRID, isRoadCell } from '../src/domain/services/cityGrid';
import { layoutCity } from '../src/domain/services/cityLayout';
import {
  MAX_PEDESTRIANS, MAX_PER_BLOCK, PEDESTRIANS_PER_ACTIVE_BUILDING,
  blockOf, layoutStreetLife, routeAroundBlock,
} from '../src/domain/services/streetLife';

const REFERENCE = 1_767_225_600_000;
const DAY = 86_400_000;

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    name: 'street-life', stars: 0, forks: 0, language: 'TypeScript',
    pushedAt: REFERENCE, isFork: false, sizeKb: 0,
    description: null, htmlUrl: 'https://example.test/street-life',
    ...overrides,
  };
}

describe('street activity has a true zero independent of the window floor', () => {
  it.each([0, 1, 30, -10])('keeps a push %s days ago fully active', days => {
    expect(streetActivityOf(repository({ pushedAt: REFERENCE - days * DAY }), REFERENCE)).toBe(1);
  });

  it.each([365, 730, 1825, 10_000])('closes a shop completely at %s days', days => {
    const repo = repository({ pushedAt: REFERENCE - days * DAY });
    expect(streetActivityOf(repo, REFERENCE)).toBe(0);
    expect(shopGradeOf(repo, REFERENCE).openRatio).toBe(0);
    expect(windowLitRatioOf(repo, REFERENCE)).toBeGreaterThan(0);
  });

  it('treats a missing push as no street activity', () => {
    expect(streetActivityOf(repository({ pushedAt: null }), REFERENCE)).toBe(0);
  });

  it('interpolates in logarithmic age and approaches both boundaries continuously', () => {
    const at = (days: number) => streetActivityOf(repository({ pushedAt: REFERENCE - days * DAY }), REFERENCE);
    expect(at(Math.sqrt(30 * 365))).toBeCloseTo(0.5, 10);
    expect(at(30.001)).toBeLessThan(1);
    expect(at(364.999)).toBeGreaterThan(0);
    expect(at(364.999)).toBeLessThan(at(180));
    expect(at(180)).toBeLessThan(at(60));
  });
});

describe('shop grades carry recency and forks separately', () => {
  it.each([[0, 0], [FORK_SATURATION, 1], [50_000, 1]] as const)('maps %i forks to bounded busyness %s', (forks, expected) => {
    const grade = shopGradeOf(repository({ forks }), REFERENCE);
    expect(grade.busyness).toBe(expected);
    expect(grade.busyness).toBeGreaterThanOrEqual(0);
    expect(grade.busyness).toBeLessThanOrEqual(1);
  });

  it('uses each doubling of forks and does not substitute stars or activity for the audience', () => {
    const at = (forks: number) => shopGradeOf(repository({ forks }), REFERENCE).busyness;
    expect(at(1)).toBeGreaterThan(0);
    expect(at(3) - at(1)).toBeCloseTo(at(1) - at(0), 10);
    const recent = shopGradeOf(repository({ forks: 31, stars: 0 }), REFERENCE);
    const stale = shopGradeOf(repository({ forks: 31, stars: 100_000, pushedAt: REFERENCE - 730 * DAY }), REFERENCE);
    expect(recent.busyness).toBe(stale.busyness);
    expect(recent.openRatio).toBe(1);
    expect(stale.openRatio).toBe(0);
  });
});

describe('street routes surround blocks instead of searching a building’s immediate neighbours', () => {
  it('puts pedestrians around the single repository at (2, 2), with no adjacent road cells', () => {
    const snapshot = new BuildCity().execute([repository()], REFERENCE);
    const building = snapshot.buildings[0]!;
    expect([building.x / CITY_GRID.cellSize, building.z / CITY_GRID.cellSize]).toEqual([2, 2]);
    for (const [gx, gz] of [[1, 2], [3, 2], [2, 1], [2, 3]] as const) {
      expect(isRoadCell(gx, gz)).toBe(false);
    }
    expect(snapshot.pedestrians).toHaveLength(PEDESTRIANS_PER_ACTIVE_BUILDING);
    expect(snapshot.pedestrians[0]!.route).toEqual({ minX: 0, maxX: 96, minZ: 0, maxZ: 96 });
  });

  it.each([[-1, -1], [-5, -2], [1, -5], [-6, 2], [2, 2]] as const)(
    'keeps every cell on all four sides of the block containing (%i, %i) on roads', (gx, gz) => {
      const block = blockOf({ gx, gz });
      expect(block).toEqual({ bx: Math.floor(gx / 4), bz: Math.floor(gz / 4) });
      const route = routeAroundBlock(block);
      const minX = route.minX / CITY_GRID.cellSize;
      const maxX = route.maxX / CITY_GRID.cellSize;
      const minZ = route.minZ / CITY_GRID.cellSize;
      const maxZ = route.maxZ / CITY_GRID.cellSize;
      expect(gx).toBeGreaterThan(minX);
      expect(gx).toBeLessThan(maxX);
      expect(gz).toBeGreaterThan(minZ);
      expect(gz).toBeLessThan(maxZ);
      for (let x = minX; x <= maxX; x += 1) {
        expect(isRoadCell(x, minZ)).toBe(true);
        expect(isRoadCell(x, maxZ)).toBe(true);
      }
      for (let z = minZ; z <= maxZ; z += 1) {
        expect(isRoadCell(minX, z)).toBe(true);
        expect(isRoadCell(maxX, z)).toBe(true);
      }
    },
  );

  it('keeps shared road lamps unique, on road cells, and independent of activity', () => {
    const plots = [{ gx: -2, gz: -2, streetActivity: 1 }, { gx: 2, gz: -2, streetActivity: 1 }];
    const active = layoutStreetLife(plots);
    const abandoned = layoutStreetLife(plots.map(plot => ({ ...plot, streetActivity: 0 })));
    expect(active.streetLights).toEqual(abandoned.streetLights);
    expect(active.streetLights).toHaveLength(27); // Two 16-cell perimeters share five cells.
    expect(new Set(active.streetLights.map(light => `${light.x},${light.z}`)).size).toBe(27);
    for (const light of active.streetLights) {
      expect(isRoadCell(light.x / CITY_GRID.cellSize, light.z / CITY_GRID.cellSize)).toBe(true);
    }
  });
});

describe('population budgets are explicit and deterministic', () => {
  it('rounds combined block activity and caps each block before the city limit', () => {
    expect(layoutStreetLife([{ gx: 1, gz: 1, streetActivity: 0.1 }, { gx: 2, gz: 1, streetActivity: 0.1 }])
      .pedestrians).toHaveLength(1);
    const fullBlock = Array.from({ length: 9 }, (_, index) => ({
      gx: 1 + index % 3, gz: 1 + Math.floor(index / 3), streetActivity: 1,
    }));
    const populated = layoutStreetLife(fullBlock);
    expect(populated.pedestrians).toHaveLength(MAX_PER_BLOCK);
    expect(populated.omittedPedestrians).toBe(0);
  });

  it('budgets higher-activity blocks first even when the quiet block arrives first', () => {
    const plots = [{ gx: -2, gz: 2, streetActivity: 0.5 }];
    for (let bx = 0; bx < 10; bx += 1) {
      for (let index = 0; index < 9; index += 1) {
        plots.push({ gx: bx * 4 + 1 + index % 3, gz: 1 + Math.floor(index / 3), streetActivity: 1 });
      }
    }
    const built = layoutStreetLife(plots);
    expect(built.pedestrians).toHaveLength(MAX_PEDESTRIANS);
    expect(built.omittedPedestrians).toBe(2);
    expect(built.pedestrians.every(pedestrian => pedestrian.route.minX >= 0)).toBe(true);
    expect(layoutStreetLife([...plots].reverse())).toEqual(built);
  });

  it('reports the city-wide truncation in the application DTO', () => {
    // The first 100 plots occupy nine full blocks, six three-plot blocks, and one plot:
    // 9*24 + 6*12 + 4 = 292 requested pedestrians, of which 52 must be reported as omitted.
    const repositories = Array.from({ length: 100 }, (_, index) => repository({ name: `repo-${index}` }));
    const snapshot = new BuildCity().execute(repositories, REFERENCE);
    expect(snapshot.pedestrians).toHaveLength(240);
    expect(snapshot.omittedPedestrians).toBe(52);
    expect(snapshot.omittedPedestrians).toBe(layoutCity(repositories, REFERENCE).omittedPedestrians);
  });

  it('returns exact empty collections for no repositories', () => {
    expect(new BuildCity().execute([], REFERENCE)).toEqual({
      buildings: [], pedestrians: [], streetLights: [], omittedPedestrians: 0,
    });
  });

  it('leaves all two-year-old shops closed and all streets empty of pedestrians', () => {
    const repositories = Array.from({ length: 40 }, (_, index) => repository({
      name: `abandoned-${index}`, forks: 50_000, pushedAt: REFERENCE - 730 * DAY,
    }));
    const snapshot = new BuildCity().execute(repositories, REFERENCE);
    expect(snapshot.pedestrians).toEqual([]);
    expect(snapshot.omittedPedestrians).toBe(0);
    expect(snapshot.buildings.every(building => building.shopOpenRatio === 0)).toBe(true);
    expect(snapshot.streetLights.length).toBeGreaterThan(0);
  });

  it('builds identical pedestrian variation, lamps, and shop grades from the unchanged 12-repository sample', () => {
    const repositories = SAMPLE_REPOSITORY_PAGE.repositories;
    expect(repositories).toHaveLength(12);
    const build = new BuildCity();
    const first = build.execute(repositories, SAMPLE_REFERENCE_TIME);
    const second = build.execute(repositories, SAMPLE_REFERENCE_TIME);
    expect(second.pedestrians).toEqual(first.pedestrians);
    expect(second.streetLights).toEqual(first.streetLights);
    expect(second.buildings.map(building => [building.shopOpenRatio, building.shopBusyness]))
      .toEqual(first.buildings.map(building => [building.shopOpenRatio, building.shopBusyness]));
    expect(first.pedestrians.length).toBeGreaterThan(0);
    expect(first.buildings.some(building => building.shopOpenRatio === 0)).toBe(true);
    expect(first.buildings.some(building => building.shopOpenRatio === 1)).toBe(true);
    expect(first.buildings.some(building => building.shopBusyness === 0)).toBe(true);
    expect(first.buildings.some(building => building.shopBusyness === 1)).toBe(true);
    expect(new Set(first.pedestrians.map(pedestrian => pedestrian.phase)).size).toBeGreaterThan(1);
    expect(new Set(first.pedestrians.map(pedestrian => pedestrian.speed)).size).toBeGreaterThan(1);
    expect(new Set(first.pedestrians.map(pedestrian => pedestrian.direction))).toEqual(new Set([-1, 1]));
    for (const pedestrian of first.pedestrians) {
      expect(pedestrian.phase).toBeGreaterThanOrEqual(0);
      expect(pedestrian.phase).toBeLessThan(1);
      expect(pedestrian.speed).toBeGreaterThan(0);
    }
  });

  it('preserves shop grades with repository identities after recency sorting', () => {
    const snapshot = new BuildCity().execute([
      repository({ name: 'stale', forks: 50_000, pushedAt: REFERENCE - 730 * DAY }),
      repository({ name: 'fresh', forks: 0 }),
    ], REFERENCE);
    expect(snapshot.buildings.map(building => [building.name, building.shopOpenRatio, building.shopBusyness]))
      .toEqual([['fresh', 1, 0], ['stale', 0, 1]]);
  });
});
