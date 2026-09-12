# Repository gateway and bundled sample

`RepositoryGateway` in `src/application/ports/RepositoryGateway.ts` is the application boundary.
`GitHubApiClient` in `src/infrastructure/github/GitHubApiClient.ts` implements it. Composition code
can construct the client and supply the port to a future use case; this change does not connect
the gateway or sample to the screen.

```ts
const gateway = new GitHubApiClient();
const result = await gateway.fetchRepositories('octocat');
```

The client requests one unauthenticated page, with `per_page=100&sort=pushed&type=owner`.
`hasMore` comes only from a `next` relation in the response's Link header. It never comes from
the number of returned repositories, and the client never follows the next-page URL.
The parser accepts relative targets and whitespace-separated relations such as `rel="alternate next"`.
It splits delimiters only outside URI references and quoted values, avoiding false matches in titles or URLs.
Provider field names are mapped to the application-facing `Repository` model; timestamps are
Unix milliseconds and missing dates remain `null`.

Consumers narrow `result.kind`. A successful nonempty page has `repositories` and `hasMore`;
`no-repositories` is a dedicated result with `hasMore`. Errors include `user-not-found`,
`network-error`, `access-denied`, `service-error`, `invalid-response`, and `rate-limited`.
Rate limits expose `limit: 'primary' | 'secondary'`, `retryAt` in Unix milliseconds, and
`retryable: true`. Presentation chooses wording from these types without interpreting HTTP
status codes, headers, or provider response bodies.

For a forbidden or too-many-requests response, zero remaining quota identifies a primary limit.
Otherwise, a too-many-requests response, Retry-After header, or secondary/abuse message identifies
a secondary limit; an unrelated forbidden response remains `access-denied`. Retry timing prefers
valid Retry-After seconds or an HTTP date, then the reset timestamp. Missing usable timing uses
a 60-second cooldown, consistent with [GitHub's secondary-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit).
The client does not automatically retry or clear a longer cooldown when an older request completes.

The client accepts optional `fetch`, `now`, and `cacheTtlMs` dependencies for deterministic tests.
Usernames are trimmed and lowercased for both in-flight sharing and the per-client cache.
Concurrent same-user calls share one underlying request. Successful pages, including the
dedicated no-repositories result, are cached for **60 seconds from completion** by default.
This absorbs repeat submissions and quick revisits without keeping rapidly changing repository
activity stale for long. Cache storage is in memory only. A per-client rate-limit cooldown
also suppresses new requests until `retryAt`; still-fresh cached results remain available.

## Fixed sample

Application and presentation consumers can import the fixture through the application layer:

```ts
import {
  SAMPLE_REFERENCE_TIME,
  SAMPLE_REPOSITORY_PAGE,
} from './application/fixtures/sampleRepositories';
```

The sample contains 12 synthetic repositories, spanning zero to many stars, small to large
sizes, original projects and forks, known/unknown/null languages, missing descriptions, and
activity ages from today through multiple years. Its URLs are synthetic display values under
`https://github.com/starscraper-sample/`; they do not assert that these repositories exist.
The page, array, and individual repositories are frozen.

For repeatable visual tuning, use `SAMPLE_REPOSITORY_PAGE.repositories` and pass the fixed
`SAMPLE_REFERENCE_TIME` (2026-01-01T00:00:00Z) as the city generator's reference time when that
generator is implemented. The fixture never reads the current clock.

A future consumer may explicitly select the same sample for a rate-limit fallback display.
The gateway keeps returning its rate-limit result and never silently replaces an error with
sample data, so the UI can label the fallback and retain the retry time. UI controls, real-data
city generation, and fallback presentation are outside this change.
