import { describe, expect, it, vi } from 'vitest';
import { GitHubApiClient } from '../src/infrastructure/github/GitHubApiClient';

const NOW = Date.UTC(2026, 8, 12, 12);

function repository(overrides: Record<string, unknown> = {}) {
  return {
    name: 'starscraper',
    stargazers_count: 42,
    forks_count: 3,
    language: 'TypeScript',
    pushed_at: '2026-09-10T12:34:56Z',
    fork: false,
    size: 1024,
    description: 'A repository skyline',
    html_url: 'https://github.com/example/starscraper',
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), init);
}

function setup(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  const client = new GitHubApiClient({ fetch, now: () => NOW });
  return { fetch, client };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('GitHubApiClient repository boundary', () => {
  it('fetches one unauthenticated owner page and maps all nine repository fields', async () => {
    const { client, fetch } = setup(jsonResponse([repository({ ignored_api_field: true })]));

    expect(await client.fetchRepositories('Example')).toEqual({
      kind: 'success',
      hasMore: false,
      repositories: [{
        name: 'starscraper',
        stars: 42,
        forks: 3,
        language: 'TypeScript',
        pushedAt: Date.parse('2026-09-10T12:34:56Z'),
        isFork: false,
        sizeKb: 1024,
        description: 'A repository skyline',
        htmlUrl: 'https://github.com/example/starscraper',
      }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.github.com');
    expect(url.pathname.toLowerCase()).toBe('/users/example/repos');
    expect([...url.searchParams]).toEqual([
      ['per_page', '100'], ['sort', 'pushed'], ['type', 'owner'],
    ]);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('preserves nullable metadata and fork status', async () => {
    const { client } = setup(jsonResponse([
      repository({ language: null, description: null, pushed_at: null, fork: true }),
    ]));
    expect(await client.fetchRepositories('example')).toMatchObject({
      kind: 'success',
      repositories: [{ language: null, description: null, pushedAt: null, isFork: true }],
    });
  });

  it('returns a dedicated no-repositories state', async () => {
    const { client } = setup(jsonResponse([]));
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'no-repositories', hasMore: false });
  });

  it.each([
    ['an object instead of a list', {}],
    ['a null entry', [null]],
    ['missing fields', [{ name: 'incomplete' }]],
    ['negative stars', [repository({ stargazers_count: -1 })]],
    ['non-numeric forks', [repository({ forks_count: '3' })]],
    ['negative size', [repository({ size: -1 })]],
    ['invalid language', [repository({ language: 42 })]],
    ['invalid description', [repository({ description: false })]],
    ['invalid fork flag', [repository({ fork: 'false' })]],
    ['invalid timestamp', [repository({ pushed_at: 'not-a-date' })]],
    ['invalid URL type', [repository({ html_url: 42 })]],
  ])('rejects malformed data: %s', async (_label, body) => {
    const { client } = setup(jsonResponse(body));
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'invalid-response', retryable: false });
  });

  it('returns invalid-response when success JSON cannot be decoded', async () => {
    const { client } = setup(new Response('{broken'));
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'invalid-response', retryable: false });
  });

  it.each([Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects an unsafe count: %s', async count => {
    const response = jsonResponse([]);
    vi.spyOn(response, 'json').mockResolvedValue([repository({ stargazers_count: count })]);
    const { client } = setup(response);
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'invalid-response', retryable: false });
  });

  it('distinguishes a response-body network failure from malformed JSON', async () => {
    const response = jsonResponse([]);
    vi.spyOn(response, 'json').mockRejectedValue(new TypeError('connection closed while reading'));
    const { client } = setup(response);
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'network-error', retryable: true });
  });
});

describe('GitHubApiClient Link pagination', () => {
  it.each([99, 100])('does not infer hasMore from %i repositories', async count => {
    const { client, fetch } = setup(jsonResponse(Array.from({ length: count }, (_, index) => (
      repository({ name: `repository-${index}` })
    ))));
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'success', hasMore: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sets hasMore only from the next Link relation and never fetches that page', async () => {
    const { client, fetch } = setup(jsonResponse([repository()], {
      headers: { Link: '<https://api.github.com/users/example/repos?page=2>; rel="next"' },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'success', hasMore: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['relative URL', '</users/example/repos?page=2>; rel="next"', true],
    ['multiple links', '</repos?page=1>; rel="prev", </repos?page=2>; rel="next"', true],
    ['multiple relation values', '<?page=2>; rel="alternate next"', true],
    ['unquoted relation', '<?page=2>; rel=next', true],
    ['quoted commas and semicolons', '<?page=2>; title="more, repositories; next page"; rel="next"', true],
    ['comma inside URL', '<?filter=a,b&page=2>; rel="next"', true],
    ['last link only', '<?page=2>; rel="last"', false],
    ['relation substring', '<?page=2>; rel="nextish"', false],
    ['relation in URL', '<?rel=next>; rel="last"', false],
    ['relation in title', '<?page=2>; title="rel=next"; rel="last"', false],
    ['quoted fake link', '<?page=2>; title="fake, <page3>; rel=next"; rel="last"', false],
  ])('handles %s', async (_label, link, hasMore) => {
    const { client } = setup(jsonResponse([repository()], { headers: { Link: String(link) } }));
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'success', hasMore });
  });

  it('retains the Link result even on the dedicated no-repositories state', async () => {
    const { client } = setup(jsonResponse([], { headers: { Link: '<?page=2>; rel="next"' } }));
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'no-repositories', hasMore: true });
  });
});

describe('GitHubApiClient failures and rate limits', () => {
  it('maps 404 to user-not-found without depending on the error body', async () => {
    const { client } = setup(new Response('not JSON', { status: 404 }));
    expect(await client.fetchRepositories('missing')).toEqual({ kind: 'user-not-found' });
  });

  it('classifies 403 with zero remaining quota as primary rate limiting', async () => {
    const { client } = setup(jsonResponse({ message: 'API rate limit exceeded' }, {
      status: 403,
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(NOW / 1000 + 120) },
    }));
    expect(await client.fetchRepositories('example')).toEqual({
      kind: 'rate-limited', limit: 'primary', retryAt: NOW + 120_000, retryable: true,
    });
  });

  it.each([
    'You have exceeded a secondary rate limit.',
    'You have triggered an abuse detection mechanism.',
  ])('identifies 403 secondary/abuse limiting from its message: %s', async message => {
    const { client } = setup(jsonResponse({ message }, {
      status: 403, headers: { 'X-RateLimit-Remaining': '59' },
    }));
    expect(await client.fetchRepositories('example')).toEqual({
      kind: 'rate-limited', limit: 'secondary', retryAt: NOW + 60_000, retryable: true,
    });
  });

  it('identifies a secondary 403 from Retry-After even without a usable error body', async () => {
    const { client } = setup(new Response('not JSON', {
      status: 403, headers: { 'Retry-After': '30', 'X-RateLimit-Remaining': '59' },
    }));
    expect(await client.fetchRepositories('example')).toEqual({
      kind: 'rate-limited', limit: 'secondary', retryAt: NOW + 30_000, retryable: true,
    });
  });

  it('maps 429 without primary-quota evidence to secondary rate limiting', async () => {
    const { client } = setup(jsonResponse({ message: 'Too many requests' }, { status: 429 }));
    expect(await client.fetchRepositories('example')).toEqual({
      kind: 'rate-limited', limit: 'secondary', retryAt: NOW + 60_000, retryable: true,
    });
  });

  it('keeps primary classification for 429 with zero remaining quota', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429, headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '10' },
    }));
    expect(await client.fetchRepositories('example')).toEqual({
      kind: 'rate-limited', limit: 'primary', retryAt: NOW + 10_000, retryable: true,
    });
  });

  it('prioritizes Retry-After seconds over the reset header', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429,
      headers: { 'Retry-After': '20', 'X-RateLimit-Reset': String(NOW / 1000 + 120) },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ retryAt: NOW + 20_000 });
  });

  it('supports Retry-After HTTP dates', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429, headers: { 'Retry-After': new Date(NOW + 45_000).toUTCString() },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ retryAt: NOW + 45_000 });
  });

  it('falls back from malformed Retry-After to reset epoch seconds', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429,
      headers: { 'Retry-After': 'invalid', 'X-RateLimit-Reset': String(NOW / 1000 + 90) },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ retryAt: NOW + 90_000 });
  });

  it('uses a conservative fallback for expired secondary reset times', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429, headers: { 'X-RateLimit-Reset': String(NOW / 1000 - 1) },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ retryAt: NOW + 60_000 });
  });

  it('honors an explicit zero-second Retry-After', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429, headers: { 'Retry-After': '0' },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ retryAt: NOW });
  });

  it('uses a finite fallback when both retry headers are malformed', async () => {
    const { client } = setup(jsonResponse({}, {
      status: 429, headers: { 'Retry-After': 'invalid', 'X-RateLimit-Reset': 'Infinity' },
    }));
    expect(await client.fetchRepositories('example')).toMatchObject({ retryAt: NOW + 60_000 });
  });

  it('does not mislabel an ordinary 403 as secondary limiting', async () => {
    const { client } = setup(jsonResponse({ message: 'Forbidden' }, {
      status: 403,
      headers: { 'X-RateLimit-Remaining': '59', 'X-RateLimit-Reset': String(NOW / 1000 + 120) },
    }));
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'access-denied', retryable: false });
  });

  it.each([500, 502, 503])('maps service status %i without exposing HTTP details', async status => {
    const { client } = setup(jsonResponse({ message: 'internal details' }, { status }));
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'service-error', retryable: true });
  });

  it('maps a rejected fetch to a distinct retryable network error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('offline'));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'network-error', retryable: true });
  });

  it('maps a synchronous fetch failure to a retryable network error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => { throw new TypeError('offline'); });
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'network-error', retryable: true });
  });
});

describe('GitHubApiClient request conservation', () => {
  it('deduplicates concurrent same-user requests into one underlying fetch', async () => {
    const pending = deferredResponse();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(pending.promise);
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    const results = ['example', 'EXAMPLE', ' example '].map(username => client.fetchRepositories(username));
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse([repository()]));
    const resolved = await Promise.all(results);
    expect(resolved).toEqual([resolved[0], resolved[0], resolved[0]]);
    expect(resolved[0]).toMatchObject({ kind: 'success' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce pending requests for different users', async () => {
    const pending = deferredResponse();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse([repository({ name: 'second' })]));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    const first = client.fetchRepositories('first');
    const second = await client.fetchRepositories('second');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ kind: 'success', repositories: [{ name: 'second' }] });
    pending.resolve(jsonResponse([repository()]));
    await first;
  });

  it('reuses a success within the default 60-second cache TTL and refreshes at expiry', async () => {
    let now = NOW;
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([repository()]))
      .mockResolvedValueOnce(jsonResponse([repository({ stargazers_count: 43 })]));
    const client = new GitHubApiClient({ fetch, now: () => now });
    const first = await client.fetchRepositories('example');
    now += 59_999;
    expect(await client.fetchRepositories(' EXAMPLE ')).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await client.fetchRepositories('example')).toMatchObject({ repositories: [{ stars: 43 }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('starts the success-cache TTL when the response completes', async () => {
    let now = NOW;
    const pending = deferredResponse();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(pending.promise);
    const client = new GitHubApiClient({ fetch, now: () => now });
    const first = client.fetchRepositories('example');
    now += 120_000;
    pending.resolve(jsonResponse([repository()]));
    await first;
    now += 59_999;
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'success' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches successful empty repository pages', async () => {
    const { client, fetch } = setup(jsonResponse([]));
    await client.fetchRepositories('example');
    expect(await client.fetchRepositories('example')).toEqual({ kind: 'no-repositories', hasMore: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cleans up a failed pending request and allows an uncached network retry', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse([repository()]));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'network-error' });
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'success' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('allows an immediate retry after an already-expired primary reset time', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({}, {
        status: 403,
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(NOW / 1000 - 1) },
      }))
      .mockResolvedValueOnce(jsonResponse([repository()]));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'rate-limited', retryAt: NOW });
    expect(await client.fetchRepositories('example')).toMatchObject({ kind: 'success' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('suppresses requests across usernames until the rate-limit retry time', async () => {
    let now = NOW;
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '30' } }))
      .mockResolvedValueOnce(jsonResponse([repository()]));
    const client = new GitHubApiClient({ fetch, now: () => now });
    const limited = await client.fetchRepositories('first');
    now += 29_999;
    expect(await client.fetchRepositories('second')).toEqual(limited);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await client.fetchRepositories('second')).toMatchObject({ kind: 'success' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('serves a cached success while requests for other users are rate limited', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([repository()]))
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '30' } }));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    const cached = await client.fetchRepositories('cached');
    await client.fetchRepositories('limited');
    expect(await client.fetchRepositories('cached')).toEqual(cached);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let a later successful pending request clear a rate-limit cooldown', async () => {
    const pending = deferredResponse();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '30' } }));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    const success = client.fetchRepositories('first');
    const limited = await client.fetchRepositories('second');
    pending.resolve(jsonResponse([repository()]));
    await success;
    expect(await client.fetchRepositories('third')).toEqual(limited);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains the longer cooldown when concurrent limit responses arrive out of order', async () => {
    const pending = deferredResponse();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '120' } }));
    const client = new GitHubApiClient({ fetch, now: () => NOW });
    const first = client.fetchRepositories('first');
    const longerLimit = await client.fetchRepositories('second');
    pending.resolve(jsonResponse({}, { status: 429, headers: { 'Retry-After': '10' } }));
    await first;
    expect(await client.fetchRepositories('third')).toEqual(longerLimit);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
