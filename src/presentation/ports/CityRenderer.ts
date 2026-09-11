import type { CitySnapshot } from '../../application/dto/CitySnapshot';

export interface CityRenderer {
  mount(container: HTMLElement, city: CitySnapshot, onFailure: () => void): void;
  update(deltaSeconds: number): void;
  renderFinal(): void;
  dispose(): void;
}
