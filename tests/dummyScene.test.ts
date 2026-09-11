import { describe, expect, it } from 'vitest';
import { CreateDummyCity } from '../src/application/usecases/CreateDummyCity';
import { BuildingMeshes } from '../src/presentation/three/BuildingMeshes';
import { calculateWindowLayout } from '../src/presentation/three/windowLayout';

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
});
