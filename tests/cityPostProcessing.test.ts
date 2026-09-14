import { Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector2 } from 'three';
import type { WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CityPostProcessing } from '../src/presentation/three/CityPostProcessing';
import { GroundReflection } from '../src/presentation/three/GroundReflection';
import { NightFinishPass } from '../src/presentation/three/NightFinishPass';

afterEach(() => vi.restoreAllMocks());

describe('night postprocessing integration (no graphics context)', () => {
  it('keeps bloom fixed, finishes before output, and resizes/disposes all new resources', () => {
    const addPass = vi.spyOn(EffectComposer.prototype, 'addPass');
    const reflectionRender = vi.spyOn(GroundReflection.prototype, 'render').mockImplementation(() => {});
    const composerRender = vi.spyOn(EffectComposer.prototype, 'render').mockImplementation(() => {});
    const reflectionResize = vi.spyOn(GroundReflection.prototype, 'resize');
    const reflectionDispose = vi.spyOn(GroundReflection.prototype, 'dispose');
    const finishDispose = vi.spyOn(NightFinishPass.prototype, 'dispose');
    const renderer = { getPixelRatio: () => 1 } as WebGLRenderer;
    const ground = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
    const pipeline = new CityPostProcessing(renderer, new Scene(), new PerspectiveCamera(), ground);
    try {
      const passes = addPass.mock.calls.map(([pass]) => pass);
      expect(passes).toHaveLength(4);
      expect(passes[0]).toBeInstanceOf(RenderPass);
      expect(passes[1]).toBeInstanceOf(UnrealBloomPass);
      expect(passes[1]).toMatchObject({ strength: 0.48, radius: 0.42, threshold: 1.15 });
      expect(passes[2]).toBeInstanceOf(NightFinishPass);
      expect(passes[3]).toBeInstanceOf(OutputPass);
      const finish = passes[2] as NightFinishPass;
      expect(finish.material.depthTest).toBe(false);
      expect(finish.material.depthWrite).toBe(false);
      pipeline.resize(801, 601, 1.5);
      expect(reflectionResize).toHaveBeenLastCalledWith(1201, 901);
      expect(finish.uniforms.resolution?.value).toEqual(new Vector2(1201, 901));
      pipeline.render();
      expect(reflectionRender).toHaveBeenCalledTimes(1);
      expect(composerRender).toHaveBeenCalledExactlyOnceWith(0);
      expect(reflectionRender.mock.invocationCallOrder[0]).toBeLessThan(composerRender.mock.invocationCallOrder[0]!);
    } finally {
      pipeline.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
    }
    expect(reflectionDispose).toHaveBeenCalledTimes(1);
    expect(finishDispose).toHaveBeenCalledTimes(1);
  });

  it('has only texture and backing-size inputs, never time or luminance-dependent grain', () => {
    const finish = new NightFinishPass();
    try {
      expect(Object.keys(finish.uniforms).sort()).toEqual(['resolution', 'tDiffuse']);
      const shader = finish.material.fragmentShader;
      expect(shader).toContain('uvec2 pixel = uvec2(gl_FragCoord.xy)');
      expect(shader).toContain('hashPixel(uvec2(pixel.x / 2u, pixel.y))');
      expect(shader).toContain('grain *= (pixel.x & 1u) == 0u ? 1.0 : -1.0');
      expect(shader).toContain('pixel.x == uint(resolution.x) - 1u) grain = 0.0');
      expect(shader).toContain('* 0.012');
      expect(shader).toContain('1.0 - 0.16 * smoothstep(0.55, 1.0, d)');
      expect(shader).toContain('color.rgb * vignette + vec3(grain)');
      expect(shader).not.toMatch(/\btime\b|\bdelta\b|\bluminance\b|\bsin\(/);
    } finally { finish.dispose(); }
  });
});
