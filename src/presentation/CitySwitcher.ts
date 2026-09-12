import type { BuildCity } from '../application/usecases/BuildCity';
import type { CitySnapshot } from '../application/dto/CitySnapshot';
import type { Repository, RepositoryGateway } from '../application/ports/RepositoryGateway';
import { messageFor, type CityMessage } from './hud/cityMessages';

export interface CityView {
  /** The city to draw, and the message describing how it was obtained. */
  readonly city: CitySnapshot;
  readonly message: CityMessage;
  /** null means the bundled sample is on screen. */
  readonly username: string | null;
}

export interface CitySwitcherOptions {
  readonly gateway: RepositoryGateway;
  readonly buildCity: BuildCity;
  readonly sample: readonly Repository[];
  readonly sampleReferenceTime: number;
  /** Wall clock, read here at the composition boundary and passed down as data. */
  readonly now: () => number;
}

/**
 * Resolves which city should be on screen.
 *
 * Every request carries a generation number and only the newest one is allowed to
 * produce a view. Without that, typing A then B and having B answer before A leaves the
 * address bar saying B while A's city is drawn — the two disagree and neither is wrong
 * on its own, which makes the bug hard to see and easy to ship.
 */
export class CitySwitcher {
  private generation = 0;

  constructor(private readonly options: CitySwitcherOptions) {}

  /** The sample city, used on first load and whenever a lookup cannot be honoured. */
  sampleView(): CityView {
    return {
      city: this.options.buildCity.execute(this.options.sample, this.options.sampleReferenceTime),
      message: { text: 'A sample city · enter a GitHub username to build your own', usingSample: true, tone: 'info' },
      username: null,
    };
  }

  /**
   * Look up a user and return the resulting view, or null when a newer request started
   * while this one was in flight. A null result must leave the screen untouched.
   */
  async resolve(username: string): Promise<CityView | null> {
    const generation = ++this.generation;
    const result = await this.options.gateway.fetchRepositories(username);
    if (generation !== this.generation) return null;

    const now = this.options.now();
    const message = messageFor(result, username, now);
    if (result.kind === 'success') {
      return { city: this.options.buildCity.execute(result.repositories, now), message, username };
    }
    if (result.kind === 'no-repositories') {
      return { city: this.options.buildCity.execute([], now), message, username };
    }
    // Everything else has no city of its own. Showing the sample beats a dark canvas,
    // and the message says which one the viewer is looking at.
    return {
      city: this.options.buildCity.execute(this.options.sample, this.options.sampleReferenceTime),
      message,
      username,
    };
  }

  /** Abandon any in-flight lookup, so a later answer cannot repaint the screen. */
  cancel(): void {
    this.generation += 1;
  }
}
