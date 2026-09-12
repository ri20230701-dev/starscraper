import type { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CityFraming } from '../three/cityFraming';

export class CityOrbitControls {
  private readonly controls: OrbitControls;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement, framing: CityFraming) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.target.set(...framing.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    // The travel limits follow the city's own size; a four-repository account and a
    // hundred-repository one need very different room to move.
    this.controls.minDistance = framing.minDistance;
    this.controls.maxDistance = framing.maxDistance;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.035;
    this.controls.update();
  }

  update(deltaSeconds: number): void {
    this.controls.update(deltaSeconds);
  }

  /** Return to the opening shot, as when a walker steps back out to the skyline view. */
  reset(framing: CityFraming): void {
    this.controls.target.set(...framing.target);
    this.controls.minDistance = framing.minDistance;
    this.controls.maxDistance = framing.maxDistance;
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
