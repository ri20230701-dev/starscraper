/** Provider-independent repository data. Timestamps are Unix milliseconds, parsed at the boundary. */
export interface Repository {
  readonly name: string;
  readonly stars: number;
  readonly forks: number;
  readonly language: string | null;
  readonly pushedAt: number | null;
  readonly isFork: boolean;
  readonly sizeKb: number;
  readonly description: string | null;
  readonly htmlUrl: string;
}
