import type { Repository, RepositoryPage } from '../ports/RepositoryGateway';

/** 2026-01-01T00:00:00Z. Pass this alongside the sample when building a reproducible city. */
export const SAMPLE_REFERENCE_TIME = 1_767_225_600_000;

const DAY_MS = 86_400_000;

// These repositories are synthetic: names and URLs are display fixtures, not fetched projects.
const repositories: readonly Repository[] = Object.freeze([
  {
    name: 'neon-engine', stars: 85_000, forks: 8_200, language: 'TypeScript',
    pushedAt: SAMPLE_REFERENCE_TIME, isFork: false, sizeKb: 148_000,
    description: 'Synthetic rendering engine for the brightest central tower.',
    htmlUrl: 'https://github.com/starscraper-sample/neon-engine',
  },
  {
    name: 'transit-map', stars: 3_400, forks: 210, language: 'Rust',
    pushedAt: SAMPLE_REFERENCE_TIME - DAY_MS, isFork: false, sizeKb: 31_000,
    description: 'Synthetic route planner with recent activity.',
    htmlUrl: 'https://github.com/starscraper-sample/transit-map',
  },
  {
    name: 'night-notebook', stars: 72, forks: 4, language: 'Python',
    pushedAt: SAMPLE_REFERENCE_TIME - 7 * DAY_MS, isFork: false, sizeKb: 860,
    description: 'Synthetic small data notebook.',
    htmlUrl: 'https://github.com/starscraper-sample/night-notebook',
  },
  {
    name: 'signal-box', stars: 0, forks: 0, language: 'Go',
    pushedAt: SAMPLE_REFERENCE_TIME - 14 * DAY_MS, isFork: false, sizeKb: 120,
    description: 'Synthetic new project without stars.',
    htmlUrl: 'https://github.com/starscraper-sample/signal-box',
  },
  {
    name: 'window-garden', stars: 880, forks: 96, language: 'JavaScript',
    pushedAt: SAMPLE_REFERENCE_TIME - 30 * DAY_MS, isFork: false, sizeKb: 6_400,
    description: 'Synthetic project at the one-month activity boundary.',
    htmlUrl: 'https://github.com/starscraper-sample/window-garden',
  },
  {
    name: 'borrowed-bridge', stars: 12_000, forks: 700, language: 'C++',
    pushedAt: SAMPLE_REFERENCE_TIME - 45 * DAY_MS, isFork: true, sizeKb: 900_000,
    description: 'Synthetic popular fork for checking muted, low-rise treatment.',
    htmlUrl: 'https://github.com/starscraper-sample/borrowed-bridge',
  },
  {
    name: 'roof-tools', stars: 19, forks: 2, language: 'Shell',
    pushedAt: SAMPLE_REFERENCE_TIME - 90 * DAY_MS, isFork: false, sizeKb: 12,
    description: null,
    htmlUrl: 'https://github.com/starscraper-sample/roof-tools',
  },
  {
    name: 'archive-hall', stars: 2_600, forks: 130, language: 'Java',
    pushedAt: SAMPLE_REFERENCE_TIME - 180 * DAY_MS, isFork: false, sizeKb: 75_000,
    description: 'Synthetic older medium-rise project.',
    htmlUrl: 'https://github.com/starscraper-sample/archive-hall',
  },
  {
    name: 'quiet-library', stars: 450, forks: 22, language: 'Ruby',
    pushedAt: SAMPLE_REFERENCE_TIME - 365 * DAY_MS, isFork: false, sizeKb: 2_100,
    description: 'Synthetic project at the one-year activity boundary.',
    htmlUrl: 'https://github.com/starscraper-sample/quiet-library',
  },
  {
    name: 'forgotten-fork', stars: 2, forks: 0, language: 'TypeScript',
    pushedAt: SAMPLE_REFERENCE_TIME - 730 * DAY_MS, isFork: true, sizeKb: 420,
    description: null,
    htmlUrl: 'https://github.com/starscraper-sample/forgotten-fork',
  },
  {
    name: 'unknown-workshop', stars: 150, forks: 9, language: 'SampleLang',
    pushedAt: SAMPLE_REFERENCE_TIME - 1_460 * DAY_MS, isFork: false, sizeKb: 1_000_000,
    description: 'Synthetic unknown language for the default color and footprint clamp.',
    htmlUrl: 'https://github.com/starscraper-sample/unknown-workshop',
  },
  {
    name: 'empty-lot', stars: 0, forks: 0, language: null,
    pushedAt: null, isFork: false, sizeKb: 0, description: null,
    htmlUrl: 'https://github.com/starscraper-sample/empty-lot',
  },
].map(repository => Object.freeze(repository)));

/** Consumers explicitly select this page for development or a rate-limit fallback display. */
export const SAMPLE_REPOSITORY_PAGE = Object.freeze({
  kind: 'success',
  repositories,
  hasMore: false,
} satisfies Extract<RepositoryPage, { kind: 'success' }>);
