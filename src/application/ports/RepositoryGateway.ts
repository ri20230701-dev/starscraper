import type { Repository } from '../../domain/model/Repository';

// Presentation consumes this port without reaching into the domain layer.
export type { Repository } from '../../domain/model/Repository';

export type RepositoryPage =
  | { readonly kind: 'success'; readonly repositories: readonly Repository[]; readonly hasMore: boolean }
  | { readonly kind: 'no-repositories'; readonly hasMore: boolean };

export interface RateLimitError {
  readonly kind: 'rate-limited';
  readonly limit: 'primary' | 'secondary';
  /** Earliest retry time in Unix milliseconds, including a conservative fallback when unknown. */
  readonly retryAt: number;
  readonly retryable: true;
}

export type RepositoryResult = RepositoryPage
  | RateLimitError
  | { readonly kind: 'user-not-found' }
  | { readonly kind: 'network-error'; readonly retryable: true }
  | { readonly kind: 'access-denied'; readonly retryable: false }
  | { readonly kind: 'service-error'; readonly retryable: true }
  | { readonly kind: 'invalid-response'; readonly retryable: false };

export interface RepositoryGateway {
  fetchRepositories(username: string): Promise<RepositoryResult>;
}
