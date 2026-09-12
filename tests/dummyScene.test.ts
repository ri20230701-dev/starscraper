import { describe, expect, it, vi } from 'vitest';
import { CreateDummyCity } from '../src/application/usecases/CreateDummyCity';
import { BuildingMeshes } from '../src/presentation/three/BuildingMeshes';
import { calculateWindowLayout } from '../src/presentation/three/windowLayout';

function isDisposable(value: unknown): value is { dispose(): void } {
  return typeof value === 'object' && value !== null
    && 'dispose' in value && typeof value.dispose === 'function';
}

describe('100-building technical-validation scene', () => {
  it('recreates the same varied fixture with unique stable IDs', () => {
    const useCase = new CreateDummyCity();
    const city = useCase.execute();
    expect(city).toEqual(useCase.execute());
    expect(city.buildings).toHaveLength(100);
    expect(new Set(city.buildings.map(building => building.id)).size).toBe(100);
    for (const key of ['width', 'depth', 'height', 'color', 'windowLitRatio'] as const) {
      expect(new Set(city.buildings.map(building => building[key])).size).toBeGreaterThan(1);
    }
    for (const building of city.buildings) {
      expect(building.windowLitRatio).toBeGreaterThanOrEqual(0);
      expect(building.windowLitRatio).toBeLessThanOrEqual(1);
      for (const face of Object.values(calculateWindowLayout(building))) {
        expect(face.horizontal.aperture).toBe(1.15);
        expect(face.vertical.aperture).toBe(1.7);
      }
    }
  });

  it('creates only one physical box per building, with no window meshes', () => {
    const city = new CreateDummyCity().execute();
    const buildings = new BuildingMeshes(city);
    try {
      expect(buildings.group.children).toHaveLength(100);
      city.buildings.forEach((building, index) => {
        expect(buildings.group.children[index]).toMatchObject({
          type: 'Mesh',
          children: [],
          position: { x: building.x, y: building.height / 2, z: building.z },
          geometry: {
            type: 'BoxGeometry',
            parameters: { width: building.width, height: building.height, depth: building.depth },
          },
          material: { type: 'MeshStandardMaterial', name: `Building ${building.id} procedural windows` },
        });
      });
    } finally {
      buildings.dispose();
    }
    expect(buildings.group.children).toHaveLength(0);
  });

  it.each(['geometry', 'material'] as const)('disposes every building %s', resourceName => {
    const city = new CreateDummyCity().execute();
    const buildings = new BuildingMeshes(city);
    const disposeSpies = buildings.group.children.map(child => {
      if (!('geometry' in child) || !('material' in child)) {
        throw new Error('Expected a building mesh with geometry and material');
      }
      const resource = child[resourceName];
      if (!isDisposable(resource)) throw new Error(`Expected a disposable ${resourceName}`);
      return vi.spyOn(resource, 'dispose');
    });
    try {
      expect(disposeSpies).toHaveLength(city.buildings.length);
      buildings.dispose();
      for (const disposeSpy of disposeSpies) {
        expect(disposeSpy).toHaveBeenCalledTimes(1);
      }
      expect(buildings.group.children).toHaveLength(0);
    } finally {
      for (const disposeSpy of disposeSpies) disposeSpy.mockRestore();
      buildings.dispose();
    }
  });
});
