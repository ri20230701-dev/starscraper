import { layoutCity } from '../../domain/services/cityLayout';
import type { Repository } from '../../domain/model/Repository';
import type { BuildingSnapshot, CitySnapshot } from '../dto/CitySnapshot';

/**
 * Turn repository data into the flat snapshot the renderer consumes.
 *
 * The reference instant is an argument all the way down. Reading a clock here would make
 * two builds of the same data disagree, and the layer contract rejects it outright.
 */
export class BuildCity {
  execute(repositories: readonly Repository[], referenceTime: number): CitySnapshot {
    const layout = layoutCity(repositories, referenceTime);
    const buildings: BuildingSnapshot[] = layout.buildings.map((building, id) => ({
      id,
      x: building.x,
      z: building.z,
      width: building.width,
      depth: building.depth,
      height: building.height,
      color: building.color,
      windowLitRatio: building.windowLitRatio,
    }));
    return Object.freeze({ buildings: Object.freeze(buildings) });
  }
}
