import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';
import { BuildCity } from '../src/application/usecases/BuildCity';
import type { Repository, RepositoryGateway, RepositoryResult } from '../src/application/ports/RepositoryGateway';
import { CitySwitcher } from '../src/presentation/CitySwitcher';
import { describeWait, messageFor } from '../src/presentation/hud/cityMessages';
import { isValidUsername, searchForUsername, usernameFromSearch } from '../src/presentation/cityAddress';

const NOW = Date.UTC(2026, 8, 12, 12);

function repository(name: string, overrides: Partial<Repository> = {}): Repository {
  return {
    name, stars: 5, forks: 0, language: 'TypeScript',
    pushedAt: NOW - 86_400_000, isFork: false, sizeKb: 2_048,
    description: null, htmlUrl: `https://github.com/example/${name}`,
    ...overrides,
  };
}

/** A gateway whose answers are released by hand, so response order can be inverted. */
function deferredGateway() {
  const pending = new Map<string, (result: RepositoryResult) => void>();
  const gateway: RepositoryGateway = {
    fetchRepositories: (username: string) =>
      new Promise<RepositoryResult>(resolve => pending.set(username, resolve)),
  };
  return {
    gateway,
    settle(username: string, result: RepositoryResult): void {
      const resolve = pending.get(username);
      if (!resolve) throw new Error(`No request in flight for ${username}`);
      pending.delete(username);
      resolve(result);
    },
  };
}

function switcher(gateway: RepositoryGateway, now: () => number = () => NOW) {
  return new CitySwitcher({
    gateway,
    buildCity: new BuildCity(),
    sample: SAMPLE_REPOSITORY_PAGE.repositories,
    sampleReferenceTime: SAMPLE_REFERENCE_TIME,
    now,
  });
}

function success(names: readonly string[], hasMore = false): RepositoryResult {
  return { kind: 'success', repositories: names.map(name => repository(name)), hasMore };
}

describe('only the newest lookup may repaint', () => {
  it('discards an older answer that arrives last', async () => {
    const { gateway, settle } = deferredGateway();
    const subject = switcher(gateway);
    const first = subject.resolve('alpha');
    const second = subject.resolve('beta');
    // Invert the order: alpha was asked first but answers second.
    settle('beta', success(['beta-one', 'beta-two']));
    settle('alpha', success(['alpha-one']));
    const [firstView, secondView] = await Promise.all([first, second]);
    // A stale answer must leave the screen alone rather than contradict the address bar.
    expect(firstView).toBeNull();
    expect(secondView?.username).toBe('beta');
    expect(secondView?.city.buildings.map(building => building.name)).toEqual(['beta-one', 'beta-two']);
  });

  it('keeps the newest answer even when three lookups overlap', async () => {
    const { gateway, settle } = deferredGateway();
    const subject = switcher(gateway);
    const views = [subject.resolve('a'), subject.resolve('b'), subject.resolve('c')];
    settle('c', success(['c-one']));
    settle('a', success(['a-one']));
    settle('b', success(['b-one']));
    const settled = await Promise.all(views);
    expect(settled.map(view => view?.username ?? null)).toEqual([null, null, 'c']);
  });

  it('drops an in-flight answer after cancel', async () => {
    const { gateway, settle } = deferredGateway();
    const subject = switcher(gateway);
    const pending = subject.resolve('alpha');
    subject.cancel();
    settle('alpha', success(['alpha-one']));
    expect(await pending).toBeNull();
  });
});

describe('every failure still shows a city', () => {
  it.each([
    ['network-error', { kind: 'network-error', retryable: true } as const],
    ['service-error', { kind: 'service-error', retryable: true } as const],
    ['access-denied', { kind: 'access-denied', retryable: false } as const],
    ['invalid-response', { kind: 'invalid-response', retryable: false } as const],
  ])('falls back to the sample on %s', async (_name, result) => {
    const subject = switcher({ fetchRepositories: async () => result });
    const view = await subject.resolve('someone');
    expect(view?.message.usingSample).toBe(true);
    expect(view?.city.buildings.length).toBe(SAMPLE_REPOSITORY_PAGE.repositories.length);
  });

  it('says how long to wait when the rate limit is spent', async () => {
    const subject = switcher({
      fetchRepositories: async () => ({
        kind: 'rate-limited', limit: 'primary', retryAt: NOW + 5 * 60_000, retryable: true,
      }),
    });
    const view = await subject.resolve('someone');
    expect(view?.message.usingSample).toBe(true);
    expect(view?.message.text).toContain('5 minutes');
  });

  it('builds an empty city rather than the sample when a user has no repositories', async () => {
    const subject = switcher({ fetchRepositories: async () => ({ kind: 'no-repositories', hasMore: false }) });
    const view = await subject.resolve('empty');
    expect(view?.message.usingSample).toBe(false);
    expect(view?.city.buildings).toEqual([]);
  });

  it('names a missing user without offering the sample as theirs', async () => {
    const subject = switcher({ fetchRepositories: async () => ({ kind: 'user-not-found' }) });
    const view = await subject.resolve('nobody');
    expect(view?.message.text).toContain('nobody');
    expect(view?.message.usingSample).toBe(false);
  });
});

describe('the status line reports what is on screen', () => {
  it('flags a truncated listing so the city is not mistaken for the whole account', () => {
    const message = messageFor(success(['one'], true), 'octocat', NOW);
    expect(message.text).toContain('100 most recently pushed');
  });

  it('reports the repository count when nothing was truncated', () => {
    expect(messageFor(success(['one', 'two']), 'octocat', NOW).text).toContain('2 repositories');
  });

  it.each([
    [500, 'a moment'],
    [45_000, '45 seconds'],
    [5 * 60_000, '5 minutes'],
    [3 * 3_600_000, '3 hours'],
    [-1000, 'a moment'],
  ])('describes %i ms as %s', (offset, expected) => {
    expect(describeWait(NOW + offset, NOW)).toBe(expected);
  });
});

describe('the address bar is the sharing mechanism', () => {
  it.each(['torvalds', 'a', 'ri20230701-dev', 'a-b-c'])('accepts %s', value => {
    expect(isValidUsername(value)).toBe(true);
  });

  it.each(['-leading', 'trailing-', 'double--hyphen', 'has space', 'a'.repeat(40), ''])('rejects %s', value => {
    expect(isValidUsername(value)).toBe(false);
  });

  it('reads a username out of the query string', () => {
    expect(usernameFromSearch('?u=octocat')).toBe('octocat');
    expect(usernameFromSearch('?u=%20octocat%20')).toBe('octocat');
    expect(usernameFromSearch('?other=1')).toBeNull();
    expect(usernameFromSearch('?u=not%20a%20name')).toBeNull();
  });

  it('preserves unrelated parameters when switching cities', () => {
    expect(searchForUsername('?debug=1', 'octocat')).toBe('?debug=1&u=octocat');
    expect(searchForUsername('?debug=1&u=old', 'new')).toBe('?debug=1&u=new');
    expect(searchForUsername('?u=old', null)).toBe('');
  });
});

describe('the sample city opens the page', () => {
  it('needs no network call', () => {
    const fetchRepositories = vi.fn();
    const view = switcher({ fetchRepositories }).sampleView();
    expect(fetchRepositories).not.toHaveBeenCalled();
    expect(view.username).toBeNull();
    expect(view.message.usingSample).toBe(true);
    expect(view.city.buildings.length).toBeGreaterThan(0);
  });

  it('is identical every time it is built', () => {
    const subject = switcher({ fetchRepositories: vi.fn() });
    expect(JSON.stringify(subject.sampleView().city)).toBe(JSON.stringify(subject.sampleView().city));
  });
});
