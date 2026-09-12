import type {
  RateLimitError, Repository, RepositoryGateway, RepositoryPage, RepositoryResult,
} from '../../application/ports/RepositoryGateway';
import { hasNextLink } from './linkHeader';

// One minute absorbs repeat submissions while keeping pushed/star data reasonably fresh.
const SUCCESS_CACHE_TTL_MS = 60_000;
const RATE_LIMIT_FALLBACK_MS = 60_000;

interface GitHubApiClientOptions {
  readonly fetch?: typeof fetch;
  /** Wall clock, used only for the outward-facing retryAt instant. */
  readonly now?: () => number;
  /** Monotonic source, used for every duration so a clock change cannot distort them. */
  readonly elapsed?: () => number;
  readonly cacheTtlMs?: number;
}

interface CachedPage {
  readonly result: RepositoryPage;
  /** On the monotonic timeline, not the wall clock. */
  readonly expiresAt: number;
}

interface Cooldown {
  readonly result: RateLimitError;
  /** On the monotonic timeline, not the wall clock. */
  readonly until: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Validate untrusted JSON instead of casting the provider response to application data. */
function parseRepository(value: unknown): Repository | null {
  if (!isRecord(value)
    || typeof value.name !== 'string'
    || !isCount(value.stargazers_count)
    || !isCount(value.forks_count)
    || !isNullableString(value.language)
    || !isNullableString(value.pushed_at)
    || typeof value.fork !== 'boolean'
    || !isCount(value.size)
    || !isNullableString(value.description)
    || typeof value.html_url !== 'string') return null;

  const pushedAt = value.pushed_at === null ? null : Date.parse(value.pushed_at);
  if (pushedAt !== null && !Number.isFinite(pushedAt)) return null;
  return Object.freeze({
    name: value.name,
    stars: value.stargazers_count,
    forks: value.forks_count,
    language: value.language,
    pushedAt,
    isFork: value.fork,
    sizeKb: value.size,
    description: value.description,
    htmlUrl: value.html_url,
  });
}

function retryAtFrom(headers: Headers, now: number, limit: RateLimitError['limit']): number {
  const retryAfter = headers.get('Retry-After')?.trim();
  if (retryAfter) {
    const time = /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(time) && time >= now) return time;
  }
  // X-RateLimit-Reset describes the primary window only. Reading it for a secondary
  // limit both under- and overshoots: a reset one second away retries immediately,
  // while one an hour away locks out every uncached lookup. GitHub's guidance for a
  // secondary limit without Retry-After is to wait at least a minute.
  if (limit === 'primary') {
    const reset = headers.get('X-RateLimit-Reset')?.trim();
    if (reset && /^\d+$/.test(reset)) {
      const time = Number(reset) * 1000;
      if (Number.isFinite(time)) return Math.max(now, time);
    }
  }
  return now + RATE_LIMIT_FALLBACK_MS;
}

export class GitHubApiClient implements RepositoryGateway {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly elapsed: () => number;
  private readonly cacheTtlMs: number;
  private readonly pending = new Map<string, Promise<RepositoryResult>>();
  private readonly cache = new Map<string, CachedPage>();
  private cooldown: Cooldown | null = null;

  constructor(options: GitHubApiClientOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    // A caller that injects a wall clock drives it deterministically, so it doubles as
    // the duration source. Left to itself the client uses a clock that cannot rewind:
    // a user correcting their system time must not extend a cache entry or revive a
    // cooldown that has already lapsed.
    this.elapsed = options.elapsed ?? options.now ?? (() => performance.now());
    this.cacheTtlMs = options.cacheTtlMs ?? SUCCESS_CACHE_TTL_MS;
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new RangeError('cacheTtlMs must be a finite nonnegative duration');
    }
  }

  fetchRepositories(username: string): Promise<RepositoryResult> {
    const key = username.trim().toLowerCase();
    const elapsed = this.elapsed();
    // Prune all expired entries so one-off usernames do not accumulate forever.
    for (const [name, entry] of this.cache) {
      if (entry.expiresAt <= elapsed) this.cache.delete(name);
    }
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached.result);
    const pending = this.pending.get(key);
    if (pending) return pending;
    // Unauthenticated limits are shared across users; cached data remains usable.
    if (this.cooldown) {
      if (this.cooldown.until > elapsed) return Promise.resolve(this.cooldown.result);
      this.cooldown = null;
    }

    const request = this.load(key).then(result => {
      if (result.kind === 'success' || result.kind === 'no-repositories') {
        this.cache.set(key, { result, expiresAt: this.elapsed() + this.cacheTtlMs });
      }
      if (result.kind === 'rate-limited') {
        const until = this.elapsed() + Math.max(0, result.retryAt - this.now());
        if (!this.cooldown || until >= this.cooldown.until) this.cooldown = { result, until };
      }
      return result;
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async load(username: string): Promise<RepositoryResult> {
    let response: Response;
    try {
      response = await this.fetch(
        `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed&type=owner`,
        { method: 'GET', headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit' },
      );
    } catch {
      return { kind: 'network-error', retryable: true };
    }

    if (response.status === 404) return { kind: 'user-not-found' };
    if (response.status === 403 || response.status === 429) return this.classifyForbidden(response);
    if (!response.ok) {
      return response.status >= 500
        ? { kind: 'service-error', retryable: true }
        : { kind: 'access-denied', retryable: false };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      return error instanceof SyntaxError
        ? { kind: 'invalid-response', retryable: false }
        : { kind: 'network-error', retryable: true };
    }
    if (!Array.isArray(payload)) return { kind: 'invalid-response', retryable: false };
    const repositories: Repository[] = [];
    for (const value of payload) {
      const repository = parseRepository(value);
      if (!repository) return { kind: 'invalid-response', retryable: false };
      repositories.push(repository);
    }
    const hasMore = hasNextLink(response.headers.get('Link'));
    return repositories.length === 0
      ? Object.freeze({ kind: 'no-repositories', hasMore })
      : Object.freeze({ kind: 'success', repositories: Object.freeze(repositories), hasMore });
  }

  private async classifyForbidden(response: Response): Promise<RepositoryResult> {
    const primary = response.headers.get('X-RateLimit-Remaining')?.trim() === '0';
    let secondary = response.status === 429 || response.headers.has('Retry-After');
    if (!primary && !secondary) {
      try {
        const payload: unknown = await response.json();
        secondary = isRecord(payload) && typeof payload.message === 'string'
          && /secondary\s+rate\s+limit|abuse(?:\s+detection)?/i.test(payload.message);
      } catch {
        // Without rate-limit evidence a forbidden response remains access-denied.
      }
    }
    if (!primary && !secondary) return { kind: 'access-denied', retryable: false };
    const limit = primary ? 'primary' : 'secondary';
    return Object.freeze({
      kind: 'rate-limited', limit, retryAt: retryAtFrom(response.headers, this.now(), limit), retryable: true,
    });
  }
}
