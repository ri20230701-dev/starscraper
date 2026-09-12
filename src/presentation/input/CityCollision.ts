import type { BuildingSnapshot, CitySnapshot } from '../../application/dto/CitySnapshot';

export interface Point {
  readonly x: number;
  readonly z: number;
}

interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly building: BuildingSnapshot;
}

/** Wide enough that a building spans few buckets, small enough that a bucket holds few. */
const BUCKET = 24;

function key(bucketX: number, bucketZ: number): string {
  return `${bucketX},${bucketZ}`;
}

/**
 * Keeps a walker out of the buildings.
 *
 * Buildings sit on a grid, so this never needs a general sweep: each one is filed into
 * the buckets its footprint touches, and a step only consults the bucket it lands in.
 * That is what made walking cheap enough to keep when the schedule argued against it.
 */
export class CityCollision {
  private readonly buckets = new Map<string, Box[]>();
  /**
   * Half the narrowest building, so a single step can never straddle one.
   *
   * A step capped at half a bucket was wider than the smallest footprint: a ten unit
   * move crossed a seven unit building with both ends legal and the middle inside it.
   */
  private readonly maxStep: number;

  constructor(city: CitySnapshot, radius: number) {
    let narrowest = Infinity;
    for (const building of city.buildings) {
      narrowest = Math.min(narrowest, building.width + radius * 2, building.depth + radius * 2);
    }
    this.maxStep = Math.max(0.05, Math.min(BUCKET / 2, narrowest / 2));
    for (const building of city.buildings) {
      // Inflate by the walker's radius so a hit test is a point-in-box question.
      const box: Box = {
        minX: building.x - building.width / 2 - radius,
        maxX: building.x + building.width / 2 + radius,
        minZ: building.z - building.depth / 2 - radius,
        maxZ: building.z + building.depth / 2 + radius,
        building,
      };
      for (let bucketX = Math.floor(box.minX / BUCKET); bucketX <= Math.floor(box.maxX / BUCKET); bucketX += 1) {
        for (let bucketZ = Math.floor(box.minZ / BUCKET); bucketZ <= Math.floor(box.maxZ / BUCKET); bucketZ += 1) {
          const bucket = this.buckets.get(key(bucketX, bucketZ));
          if (bucket) bucket.push(box);
          else this.buckets.set(key(bucketX, bucketZ), [box]);
        }
      }
    }
  }

  /** True when a walker centred here would be inside a building. */
  blocked(point: Point): boolean {
    const bucket = this.buckets.get(key(Math.floor(point.x / BUCKET), Math.floor(point.z / BUCKET)));
    if (!bucket) return false;
    return bucket.some(box => point.x > box.minX && point.x < box.maxX
      && point.z > box.minZ && point.z < box.maxZ);
  }

  /**
   * Move as far along the requested step as the buildings allow.
   *
   * The step is subdivided so that no single move can exceed a bucket: at a low frame
   * rate an undivided step would jump straight through a wall. Each axis is then tried
   * separately, which is what lets a walker slide along a facade instead of sticking to it.
   */
  move(from: Point, deltaX: number, deltaZ: number): Point {
    const distance = Math.hypot(deltaX, deltaZ);
    if (distance === 0) return from;
    const steps = Math.max(1, Math.ceil(distance / this.maxStep));
    let current = from;
    for (let step = 0; step < steps; step += 1) {
      current = this.step(current, deltaX / steps, deltaZ / steps);
    }
    return current;
  }

  private step(from: Point, deltaX: number, deltaZ: number): Point {
    let { x, z } = from;
    if (deltaX !== 0 && !this.blocked({ x: x + deltaX, z })) x += deltaX;
    if (deltaZ !== 0 && !this.blocked({ x, z: z + deltaZ })) z += deltaZ;
    return { x, z };
  }

  /**
   * A free spot to start from, searched outward from the middle of the city so the walker
   * begins on the street rather than being dropped on a roof or outside town.
   */
  spawn(centre: Point): Point {
    if (!this.blocked(centre)) return centre;
    for (let ring = 1; ring <= 64; ring += 1) {
      const reach = ring * (BUCKET / 3);
      for (let angle = 0; angle < 12; angle += 1) {
        const radians = (angle / 12) * Math.PI * 2;
        const candidate = {
          x: centre.x + Math.cos(radians) * reach,
          z: centre.z + Math.sin(radians) * reach,
        };
        if (!this.blocked(candidate)) return candidate;
      }
    }
    return centre;
  }
}
