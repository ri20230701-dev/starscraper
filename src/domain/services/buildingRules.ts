import type { Repository } from '../model/Repository';
import { MAX_FOOTPRINT } from './cityGrid';
import { colorForLanguage, desaturate } from './languageColors';

const DAY_MS = 86_400_000;

export const BUILDING_RULES = Object.freeze({
  /** A zero-star repository is still a building; nobody's work should read as rubble. */
  baseHeight: 12,
  /** Metres of height per doubling of stars. */
  heightPerDoubling: 6,
  minFootprint: 7,
  maxFootprint: MAX_FOOTPRINT,
  /** World units of footprint per doubling of repository size. */
  footprintPerDoubling: 1.3,
  /** Forks stay low so originals keep the skyline. */
  forkHeightScale: 0.6,
  forkDesaturation: 0.45,
});

export const WINDOW_LIT = Object.freeze({
  /** Anything touched within a month is treated as fully alive. */
  freshDays: 30,
  freshRatio: 0.9,
  staleDays: 365,
  staleRatio: 0.1,
  abandonedDays: 1825,
  abandonedRatio: 0.02,
});

/**
 * Stars follow a power law: most repositories have none and a single one may have tens of
 * thousands. Mapping them linearly produces one tower beside a field of paving stones, so
 * height grows with each doubling instead.
 */
export function heightOf(repository: Repository): number {
  const height = BUILDING_RULES.baseHeight
    + BUILDING_RULES.heightPerDoubling * Math.log2(repository.stars + 1);
  return repository.isFork ? height * BUILDING_RULES.forkHeightScale : height;
}

/**
 * Footprint also grows per doubling, then clamps. The upper clamp is the grid's own
 * limit, which is what keeps a building from ever reaching the road.
 */
export function footprintOf(sizeKb: number): number {
  const footprint = BUILDING_RULES.minFootprint
    + BUILDING_RULES.footprintPerDoubling * Math.log2(Math.max(0, sizeKb) + 1);
  return Math.min(BUILDING_RULES.maxFootprint, Math.max(BUILDING_RULES.minFootprint, footprint));
}

/** FNV-1a over the name: variation that is stable for a given repository, without a clock or RNG. */
export function nameNoise(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/** A slab city looks generated; depth varies around the footprint, still inside the clamp. */
export function depthOf(repository: Repository): number {
  const footprint = footprintOf(repository.sizeKb);
  const varied = footprint * (0.75 + 0.5 * nameNoise(repository.name));
  return Math.min(BUILDING_RULES.maxFootprint, Math.max(BUILDING_RULES.minFootprint, varied));
}

export function wallColorOf(repository: Repository): string {
  const color = colorForLanguage(repository.language);
  return repository.isFork ? desaturate(color, BUILDING_RULES.forkDesaturation) : color;
}

function interpolate(value: number, fromValue: number, toValue: number, fromResult: number, toResult: number): number {
  const span = toValue - fromValue;
  const position = span === 0 ? 0 : (value - fromValue) / span;
  return fromResult + (toResult - fromResult) * Math.min(1, Math.max(0, position));
}

/**
 * The share of windows that are lit, which is how a repository's last push reaches the
 * viewer. Age is interpolated in log space because the interesting difference is between
 * a month and a year, not between three and four years.
 *
 * `referenceTime` is a parameter rather than a clock read: the same data and the same
 * reference instant must always produce the same city (PLAN section 6), and the layer
 * contract forbids reading the clock here at all.
 */
export function windowLitRatioOf(repository: Repository, referenceTime: number): number {
  if (repository.pushedAt === null) return WINDOW_LIT.abandonedRatio;
  const days = Math.max(0, (referenceTime - repository.pushedAt) / DAY_MS);
  if (days <= WINDOW_LIT.freshDays) return WINDOW_LIT.freshRatio;
  const logDays = Math.log2(days);
  if (days <= WINDOW_LIT.staleDays) {
    return interpolate(logDays, Math.log2(WINDOW_LIT.freshDays), Math.log2(WINDOW_LIT.staleDays),
      WINDOW_LIT.freshRatio, WINDOW_LIT.staleRatio);
  }
  return interpolate(logDays, Math.log2(WINDOW_LIT.staleDays), Math.log2(WINDOW_LIT.abandonedDays),
    WINDOW_LIT.staleRatio, WINDOW_LIT.abandonedRatio);
}

/**
 * Downtown is the recently pushed work. Ties break on name so that two repositories
 * pushed in the same second never swap places between builds, and repositories with no
 * push date sink to the edge of town.
 */
export function byRecency(left: Repository, right: Repository): number {
  if (left.pushedAt !== right.pushedAt) {
    if (left.pushedAt === null) return 1;
    if (right.pushedAt === null) return -1;
    return right.pushedAt - left.pushedAt;
  }
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}
