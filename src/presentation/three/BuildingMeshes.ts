import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { BuildingSnapshot, CitySnapshot } from '../../application/dto/CitySnapshot';
import { createWindowMaterial } from './WindowMaterial';

/** Exactly one box and one draw call per building; windows never own geometry. */
export class BuildingMeshes {
  readonly group = new Group();
  private readonly geometries = new Set<BoxGeometry>();
  private readonly materials = new Set<MeshStandardMaterial>();
  /** Lets a ray hit be answered with the repository it belongs to. */
  private readonly byMesh = new Map<Object3D, BuildingSnapshot>();

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
      this.byMesh.set(mesh, building);
      this.group.add(mesh);
    }
  }

  /** The repository a hit mesh stands for, walking up to the mesh the group owns. */
  snapshotFor(object: Object3D | null): BuildingSnapshot | null {
    for (let node = object; node; node = node.parent) {
      const building = this.byMesh.get(node);
      if (building) return building;
    }
    return null;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.byMesh.clear();
    this.group.clear();
  }
}
