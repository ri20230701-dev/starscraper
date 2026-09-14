import { Vector2 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** One deterministic, linear-HDR pass immediately before OutputPass. */
export class NightFinishPass extends ShaderPass {
  constructor() {
    super({
      uniforms: { tDiffuse: { value: null }, resolution: { value: new Vector2(1, 1) } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;
        uint hashPixel(uvec2 p) {
          uint h = p.x * 0x9e3779b9u ^ p.y * 0x85ebca6bu;
          h ^= h >> 16u; h *= 0x7feb352du;
          h ^= h >> 15u; h *= 0x846ca68bu;
          return h ^ (h >> 16u);
        }
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float d = length(vUv * 2.0 - 1.0) / sqrt(2.0);
          float vignette = 1.0 - 0.16 * smoothstep(0.55, 1.0, d);
          uvec2 pixel = uvec2(gl_FragCoord.xy);
          // Adjacent pixels share a hash with opposite signs: exact zero-sum pairs.
          uint bits = hashPixel(uvec2(pixel.x / 2u, pixel.y)) & 0xffffu;
          float grain = (float(bits) / 65535.0 * 2.0 - 1.0) * 0.012;
          grain *= (pixel.x & 1u) == 0u ? 1.0 : -1.0;
          // An odd-width row has one unpaired pixel; keep its contribution zero.
          if ((uint(resolution.x) & 1u) == 1u && pixel.x == uint(resolution.x) - 1u) grain = 0.0;
          gl_FragColor = vec4(color.rgb * vignette + vec3(grain), color.a);
        }`,
    });
    this.material.depthTest = false;
    this.material.depthWrite = false;
  }

  override setSize(width: number, height: number): void {
    this.uniforms.resolution!.value.set(Math.floor(width), Math.floor(height));
  }
}
