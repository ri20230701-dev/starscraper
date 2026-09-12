import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';
import { BuildCity } from '../src/application/usecases/BuildCity';
import { BuildingMeshes } from '../src/presentation/three/BuildingMeshes';
import { calculateWindowLayout } from '../src/presentation/three/windowLayout';

function sampleCity() {
  return new BuildCity().execute(SAMPLE_REPOSITORY_PAGE.repositories, SAMPLE_REFERENCE_TIME);
}

function isDisposable(value: unknown): value is { dispose(): void } {
  return typeof value === 'object' && value !== null
    && 'dispose' in value && typeof value.dispose === 'function';
}

describe('the sample city reaches the renderer intact', () => {
  it('gives every building a unique id and a window layout', () => {
    const city = sampleCity();
    expect(city.buildings.length).toBe(SAMPLE_REPOSITORY_PAGE.repositories.length);
    expect(new Set(city.buildings.map(building => building.id)).size).toBe(city.buildings.length);
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
    const city = sampleCity();
    const buildings = new BuildingMeshes(city);
    try {
      expect(buildings.group.children).toHaveLength(city.buildings.length);
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
    const buildings = new BuildingMeshes(sampleCity());
    const disposeSpies = buildings.group.children.map(child => {
      if (!('geometry' in child) || !('material' in child)) {
        throw new Error('Expected a building mesh with geometry and material');
      }
      const resource = child[resourceName];
      if (!isDisposable(resource)) throw new Error(`Expected a disposable ${resourceName}`);
      return vi.spyOn(resource, 'dispose');
    });
    try {
      expect(disposeSpies.length).toBeGreaterThan(0);
      buildings.dispose();
      for (const disposeSpy of disposeSpies) expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect(buildings.group.children).toHaveLength(0);
    } finally {
      for (const disposeSpy of disposeSpies) disposeSpy.mockRestore();
      buildings.dispose();
    }
  });

  it('releases every mesh across repeated rebuilds', () => {
    // Switching users remounts the scene; a missed release would leak once per lookup.
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    for (let round = 0; round < 3; round += 1) {
      const buildings = new BuildingMeshes(sampleCity());
      for (const child of buildings.group.children) {
        if ('geometry' in child && isDisposable(child.geometry)) {
          spies.push(vi.spyOn(child.geometry, 'dispose'));
        }
      }
      buildings.dispose();
      expect(buildings.group.children).toHaveLength(0);
    }
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
