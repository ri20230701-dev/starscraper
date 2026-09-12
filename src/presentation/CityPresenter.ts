import type { BuildingSnapshot } from '../application/dto/CitySnapshot';
import type { CityMode, CityRenderer } from './ports/CityRenderer';
import type { CityHud } from './hud/CityHud';
import type { CitySwitcher, CityView } from './CitySwitcher';
import { isValidUsername, searchForUsername, usernameFromSearch } from './cityAddress';

/** The sole requestAnimationFrame owner, including all development timing. */
export class CityPresenter {
  private frameId: number | null = null;
  private previousTime: number | null = null;
  private running = false;
  private readonly frameTimes: number[] = [];

  private viewport: HTMLElement | null = null;
  private username: string | null = null;
  /**
   * Which lookup currently owns the screen. The switcher guards which answer may draw;
   * this guards the busy state, because an older request finishing was re-enabling the
   * form while the newest one was still in flight.
   */
  private request = 0;
  private walking = false;
  private selected: BuildingSnapshot | null = null;

  constructor(
    private readonly switcher: CitySwitcher,
    private readonly renderer: CityRenderer,
    private readonly hud: CityHud,
  ) {
    import.meta.hot?.dispose(() => this.dispose());
  }

  start(): void {
    if (this.running) return;
    this.viewport = this.hud.mount({
      onSave: this.savePng,
      onSubmit: this.onSubmit,
      onWalk: this.onWalk,
      onOpenSelection: this.onOpenSelection,
    });
    try {
      this.show(this.switcher.sampleView());
      this.hud.showReady();
      this.running = true;
      this.frameId = requestAnimationFrame(this.tick);
    } catch (error: unknown) {
      console.error('City initialization failed:', error);
      this.hud.showUnavailable();
      return;
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    window.addEventListener('popstate', this.onPopState);
    document.addEventListener('keydown', this.onKeyDown);
    // A shared link should open that person's city, not the sample.
    const requested = usernameFromSearch(window.location.search);
    if (requested !== null) void this.lookup(requested, 'replace');
  }

  /**
   * Draw a view and align the address bar with it. Mounting disposes the previous scene
   * first, so a visitor comparing several accounts does not accumulate a renderer each time.
   */
  private show(view: CityView): void {
    if (!this.viewport) return;
    // A new city means a new set of streets; any walk through the old one is over.
    if (this.walking) this.renderer.setMode('orbit', this.onLockChange);
    this.walking = false;
    this.selected = null;
    this.hud.showWalking(false);
    try {
      this.renderer.mount(this.viewport, view.city, this.onFailure);
      this.renderer.renderFinal();
    } catch (error: unknown) {
      // mount() releases the previous scene before building the new one, so a failure
      // here leaves nothing on screen. Reporting it beats leaving a dead canvas behind
      // a status line that still claims a city is loading.
      console.error('City render failed:', error);
      this.onFailure();
      return;
    }
    this.username = view.username;
    this.hud.showCity(view.message, view.username, view.city.buildings.length);
  }

  private readonly onSubmit = (value: string): void => {
    if (value === '') {
      this.showSample('push');
      return;
    }
    if (!isValidUsername(value)) {
      this.hud.showInvalidUsername(value);
      return;
    }
    void this.lookup(value, 'push');
  };

  /** Show the bundled city and settle every pending state, with no request outstanding. */
  private showSample(history: 'push' | 'replace' | 'none'): void {
    this.request += 1;
    this.switcher.cancel();
    this.show(this.switcher.sampleView());
    // Nothing is in flight, so the form has to be usable again immediately rather than
    // waiting for a cancelled lookup to run its own cleanup.
    this.hud.showIdle();
    if (history !== 'none') this.writeAddress(null, history);
  }

  private async lookup(username: string, history: 'push' | 'replace' | 'none'): Promise<void> {
    const request = ++this.request;
    this.hud.showLoading(username);
    // The address changes immediately so the link is shareable while the city loads;
    // the switcher's generation guard keeps a late answer from contradicting it.
    if (history !== 'none') this.writeAddress(username, history);
    try {
      const view = await this.switcher.resolve(username);
      if (view !== null) this.show(view);
    } catch (error: unknown) {
      console.error('City lookup failed:', error);
    } finally {
      // Only the newest request may release the form. An older one finishing used to
      // unlock it while the current lookup was still running.
      if (request === this.request) this.hud.showIdle();
    }
  }

  private writeAddress(username: string | null, history: 'push' | 'replace'): void {
    const search = searchForUsername(window.location.search, username);
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    // Push for a deliberate lookup so Back returns to the previous city; replace when
    // merely honouring the address already in the bar, which has no earlier entry.
    if (history === 'push') window.history.pushState({ u: username }, '', url);
    else window.history.replaceState({ u: username }, '', url);
  }

  private readonly onPopState = (): void => {
    // Abandon whatever is in flight before deciding anything else. Returning early on a
    // name match used to skip this, so going Back during a lookup let that lookup land
    // afterwards and draw a city the address bar no longer named.
    this.request += 1;
    this.switcher.cancel();
    const requested = usernameFromSearch(window.location.search);
    if (requested === null) {
      this.showSample('none');
      return;
    }
    if (requested === this.username) {
      // The city is already correct; just settle the form and the status line.
      this.hud.showIdle();
      this.hud.showCityName(requested);
      return;
    }
    void this.lookup(requested, 'none');
  };

  private readonly tick = (timestamp: number): void => {
    if (!this.running) return;
    const elapsed = this.previousTime === null ? 0 : timestamp - this.previousTime;
    this.previousTime = timestamp;
    this.renderer.update(Math.min(elapsed / 1000, 0.1));
    if (this.walking) this.refreshSelection();
    this.renderer.renderFinal();
    if (import.meta.env.DEV && elapsed > 0 && !document.hidden) this.recordFrame(elapsed);
    this.frameId = requestAnimationFrame(this.tick);
  };

  private recordFrame(elapsed: number): void {
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length < 300) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const mean = this.frameTimes.reduce((sum, time) => sum + time, 0) / this.frameTimes.length;
    console.info('[starscraper performance]', JSON.stringify({
      samples: this.frameTimes.length,
      fps: Number((1000 / mean).toFixed(1)),
      meanFrameMs: Number(mean.toFixed(2)),
      p95FrameMs: Number((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0).toFixed(2)),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    }));
    this.frameTimes.length = 0;
  }

  private readonly onVisibilityChange = (): void => {
    this.previousTime = null;
    this.frameTimes.length = 0;
  };

  private readonly onFailure = (): void => {
    this.stop();
    this.hud.showUnavailable();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.walking) return;
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      this.onOpenSelection();
    }
  };

  private readonly onWalk = (): void => {
    this.setMode(this.walking ? 'orbit' : 'walk');
  };

  private setMode(mode: CityMode): void {
    this.renderer.setMode(mode, this.onLockChange);
    if (mode === 'orbit') this.onLockChange(false);
  }

  private readonly onLockChange = (locked: boolean): void => {
    // Losing the lock — Esc, or the browser dropping it — must return the page to the
    // skyline view, or the visitor is left with a crosshair and no way to type.
    if (!locked && this.walking) this.renderer.setMode('orbit', this.onLockChange);
    this.walking = locked;
    this.selected = null;
    this.hud.showWalking(locked);
  };

  private refreshSelection(): void {
    const building = this.renderer.pickAtCentre();
    if (building?.name === this.selected?.name) return;
    this.selected = building;
    this.hud.showSelection(building);
  }

  private readonly onOpenSelection = (): void => {
    const url = this.selected?.htmlUrl;
    if (!url) return;
    // noopener: the repository page must not get a handle on this window.
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  private readonly savePng = (): void => {
    try {
      this.hud.downloadPng(this.renderer.capturePng());
    } catch (error: unknown) {
      console.error('PNG capture failed:', error);
      this.hud.showCaptureError();
    }
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) this.stop();
    else this.dispose();
  };

  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return;
    this.renderer.dispose();
    this.hud.dispose();
    this.start();
  };

  private stop(): void {
    this.running = false;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.onVisibilityChange();
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    window.removeEventListener('popstate', this.onPopState);
    document.removeEventListener('keydown', this.onKeyDown);
    this.switcher.cancel();
    this.viewport = null;
    this.renderer.dispose();
    this.hud.dispose();
  }
}
