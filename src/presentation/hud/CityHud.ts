import './city.css';

export class CityHud {
  private root: HTMLElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private onSave: (() => void) | null = null;

  mount(onSave: () => void): HTMLElement {
    const root = document.getElementById('app');
    if (!root) throw new Error('Missing application root.');
    this.root = root;
    this.onSave = onSave;
    root.classList.remove('unavailable');
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
        <div class="save-group"><span class="fixture-label">FIXED SAMPLE CITY</span>
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
    return viewport;
  }

  showReady(): void {
    this.status('100 buildings · Orbit');
    if (this.saveButton) this.saveButton.disabled = false;
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
    this.status('PNG saved · 100 buildings · Orbit');
  }

  showCaptureError(): void {
    this.status('PNG could not be saved. Try again after the city is ready.');
  }

  private readonly save = (): void => { this.onSave?.(); };

  private status(message: string): void {
    const status = this.root?.querySelector<HTMLElement>('[data-testid="scene-status"]');
    if (status) status.textContent = message;
  }

  dispose(): void {
    this.saveButton?.removeEventListener('click', this.save);
    this.saveButton = null;
    this.onSave = null;
    this.root?.replaceChildren();
    this.root = null;
  }
}
