import {
  ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight,
  Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import type { CitySnapshot } from '../../application/dto/CitySnapshot';
import type { CityRenderer } from '../ports/CityRenderer';
import { CityOrbitControls } from '../input/CityOrbitControls';
import { BuildingMeshes } from './BuildingMeshes';
import { CityPostProcessing } from './CityPostProcessing';
import { frameCity } from './cityFraming';

/** Passive graphics adapter. CityPresenter alone schedules frames. */
export class ThreeCityRenderer implements CityRenderer {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private buildings: BuildingMeshes | null = null;
  private controls: CityOrbitControls | null = null;
  private postProcessing: CityPostProcessing | null = null;
  private ground: Mesh<PlaneGeometry, MeshStandardMaterial> | null = null;
  private observer: ResizeObserver | null = null;
  private container: HTMLElement | null = null;
  private onFailure: (() => void) | null = null;

  mount(container: HTMLElement, city: CitySnapshot, onFailure: () => void): void {
    this.dispose();
    this.container = container;
    this.onFailure = onFailure;
    const canvas = container.ownerDocument.createElement('canvas');
    canvas.dataset.testid = 'city-canvas';
    canvas.setAttribute('aria-label', `Night city with ${city.buildings.length} buildings`);
    try {
      const context = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
      if (!context) throw new Error('WebGL 2 is unavailable.');
      this.renderer = new WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: false });
      this.renderer.info.autoReset = false;
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.scene = new Scene();
      this.scene.background = new Color('#050a16');
      this.scene.fog = new FogExp2('#050a16', 0.0025);
      // The city must read as lit *by its own windows*. Ambient and moonlight only
      // carve the silhouettes; anything brighter turns the facades into daylight.
      this.scene.add(new HemisphereLight('#8ba9e0', '#101724', 0.32));
      const moon = new DirectionalLight('#b4d0ff', 0.55);
      moon.position.set(-80, 180, 70);
      this.scene.add(moon);
      this.ground = new Mesh(new PlaneGeometry(2200, 2200), new MeshStandardMaterial({
        color: '#101925', roughness: 0.86, metalness: 0.55,
      }));
      this.ground.name = 'Ground';
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.y = -0.025;
      this.scene.add(this.ground);
      this.buildings = new BuildingMeshes(city);
      this.scene.add(this.buildings.group);
      const aspect = Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
      const framing = frameCity(city, 43, aspect);
      this.camera = new PerspectiveCamera(43, aspect, 0.5, 4000);
      this.camera.position.set(...framing.position);
      container.append(canvas);
      this.controls = new CityOrbitControls(this.camera, canvas, framing);
      this.postProcessing = new CityPostProcessing(this.renderer, this.scene, this.camera);
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(container);
      window.addEventListener('resize', this.resize);
      this.resize();
      this.renderFinal();
      if (import.meta.env.DEV) console.info('[starscraper scene]', JSON.stringify({
        buildings: this.buildings.group.children.length,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        preserveDrawingBuffer: context.getContextAttributes()?.preserveDrawingBuffer,
      }));
    } catch (error: unknown) {
      this.dispose();
      throw error;
    }
  }

  update(deltaSeconds: number): void {
    this.controls?.update(deltaSeconds);
  }

  renderFinal(): void {
    this.renderer?.info.reset();
    this.postProcessing?.render();
  }

  capturePng(): string {
    if (!this.renderer || !this.postProcessing) throw new Error('The city is not ready to capture.');
    // A resize notification may still be queued when the user clicks Save.
    this.resize();
    this.renderFinal();
    // No await, frame scheduling, or controls.update between rendering and reading.
    return this.renderer.domElement.toDataURL('image/png');
  }

  private readonly resize = (): void => {
    if (!this.renderer || !this.camera || !this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.postProcessing?.resize(width, height, pixelRatio);
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    const notify = this.onFailure;
    this.dispose();
    notify?.();
  };

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('resize', this.resize);
    this.controls?.dispose();
    this.controls = null;
    this.postProcessing?.dispose();
    this.postProcessing = null;
    this.buildings?.dispose();
    this.buildings = null;
    this.ground?.geometry.dispose();
    this.ground?.material.dispose();
    this.ground = null;
    this.scene?.clear();
    this.scene = null;
    this.camera = null;
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      canvas.remove();
      this.renderer = null;
    }
    this.container = null;
    this.onFailure = null;
  }
}
