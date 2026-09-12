import type { BuildingSnapshot, CitySnapshot } from '../../application/dto/CitySnapshot';

export type CityMode = 'orbit' | 'walk';

export interface CityRenderer {
  mount(container: HTMLElement, city: CitySnapshot, onFailure: () => void): void;
  update(deltaSeconds: number): void;
  renderFinal(): void;
  capturePng(): string;
  /** Switch between orbiting the skyline and walking the streets. */
  setMode(mode: CityMode, onLockChange: (locked: boolean) => void): void;
  /** The building under the crosshair, which is how selection works while pointer-locked. */
  pickAtCentre(): BuildingSnapshot | null;
  dispose(): void;
}
