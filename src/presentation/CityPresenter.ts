import type { CityRenderer } from './ports/CityRenderer';
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

  constructor(
    private readonly switcher: CitySwitcher,
    private readonly renderer: CityRenderer,
    private readonly hud: CityHud,
  ) {
    import.meta.hot?.dispose(() => this.dispose());
  }

  start(): void {
    if (this.running) return;
    this.viewport = this.hud.mount({ onSave: this.savePng, onSubmit: this.onSubmit });
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
    this.renderer.mount(this.viewport, view.city, this.onFailure);
    this.renderer.renderFinal();
    this.username = view.username;
    this.hud.showCity(view.message, view.username, view.city.buildings.length);
  }

  private readonly onSubmit = (value: string): void => {
    if (value === '') {
      this.switcher.cancel();
      this.show(this.switcher.sampleView());
      this.writeAddress(null, 'push');
      return;
    }
    if (!isValidUsername(value)) {
      this.hud.showInvalidUsername(value);
      return;
    }
    void this.lookup(value, 'push');
  };

  private async lookup(username: string, history: 'push' | 'replace'): Promise<void> {
    this.hud.showLoading(username);
    // The address changes immediately so the link is shareable while the city loads;
    // the switcher's generation guard keeps a late answer from contradicting it.
    this.writeAddress(username, history);
    try {
      const view = await this.switcher.resolve(username);
      if (view !== null) this.show(view);
    } catch (error: unknown) {
      console.error('City lookup failed:', error);
    } finally {
      this.hud.showIdle();
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
    const requested = usernameFromSearch(window.location.search);
    if (requested === this.username) return;
    this.switcher.cancel();
    if (requested === null) this.show(this.switcher.sampleView());
    else void this.lookupWithoutHistory(requested);
  };

  private async lookupWithoutHistory(username: string): Promise<void> {
    this.hud.showLoading(username);
    try {
      const view = await this.switcher.resolve(username);
      if (view !== null) this.show(view);
    } catch (error: unknown) {
      console.error('City lookup failed:', error);
    } finally {
      this.hud.showIdle();
    }
  }

  private readonly tick = (timestamp: number): void => {
    if (!this.running) return;
    const elapsed = this.previousTime === null ? 0 : timestamp - this.previousTime;
    this.previousTime = timestamp;
    this.renderer.update(Math.min(elapsed / 1000, 0.1));
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
    this.switcher.cancel();
    this.viewport = null;
    this.renderer.dispose();
    this.hud.dispose();
  }
}
