import type { Repository } from '../model/Repository';
import { byRecency, depthOf, footprintOf, heightOf, wallColorOf, windowLitRatioOf } from './buildingRules';
import { cellCentre, plotCells } from './cityGrid';

/** One placed building, in world units. Rendering owns everything beyond these numbers. */
export interface PlacedBuilding {
  readonly name: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly language: string | null;
  readonly stars: number;
  readonly pushedAt: number | null;
  readonly isFork: boolean;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color: string;
  readonly windowLitRatio: number;
}

export interface CityLayout {
  readonly buildings: readonly PlacedBuilding[];
}

/**
 * Build the whole city from repository data and a reference instant.
 *
 * The result depends on nothing else: no clock, no randomness, no iteration order of a
 * map. Given the same repositories and the same `referenceTime` this returns the same
 * city every time, which is what makes a shared screenshot reproducible.
 */
export function layoutCity(
  repositories: readonly Repository[],
  referenceTime: number,
): CityLayout {
  const ordered = [...repositories].sort(byRecency);
  const cells = plotCells(ordered.length);
  const buildings = ordered.map((repository, index) => {
    const cell = cells[index];
    // plotCells returns exactly one cell per repository; this guards the index type.
    if (!cell) throw new RangeError('The grid produced fewer plots than repositories.');
    const centre = cellCentre(cell);
    return Object.freeze({
      name: repository.name,
      htmlUrl: repository.htmlUrl,
      description: repository.description,
      language: repository.language,
      stars: repository.stars,
      pushedAt: repository.pushedAt,
      isFork: repository.isFork,
      x: centre.x,
      z: centre.z,
      width: footprintOf(repository.sizeKb),
      depth: depthOf(repository),
      height: heightOf(repository),
      color: wallColorOf(repository),
      windowLitRatio: windowLitRatioOf(repository, referenceTime),
    });
  });
  return Object.freeze({ buildings: Object.freeze(buildings) });
}
