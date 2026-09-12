/**
 * The city is laid out on a fixed grid so that placement stays provably legal: every
 * building sits at the centre of one cell, and a cell is either a building plot or a
 * stretch of road. Spiral order alone cannot promise connected roads, so roads are
 * decided from the coordinates themselves rather than from the order cells are filled.
 */
export const CITY_GRID = Object.freeze({
  /** Centre-to-centre distance between neighbouring cells, in world units. */
  cellSize: 24,
  /** Clear space kept between a building edge and its cell edge, on every side. */
  buildingMargin: 3,
  /** Every nth column and row is road, which leaves blocks of (period - 1) squared plots. */
  roadPeriod: 4,
});

/** The widest a building may be before it would cross into the road. */
export const MAX_FOOTPRINT = CITY_GRID.cellSize - CITY_GRID.buildingMargin * 2;

export interface GridCell {
  readonly gx: number;
  readonly gz: number;
}

/**
 * Roads run along whole columns and rows, so any two road cells are joined by travelling
 * along one road line to an intersection and then along the other. Deciding this from the
 * coordinate — not from how far the spiral has walked — is what keeps that true.
 */
export function isRoadCell(gx: number, gz: number): boolean {
  const period = CITY_GRID.roadPeriod;
  return modulo(gx, period) === 0 || modulo(gz, period) === 0;
}

/** Remainder that stays nonnegative, so roads mirror correctly across the origin. */
function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** World centre of a cell. Buildings are centred here and never offset within the cell. */
export function cellCentre(cell: GridCell): { readonly x: number; readonly z: number } {
  return { x: cell.gx * CITY_GRID.cellSize, z: cell.gz * CITY_GRID.cellSize };
}

/**
 * Square-ring spiral outward from the origin. Walking outward is what puts the most
 * recently pushed repositories downtown; the caller skips road cells as it goes.
 */
export function* spiralCells(): Generator<GridCell> {
  yield { gx: 0, gz: 0 };
  let gx = 0;
  let gz = 0;
  let stepX = 1;
  let stepZ = 0;
  let runLength = 1;
  let turns = 0;
  for (;;) {
    for (let step = 0; step < runLength; step += 1) {
      gx += stepX;
      gz += stepZ;
      yield { gx, gz };
    }
    const nextStepX = -stepZ;
    stepZ = stepX;
    stepX = nextStepX;
    turns += 1;
    if (turns % 2 === 0) runLength += 1;
  }
}

/** The first `count` cells that are plots rather than road, in spiral order. */
export function plotCells(count: number): readonly GridCell[] {
  // The loop below stops on an exact length match, so a fractional or infinite count
  // would spiral outward forever rather than fail.
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('plotCells needs a nonnegative safe integer count.');
  }
  const plots: GridCell[] = [];
  if (count === 0) return plots;
  for (const cell of spiralCells()) {
    if (!isRoadCell(cell.gx, cell.gz)) plots.push(cell);
    if (plots.length === count) break;
  }
  return plots;
}
