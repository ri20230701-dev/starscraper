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
  readonly name: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly language: string | null;
  readonly stars: number;
  /** Unix milliseconds, or null when the provider reported no push. */
  readonly pushedAt: number | null;
  readonly isFork: boolean;
}

export interface CitySnapshot {
  readonly buildings: readonly BuildingSnapshot[];
}
