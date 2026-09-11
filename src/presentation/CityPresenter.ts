import type { CreateDummyCity } from '../application/usecases/CreateDummyCity';
import type { CityRenderer } from './ports/CityRenderer';
import type { CityHud } from './hud/CityHud';

/** The sole requestAnimationFrame owner, including all development timing. */
export class CityPresenter {
  private frameId: number | null = null;
  private previousTime: number | null = null;
  private running = false;
  private readonly frameTimes: number[] = [];

  constructor(
    private readonly createCity: CreateDummyCity,
    private readonly renderer: CityRenderer,
    private readonly hud: CityHud,
  ) {}

  start(): void {
    if (this.running) return;
    const viewport = this.hud.mount();
    try {
      this.renderer.mount(viewport, this.createCity.execute(), this.onFailure);
      this.renderer.renderFinal();
      this.hud.showReady();
      this.running = true;
      this.frameId = requestAnimationFrame(this.tick);
    } catch (error: unknown) {
      console.error('City initialization failed:', error);
      this.hud.showUnavailable();
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    import.meta.hot?.dispose(() => this.dispose());
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
    console.info('[starscraper performance]', {
      samples: this.frameTimes.length,
      fps: Number((1000 / mean).toFixed(1)),
      meanFrameMs: Number(mean.toFixed(2)),
      p95FrameMs: Number((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0).toFixed(2)),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    });
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
    this.renderer.dispose();
    this.hud.dispose();
  }
}
