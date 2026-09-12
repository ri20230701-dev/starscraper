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
  /**
   * Repository size, in KB, that reaches the widest plot. Chosen at 100 MiB because
   * ordinary repositories run from a few hundred KB to tens of MB: saturating earlier
   * would flatten most of a real account into one identical footprint and throw the
   * size signal away.
   */
  footprintSaturationKb: 102_400,
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
 * limit, which is what keeps a building from ever reaching the road. The rate is derived
 * from the saturation size rather than picked, so the widest plot lands exactly there.
 */
export function footprintOf(sizeKb: number): number {
  const span = BUILDING_RULES.maxFootprint - BUILDING_RULES.minFootprint;
  const rate = span / Math.log2(BUILDING_RULES.footprintSaturationKb + 1);
  const footprint = BUILDING_RULES.minFootprint + rate * Math.log2(Math.max(0, sizeKb) + 1);
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

/**
 * A slab city looks generated, so depth varies around the footprint by name.
 *
 * The noise maps into the legal interval rather than being clamped afterwards. Clamping
 * a scaled value collapses at the ends: at the widest footprint every name above the
 * midpoint produced the same depth, so large repositories all became one identical box.
 */
export function depthOf(repository: Repository): number {
  const footprint = footprintOf(repository.sizeKb);
  const lower = Math.max(BUILDING_RULES.minFootprint, footprint * 0.75);
  const upper = Math.min(BUILDING_RULES.maxFootprint, footprint * 1.25);
  return lower + (upper - lower) * nameNoise(repository.name);
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
