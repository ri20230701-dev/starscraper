import {
  ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight,
  Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import type { CitySnapshot } from '../../application/dto/CitySnapshot';
import type { CityRenderer } from '../ports/CityRenderer';
import { CityOrbitControls } from '../input/CityOrbitControls';
import { BuildingMeshes } from './BuildingMeshes';

/** Passive graphics adapter. CityPresenter alone schedules frames. */
export class ThreeCityRenderer implements CityRenderer {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private buildings: BuildingMeshes | null = null;
  private controls: CityOrbitControls | null = null;
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
      const context = canvas.getContext('webgl2', { alpha: false, antialias: true, preserveDrawingBuffer: false });
      if (!context) throw new Error('WebGL 2 is unavailable.');
      this.renderer = new WebGLRenderer({ canvas, context, antialias: true, preserveDrawingBuffer: false });
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      this.scene = new Scene();
      this.scene.background = new Color('#050a16');
      this.scene.fog = new FogExp2('#050a16', 0.0025);
      this.scene.add(new HemisphereLight('#8ba9e0', '#101724', 0.65));
      const moon = new DirectionalLight('#b4d0ff', 1.3);
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
      this.camera = new PerspectiveCamera(43, 1, 0.5, 1800);
      this.camera.position.set(260, 200, 300);
      this.controls = new CityOrbitControls(this.camera, canvas);
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      container.append(canvas);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(container);
      window.addEventListener('resize', this.resize);
      this.resize();
    } catch (error: unknown) {
      this.dispose();
      throw error;
    }
  }

  update(deltaSeconds: number): void {
    this.controls?.update(deltaSeconds);
  }

  renderFinal(): void {
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  private readonly resize = (): void => {
    if (!this.renderer || !this.camera || !this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
