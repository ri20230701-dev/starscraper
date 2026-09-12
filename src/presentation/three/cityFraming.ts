import type { CitySnapshot } from '../../application/dto/CitySnapshot';

export interface CityFraming {
  /** Where the camera sits, in world units. */
  readonly position: readonly [number, number, number];
  /** What it looks at: the middle of the skyline, not the ground. */
  readonly target: readonly [number, number, number];
  readonly minDistance: number;
  readonly maxDistance: number;
}

/**
 * Frame the camera around the city that actually exists.
 *
 * A fixed viewpoint was sized for a hundred buildings, which leaves an account of four
 * repositories as a speck in the dark — and most accounts are far below a hundred. The
 * opening shot has to fit whatever it is given, because switching users changes the
 * city's extent by an order of magnitude.
 */
export function frameCity(city: CitySnapshot, verticalFovDegrees: number, aspect: number): CityFraming {
  if (city.buildings.length === 0) {
    return { position: [90, 70, 110], target: [0, 6, 0], minDistance: 20, maxDistance: 650 };
  }

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
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  // A lone building still needs breathing room, so the radius has a floor.
  const radius = Math.max(Math.hypot(maxX - minX, maxZ - minZ) / 2, 34);

  const verticalFov = (verticalFovDegrees * Math.PI) / 180;
  // The horizontal field is the binding one on wide screens and the vertical one on tall
  // screens, so fit against whichever is narrower.
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.2, aspect));
  const span = Math.hypot(radius, tallest / 2);
  const distance = (span / Math.tan(Math.min(verticalFov, horizontalFov) / 2)) * 1.15;

  // Roughly 34 degrees above the ground: high enough to read the street grid, low enough
  // that the towers still overlap and the skyline has depth.
  const elevation = Math.sin(0.6) * distance;
  const ground = Math.cos(0.6) * distance;
  return {
    position: [centreX + ground * 0.68, elevation + tallest * 0.25, centreZ + ground * 0.73],
    target: [centreX, Math.min(tallest * 0.45, 40), centreZ],
    minDistance: Math.max(12, radius * 0.2),
    maxDistance: distance * 3.5,
  };
}
