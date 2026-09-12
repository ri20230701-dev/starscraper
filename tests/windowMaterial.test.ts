import { describe, expect, it } from 'vitest';
import type { BuildingSnapshot } from '../src/application/dto/CitySnapshot';
import { createWindowMaterial } from '../src/presentation/three/WindowMaterial';

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

const narrowBuilding: BuildingSnapshot = {
  id: 17, x: 0, z: 0, width: 9, depth: 17, height: 76,
  color: '#123456', windowLitRatio: 0.37,
};
const wideBuilding: BuildingSnapshot = {
  id: 35, x: 10, z: 20, width: 18, depth: 8, height: 12,
  color: '#654321', windowLitRatio: 0.81,
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
});
