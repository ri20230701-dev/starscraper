import {
  AdditiveBlending, BoxGeometry, CircleGeometry, CylinderGeometry, Group, InstancedMesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, ShaderChunk,
} from 'three';
import type { StreetLightSnapshot } from '../../application/dto/CitySnapshot';
import { STREET_LIGHT_HEIGHT, STREET_LIGHT_POOL_RADIUS } from './streetDimensions';

// Reuse three's linear/exp2 distance calculation, but fade an additive contribution
// to zero. Mixing toward fogColor would add another patch of fog over the scene.
const ADDITIVE_FOG_FRAGMENT = ShaderChunk.fog_fragment.replace(
  'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
  'gl_FragColor.a *= 1.0 - fogFactor;',
);

/** A soft additive decal with distance fading and the standard output transforms. */
function poolMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: '#c7e6ff', transparent: true, opacity: 0.14,
    blending: AdditiveBlending, depthWrite: false,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPoolPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPoolPosition = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPoolPosition;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float falloff = max(0.0, 1.0 - dot(vPoolPosition, vPoolPosition));
        diffuseColor.a *= falloff * falloff;`)
      .replace('#include <fog_fragment>', ADDITIVE_FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'starscraper-street-light-pool-v2';
  return material;
}

/** Infrastructure only: three instanced draws and no real lights or shadow passes. */
export class StreetLightMeshes {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];

  constructor(lights: readonly StreetLightSnapshot[]) {
    this.group.name = 'Street lights';
    if (lights.length === 0) return;
    const poleHeight = STREET_LIGHT_HEIGHT - 0.2;
    const poles = new InstancedMesh(new CylinderGeometry(0.09, 0.14, poleHeight, 6),
      new MeshStandardMaterial({ color: '#697587', roughness: 0.62, metalness: 0.65 }), lights.length);
    const lamps = new InstancedMesh(new BoxGeometry(0.9, 0.3, 0.55), new MeshStandardMaterial({
      color: '#c7e6ff', emissive: '#c7e6ff', emissiveIntensity: 2.0,
      roughness: 0.4, metalness: 0,
    }), lights.length);
    const pools = new InstancedMesh(new CircleGeometry(1, 24), poolMaterial(), lights.length);
    poles.name = 'Street light poles';
    lamps.name = 'Cool white lamps';
    pools.name = 'Additive light pools';
    const transform = new Object3D();
    lights.forEach((light, index) => {
      transform.position.set(light.x, poleHeight / 2, light.z);
      transform.rotation.set(0, 0, 0);
      transform.scale.setScalar(1);
      transform.updateMatrix();
      poles.setMatrixAt(index, transform.matrix);
      transform.position.y = STREET_LIGHT_HEIGHT - 0.15;
      transform.updateMatrix();
      lamps.setMatrixAt(index, transform.matrix);
      transform.position.y = 0.012;
      transform.rotation.x = -Math.PI / 2;
      transform.scale.setScalar(STREET_LIGHT_POOL_RADIUS);
      transform.updateMatrix();
      pools.setMatrixAt(index, transform.matrix);
    });
    for (const mesh of [poles, lamps, pools]) {
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial | MeshStandardMaterial).dispose();
    }
    this.meshes.length = 0;
    this.group.clear();
  }
}
