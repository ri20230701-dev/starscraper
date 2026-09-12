# Issue #1 — render pipeline validation

Scope: PLAN.md §7, fixed sample data only. GitHub integration, domain mapping/placement,
Walk controls, and the full architecture test suite remain separate issues.

## Window dimensions and stability

`WindowMaterial.ts` extends `MeshStandardMaterial.onBeforeCompile`. Each building owns
one `BoxGeometry(width, height, depth)` and one mesh. Local vertex positions retain
physical dimensions; no box scaling or stretched UV pattern is used.

| Face | Horizontal dimension | Columns | Rows |
| --- | --- | --- | --- |
| ±Z | width | floor(width / 2.4) | floor(height / 3.4) |
| ±X | depth | floor(depth / 2.4) | floor(height / 3.4) |
| ±Y | roof/bottom | no windows | no windows |

For each axis, margin = (dimension − count × pitch) / 2. A window aperture is always
**1.15 × 1.7 world units**, centered in its 2.4 × 3.4 cell. Leftover space becomes
equal margins instead of enlarging windows. Example: width 9, depth 17, height 76
produces 3 × 22 windows on ±Z and 7 × 22 on ±X. Horizontal margins are 0.9 and 0.1;
vertical margin is 0.6. Crossing width 9.59 → 9.60 adds one column without changing
the aperture. Seven layout tests cover these calculations, edge clearance,
noninteger dimensions, and faces too small for a complete cell. Two scene tests
also check all 100 fixed buildings and the one-box-per-building contract.

Lit state uses an integer GLSL hash of building ID, signed face ID, column, and row.
It contains no time input or frame-dependent random calls. Normals with |y| > 0.5
return zero window coverage. `fwidth` smooths aperture edges. As a cell approaches
subpixel size, coverage transitions to aperture area × building lit-ratio, avoiding
undersampled random flicker while preserving average emission. Scene render targets
also use 4× MSAA. Shader compilation and distant motion still need browser validation.

**No texture fallback was used.** The procedural implementation is complete, but
visual acceptance is pending the browser check below.

## HDR, capture, and lifecycle

The only pass chain is **RenderPass → UnrealBloomPass → OutputPass** with half-float
targets. The renderer selects ACESFilmic tone mapping, exposure 1.1, and sRGB output;
OutputPass performs the final transform. Warm/cool window emission is scaled by 5.5.

Bloom uses **strength 0.85, radius 0.45, threshold 1.0**: HDR windows exceed the
threshold while the dark shell/ground do not; moderate strength/radius aim to retain
legible window grids with a soft halo. These are initial settings, not visually
approved values. Parameter semantics follow the [Three.js documentation](https://threejs.org/docs/pages/UnrealBloomPass.html).
The scene uses a dark sky, exponential fog, and a ground material with roughness 0.86
and metalness 0.55, without dynamic reflections.

`CityPresenter` alone owns requestAnimationFrame. Normal frames call
`ThreeCityRenderer.renderFinal()`. Capture calls `resize()` → the same `renderFinal()`
→ immediate `canvas.toDataURL('image/png')`. `renderFinal()` calls the composer;
there is no direct renderer.render call in project code. Capture never updates
OrbitControls or advances simulation state, and preserveDrawingBuffer is false.
Resize synchronizes the camera aspect, canvas, both composer targets, and passes.
Renderer and composer DPR are both capped at 1.5.

The presenter releases its frame/listeners on disposal. The renderer releases
controls, ResizeObserver, listeners, geometry, materials, all passes, both composer
targets, renderer, and WebGL context. The wrapper also disposes the threshold
material omitted by Three r186's UnrealBloomPass.dispose(). HMR and page lifecycle
handlers call the same cleanup. WebGL failure shows a fallback and disables capture.

## Verification completed on 2026-09-11

Actual command output:

```text
> starscraper@0.1.0 typecheck
> tsc --noEmit

Test Files  2 passed (2)
     Tests  9 passed (9)

vite v8.3.0 building client environment for production...
✓ 27 modules transformed.
✓ built
```

`npm run typecheck`, `npm test`, and `npx vite build` exit 0. Vite emits its normal
large-chunk warning for the bundled Three.js code (about 585 kB / 146 kB gzip).
The existing `npm run build` exits 1 because it selects the absent
`tests/architecture.test.ts` (issue #6). Its script and PLAN.md were not changed.

`npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` started successfully:

```text
VITE v8.3.0 ready in 156 ms
Local: http://127.0.0.1:5174/
```

This confirms server startup, not successful WebGL scene initialization.
Port 5174 avoids an unrelated existing app on 5173.

A one-off TypeScript AST/import inspection of all 12 source files (30 imports)
passed: Three imports only in presentation, no direct presentation→domain imports,
no application browser/time globals, no explicit any, one RAF owner
(`CityPresenter.ts`). `main.ts` contains composition only. Domain is not implemented.
Capture order, composer passes, DPR, and preserveDrawingBuffer were separately
checked by source inspection and independent review.

## Browser acceptance — partially completed 2026-09-11

Codex could not reach a browser during implementation (navigation was declined and a
headless Chrome launch exited with SIGABRT/EPERM). The checks below were run
afterwards from the main session against the dev server on port 5178.

Measurement conditions: desktop Chrome, viewport 3440×1352, **devicePixelRatio 1**,
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`.

Confirmed in the browser:

- **The scene renders.** The canvas shows the city; `gl.isContextLost()` is false.
- **The GLSL compiles.** A console read filtered on `starscraper|rror|WebGL|shader|GLSL|THREE`
  returned no messages after a reload. A failed program link would surface a
  `THREE.WebGLProgram` error here.
- **Window geometry is correct.** Under 2.2× zoom the grids are legible and window size
  is visually constant across buildings of differing widths and depths — the central
  acceptance criterion for the shader approach.
- **Per-building lit ratio reads.** Sparse and dense buildings are distinguishable,
  which is the mechanism PLAN.md §4 relies on to express `pushed_at`.

### Exposure correction applied after the first browser look

The first render was badly overexposed: facades blew out to cream and the city read as
a glowing blob rather than a skyline. Source inspection had not caught this — it only
became visible on screen. Values changed:

| Parameter | Before | After |
| --- | --- | --- |
| `DirectionalLight` (moon) | 1.3 | 0.55 |
| `HemisphereLight` | 0.65 | 0.32 |
| Window emission multiplier | 5.5 | 3.2 |
| Facade base color multiplier | 0.36 | 0.55 |
| `toneMappingExposure` | 1.1 | 1.0 |
| Bloom (strength, radius, threshold) | 0.85, 0.45, 1.0 | 0.75, 0.6, 1.0 |

An intermediate pass (moon 0.22 / emission 2.2 / bloom strength 0.55) was too dark —
the buildings lost all mass and became scattered dots. The committed values are the
midpoint. They are a working baseline, not final: issue #7 retunes against real data.

### Frame rate — measured 2026-09-12

Foreground tab (`document.hidden === false`), viewport 3440×1296, DPR 1, Apple M4 Pro.
200 frames sampled, first 60 discarded as warmup:

| Metric | Value |
| --- | --- |
| Mean frame time | 16.67 ms |
| p95 | 17.60 ms |
| Worst | 18.70 ms |
| FPS | **60.0** |

This meets the 60fps target with no frame exceeding 18.7 ms. Measured on the fixed
100-building fixture; the real placement algorithm (issue #2) changes per-building
cost, so this is a baseline to re-measure, not a final number.

An earlier attempt collected 0 of 180 frames because the automated tab was
backgrounded and `requestAnimationFrame` was suspended. Frame pacing itself is sound:
`CityPresenter` clamps delta to 0.1 s and resets `previousTime` on `visibilitychange`,
so a long hidden period cannot produce one oversized step.

### PNG capture — verified 2026-09-12

Verified without triggering a file download, by temporarily replacing
`HTMLAnchorElement.prototype.click` to intercept the object URL, clicking the real
Save PNG button, then decoding the captured data URL. This exercises the production
path (`capturePng()` → composer render → `toDataURL`), not a reimplementation.

| Check | Result |
| --- | --- |
| MIME prefix | `data:image/png;base64,` |
| Dimensions | 3440 × 1296 — matches canvas backing store exactly |
| Mean luminance | 110.86 / 255 |
| Std deviation | 88.95 |
| Non-black pixels (Y > 8) | 85.6 % |
| Bright pixels (Y > 200) | 27.0 % |

The image is not black and not uniform. Rendering the captured PNG back over the page
and comparing it against the live canvas showed the same framing, including bloom
halos — confirming the capture goes through the composer rather than a raw
`renderer.render()`.

### Known visual problem, deferred to issue #7

The exposure above was judged from the **default overhead framing only**. Orbiting down
to a low, close viewpoint still blows out: the warm window emission pools into a large
wash and the facades disappear. The current values are acceptable at the opening
camera angle and wrong at ground level. Issue #7 must tune against several camera
distances, not just the initial one.

### Still not verified

- Resize behavior across aspect ratios and the WebGL-failure UI are unexercised.
- All observations are at **DPR 1**, so no claim is made about fine texture or shading
  quality at higher pixel ratios.

Remaining checks:

1. Open the dev URL in desktop Chrome and inspect errors and `[starscraper scene]`
   logs (100 buildings, draw calls, triangle/geometry count, preserveDrawingBuffer).
2. Check differing-width/depth walls, roof faces, bloom halos, and slow zoom/orbit
   toward distant buildings for flicker. Check WebGL failure UI if feasible.
3. Save PNG, decode it, record dimensions/byte count and RGB range/variance to verify
   nontrivial pixels, then compare the bloom appearance with the displayed canvas.
4. Resize to a different aspect ratio, repeat capture, verify PNG dimensions match
   canvas CSS size × min(devicePixelRatio, 1.5), and check the scene stays undistorted.
5. Measure foreground idle and orbit at a recorded viewport/DPR/GPU. Development
   logs report 300 consecutive RAF intervals, mean ms, p95 ms, and 1000/mean FPS.
   Ignore the first warmup batch; keep capture/resize intervals out of steady-state
   batches. Target 60fps, minimum 30fps. Background visibility resets the sample.

## Commit handling in this environment

The requested checkout's `.git` is read-only. `git add` failed with
`Unable to create .../.git/index.lock: Operation not permitted`.
Separate commits were made in `/private/tmp/starscraper-issue-1-commits`, each with
the requested co-author trailer; nothing was pushed. A format-patch export is at
`/private/tmp/starscraper-issue-1.patch`. The original checkout contains the complete
source changes, but its branch pointer could not be updated. The preexisting
untracked package-lock.json was left untouched and excluded from the commits.
