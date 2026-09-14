import {
  BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, MeshStandardMaterial, Object3D,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PedestrianSnapshot } from '../../application/dto/CitySnapshot';
import { PEDESTRIAN_HEIGHT } from './streetDimensions';

/** One geometry/material for the whole population, including heads, bodies and legs. */
function personGeometry() {
  const parts = [
    new BoxGeometry(0.38, 0.62, 0.24).translate(0, 1.08, 0),
    new SphereGeometry(0.16, 8, 6).translate(0, PEDESTRIAN_HEIGHT - 0.16, 0),
    new BoxGeometry(0.14, 0.78, 0.17).translate(-0.11, 0.39, 0.055),
    new BoxGeometry(0.14, 0.78, 0.17).translate(0.11, 0.39, -0.055),
    new BoxGeometry(0.12, 0.59, 0.14).rotateX(-0.18).translate(-0.26, 1.04, 0),
    new BoxGeometry(0.12, 0.59, 0.14).rotateX(0.18).translate(0.26, 1.04, 0),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Could not assemble the pedestrian geometry.');
  return geometry;
}

/** The DTO supplies the route; this adapter knows nothing about road grids. */
export class PedestrianMeshes {
  readonly group = new Group();
  private readonly mesh: InstancedMesh | null;
  private readonly transform = new Object3D();

  constructor(private readonly pedestrians: readonly PedestrianSnapshot[]) {
    this.group.name = 'Pedestrians';
    if (pedestrians.length === 0) {
      this.mesh = null;
      return;
    }
    const material = new MeshStandardMaterial({
      color: '#e1cbb3', roughness: 0.88, metalness: 0,
      emissive: '#414958', emissiveIntensity: 0.2,
    });
    const mesh = new InstancedMesh(personGeometry(), material, pedestrians.length);
    mesh.name = 'Walking people';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const colors = ['#cda786', '#87a6bb', '#b1ab93', '#927d94'].map(color => new Color(color));
    pedestrians.forEach((person, index) => mesh.setColorAt(index, colors[Math.floor(person.phase * colors.length)]!));
    this.mesh = mesh;
    this.group.add(mesh);
    this.update(0);
  }

  /** Reuses scratch state and only uploads instance matrices; no per-frame geometry. */
  update(elapsedSeconds: number): void {
    if (!this.mesh) return;
    this.pedestrians.forEach((person, index) => {
      const { minX, maxX, minZ, maxZ } = person.route;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const perimeter = 2 * (width + depth);
      const travel = person.phase * perimeter + person.direction * person.speed * elapsedSeconds;
      let distance = ((travel % perimeter) + perimeter) % perimeter;
      let x: number;
      let z: number;
      let heading: number;
      if (distance < width) {
        x = minX + distance; z = minZ; heading = Math.PI / 2;
      } else if ((distance -= width) < depth) {
        x = maxX; z = minZ + distance; heading = 0;
      } else if ((distance -= depth) < width) {
        x = maxX - distance; z = maxZ; heading = -Math.PI / 2;
      } else {
        distance -= width;
        x = minX; z = maxZ - distance; heading = Math.PI;
      }
      this.transform.position.set(x, 0, z);
      this.transform.rotation.set(0, heading + (person.direction === -1 ? Math.PI : 0), 0);
      this.transform.updateMatrix();
      this.mesh!.setMatrixAt(index, this.transform.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh.geometry.dispose();
      (this.mesh.material as MeshStandardMaterial).dispose();
    }
    this.group.clear();
  }
}
