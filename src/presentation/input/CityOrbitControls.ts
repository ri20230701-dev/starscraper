import type { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CityOrbitControls {
  private readonly controls: OrbitControls;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.target.set(0, 23, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 45;
    this.controls.maxDistance = 650;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.035;
    this.controls.update();
  }

  update(deltaSeconds: number): void {
    this.controls.update(deltaSeconds);
  }

  dispose(): void {
    this.controls.dispose();
  }
}
