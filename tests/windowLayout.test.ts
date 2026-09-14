import { describe, expect, it } from 'vitest';
import { calculateWindowLayout, WINDOW_GRID } from '../src/presentation/three/windowLayout';
import type { WindowAxisLayout } from '../src/presentation/three/windowLayout';

function apertureBounds(axis: WindowAxisLayout, index: number): readonly [number, number] {
  const center = axis.margin + (index + 0.5) * axis.pitch;
  return [center - axis.aperture / 2, center + axis.aperture / 2];
}

describe('physical window layout', () => {
  it('uses width on ±Z, depth on ±X, and height on all four walls', () => {
    const layout = calculateWindowLayout({ width: 9, depth: 17, height: 76 });
    expect(layout.front.horizontal.count).toBe(3);
    expect(layout.side.horizontal.count).toBe(7);
    expect(layout.front.vertical.count).toBe(22);
    expect(layout.side.vertical.count).toBe(22);
    expect(layout.front.horizontal.margin).toBeCloseTo(0.9);
    expect(layout.side.horizontal.margin).toBeCloseTo(0.1);
    expect(layout.front.vertical.margin).toBeCloseTo(0.6);
  });

  it.each([
    { width: 9, depth: 8, height: 12 },
    { width: 18, depth: 17, height: 76 },
    { width: 11.37, depth: 15.81, height: 43.29 },
    { width: 2.4, depth: 4.8, height: 3.4 },
  ])('keeps 1.15 × 1.7 apertures and centered edge clearance for $width × $depth × $height', dimensions => {
    const layout = calculateWindowLayout(dimensions);
    for (const [face, width] of [[layout.front, dimensions.width], [layout.side, dimensions.depth]] as const) {
      for (const [axis, dimension, expectedSize] of [
        [face.horizontal, width, 1.15],
        [face.vertical, dimensions.height, 1.7],
      ] as const) {
        expect(axis.count).toBeGreaterThan(0);
        const first = apertureBounds(axis, 0);
        const last = apertureBounds(axis, axis.count - 1);
        expect(first[1] - first[0]).toBeCloseTo(expectedSize);
        expect(last[1] - last[0]).toBeCloseTo(expectedSize);
        expect(first[0]).toBeGreaterThan(0);
        expect(last[1]).toBeLessThan(dimension);
        expect(first[0]).toBeCloseTo(dimension - last[1]);
        expect(axis.margin).toBeGreaterThanOrEqual(0);
        expect(axis.margin).toBeLessThan(axis.pitch / 2);
      }
    }
  });

  it('adds a column at the next full pitch instead of stretching existing windows', () => {
    const narrow = calculateWindowLayout({ width: 9.59, depth: 8, height: 12 }).front.horizontal;
    const wider = calculateWindowLayout({ width: 9.6, depth: 8, height: 12 }).front.horizontal;
    expect(narrow.count).toBe(3);
    expect(wider.count).toBe(4);
    expect(narrow.aperture).toBe(wider.aperture);
    expect(narrow.pitch).toBe(WINDOW_GRID.horizontalPitch);
    expect(wider.pitch).toBe(WINDOW_GRID.horizontalPitch);
  });

  it('leaves faces smaller than a complete cell without squeezed windows', () => {
    const layout = calculateWindowLayout({ width: 1, depth: 2, height: 3 });
    expect(layout.front.horizontal.count).toBe(0);
    expect(layout.side.horizontal.count).toBe(0);
    expect(layout.front.vertical.count).toBe(0);
  });
});

describe('shops replace one complete window row', () => {
  it.each([
    { height: 7.2, count: 2, firstAperture: [1.05, 2.75], shopTop: 3.6 },
    { height: 12, count: 3, firstAperture: [1.75, 3.45], shopTop: 4.3 },
  ])('leaves no severed window at height $height', ({ height, count, firstAperture, shopTop }) => {
    const layout = calculateWindowLayout({ width: 9, depth: 8, height });
    const vertical = layout.front.vertical;
    expect(vertical.count).toBe(count);
    expect(layout.side.vertical).toBe(vertical);
    expect(apertureBounds(vertical, 0)[0]).toBeCloseTo(firstAperture[0]!);
    expect(apertureBounds(vertical, 0)[1]).toBeCloseTo(firstAperture[1]!);
    expect(layout.shopBandTop).toBeCloseTo(shopTop);
    expect(layout.shopBandTop).toBeCloseTo(vertical.margin + vertical.pitch);
    // The full old opening lies in the replacement cell; every remaining opening
    // lies above it. A fixed 2.448/3.4-high strip fails the first of these assertions.
    expect(apertureBounds(vertical, 0)[1]).toBeLessThan(layout.shopBandTop);
    for (let row = 1; row < vertical.count; row += 1) {
      expect(apertureBounds(vertical, row)[0]).toBeGreaterThan(layout.shopBandTop);
    }
    expect(vertical.count - 1).toBeGreaterThanOrEqual(1);
  });

  it.each([3, 3.4, 6.79])('preserves windows when height %s cannot hold two rows', height => {
    const layout = calculateWindowLayout({ width: 9, depth: 8, height });
    expect(layout.front.vertical.count).toBeLessThan(2);
    expect(layout.shopBandTop).toBe(0);
  });

  it('does not move the store up to the geometry center in a tall building', () => {
    const height = 76;
    const layout = calculateWindowLayout({ width: 9, depth: 8, height });
    const localShopTop = layout.shopBandTop - height * 0.5;
    expect(localShopTop).toBeCloseTo(-34);
    expect(localShopTop + height * 0.5).toBeCloseTo(4);
    expect(localShopTop).toBeLessThan(0);
  });
});
