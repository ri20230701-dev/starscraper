import type { CitySnapshot } from '../dto/CitySnapshot';

const WALL_COLORS = ['#37516a', '#4b4263', '#34605e', '#675148', '#384c64'] as const;

/** Fixed technical-validation fixture, deliberately only an even 10 × 10 grid. */
export class CreateDummyCity {
  execute(): CitySnapshot {
    return {
      buildings: Array.from({ length: 100 }, (_, id) => ({
        id,
        x: ((id % 10) - 4.5) * 24,
        z: (Math.floor(id / 10) - 4.5) * 24,
        width: 9 + ((id * 7) % 10),
        depth: 8 + ((id * 3) % 10),
        height: 12 + ((id * 23 + 17) % 65),
        color: WALL_COLORS[id % WALL_COLORS.length] ?? '#384c64',
        windowLitRatio: 0.15 + ((id * 13) % 80) / 100,
        // Placeholder metadata: this fixture predates real repository data and exists
        // only to keep the render path alive until issue #4 wires the gateway in.
        name: `sample-${String(id).padStart(3, '0')}`,
        htmlUrl: 'https://github.com/',
        description: null,
        language: null,
        stars: 0,
        pushedAt: null,
        isFork: false,
      })),
    };
  }
}
