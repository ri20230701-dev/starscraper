import './city.css';
import type { BuildingSnapshot } from '../../application/dto/CitySnapshot';
import type { CityMessage } from './cityMessages';

const DAY_MS = 86_400_000;

/** Rough, human phrasing; the exact date is not what a passer-by wants to read. */
function describeAge(pushedAt: number, now = Date.now()): string {
  const days = Math.max(0, Math.round((now - pushedAt) / DAY_MS));
  if (days <= 1) return 'today';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export interface CityHudHandlers {
  readonly onSave: () => void;
  readonly onSubmit: (username: string) => void;
  readonly onWalk: () => void;
  readonly onOpenSelection: () => void;
}

export class CityHud {
  private root: HTMLElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private form: HTMLFormElement | null = null;
  private input: HTMLInputElement | null = null;
  private walkButton: HTMLButtonElement | null = null;
  private handlers: CityHudHandlers | null = null;

  mount(handlers: CityHudHandlers): HTMLElement {
    const root = document.getElementById('app');
    if (!root) throw new Error('Missing application root.');
    this.root = root;
    this.handlers = handlers;
    root.classList.remove('unavailable');
    root.innerHTML = `
      <div class="city-viewport"></div>
      <div class="crosshair" data-testid="crosshair" hidden aria-hidden="true"></div>
      <aside class="selection" data-testid="selection" hidden></aside>
      <header class="masthead">
        <a class="wordmark" href="./" aria-label="starscraper home"><span class="brand-star">✳</span> starscraper</a>
        <span class="edition">RENDER STUDY / 001</span>
      </header>
      <section class="intro" aria-label="Scene information">
        <p class="eyebrow"><span class="live-dot"></span> A CITY AFTER DARK</p>
        <h1>Every window,<br>a little life.</h1>
        <p class="intro-copy">Every repository becomes a building.<br>Stars raise it, and the last push keeps its windows lit.</p>
        <form class="lookup" data-testid="lookup-form" autocomplete="off">
          <label class="lookup-label" for="username">GitHub username</label>
          <div class="lookup-row">
            <input class="lookup-input" data-testid="username-input" id="username" name="u"
              type="text" inputmode="latin" spellcheck="false" placeholder="torvalds" maxlength="39">
            <button class="lookup-button" data-testid="lookup-submit" type="submit">Build</button>
          </div>
        </form>
      </section>
      <footer class="toolbar">
        <div><p class="scene-status" data-testid="scene-status" role="status">Starting the city…</p>
        <p class="controls-hint">Drag to orbit <span>·</span> Scroll to explore <span>·</span> Right-drag to pan</p></div>
        <div class="save-group"><span class="fixture-label">FIXED SAMPLE CITY</span>
        <button class="walk-button" data-testid="walk-toggle" type="button" disabled>Walk the streets</button>
        <button class="save-button" data-testid="save-png" type="button" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></svg>
          Save PNG
        </button></div>
      </footer>
      <noscript>This city needs JavaScript and WebGL 2.</noscript>`;
    const viewport = root.querySelector<HTMLElement>('.city-viewport');
    if (!viewport) throw new Error('Missing city viewport.');
    this.saveButton = root.querySelector<HTMLButtonElement>('[data-testid="save-png"]');
    this.saveButton?.addEventListener('click', this.save);
    this.form = root.querySelector<HTMLFormElement>('[data-testid="lookup-form"]');
    this.input = root.querySelector<HTMLInputElement>('[data-testid="username-input"]');
    this.form?.addEventListener('submit', this.submit);
    this.walkButton = root.querySelector<HTMLButtonElement>('[data-testid="walk-toggle"]');
    this.walkButton?.addEventListener('click', this.walk);
    return viewport;
  }

  showReady(): void {
    if (this.saveButton) this.saveButton.disabled = false;
    if (this.walkButton) this.walkButton.disabled = false;
  }

  /** Pointer lock hides the cursor, so the crosshair is the only way to aim. */
  showWalking(walking: boolean): void {
    const crosshair = this.root?.querySelector<HTMLElement>('[data-testid="crosshair"]');
    if (crosshair) crosshair.hidden = !walking;
    if (this.walkButton) this.walkButton.textContent = walking ? 'Back to the skyline' : 'Walk the streets';
    // Typing and saving belong to the skyline view; both need the cursor back.
    if (this.input) this.input.disabled = walking;
    if (this.saveButton) this.saveButton.disabled = walking;
    if (!walking) this.showSelection(null);
    this.status(walking
      ? 'WASD to move · Shift to run · Enter opens the repository · Esc to step back out'
      : 'Drag to orbit · Scroll to explore · Right-drag to pan');
  }

  /** Describe whatever the crosshair is resting on, or clear the panel. */
  showSelection(building: BuildingSnapshot | null): void {
    const panel = this.root?.querySelector<HTMLElement>('[data-testid="selection"]');
    if (!panel) return;
    if (!building) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    panel.hidden = false;
    // textContent throughout: repository names and descriptions are other people's input.
    const name = panel.ownerDocument.createElement('h2');
    name.textContent = building.name;
    const facts = panel.ownerDocument.createElement('p');
    facts.className = 'selection-facts';
    facts.textContent = [
      `${building.stars} ★`,
      building.language ?? 'Unknown language',
      building.pushedAt === null ? 'never pushed' : `pushed ${describeAge(building.pushedAt)}`,
      building.isFork ? 'fork' : null,
    ].filter(Boolean).join(' · ');
    const description = panel.ownerDocument.createElement('p');
    description.className = 'selection-description';
    description.textContent = building.description ?? '';
    panel.replaceChildren(name, facts, description);
  }

  /** Reflect the city now on screen: its message, and whose name the field should hold. */
  showCity(message: CityMessage, username: string | null, buildings: number): void {
    this.status(`${message.text} · ${buildings} buildings`);
    this.root?.dataset && (this.root.dataset['tone'] = message.tone);
    this.setFixtureLabel(message.usingSample);
    if (this.input && this.input !== this.root?.ownerDocument.activeElement) {
      this.input.value = username ?? '';
    }
  }

  /** Put a name back in the field without rebuilding the city, as after a history move. */
  showCityName(username: string | null): void {
    if (this.input && this.input !== this.root?.ownerDocument.activeElement) {
      this.input.value = username ?? '';
    }
  }

  showLoading(username: string): void {
    this.status(`Looking up ${username}…`);
    this.setBusy(true);
  }

  showIdle(): void {
    this.setBusy(false);
  }

  showInvalidUsername(value: string): void {
    this.status(`"${value}" is not a GitHub username.`);
  }

  private setBusy(busy: boolean): void {
    if (this.input) this.input.disabled = busy;
    const submit = this.root?.querySelector<HTMLButtonElement>('[data-testid="lookup-submit"]');
    if (submit) submit.disabled = busy;
  }

  private setFixtureLabel(usingSample: boolean): void {
    const label = this.root?.querySelector<HTMLElement>('.fixture-label');
    if (label) label.textContent = usingSample ? 'SAMPLE CITY' : 'LIVE FROM GITHUB';
  }

  showUnavailable(): void {
    this.status('The city needs WebGL 2. Enable hardware acceleration, then reload.');
    this.root?.classList.add('unavailable');
    if (this.saveButton) this.saveButton.disabled = true;
  }

  downloadPng(dataUrl: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'starscraper.png';
    link.hidden = true;
    this.root?.append(link);
    link.click();
    link.remove();
    this.status('PNG saved.');
  }

  showCaptureError(): void {
    this.status('PNG could not be saved. Try again after the city is ready.');
  }

  private readonly save = (): void => { this.handlers?.onSave(); };

  private readonly walk = (): void => { this.handlers?.onWalk(); };

  private readonly submit = (event: Event): void => {
    event.preventDefault();
    this.handlers?.onSubmit(this.input?.value.trim() ?? '');
  };

  private status(message: string): void {
    const status = this.root?.querySelector<HTMLElement>('[data-testid="scene-status"]');
    if (status) status.textContent = message;
  }

  dispose(): void {
    this.saveButton?.removeEventListener('click', this.save);
    this.form?.removeEventListener('submit', this.submit);
    this.walkButton?.removeEventListener('click', this.walk);
    this.saveButton = null;
    this.form = null;
    this.walkButton = null;
    this.input = null;
    this.handlers = null;
    this.root?.replaceChildren();
    this.root = null;
  }
}
