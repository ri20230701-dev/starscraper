/** Rendering data only. The domain mapping and real placement arrive in issue #2. */
export interface BuildingSnapshot {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color: string;
  readonly windowLitRatio: number;
}

export interface CitySnapshot {
  readonly buildings: readonly BuildingSnapshot[];
}
