import type { RepositoryResult } from '../../application/ports/RepositoryGateway';

export interface CityMessage {
  /** Sentence shown in the status line. */
  readonly text: string;
  /** True when the city on screen is the bundled sample rather than the requested user. */
  readonly usingSample: boolean;
  readonly tone: 'info' | 'warning' | 'error';
}

/** Round up so "wait 1 minute" never means "wait 61 seconds". */
export function describeWait(retryAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  if (seconds <= 1) return 'a moment';
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/**
 * Turn a gateway outcome into something a visitor can act on.
 *
 * The gateway speaks in outcomes rather than status codes precisely so this decision
 * lives here: presentation owns the wording, and no HTTP detail crosses the boundary.
 */
export function messageFor(result: RepositoryResult, username: string, now: number): CityMessage {
  switch (result.kind) {
    case 'success':
      return {
        text: result.hasMore
          ? `${username} · showing the 100 most recently pushed repositories`
          : `${username} · ${result.repositories.length} repositories`,
        usingSample: false,
        tone: 'info',
      };
    case 'no-repositories':
      return { text: `${username} has no public repositories yet.`, usingSample: false, tone: 'info' };
    case 'user-not-found':
      // The sample stays on screen, so say so. Claiming a live account while showing
      // bundled data is worse than the miss itself.
      return {
        text: `No GitHub user called ${username}. Showing the sample city.`,
        usingSample: true,
        tone: 'error',
      };
    case 'rate-limited':
      // Falling back to the sample keeps something on screen: an empty dark canvas
      // reads as a broken page, and the limit is per address, not per visitor.
      return {
        text: `GitHub's rate limit is exhausted. Showing the sample city; try ${username} again in ${describeWait(result.retryAt, now)}.`,
        usingSample: true,
        tone: 'warning',
      };
    case 'network-error':
      return { text: 'Could not reach GitHub. Check your connection and try again.', usingSample: true, tone: 'warning' };
    case 'service-error':
      return { text: 'GitHub is having trouble right now. Try again shortly.', usingSample: true, tone: 'warning' };
    case 'access-denied':
      return { text: `GitHub refused the request for ${username}.`, usingSample: true, tone: 'error' };
    case 'invalid-response':
      return { text: 'GitHub returned something unreadable. Try again shortly.', usingSample: true, tone: 'error' };
  }
}
