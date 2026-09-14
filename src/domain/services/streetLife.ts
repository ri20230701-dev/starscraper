import { nameNoise } from './buildingRules';
import { CITY_GRID, cellCentre } from './cityGrid';
import type { GridCell } from './cityGrid';

export const PEDESTRIANS_PER_ACTIVE_BUILDING = 4;
export const MAX_PER_BLOCK = 24;
export const MAX_PEDESTRIANS = 240;

export interface StreetBuilding extends GridCell {
  readonly streetActivity: number;
}

export interface CityBlock {
  readonly bx: number;
  readonly bz: number;
}

/** The four road centre lines surrounding a block, in world units. */
export interface PedestrianRoute {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Pedestrian {
  readonly route: PedestrianRoute;
  /** Fraction of one circuit, in [0, 1). */
  readonly phase: number;
  /** World units per second. */
  readonly speed: number;
  readonly direction: 1 | -1;
}

export interface StreetLight {
  readonly x: number;
  readonly z: number;
}

export interface StreetLife {
  readonly pedestrians: readonly Pedestrian[];
  readonly streetLights: readonly StreetLight[];
  /** Requested pedestrians excluded by the city-wide cap, after each block's cap. */
  readonly omittedPedestrians: number;
}

export function blockOf(cell: GridCell): CityBlock {
  return Object.freeze({
    bx: Math.floor(cell.gx / CITY_GRID.roadPeriod),
    bz: Math.floor(cell.gz / CITY_GRID.roadPeriod),
  });
}

export function routeAroundBlock(block: CityBlock): PedestrianRoute {
  const first = cellCentre({ gx: block.bx * CITY_GRID.roadPeriod, gz: block.bz * CITY_GRID.roadPeriod });
  const last = cellCentre({ gx: (block.bx + 1) * CITY_GRID.roadPeriod, gz: (block.bz + 1) * CITY_GRID.roadPeriod });
  return Object.freeze({ minX: first.x, maxX: last.x, minZ: first.z, maxZ: last.z });
}

/**
 * A block's occupants use the surrounding roads, even when none of their adjacent cells
 * are roads. Lamps belong to those roads and do not depend on repository activity.
 */
export function layoutStreetLife(buildings: readonly StreetBuilding[]): StreetLife {
  const blocks = new Map<string, CityBlock & { activity: number }>();
  for (const building of buildings) {
    const block = blockOf(building);
    const key = `${block.bx},${block.bz}`;
    const existing = blocks.get(key);
    if (existing) existing.activity += building.streetActivity;
    else blocks.set(key, { ...block, activity: building.streetActivity });
  }
  // Higher activity gets the finite instance budget first; coordinates resolve ties.
  const ordered = [...blocks.values()].sort((left, right) =>
    right.activity - left.activity || left.bx - right.bx || left.bz - right.bz);
  const pedestrians: Pedestrian[] = [];
  const lights = new Map<string, StreetLight>();
  let omittedPedestrians = 0;
  for (const block of ordered) {
    const route = routeAroundBlock(block);
    const requested = Math.min(MAX_PER_BLOCK, Math.round(block.activity * PEDESTRIANS_PER_ACTIVE_BUILDING));
    const count = Math.min(requested, MAX_PEDESTRIANS - pedestrians.length);
    omittedPedestrians += requested - count;
    for (let index = 0; index < count; index += 1) {
      const seed = `${block.bx},${block.bz}:${index}`;
      pedestrians.push(Object.freeze({
        route,
        phase: nameNoise(`${seed}:phase`),
        speed: 0.85 + nameNoise(`${seed}:speed`) * 0.5,
        direction: nameNoise(`${seed}:direction`) < 0.5 ? -1 : 1,
      }));
    }
    // One lamp per road cell. A shared edge/intersection is infrastructure only once.
    const addLight = (gx: number, gz: number): void => {
      const key = `${gx},${gz}`;
      if (!lights.has(key)) lights.set(key, Object.freeze(cellCentre({ gx, gz })));
    };
    const gx = block.bx * CITY_GRID.roadPeriod;
    const gz = block.bz * CITY_GRID.roadPeriod;
    for (let offset = 0; offset <= CITY_GRID.roadPeriod; offset += 1) {
      addLight(gx + offset, gz);
      addLight(gx + offset, gz + CITY_GRID.roadPeriod);
      addLight(gx, gz + offset);
      addLight(gx + CITY_GRID.roadPeriod, gz + offset);
    }
  }
  const streetLights = [...lights.values()].sort((left, right) => left.x - right.x || left.z - right.z);
  return Object.freeze({
    pedestrians: Object.freeze(pedestrians),
    streetLights: Object.freeze(streetLights),
    omittedPedestrians,
  });
}
