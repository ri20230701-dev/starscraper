import {
  HalfFloatType, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene,
  ShaderLib, ShaderMaterial, Vector2, WebGLRenderTarget,
} from 'three';
import type { WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GroundReflection, reflectionSize } from '../src/presentation/three/GroundReflection';

function setup() {
  const ground = new Mesh(new PlaneGeometry(2200, 2200), new MeshStandardMaterial({
    color: '#101925', roughness: 0.86, metalness: 0.55,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.025;
  const scene = new Scene();
  scene.add(ground);
  const camera = new PerspectiveCamera(43, 1, 0.5, 4000);
  camera.position.set(0, 20, 40);
  camera.lookAt(0, 0, 0);
  const previousCompile = ground.material.onBeforeCompile;
  const previousCacheKey = ground.material.customProgramCacheKey;
  const reflection = new GroundReflection(ground);
  const shader = { ...ShaderLib.standard, uniforms: { ...ShaderLib.standard.uniforms } };
  ground.material.onBeforeCompile(shader as Parameters<MeshStandardMaterial['onBeforeCompile']>[0], {} as WebGLRenderer);
  let target: WebGLRenderTarget | null = null;
  const draws: { target: WebGLRenderTarget | null; step?: Vector2; texture?: unknown }[] = [];
  const renderer = {
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn((next: WebGLRenderTarget | null) => { target = next; }),
    xr: { enabled: true }, shadowMap: { autoUpdate: true }, autoClear: false,
    state: { buffers: { depth: { setMask: vi.fn() } } }, clear: vi.fn(),
    render: vi.fn((object: Scene | Mesh) => {
      expect(ground.visible).toBe(false);
      if (object instanceof Mesh && object.material instanceof ShaderMaterial) {
        draws.push({ target, step: object.material.uniforms.step!.value.clone(), texture: object.material.uniforms.tDiffuse!.value });
      } else draws.push({ target });
    }),
  };
  const render = () => reflection.render(renderer as unknown as WebGLRenderer, scene, camera);
  const cleanup = () => { reflection.dispose(); ground.geometry.dispose(); ground.material.dispose(); };
  return { ground, scene, camera, reflection, shader, renderer, draws, render, cleanup, previousCompile, previousCacheKey };
}

describe('ground reflection image producer (CPU lifecycle, not GPU pixels)', () => {
  it.each([
    [3440, 1352, 1024, 402], [1352, 3440, 402, 1024], [800, 600, 800, 600],
    [5160, 2028, 1024, 402], [1, 10000, 1, 1024], [1, 1, 1, 1],
  ])('caps %ix%i at %ix%i, with only integer-pixel aspect rounding', (w, h, expectedW, expectedH) => {
    expect(reflectionSize(w, h)).toEqual([expectedW, expectedH]);
  });

  it('renders once off-scene, then blurs once each axis at one texel in half-float', () => {
    const s = setup();
    try {
      s.reflection.resize(3440, 1352);
      s.render();
      expect(s.scene.children).toEqual([s.ground]);
      expect(s.draws).toHaveLength(3);
      const [source, horizontal, vertical] = s.draws;
      for (const draw of s.draws) {
        expect(draw.target?.texture.type).toBe(HalfFloatType);
        expect([draw.target?.width, draw.target?.height]).toEqual([1024, 402]);
      }
      expect(source!.target?.samples).toBe(4);
      expect(horizontal!.step).toEqual(new Vector2(1 / 1024, 0));
      expect(horizontal!.texture).toBe(source!.target?.texture);
      expect(vertical!.step).toEqual(new Vector2(0, 1 / 402));
      expect(vertical!.texture).toBe(horizontal!.target?.texture);
      expect(s.shader.uniforms.groundReflection?.value).toBe(vertical!.target?.texture);
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(1);
      expect(s.renderer.getRenderTarget()).toBeNull();
      expect(s.renderer.xr.enabled).toBe(true);
      expect(s.renderer.shadowMap.autoUpdate).toBe(true);
      expect(s.ground.visible).toBe(true);
    } finally { s.cleanup(); }
  });

  it('invalidates a previously generated image on the back side and after resize', () => {
    const s = setup();
    try {
      s.render();
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(1);
      s.camera.position.y = -1;
      s.render();
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(0);
      expect(s.renderer.render).toHaveBeenCalledTimes(3);
      s.camera.position.y = 20;
      s.render();
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(1);
      s.reflection.resize(601, 801);
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(0);
      s.ground.visible = false;
      s.render();
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(0);
      expect(s.renderer.render).toHaveBeenCalledTimes(6);
    } finally { s.cleanup(); }
  });

  it('uses world transforms for the back-side guard', () => {
    const s = setup();
    try {
      const parent = new Scene();
      parent.position.y = 30;
      parent.add(s.ground);
      s.scene.add(parent);
      s.render(); // camera y=20 is below the transformed plane at 29.975
      expect(s.renderer.render).not.toHaveBeenCalled();
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(0);
    } finally { s.cleanup(); }
  });

  it.each([1, 2, 3])('restores visibility and renderer state if draw %i fails; the image stays invalid', failureDraw => {
    const s = setup();
    try {
      s.render();
      let count = 0;
      s.renderer.render.mockImplementation(() => {
        count += 1;
        if (count === failureDraw) throw new Error('GPU failure');
      });
      expect(s.render).toThrow('GPU failure');
      expect(s.shader.uniforms.groundReflectionValid?.value).toBe(0);
      expect(s.ground.visible).toBe(true);
      expect(s.renderer.getRenderTarget()).toBeNull();
      expect(s.renderer.xr.enabled).toBe(true);
      expect(s.renderer.shadowMap.autoUpdate).toBe(true);
    } finally { s.cleanup(); }
  });

  it('preserves standard lighting and fog and bounds the addition before the output chunks', () => {
    const s = setup();
    try {
      expect(s.ground.material.isMeshStandardMaterial).toBe(true);
      expect(s.ground.material.color.getHexString()).toBe('101925');
      expect(s.ground.material.roughness).toBe(0.86);
      expect(s.ground.material.metalness).toBe(0.55);
      const fragment = s.shader.fragmentShader;
      expect(fragment).toContain('#include <lights_fragment_begin>');
      expect(fragment).toContain('vec3 R = max(texture2D(groundReflection, reflectionUv).rgb, vec3(0.0));');
      const addition = fragment.indexOf('outgoingLight += 0.08 * R / (1.0 + max(R.r, max(R.g, R.b)))');
      expect(addition).toBeGreaterThan(0);
      for (const chunk of ['opaque_fragment', 'tonemapping_fragment', 'colorspace_fragment', 'fog_fragment']) {
        expect(fragment.indexOf(`#include <${chunk}>`)).toBeGreaterThan(addition);
      }
      expect(fragment).not.toContain('blendOverlay');
    } finally { s.cleanup(); }
  });

  it('disposes all three targets and both materials, restores hooks, and leaves borrowed ground resources to their owner', () => {
    const s = setup();
    const targetDispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    const shaderDispose = vi.spyOn(ShaderMaterial.prototype, 'dispose');
    const geometryDispose = vi.spyOn(s.ground.geometry, 'dispose');
    const groundDispose = vi.spyOn(s.ground.material, 'dispose');
    try {
      s.reflection.dispose();
      expect(targetDispose).toHaveBeenCalledTimes(3);
      expect(shaderDispose).toHaveBeenCalledTimes(2);
      expect(geometryDispose).not.toHaveBeenCalled();
      expect(groundDispose).not.toHaveBeenCalled();
      expect(s.ground.material.onBeforeCompile).toBe(s.previousCompile);
      expect(s.ground.material.customProgramCacheKey).toBe(s.previousCacheKey);
    } finally {
      vi.restoreAllMocks();
      s.ground.geometry.dispose();
      s.ground.material.dispose();
    }
  });
});
