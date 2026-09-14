/**
 * Rendering data plus the facts the viewer reads off a building.
 *
 * The metadata travels with the geometry because placement sorts by recency: the caller
 * cannot recover which repository became which building from the input order, so anything
 * the crosshair or a tooltip needs has to be resolved here.
 */
export interface BuildingSnapshot {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color: string;
  readonly windowLitRatio: number;
  readonly shopOpenRatio: number;
  readonly shopBusyness: number;
  readonly name: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly language: string | null;
  readonly stars: number;
  /** Unix milliseconds, or null when the provider reported no push. */
  readonly pushedAt: number | null;
  readonly isFork: boolean;
}

export interface PedestrianSnapshot {
  readonly route: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
  /** Fraction of one circuit, in [0, 1). */
  readonly phase: number;
  /** World units per second. */
  readonly speed: number;
  readonly direction: 1 | -1;
}

export interface StreetLightSnapshot {
  readonly x: number;
  readonly z: number;
}

export interface CitySnapshot {
  readonly buildings: readonly BuildingSnapshot[];
  readonly pedestrians: readonly PedestrianSnapshot[];
  readonly streetLights: readonly StreetLightSnapshot[];
  /** Requested pedestrians omitted by the city-wide instance limit. */
  readonly omittedPedestrians: number;
}
