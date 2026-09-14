import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import type { Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GroundReflection } from './GroundReflection';
import { NightFinishPass } from './NightFinishPass';

/** HDR until the final output transform; display and PNG share this exact chain. */
/**
 * Radiance a surface must exceed before it blooms. Exported because the window emission
 * is chosen against it: the two numbers only make sense together.
 */
export const BLOOM_THRESHOLD = 1.15;

export class CityPostProcessing {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly reflection: GroundReflection;
  private readonly finishPass: NightFinishPass;

  constructor(
    private readonly renderer: WebGLRenderer, private readonly scene: Scene,
    private readonly camera: PerspectiveCamera, ground: Mesh<PlaneGeometry, MeshStandardMaterial>,
  ) {
    this.reflection = new GroundReflection(ground);
    // Default-framebuffer antialiasing does not antialias the composer's scene target.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    // HDR windows, shop fronts and lamp bodies bloom; pools stay below the threshold.
    // A moderate halo keeps the window grid legible.
    // Strength and radius are held down so the halo separates buildings instead of
    // fusing the skyline into one bright mass; the threshold keeps the walls out of it.
    this.bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.48, 0.42, BLOOM_THRESHOLD);
    this.finishPass = new NightFinishPass();
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.finishPass);
    this.composer.addPass(this.outputPass);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.reflection.resize(Math.floor(width * pixelRatio), Math.floor(height * pixelRatio));
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(): void {
    // No simulation time advances here, including when called synchronously for PNG.
    this.reflection.render(this.renderer, this.scene, this.camera);
    this.composer.render(0);
  }

  dispose(): void {
    this.reflection.dispose();
    this.finishPass.dispose();
    this.renderPass.dispose();
    this.bloomPass.dispose();
    // Three r186's pass disposer omits this threshold-filter material.
    this.bloomPass.materialHighPassFilter.dispose();
    this.outputPass.dispose();
    // Disposes both HDR targets and the composer's internal copy pass.
    this.composer.dispose();
  }
}
