// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../src/application/fixtures/sampleRepositories';
import { BuildCity } from '../src/application/usecases/BuildCity';
import type { CitySnapshot } from '../src/application/dto/CitySnapshot';
import type { RepositoryGateway, RepositoryResult } from '../src/application/ports/RepositoryGateway';
import { CityPresenter } from '../src/presentation/CityPresenter';
import { CitySwitcher } from '../src/presentation/CitySwitcher';
import { CityHud } from '../src/presentation/hud/CityHud';
import type { CityRenderer } from '../src/presentation/ports/CityRenderer';

const NOW = Date.UTC(2026, 8, 12, 12);

function repositories(names: readonly string[]) {
  return names.map(name => ({
    name, stars: 3, forks: 0, language: 'TypeScript', pushedAt: NOW - 86_400_000,
    isFork: false, sizeKb: 4_096, description: null, htmlUrl: `https://github.com/x/${name}`,
  }));
}

function success(names: readonly string[]): RepositoryResult {
  return { kind: 'success', repositories: repositories(names), hasMore: false };
}

/** Records what was drawn without touching WebGL. */
class StubRenderer implements CityRenderer {
  readonly mounted: CitySnapshot[] = [];
  failOnNextMount = false;

  mount(_container: HTMLElement, city: CitySnapshot): void {
    if (this.failOnNextMount) {
      this.failOnNextMount = false;
      throw new Error('WebGL unavailable');
    }
    this.mounted.push(city);
  }

  update(): void {}
  renderFinal(): void {}
  capturePng(): string { return 'data:image/png;base64,'; }
  dispose(): void {}

  get names(): string[] {
    const last = this.mounted[this.mounted.length - 1];
    return last ? last.buildings.map(building => building.name) : [];
  }
}

function harness() {
  document.body.innerHTML = '<div id="app"></div>';
  const pending = new Map<string, (result: RepositoryResult) => void>();
  const gateway: RepositoryGateway = {
    fetchRepositories: username => new Promise(resolve => pending.set(username, resolve)),
  };
  const renderer = new StubRenderer();
  const presenter = new CityPresenter(
    new CitySwitcher({
      gateway,
      buildCity: new BuildCity(),
      sample: SAMPLE_REPOSITORY_PAGE.repositories,
      sampleReferenceTime: SAMPLE_REFERENCE_TIME,
      now: () => NOW,
    }),
    renderer,
    new CityHud(),
  );
  return {
    presenter,
    renderer,
    settle(username: string, result: RepositoryResult): Promise<void> {
      const resolve = pending.get(username);
      if (!resolve) throw new Error(`No request in flight for ${username}`);
      pending.delete(username);
      resolve(result);
      // Let the awaiting continuation and its finally block run.
      return new Promise(done => { setTimeout(done, 0); });
    },
    submit(username: string): Promise<void> {
      const input = document.querySelector<HTMLInputElement>('[data-testid="username-input"]');
      const form = document.querySelector<HTMLFormElement>('[data-testid="lookup-form"]');
      if (!input || !form) throw new Error('The lookup form is missing.');
      input.value = username;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return new Promise(done => { setTimeout(done, 0); });
    },
    back(): Promise<void> {
      // jsdom dispatches popstate asynchronously, so wait for the event itself rather
      // than guessing a number of ticks.
      const fired = new Promise<void>(done => {
        window.addEventListener('popstate', () => { setTimeout(done, 0); }, { once: true });
      });
      window.history.back();
      return fired;
    },
    state() {
      return {
        search: window.location.search,
        input: document.querySelector<HTMLInputElement>('[data-testid="username-input"]')?.value,
        busy: document.querySelector<HTMLInputElement>('[data-testid="username-input"]')?.disabled,
        status: document.querySelector('[data-testid="scene-status"]')?.textContent ?? '',
      };
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the address bar, the form and the city never disagree', () => {
  it('opens on the sample with an unlocked form', () => {
    const { presenter, renderer } = harness();
    presenter.start();
    expect(renderer.mounted).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('[data-testid="username-input"]')?.disabled).toBe(false);
    presenter.dispose();
  });

  it('drops a lookup abandoned by going Back', async () => {
    // The early return on a matching name used to skip the cancel, so this answer landed
    // afterwards and drew a city the address bar no longer named.
    const { presenter, renderer, settle, submit, back, state } = harness();
    presenter.start();
    const sampleMount = renderer.mounted.length;
    await submit('alpha');
    expect(state().search).toBe('?u=alpha');
    await back();
    await settle('alpha', success(['alpha-one']));
    const after = state();
    expect(after.search).toBe('');
    expect(renderer.names).not.toContain('alpha-one');
    expect(renderer.mounted.length).toBeGreaterThan(sampleMount);
    expect(after.input).toBe('');
    expect(after.busy).toBe(false);
    presenter.dispose();
  });

  it('keeps the form locked while the newest lookup is still running', async () => {
    // An older request completing used to release the lock for a newer one.
    const { presenter, settle, submit, state } = harness();
    presenter.start();
    await submit('alpha');
    await submit('beta');
    expect(state().busy).toBe(true);
    await settle('alpha', success(['alpha-one']));
    expect(state().busy, 'the stale answer released the form').toBe(true);
    await settle('beta', success(['beta-one']));
    expect(state().busy).toBe(false);
    presenter.dispose();
  });

  it('unlocks the form immediately when Back lands on the sample', async () => {
    const { presenter, submit, back, state } = harness();
    presenter.start();
    await submit('alpha');
    await back();
    expect(state().busy, 'a cancelled lookup left the form disabled').toBe(false);
    expect(state().search).toBe('');
    presenter.dispose();
  });

  it('shows only the newest city when answers arrive out of order', async () => {
    const { presenter, renderer, settle, submit } = harness();
    presenter.start();
    await submit('alpha');
    await submit('beta');
    await settle('beta', success(['beta-one']));
    await settle('alpha', success(['alpha-one']));
    expect(renderer.names).toEqual(['beta-one']);
    presenter.dispose();
  });

  it('reports a render failure instead of leaving a dead canvas', async () => {
    // mount() releases the old scene before building the new one, so a failure leaves
    // nothing on screen; the status line used to still claim a city was loading.
    const { presenter, renderer, settle, submit, state } = harness();
    presenter.start();
    renderer.failOnNextMount = true;
    await submit('alpha');
    await settle('alpha', success(['alpha-one']));
    expect(state().status).toContain('WebGL');
    expect(state().status).not.toContain('Looking up');
    presenter.dispose();
  });

  it('rejects an impossible username without calling GitHub', async () => {
    const { presenter, submit, state } = harness();
    presenter.start();
    await submit('not a username');
    expect(state().status).toContain('not a GitHub username');
    expect(state().busy).toBe(false);
    presenter.dispose();
  });
});
