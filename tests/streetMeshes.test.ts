import {
  AdditiveBlending, DynamicDrawUsage, InstancedMesh, Light, Matrix4, MeshBasicMaterial,
  MeshStandardMaterial, ShaderChunk, ShaderLib, UniformsUtils, Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PedestrianSnapshot } from '../src/application/dto/CitySnapshot';
import { BuildCity } from '../src/application/usecases/BuildCity';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';
import { PedestrianMeshes } from '../src/presentation/three/PedestrianMeshes';
import { StreetLightMeshes } from '../src/presentation/three/StreetLightMeshes';
import { PEDESTRIAN_HEIGHT, STREET_LIGHT_HEIGHT } from '../src/presentation/three/streetDimensions';

function instances(group: { children: readonly unknown[] }): InstancedMesh[] {
  return group.children.map(child => {
    if (!(child instanceof InstancedMesh)) throw new Error('Expected one instanced batch.');
    return child;
  });
}

const person: PedestrianSnapshot = {
  route: { minX: -96, maxX: 0, minZ: -96, maxZ: 0 }, phase: 0, speed: 1, direction: 1,
};

function positionAt(people: PedestrianMeshes, time: number): Vector3 {
  people.update(time);
  const matrix = new Matrix4();
  instances(people.group)[0]!.getMatrixAt(0, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
}

function compilePool(material: MeshBasicMaterial) {
  const shader = {
    uniforms: UniformsUtils.clone(ShaderLib.basic.uniforms),
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  };
  type CompileArguments = Parameters<MeshBasicMaterial['onBeforeCompile']>;
  material.onBeforeCompile(shader as CompileArguments[0], {} as CompileArguments[1]);
  return shader;
}

describe('street life instanced rendering', () => {
  it('uses exactly four batches for the populated sample, with no real lights', () => {
    const city = new BuildCity().execute(SAMPLE_REPOSITORY_PAGE.repositories, SAMPLE_REFERENCE_TIME);
    const people = new PedestrianMeshes(city.pedestrians);
    const lights = new StreetLightMeshes(city.streetLights);
    try {
      const batches = [...instances(people.group), ...instances(lights.group)];
      expect(people.group.children).toHaveLength(1);
      expect(lights.group.children).toHaveLength(3);
      expect(batches.map(mesh => mesh.count)).toEqual([
        city.pedestrians.length, ...Array<number>(3).fill(city.streetLights.length),
      ]);
      for (const mesh of batches) {
        expect(mesh.frustumCulled).toBe(false);
        expect(Array.isArray(mesh.material)).toBe(false);
      }
      // Groups on built-in cylinders/boxes only split draws with a material array.
      expect(batches[0]!.geometry.groups).toEqual([]);
      lights.group.traverse(object => expect(object instanceof Light).toBe(false));
      expect(batches[0]!.instanceMatrix.usage).toBe(DynamicDrawUsage);
      const pool = batches[3]!.material as MeshBasicMaterial;
      expect(pool).toMatchObject({ transparent: true, depthWrite: false, blending: AdditiveBlending });
      const lamp = batches[2]!.material as MeshStandardMaterial;
      expect(lamp.emissive.b).toBeGreaterThan(lamp.emissive.r);
      expect(lamp.emissiveIntensity).toBeGreaterThan(1.15);
    } finally {
      people.dispose(); lights.dispose();
    }
  });

  it('emits no draws or GPU resources for empty arrays', () => {
    const people = new PedestrianMeshes([]);
    const lights = new StreetLightMeshes([]);
    people.update(100);
    expect(people.group.children).toEqual([]);
    expect(lights.group.children).toEqual([]);
    people.dispose(); lights.dispose();
  });

  it('connects the pool gradient and additive fog fade to the actual basic shader without changing output transforms', () => {
    const first = new StreetLightMeshes([{ x: 0, z: 0 }]);
    const second = new StreetLightMeshes([{ x: -96, z: 24 }, { x: 24, z: 96 }]);
    try {
      const materials = [first, second].map(lights => instances(lights.group)[2]!.material as MeshBasicMaterial);
      const shaders = materials.map(compilePool);
      for (const shader of shaders) {
        expect(shader.vertexShader.match(/varying vec2 vPoolPosition;/g)).toHaveLength(1);
        expect(shader.fragmentShader.match(/varying vec2 vPoolPosition;/g)).toHaveLength(1);
        expect(shader.vertexShader).toContain('vPoolPosition = position.xy;');
        expect(shader.fragmentShader).toContain('float falloff = max(0.0, 1.0 - dot(vPoolPosition, vPoolPosition));');
        expect(shader.fragmentShader).toContain('diffuseColor.a *= falloff * falloff;');
        expect(shader.fragmentShader.indexOf('diffuseColor.a *= falloff * falloff;'))
          .toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
        // Both built-in fog modes retain their exact distance calculation. Only
        // the final color mix changes: full fog must add zero, not another fogColor.
        const fogCalculation = ShaderChunk.fog_fragment.split('gl_FragColor.rgb')[0]!.trim();
        expect(shader.fragmentShader).toContain(fogCalculation);
        expect(shader.fragmentShader).toContain('gl_FragColor.a *= 1.0 - fogFactor;');
        expect(shader.fragmentShader).not.toContain('mix( gl_FragColor.rgb, fogColor, fogFactor )');
        expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
        for (const chunk of ['tonemapping_fragment', 'colorspace_fragment', 'premultiplied_alpha_fragment']) {
          expect(shader.fragmentShader).toContain(`#include <${chunk}>`);
        }
      }
      expect(materials[0]).not.toBe(materials[1]);
      expect(shaders[0]!.vertexShader).toBe(shaders[1]!.vertexShader);
      expect(shaders[0]!.fragmentShader).toBe(shaders[1]!.fragmentShader);
      for (const material of materials) {
        expect(material.customProgramCacheKey()).toBe('starscraper-street-light-pool-v2');
        expect(material.premultipliedAlpha).toBe(false);
      }
    } finally { first.dispose(); second.dispose(); }
  });

  it('walks all four road edges and wraps after one lap, including negative coordinates', () => {
    const people = new PedestrianMeshes([person]);
    try {
      expect(positionAt(people, 0).toArray()).toEqual([-96, 0, -96]);
      expect(positionAt(people, 48).toArray()).toEqual([-48, 0, -96]);
      expect(positionAt(people, 144).toArray()).toEqual([0, 0, -48]);
      expect(positionAt(people, 240).toArray()).toEqual([-48, 0, 0]);
      expect(positionAt(people, 336).toArray()).toEqual([-96, 0, -48]);
      expect(positionAt(people, 384).toArray()).toEqual([-96, 0, -96]);
      expect(positionAt(people, 384 * 1000 + 48).toArray()).toEqual([-48, 0, -96]);
    } finally { people.dispose(); }
  });

  it('applies phase, speed and reverse direction without replacing geometry or colors', () => {
    const people = new PedestrianMeshes([{ ...person, phase: 0.25, speed: 2, direction: -1 }]);
    try {
      const mesh = instances(people.group)[0]!;
      const geometry = mesh.geometry;
      const colors = mesh.instanceColor!.array.slice();
      expect(positionAt(people, 0).toArray()).toEqual([0, 0, -96]);
      expect(positionAt(people, 24).toArray()).toEqual([-48, 0, -96]);
      const matrix = new Matrix4();
      mesh.getMatrixAt(0, matrix);
      const forward = new Vector3(0, 0, 1).transformDirection(matrix);
      expect(forward.x).toBeCloseTo(-1);
      expect(forward.z).toBeCloseTo(0);
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.instanceColor!.array).toEqual(colors);
    } finally { people.dispose(); }
  });

  it('matches the physical heights used by framing and keeps pools just above ground', () => {
    const people = new PedestrianMeshes([person]);
    const lights = new StreetLightMeshes([{ x: 24, z: -96 }]);
    try {
      const body = instances(people.group)[0]!;
      body.geometry.computeBoundingBox();
      expect(body.geometry.boundingBox!.min.y).toBeCloseTo(0);
      expect(body.geometry.boundingBox!.max.y).toBeCloseTo(PEDESTRIAN_HEIGHT);
      const [, lamp, pool] = instances(lights.group);
      const matrix = new Matrix4();
      lamp!.getMatrixAt(0, matrix);
      lamp!.geometry.computeBoundingBox();
      expect(lamp!.geometry.boundingBox!.clone().applyMatrix4(matrix).max.y).toBeCloseTo(STREET_LIGHT_HEIGHT);
      pool!.getMatrixAt(0, matrix);
      expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([24, expect.closeTo(0.012), -96]);
      expect(new Vector3(0, 0, 1).transformDirection(matrix).y).toBeCloseTo(1);
    } finally { people.dispose(); lights.dispose(); }
  });

  it('explicitly disposes instance buffers, geometries and materials on every rebuild', () => {
    for (let round = 0; round < 3; round += 1) {
      const people = new PedestrianMeshes([person]);
      const lights = new StreetLightMeshes([{ x: 0, z: 0 }]);
      const spies = [...instances(people.group), ...instances(lights.group)].flatMap(mesh => [
        vi.spyOn(mesh, 'dispose'), vi.spyOn(mesh.geometry, 'dispose'),
        vi.spyOn(mesh.material as MeshStandardMaterial | MeshBasicMaterial, 'dispose'),
      ]);
      people.dispose(); lights.dispose();
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
      expect(people.group.children).toEqual([]);
      expect(lights.group.children).toEqual([]);
    }
  });
});
