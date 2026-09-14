import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from '../../src/application/fixtures/sampleRepositories';
import { BuildCity } from '../../src/application/usecases/BuildCity';
import { ThreeCityRenderer } from '../../src/presentation/three/ThreeCityRenderer';

// Open /tests/browser/night-look.html with the Vite dev server. This is deliberately
// outside Vitest/jsdom: both WebGLRenderer and HTMLCanvasElement.toDataURL are real.
const output = document.querySelector<HTMLPreElement>('#result')!;
const container = document.querySelector<HTMLDivElement>('#city')!;
const adapter = new ThreeCityRenderer();
const originalInfo = console.info;
const originalError = console.error;
const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
const nativeDpr = window.devicePixelRatio;
const errors: string[] = [];
const sceneLogs: Record<string, unknown>[] = [];
const captures: Record<string, unknown>[] = [];
console.info = (...args: unknown[]) => {
  originalInfo(...args);
  if (args[0] === '[starscraper scene]' && typeof args[1] === 'string') {
    sceneLogs.push(JSON.parse(args[1]) as Record<string, unknown>);
  }
};
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); originalError(...args); };

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

try {
  const repositories = Array.from({ length: 100 }, (_, i) => ({
    ...SAMPLE_REPOSITORY_PAGE.repositories[i % SAMPLE_REPOSITORY_PAGE.repositories.length]!,
    name: `validation-${i}`, htmlUrl: `https://github.com/starscraper-sample/validation-${i}`,
    // Recent active shops exercise the population cap and all street-life batches.
    pushedAt: SAMPLE_REFERENCE_TIME, forks: 8200,
  }));
  const city = new BuildCity().execute(repositories, SAMPLE_REFERENCE_TIME);
  let gpu = '';
  for (const dpr of [1, 1.5]) {
    // Exercise the production resize input at both supported DPRs without claiming
    // the physical display or browser's native device scale has changed.
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
    container.style.width = '3440px';
    container.style.height = '1352px';
    adapter.mount(container, city, () => { errors.push('WebGL context lost'); });
    adapter.update(3.25);
    const canvas = container.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    check(!gl.isContextLost(), 'Context is lost');
    check(gl.getContextAttributes()?.preserveDrawingBuffer === false, 'Unexpected preserved buffer');
    check(Number(sceneLogs.at(-1)?.calls) <= 238, 'Draw call budget exceeded');
    for (const [width, height] of [[3440, 1352], [801, 601], [601, 801]]) {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      // These MUST be synchronous neighbours, in the same JS execution. No await,
      // update, events, RAF, or pixel mock may intervene between the two captures.
      const first = adapter.capturePng();
      const second = adapter.capturePng();
      check(first.startsWith('data:image/png;base64,'), 'PNG prefix missing');
      check(first === second, `PNG differs at ${width}x${height}, DPR input ${dpr}`);
      check(canvas.width === Math.floor(width! * dpr) && canvas.height === Math.floor(height! * dpr), 'Wrong backing size');
      check(first.length > 10000, 'Suspiciously small PNG');
      captures.push({ css: [width, height], dprInput: dpr, backing: [canvas.width, canvas.height], identical: first === second, dataUrlLength: first.length });
    }
    adapter.dispose();
  }
  check(errors.length === 0, 'Browser/GLSL errors occurred');
  output.textContent = JSON.stringify({ status: 'PASS', nativeDpr, gpu, sceneLogs, captures, errors }, null, 2);
} catch (error: unknown) {
  output.textContent = JSON.stringify({ status: 'FAIL', message: String(error), nativeDpr, sceneLogs, captures, errors }, null, 2);
  originalError(error);
} finally {
  adapter.dispose();
  console.info = originalInfo;
  console.error = originalError;
  if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
  else Reflect.deleteProperty(window, 'devicePixelRatio');
}
