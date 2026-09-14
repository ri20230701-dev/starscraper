import { describe, expect, it } from 'vitest';
import type { BuildingSnapshot } from '../src/application/dto/CitySnapshot';
import { createWindowMaterial } from '../src/presentation/three/WindowMaterial';
import { BLOOM_THRESHOLD } from '../src/presentation/three/CityPostProcessing';

type WindowMaterial = ReturnType<typeof createWindowMaterial>;
type CompileArguments = Parameters<WindowMaterial['onBeforeCompile']>;

interface TestShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function compile(material: WindowMaterial): TestShader {
  const shader: TestShader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>',
    fragmentShader: '#include <color_fragment>\n#include <emissivemap_fragment>',
  };
  // The hook only consumes these shader fields and does not use the renderer.
  material.onBeforeCompile(shader as CompileArguments[0], {} as CompileArguments[1]);
  return shader;
}

/** The shader reads geometry only; this metadata exists to satisfy the snapshot shape. */
const metadata = {
  htmlUrl: 'https://github.com/example/repo',
  description: null, language: null, stars: 0, pushedAt: null, isFork: false,
} as const;

const narrowBuilding: BuildingSnapshot = {
  id: 17, x: 0, z: 0, width: 9, depth: 17, height: 76,
  color: '#123456', windowLitRatio: 0.37, shopOpenRatio: 0.35, shopBusyness: 0.2, name: 'narrow', ...metadata,
};
const wideBuilding: BuildingSnapshot = {
  id: 35, x: 10, z: 20, width: 18, depth: 8, height: 12,
  color: '#654321', windowLitRatio: 0.81, shopOpenRatio: 0.95, shopBusyness: 0.8, name: 'wide', ...metadata,
};

function expectBuildingUniforms(
  shader: TestShader,
  building: BuildingSnapshot,
  counts: readonly [number, number, number],
  margins: readonly [number, number, number],
): void {
  expect(shader.uniforms).toMatchObject({
    uBuildingDimensions: { value: { x: building.width, y: building.height, z: building.depth } },
    uWindowCounts: { value: { x: counts[0], y: counts[1], z: counts[2] } },
    uWindowMargins: {
      value: { x: expect.closeTo(margins[0]), y: expect.closeTo(margins[1]), z: expect.closeTo(margins[2]) },
    },
    uWindowPitch: { value: { x: 2.4, y: 3.4 } },
    uWindowAperture: { value: { x: 1.15, y: 1.7 } },
    uBuildingId: { value: building.id },
    uWindowLitRatio: { value: building.windowLitRatio },
    uWindowEmission: { value: { isColor: true } },
    uShopBandTop: { value: expect.closeTo(margins[1] + 3.4) },
    uShopOpenRatio: { value: building.shopOpenRatio },
    uShopBusyness: { value: building.shopBusyness },
  });
}

describe('window material shader connection', () => {
  it('passes physical dimensions and front/side layouts through the compile hook', () => {
    const material = createWindowMaterial(narrowBuilding);
    try {
      const shader = compile(material);
      expectBuildingUniforms(shader, narrowBuilding, [3, 22, 7], [0.9, 0.6, 0.1]);
      expect(shader.vertexShader).toContain('vBuildingPosition = position;');
      expect(shader.vertexShader).toContain('vBuildingNormal = normal;');
      expect(shader.fragmentShader).toContain('uniform vec3 uWindowMargins;');
      expect(shader.fragmentShader).toContain('side ? uBuildingDimensions.z : uBuildingDimensions.x');
      expect(shader.fragmentShader).toContain('side ? uWindowCounts.z : uWindowCounts.x');
      expect(shader.fragmentShader).toContain('vec2(side ? uWindowMargins.z : uWindowMargins.x, uWindowMargins.y)');
      expect(shader.fragmentShader).toContain('vec2 windowCoverage = buildingWindows();');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uWindowEmission * windowCoverage.y;');
    } finally {
      material.dispose();
    }
  });

  it('keeps uniforms independent for different buildings across compilations', () => {
    const firstMaterial = createWindowMaterial(narrowBuilding);
    const secondMaterial = createWindowMaterial(wideBuilding);
    try {
      const firstShader = compile(firstMaterial);
      const secondShader = compile(secondMaterial);
      const recompiledFirstShader = compile(firstMaterial);
      expectBuildingUniforms(firstShader, narrowBuilding, [3, 22, 7], [0.9, 0.6, 0.1]);
      expectBuildingUniforms(secondShader, wideBuilding, [7, 3, 3], [0.6, 0.9, 0.4]);
      expectBuildingUniforms(recompiledFirstShader, narrowBuilding, [3, 22, 7], [0.9, 0.6, 0.1]);
      expect(firstMaterial).not.toBe(secondMaterial);
      expect(firstShader.uniforms).not.toBe(secondShader.uniforms);
      for (const [name, uniform] of Object.entries(firstShader.uniforms)) {
        expect(uniform).not.toBe(secondShader.uniforms[name]);
        if (typeof uniform.value === 'object' && uniform.value !== null) {
          expect(uniform.value).not.toBe(secondShader.uniforms[name]?.value);
        }
      }
    } finally {
      firstMaterial.dispose();
      secondMaterial.dispose();
    }
  });

  it('shares the same v2 shader and defines for every store grade, size, and window-row count', () => {
    const materials = [narrowBuilding, wideBuilding, {
      ...narrowBuilding, height: 3.4, shopOpenRatio: 0, shopBusyness: 0,
    }, {
      ...narrowBuilding, height: 7.2, shopOpenRatio: 1, shopBusyness: 1,
    }].map(createWindowMaterial);
    try {
      const shaders = materials.map(compile);
      for (let index = 0; index < materials.length; index += 1) {
        expect(materials[index]!.customProgramCacheKey()).toBe('starscraper-physical-windows-v2');
        expect(materials[index]!.defines).toEqual({ STANDARD: '' });
        expect(shaders[index]!.vertexShader).toBe(shaders[0]!.vertexShader);
        expect(shaders[index]!.fragmentShader).toBe(shaders[0]!.fragmentShader);
      }
      expect(shaders[2]!.uniforms.uShopBandTop?.value).toBe(0);
      expect(shaders[3]!.uniforms.uShopBandTop?.value).toBeCloseTo(3.6);
      expect(shaders[2]!.uniforms.uShopOpenRatio?.value).toBe(0);
      expect(shaders[3]!.uniforms.uShopOpenRatio?.value).toBe(1);
    } finally {
      materials.forEach(material => material.dispose());
    }
  });

  it('replaces the lowest cell before both detailed and averaged window coverage', () => {
    const material = createWindowMaterial({ ...narrowBuilding, height: 7.2 });
    try {
      const shader = compile(material);
      const fragment = shader.fragmentShader;
      expect(shader.uniforms.uShopBandTop?.value).toBeCloseTo(3.6);
      const rowExclusion = fragment.indexOf('if (uShopBandTop > 0.0 && cell.y <= 0.0) return vec2(0.0);');
      expect(rowExclusion).toBeGreaterThan(0);
      expect(rowExclusion).toBeLessThan(fragment.indexOf('float detailedGlass'));
      expect(rowExclusion).toBeLessThan(fragment.indexOf('float averageWeight'));
      expect(fragment).toContain('cellPosition - vec2(0.0, firstWindowRow)');
      expect(fragment).toContain('float fromBase = vBuildingPosition.y + uBuildingDimensions.y * 0.5;');
      expect(fragment).toContain('uShopBandTop <= 0.0 || fromBase >= uShopBandTop');
      expect(fragment).toContain('float open = 1.0 - step(uShopOpenRatio, openingY);');
      expect(fragment).toContain('uWindowEmission * shopCoverage.y * mix(0.3, 1.0, uShopBusyness)');
    } finally {
      material.dispose();
    }
  });
});

describe('the night look rests on two numbers agreeing', () => {
  it('emits windows above the bloom threshold while walls stay below it', () => {
    // The whole design is "only the windows bloom". Raising the threshold without
    // checking it against the emission multiplier would quietly extinguish the city,
    // and lowering it would set the walls glowing.
    const material = createWindowMaterial(narrowBuilding);
    try {
      const shader = compile(material);
      const emission = shader.uniforms['uWindowEmission']?.value as { r: number; g: number; b: number };
      const brightest = Math.max(emission.r, emission.g, emission.b);
      expect(brightest, 'windows no longer clear the bloom threshold').toBeGreaterThan(BLOOM_THRESHOLD * 1.5);

      // Walls are the repository colour scaled down and lit only by a dim sky, so their
      // radiance cannot approach the threshold.
      const wall = material.color;
      expect(Math.max(wall.r, wall.g, wall.b)).toBeLessThan(BLOOM_THRESHOLD * 0.6);
    } finally {
      material.dispose();
    }
  });

  it('never puts a window on a roof', () => {
    const material = createWindowMaterial(narrowBuilding);
    try {
      const shader = compile(material);
      // The roof is excluded in the coverage function and darkened separately; both
      // have to survive, or the skyline grows lit lids seen from above.
      expect(shader.fragmentShader).toContain('abs(vBuildingNormal.y) > 0.5');
      expect(shader.fragmentShader).toContain('roofMask()');
      expect(shader.fragmentShader).toContain('step(0.5, abs(vBuildingNormal.y))');
    } finally {
      material.dispose();
    }
  });
});
