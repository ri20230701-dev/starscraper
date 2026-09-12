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
