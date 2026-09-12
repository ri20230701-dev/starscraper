import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';

describe('bundled repository sample', () => {
  it('covers the visual mapping boundaries and nullable provider fields', () => {
    const { repositories } = SAMPLE_REPOSITORY_PAGE;
    expect(SAMPLE_REPOSITORY_PAGE.kind).toBe('success');
    expect(SAMPLE_REPOSITORY_PAGE.hasMore).toBe(false);
    expect(repositories).toHaveLength(12);
    expect(new Set(repositories.map(repository => repository.name)).size).toBe(repositories.length);
    expect(repositories.some(repository => repository.stars === 0)).toBe(true);
    expect(repositories.some(repository => repository.stars > 10_000)).toBe(true);
    expect(repositories.some(repository => repository.sizeKb === 0)).toBe(true);
    expect(repositories.some(repository => repository.sizeKb >= 100_000)).toBe(true);
    expect(new Set(repositories.map(repository => repository.language)).size).toBeGreaterThan(5);
    expect(new Set(repositories.map(repository => repository.isFork))).toEqual(new Set([false, true]));
    for (const key of ['language', 'pushedAt', 'description'] as const) {
      expect(repositories.some(repository => repository[key] === null)).toBe(true);
      expect(repositories.some(repository => repository[key] !== null)).toBe(true);
    }
    const ages = repositories.flatMap(repository => repository.pushedAt === null
      ? [] : [(SAMPLE_REFERENCE_TIME - repository.pushedAt) / 86_400_000]);
    expect(ages).toContain(0);
    expect(ages).toContain(30);
    expect(ages).toContain(365);
    expect(ages.some(age => age > 365)).toBe(true);
    for (const repository of repositories) {
      expect(repository.htmlUrl).toBe(`https://github.com/starscraper-sample/${repository.name}`);
    }
  });

  it('freezes the page, collection, and each repository to prevent shared fixture corruption', () => {
    expect(Object.isFrozen(SAMPLE_REPOSITORY_PAGE)).toBe(true);
    expect(Object.isFrozen(SAMPLE_REPOSITORY_PAGE.repositories)).toBe(true);
    for (const repository of SAMPLE_REPOSITORY_PAGE.repositories) {
      expect(Object.isFrozen(repository)).toBe(true);
      expect(Reflect.set(repository, 'stars', -1)).toBe(false);
    }
  });

  it('loads identical data and reference time even when the system clock changes', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      vi.resetModules();
      const before = await import('../src/application/fixtures/sampleRepositories');
      vi.setSystemTime(4_000_000_000_000);
      vi.resetModules();
      const after = await import('../src/application/fixtures/sampleRepositories');
      expect(after.SAMPLE_REFERENCE_TIME).toBe(before.SAMPLE_REFERENCE_TIME);
      expect(after.SAMPLE_REPOSITORY_PAGE).toEqual(before.SAMPLE_REPOSITORY_PAGE);
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });
});
