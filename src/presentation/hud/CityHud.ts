import './city.css';

export class CityHud {
  private root: HTMLElement | null = null;

  mount(): HTMLElement {
    const root = document.getElementById('app');
    if (!root) throw new Error('Missing application root.');
    this.root = root;
    root.innerHTML = `
      <div class="city-viewport"></div>
      <header class="masthead">
        <a class="wordmark" href="./" aria-label="starscraper home"><span class="brand-star">✳</span> starscraper</a>
        <span class="edition">RENDER STUDY / 001</span>
      </header>
      <section class="intro" aria-label="Scene information">
        <p class="eyebrow"><span class="live-dot"></span> A CITY AFTER DARK</p>
        <h1>Every window,<br>a little life.</h1>
        <p class="intro-copy">One hundred buildings. A thousand little lights.<br>A first glimpse of a city made from code.</p>
      </section>
      <footer class="toolbar">
        <div><p class="scene-status" data-testid="scene-status" role="status">Starting the city…</p>
        <p class="controls-hint">Drag to orbit <span>·</span> Scroll to explore <span>·</span> Right-drag to pan</p></div>
        <span class="fixture-label">FIXED SAMPLE CITY</span>
      </footer>
      <noscript>This city needs JavaScript and WebGL 2.</noscript>`;
    const viewport = root.querySelector<HTMLElement>('.city-viewport');
    if (!viewport) throw new Error('Missing city viewport.');
    return viewport;
  }

  showReady(): void {
    this.status('100 buildings · Orbit');
  }

  showUnavailable(): void {
    this.status('The city needs WebGL 2. Enable hardware acceleration, then reload.');
    this.root?.classList.add('unavailable');
  }

  private status(message: string): void {
    const status = this.root?.querySelector<HTMLElement>('[data-testid="scene-status"]');
    if (status) status.textContent = message;
  }

  dispose(): void {
    this.root?.replaceChildren();
    this.root = null;
  }
}
