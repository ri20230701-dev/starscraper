/** World units, shared by the CPU layout and the shader's window apertures. */
export const WINDOW_GRID = Object.freeze({
  horizontalPitch: 2.4,
  verticalPitch: 3.4,
  windowWidth: 1.15,
  windowHeight: 1.7,
});

export interface WindowAxisLayout {
  readonly count: number;
  readonly pitch: number;
  readonly aperture: number;
  /** Empty space before the first complete cell, in world units. */
  readonly margin: number;
}

export interface WindowFaceLayout {
  readonly horizontal: WindowAxisLayout;
  readonly vertical: WindowAxisLayout;
}

export interface BuildingWindowLayout {
  /** Front/back (normal ±Z): the wall's horizontal dimension is width. */
  readonly front: WindowFaceLayout;
  /** Left/right (normal ±X): the wall's horizontal dimension is depth. */
  readonly side: WindowFaceLayout;
  /** Top of the replaced ground-floor cell, measured from the base; 0 preserves a lone window row. */
  readonly shopBandTop: number;
}

function axisLayout(dimension: number, pitch: number, aperture: number): WindowAxisLayout {
  const count = Math.max(0, Math.floor(dimension / pitch));
  return { count, pitch, aperture, margin: (dimension - count * pitch) / 2 };
}

/** Fit complete cells; leftover width becomes margins instead of stretching windows. */
export function calculateWindowLayout(dimensions: {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}): BuildingWindowLayout {
  const vertical = axisLayout(dimensions.height, WINDOW_GRID.verticalPitch, WINDOW_GRID.windowHeight);
  return {
    shopBandTop: vertical.count >= 2 ? vertical.margin + vertical.pitch : 0,
    front: {
      horizontal: axisLayout(dimensions.width, WINDOW_GRID.horizontalPitch, WINDOW_GRID.windowWidth),
      vertical,
    },
    side: {
      horizontal: axisLayout(dimensions.depth, WINDOW_GRID.horizontalPitch, WINDOW_GRID.windowWidth),
      vertical,
    },
  };
}
