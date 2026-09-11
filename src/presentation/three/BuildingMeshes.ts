import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { CitySnapshot } from '../../application/dto/CitySnapshot';
import { createWindowMaterial } from './WindowMaterial';

/** Exactly one box and one draw call per building; windows never own geometry. */
export class BuildingMeshes {
  readonly group = new Group();
  private readonly geometries = new Set<BoxGeometry>();
  private readonly materials = new Set<MeshStandardMaterial>();

  constructor(city: CitySnapshot) {
    this.group.name = 'Buildings';
    for (const building of city.buildings) {
      const geometry = new BoxGeometry(building.width, building.height, building.depth);
      const material = createWindowMaterial(building);
      const mesh = new Mesh(geometry, material);
      mesh.name = `Building ${building.id}`;
      mesh.position.set(building.x, building.height / 2, building.z);
      this.geometries.add(geometry);
      this.materials.add(material);
      this.group.add(mesh);
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.group.clear();
  }
}
