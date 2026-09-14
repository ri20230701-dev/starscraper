// @vitest-environment jsdom
import { InstancedMesh } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitySnapshot } from '../src/application/dto/CitySnapshot';
import { PedestrianMeshes } from '../src/presentation/three/PedestrianMeshes';
import { StreetLightMeshes } from '../src/presentation/three/StreetLightMeshes';
import { ThreeCityRenderer } from '../src/presentation/three/ThreeCityRenderer';

const runtime = vi.hoisted(() => ({
  events: [] as string[],
  orbitUpdate: vi.fn(),
  walkUpdate: vi.fn(),
}));

// Keep three's scene, geometry, materials and instance matrices real. Only the browser
// graphics context and postprocessing boundary need substitutes in this lifecycle test.
vi.mock('three', async importOriginal => {
  const original = await importOriginal<typeof import('three')>();
  return {
    ...original,
    WebGLRenderer: class {
      readonly domElement: HTMLCanvasElement;
      readonly info = {
        autoReset: true, reset: vi.fn(),
        render: { calls: 0, triangles: 0 }, memory: { geometries: 0 },
      };
      constructor(options: { canvas: HTMLCanvasElement }) { this.domElement = options.canvas; }
      setPixelRatio(): void { /* The graphics context is not rendered in jsdom. */ }
      setSize(): void { runtime.events.push('renderer.resize'); }
      dispose(): void { /* No graphics context to release. */ }
      forceContextLoss(): void { /* No graphics context to lose. */ }
    },
  };
});

vi.mock('../src/presentation/three/CityPostProcessing', () => ({
  CityPostProcessing: class {
    resize(): void { runtime.events.push('post.resize'); }
    render(): void { runtime.events.push('render'); }
    dispose(): void { /* No graphics targets allocated by this boundary stub. */ }
  },
}));

vi.mock('../src/presentation/input/CityOrbitControls', () => ({
  CityOrbitControls: class {
    update = runtime.orbitUpdate;
    setEnabled(): void { /* Input is tested separately. */ }
    reset(): void { /* Input is tested separately. */ }
    dispose(): void { /* Input is tested separately. */ }
  },
}));

vi.mock('../src/presentation/input/WalkControls', () => ({
  WalkControls: class {
    update = runtime.walkUpdate;
    attach(): void { /* Browser pointer lock is outside this lifecycle test. */ }
    enter(): Promise<boolean> { return Promise.resolve(true); }
    dispose(): void { /* Input is tested separately. */ }
  },
}));

const city: CitySnapshot = {
  buildings: [{
    id: 0, x: 48, z: 48, width: 12, depth: 12, height: 12,
    color: '#3178c6', windowLitRatio: 1, shopOpenRatio: 1, shopBusyness: 0.5,
    name: 'repo', htmlUrl: 'https://github.com/example/repo', description: null,
    language: null, stars: 0, pushedAt: 1, isFork: false,
  }],
  pedestrians: [{ route: { minX: 0, maxX: 96, minZ: 0, maxZ: 96 }, phase: 0.2, speed: 1.2, direction: 1 }],
  streetLights: [{ x: 0, z: 24 }],
  omittedPedestrians: 0,
};

let renderer: ThreeCityRenderer;
let container: HTMLDivElement;

beforeEach(() => {
  runtime.events.length = 0;
  runtime.orbitUpdate.mockClear();
  runtime.walkUpdate.mockClear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getContextAttributes: () => ({ preserveDrawingBuffer: false }),
  } as WebGL2RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
    runtime.events.push('capture');
    return 'data:image/png;base64,current-frame';
  });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void { /* Resize notifications are driven synchronously by mount/capture. */ }
    disconnect(): void { /* No asynchronous observer is allocated. */ }
  });
  renderer = new ThreeCityRenderer();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  renderer.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('street animation follows the renderer lifecycle', () => {
  it('keeps the same animation clock through Orbit, Walk and back to Orbit', async () => {
    const update = vi.spyOn(PedestrianMeshes.prototype, 'update');
    renderer.mount(container, city, vi.fn());
    update.mockClear();

    renderer.update(0.5);
    renderer.setMode('walk', vi.fn());
    await Promise.resolve();
    renderer.update(1);
    renderer.setMode('orbit', vi.fn());
    renderer.update(0.25);

    expect(update.mock.calls).toEqual([[0.5], [1.5], [1.75]]);
    expect(runtime.orbitUpdate.mock.calls).toEqual([[0.5], [0.25]]);
    expect(runtime.walkUpdate.mock.calls).toEqual([[1]]);
  });

  it('starts the new city at elapsed zero after remounting', () => {
    const update = vi.spyOn(PedestrianMeshes.prototype, 'update');
    renderer.mount(container, city, vi.fn());
    renderer.update(10);
    renderer.mount(container, city, vi.fn());
    renderer.update(0.25);

    expect(update.mock.calls).toEqual([[0], [10], [0], [0.25]]);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('captures the displayed pedestrian matrices after resize and render without advancing time', () => {
    const update = vi.spyOn(PedestrianMeshes.prototype, 'update');
    renderer.mount(container, city, vi.fn());
    renderer.update(3);
    const pedestrians = update.mock.contexts[0] as PedestrianMeshes;
    const mesh = pedestrians.group.children[0] as InstancedMesh;
    const currentMatrices = Array.from(mesh.instanceMatrix.array);
    update.mockClear();
    runtime.orbitUpdate.mockClear();
    runtime.events.length = 0;

    expect(renderer.capturePng()).toBe('data:image/png;base64,current-frame');

    expect(runtime.events).toEqual(['renderer.resize', 'post.resize', 'render', 'capture']);
    expect(update).not.toHaveBeenCalled();
    expect(runtime.orbitUpdate).not.toHaveBeenCalled();
    expect(runtime.walkUpdate).not.toHaveBeenCalled();
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(currentMatrices);
    renderer.update(0.5);
    expect(update).toHaveBeenLastCalledWith(3.5);
  });

  it('releases pedestrians and all three street light instance buffers once on disposal', () => {
    const peopleDispose = vi.spyOn(PedestrianMeshes.prototype, 'dispose');
    const lightsDispose = vi.spyOn(StreetLightMeshes.prototype, 'dispose');
    const instanceDispose = vi.spyOn(InstancedMesh.prototype, 'dispose');
    const update = vi.spyOn(PedestrianMeshes.prototype, 'update');
    renderer.mount(container, city, vi.fn());
    update.mockClear();

    renderer.dispose();
    renderer.dispose();
    renderer.update(1);

    expect(peopleDispose).toHaveBeenCalledTimes(1);
    expect(lightsDispose).toHaveBeenCalledTimes(1);
    expect(instanceDispose).toHaveBeenCalledTimes(4);
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector('canvas')).toBeNull();
  });
});
