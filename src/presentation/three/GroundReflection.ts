import {
  HalfFloatType, Matrix4, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,
} from 'three';
import type { Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export function reflectionSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** Off-scene image producer: the original standard-material ground is the only surface. */
export class GroundReflection {
  private readonly reflector: Reflector;
  private readonly reflectorMaterial: ShaderMaterial;
  private readonly horizontal = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly vertical = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly valid = { value: 0 };
  private readonly rotation = new Matrix4();
  private readonly normal = new Vector3();
  private readonly view = new Vector3();
  private readonly cameraPosition = new Vector3();
  private readonly blur = new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tDiffuse: { value: this.horizontal.texture }, step: { value: new Vector2() } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // Fixed three-tap kernel, spacing exactly one texel, once along each axis.
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 step; varying vec2 vUv;
      void main() {
        gl_FragColor = 0.25 * texture2D(tDiffuse, vUv - step)
          + 0.5 * texture2D(tDiffuse, vUv) + 0.25 * texture2D(tDiffuse, vUv + step);
      }`,
  });
  private readonly quad = new FullScreenQuad(this.blur);
  private readonly previousCompile: MeshStandardMaterial['onBeforeCompile'];
  private readonly previousCacheKey: MeshStandardMaterial['customProgramCacheKey'];

  constructor(private readonly ground: Mesh<PlaneGeometry, MeshStandardMaterial>) {
    // Borrow the ground geometry; Reflector.dispose releases only its RT and material.
    this.reflector = new Reflector(ground.geometry, { textureWidth: 1, textureHeight: 1, multisample: 4 });
    // r185 declarations inherit Mesh.material; r186 Reflector always owns ShaderMaterial.
    this.reflectorMaterial = this.reflector.material as ShaderMaterial;
    this.previousCompile = ground.material.onBeforeCompile;
    this.previousCacheKey = ground.material.customProgramCacheKey;
    ground.material.onBeforeCompile = (shader, renderer) => {
      this.previousCompile.call(ground.material, shader, renderer);
      shader.uniforms.groundReflection = { value: this.vertical.texture };
      shader.uniforms.groundReflectionMatrix = this.reflectorMaterial.uniforms.textureMatrix!;
      shader.uniforms.groundReflectionValid = this.valid;
      shader.vertexShader = `uniform mat4 groundReflectionMatrix; varying vec4 vGroundReflection;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vGroundReflection = groundReflectionMatrix * vec4(position, 1.0);`);
      shader.fragmentShader = `uniform sampler2D groundReflection;
        uniform float groundReflectionValid; varying vec4 vGroundReflection;\n${shader.fragmentShader}`
        .replace('#include <opaque_fragment>', `
          if (groundReflectionValid > 0.5 && vGroundReflection.w > 0.0) {
            vec2 reflectionUv = vGroundReflection.xy / vGroundReflection.w;
            if (all(greaterThanEqual(reflectionUv, vec2(0.0))) && all(lessThanEqual(reflectionUv, vec2(1.0)))) {
              vec3 R = max(texture2D(groundReflection, reflectionUv).rgb, vec3(0.0));
              outgoingLight += 0.08 * R / (1.0 + max(R.r, max(R.g, R.b)));
            }
          }
          #include <opaque_fragment>`);
      // The standard material's fog and output chunks still follow opaque_fragment.
    };
    ground.material.customProgramCacheKey = () => 'starscraper-ground-reflection-v1';
    ground.material.needsUpdate = true;
  }

  resize(width: number, height: number): void {
    const [w, h] = reflectionSize(width, height);
    this.valid.value = 0;
    this.reflector.getRenderTarget().setSize(w, h);
    this.horizontal.setSize(w, h);
    this.vertical.setSize(w, h);
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    this.valid.value = 0;
    this.ground.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    this.reflector.matrixWorld.copy(this.ground.matrixWorld);
    this.rotation.extractRotation(this.reflector.matrixWorld);
    this.normal.set(0, 0, 1).applyMatrix4(this.rotation);
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.view.setFromMatrixPosition(this.reflector.matrixWorld).sub(this.cameraPosition);
    // Match r186 Reflector's skip predicate before calling it; old pixels stay invalid.
    if (!this.ground.visible || this.view.dot(this.normal) > 0) return;

    const target = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const xr = renderer.xr.enabled;
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    const visible = this.ground.visible;
    try {
      this.ground.visible = false;
      this.reflector.forceUpdate = false;
      // Reflector's callback consumes only these three arguments (Mesh types require six).
      const generate = this.reflector.onBeforeRender as (
        renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera,
      ) => void;
      generate.call(this.reflector, renderer, scene, camera);
      renderer.xr.enabled = false;
      this.blur.uniforms.tDiffuse!.value = this.reflector.getRenderTarget().texture;
      this.blur.uniforms.step!.value.set(1 / this.horizontal.width, 0);
      renderer.setRenderTarget(this.horizontal);
      this.quad.render(renderer);
      this.blur.uniforms.tDiffuse!.value = this.horizontal.texture;
      this.blur.uniforms.step!.value.set(0, 1 / this.vertical.height);
      renderer.setRenderTarget(this.vertical);
      this.quad.render(renderer);
      this.valid.value = 1;
    } finally {
      this.ground.visible = visible;
      renderer.xr.enabled = xr;
      renderer.shadowMap.autoUpdate = shadowUpdate;
      renderer.setRenderTarget(target, cubeFace, mipLevel);
    }
  }

  dispose(): void {
    this.ground.material.onBeforeCompile = this.previousCompile;
    this.ground.material.customProgramCacheKey = this.previousCacheKey;
    this.ground.material.needsUpdate = true;
    this.reflector.dispose();
    this.horizontal.dispose();
    this.vertical.dispose();
    this.blur.dispose();
    this.quad.dispose();
  }
}
