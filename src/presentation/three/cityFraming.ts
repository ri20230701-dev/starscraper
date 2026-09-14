import type { CitySnapshot } from '../../application/dto/CitySnapshot';
import {
  PEDESTRIAN_HEIGHT, PEDESTRIAN_RADIUS, STREET_LIGHT_HEIGHT, STREET_LIGHT_POOL_RADIUS,
} from './streetDimensions';

export interface CityFraming {
  /** Where the camera sits, in world units. */
  readonly position: readonly [number, number, number];
  /** What it looks at: the middle of the skyline, not the ground. */
  readonly target: readonly [number, number, number];
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Far plane and fog density sized for this city, not for a fixed one. */
  readonly far: number;
  readonly fogDensity: number;
}

const EMPTY: CityFraming = {
  position: [90, 70, 110], target: [0, 6, 0],
  minDistance: 20, maxDistance: 650, far: 2600, fogDensity: 0.0025,
};

/**
 * Frame the camera around the city that actually exists.
 *
 * A fixed viewpoint was sized for a hundred buildings, which leaves an account of four
 * repositories as a speck in the dark — and most accounts are far below a hundred. The
 * opening shot has to fit whatever it is given, because switching users changes the
 * city's extent by an order of magnitude.
 *
 * Fitting is done against a sphere around the point the camera looks at. Fitting the
 * half-height instead left the target below the true centre, so a single very tall tower
 * projected past the top of the screen even though the arithmetic said it fit.
 */
export function frameCity(city: CitySnapshot, verticalFovDegrees: number, aspect: number): CityFraming {
  if (city.buildings.length === 0 && city.pedestrians.length === 0 && city.streetLights.length === 0) return EMPTY;

  // Measure the city where it actually stands. The grid starts inside a block rather
  // than at the origin, so assuming the skyline is centred would frame empty ground.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let tallest = 0;
  for (const building of city.buildings) {
    minX = Math.min(minX, building.x - building.width / 2);
    maxX = Math.max(maxX, building.x + building.width / 2);
    minZ = Math.min(minZ, building.z - building.depth / 2);
    maxZ = Math.max(maxZ, building.z + building.depth / 2);
    if (building.height > tallest) tallest = building.height;
  }
  // A pedestrian can visit every corner of its route. Fitting just today's instance
  // positions would let the same walkers leave the opening shot a few seconds later.
  for (const pedestrian of city.pedestrians) {
    minX = Math.min(minX, pedestrian.route.minX - PEDESTRIAN_RADIUS);
    maxX = Math.max(maxX, pedestrian.route.maxX + PEDESTRIAN_RADIUS);
    minZ = Math.min(minZ, pedestrian.route.minZ - PEDESTRIAN_RADIUS);
    maxZ = Math.max(maxZ, pedestrian.route.maxZ + PEDESTRIAN_RADIUS);
    tallest = Math.max(tallest, PEDESTRIAN_HEIGHT);
  }
  for (const light of city.streetLights) {
    minX = Math.min(minX, light.x - STREET_LIGHT_POOL_RADIUS);
    maxX = Math.max(maxX, light.x + STREET_LIGHT_POOL_RADIUS);
    minZ = Math.min(minZ, light.z - STREET_LIGHT_POOL_RADIUS);
    maxZ = Math.max(maxZ, light.z + STREET_LIGHT_POOL_RADIUS);
    tallest = Math.max(tallest, STREET_LIGHT_HEIGHT);
  }
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  // Aim at the middle of the skyline's height so the fit is symmetric about the axis.
  const targetY = tallest / 2;

  // Radius of the sphere containing buildings and all street life, measured from the target.
  const halfX = Math.max((maxX - minX) / 2, 12);
  const halfZ = Math.max((maxZ - minZ) / 2, 12);
  const radius = Math.max(Math.hypot(halfX, halfZ, targetY), 26);

  const verticalFov = (verticalFovDegrees * Math.PI) / 180;
  // The horizontal field binds on wide screens and the vertical one on tall screens, so
  // fit against whichever is narrower. The real aspect is used, unclamped, because the
  // camera itself is not clamped and a mismatch is what lets the edges crop.
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  // A sphere of this radius fits when the half-angle subtends it: distance = r / sin(θ/2).
  const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.08;

  // Roughly 34 degrees above the ground: high enough to read the street grid, low enough
  // that the towers still overlap and the skyline has depth.
  const elevation = Math.sin(0.6) * distance;
  const ground = Math.cos(0.6) * distance;
  const maxDistance = distance * 3;
  return {
    position: [centreX + ground * 0.68, targetY + elevation, centreZ + ground * 0.73],
    target: [centreX, targetY, centreZ],
    minDistance: Math.max(12, radius * 0.2),
    maxDistance,
    // Everything must stay visible at the furthest allowed zoom, so the far plane clears
    // the whole city from there rather than sitting at a fixed depth.
    far: (maxDistance + radius) * 1.25,
    // Fog is tuned to the city's own size. A density fixed for a small scene buried a
    // large one: at the opening distance almost none of the original colour survived.
    fogDensity: 0.9 / Math.max(1, distance + radius),
  };
}
