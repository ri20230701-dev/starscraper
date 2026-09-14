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

`npm run typecheck`, `npm test`, and `npm run build` all exit 0. Vite emits its normal
large-chunk warning for the bundled Three.js code (about 585 kB / 146 kB gzip).

The `build` script originally selected a single file, `tests/architecture.test.ts`,
which does not exist until issue #6 — so `npm run build` exited 1, and green tests
could not imply a green build. It now runs `vitest run` over the whole suite, which
both fixes the failure and closes the gap where `build` passed while unit tests were
broken. Issue #6's architecture test will be picked up automatically.

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

## Final lighting, issue #7 — measured 2026-09-12

Measurement conditions: desktop Chrome, viewport 3440×1296, **devicePixelRatio 1**,
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, real data via `?u=sindresorhus`
(100 buildings). Figures come from the production Save PNG path, intercepted before the
download so the measured image is the one a visitor would receive.

### What changed and why

| Parameter | Before | After | Reason |
| --- | --- | --- | --- |
| Roof diffuse | full wall colour | × 0.12 | From above the language colour painted flat olive and navy lids across the skyline |
| Bloom strength | 0.75 | 0.48 | A hundred buildings fused into one bright mass and the streets vanished |
| Bloom radius | 0.6 | 0.42 | Same |
| Bloom threshold | 1.0 | 1.15 | Keeps the walls out of the glow |

### Measured

| Metric | Opening shot |
| --- | --- |
| Mean luminance | 23.7 / 255 |
| Saturated pixels (Y > 250) | 0.00 % |
| Near-black pixels (Y < 10) | 73.5 % |

The near-black share is expected: the city occupies a fraction of the frame against a
night sky. Zero saturated pixels is the meaningful number — the earlier blowout that
issue #4 recorded no longer appears at this framing.

Visually confirmed at this setting: individual towers separate, window grids legible,
warm and cool language colours distinguishable, roads readable as dark gaps, roofs dark.

### Not verified

Recorded plainly rather than implied:

- **Frame rate after the change was not measured.** The automated tab is backgrounded, so
  `requestAnimationFrame` is suspended (the same limitation as issue #1). Weakening bloom
  should reduce cost, but an unmeasured change is not a measured improvement.
- **Pointer lock, and therefore walking, has never run in a browser here.**
  `requestPointerLock()` returns `WrongDocumentError: The root document of this element is
  not valid for pointer lock` under automation. The movement, collision and look logic are
  covered by tests against a real camera; the entry gesture is not.
- **DPR 1.5 and mobile were not exercised**, nor a resize followed by a capture at the
  final settings.
- Close and low camera angles were not re-measured: synthetic pointer events do not drive
  OrbitControls in this harness, so the earlier low-angle blowout is unconfirmed either
  way at the new settings.

These need a person with a browser. They are the first things to check after the first
deployment.

## Issue #14 — street life (2026-09-13)

Implemented shop fronts in the lowest complete window row, deterministic pedestrians
on block perimeter roads, and cool-white street lights with additive ground pools.
The camera fit, fog and far plane include whole pedestrian routes and lamp/pool bounds.

### Automated verification

- `npm run build` passed: TypeScript, 336 tests in 15 files, and the Vite production build.
- `tests/architecture.test.ts` is unchanged; no dependency allowlist was relaxed.
- All brief counterexamples are covered: the isolated `(2,2)` plot, negative blocks,
  two-year-old repositories, 7.2/12-unit buildings, empty cities, fork extremes,
  observable population truncation, deterministic snapshots, and one-building framing.
- The existing 12-repository sample is unchanged and exercises closed/open shops,
  zero/saturated busyness, and pedestrians.
- Mesh tests verify one pedestrian batch plus three lamp batches, single materials,
  no real lights, disabled instance frustum culling, and explicit resource disposal.
  Lifecycle tests verify time advances in Orbit and Walk, resets on mount, and does
  not advance during `capturePng()`.
- Static shader review/tests preserve one fixed window program with uniforms and cache
  key `starscraper-physical-windows-v2`. The lowest row is excluded before both detailed
  and averaged window coverage. Pools retain the basic material's output transforms and
  reuse three's fog distance calculation, fading their additive alpha to zero instead
  of adding fog color. A hook test against `ShaderLib.basic` covers that integration;
  this is not a GPU shader compilation or rendered-image test.

### Draw-call measurement

Both readings come from the `[starscraper scene]` DEV log at
`http://localhost:5199/?u=sindresorhus`, viewport 3440×1352, DPR 1.

| | before | after |
|---|---|---|
| `buildings` | 100 | 100 |
| `calls` | 115 | **119** (+4) |
| `triangles` | 1216 | 43516 |
| `geometries` | 102 | 106 |

The four added calls are the one pedestrian batch and the three lamp batches, which is
the budget the brief set. `pedestrians=240` (city cap), `streetLights=145`.
`omittedPedestrians` drifts between runs because the reference instant is the wall clock:
determinism is promised per `referenceTime`, not across days.

### Measurements still pending

**Composited appearance is only verified in Orbit.** Orbit screenshots at the conditions
above show the additive pools, lamp bloom, lit shop fronts and shutter bands rendering as
intended, and confirm no severed window row above the shop band. Because DPR was 1, no
conclusion is drawn about texture, shading or antialiasing quality.

**Walk-mode appearance is not verified at all.** Pointer lock is not granted to automated
clicks, so eye-height 1.7 was never entered.

**Walk frame times/FPS were not measured.** They remain a human manual acceptance
check at eye height 1.7 after entering pointer lock in a foreground browser tab.
Orbit maximum zoom is not a substitute. Automated background rAF samples and mocked
pointer-lock tests must not be reported as Walk performance measurements.

### Deliberately retained behavior

- Raycasting selects buildings only, even behind a visually overlapping pedestrian or lamp.
- `CityCollision` is unchanged: pedestrians and lamps have no collision and can be walked through.
- PNG capture saves the current displayed state; it does not promise identical pedestrian
  positions at arbitrary capture times from identical repository inputs.
- Summing a block's activity accumulates in input order, so the rounded pedestrian count
  sits on a floating-point knife edge for contrived inputs (`0.008 + 0.071 + 0.046` rounds
  to one pedestrian forwards and none reversed). `layoutCity` always sorts with `byRecency`
  first, which is a total order, so the stated contract — same repositories and same
  `referenceTime` produce the same city — holds. Only a direct `layoutStreetLife` call with
  a different order can observe the difference.
- A pedestrian walking in reverse that lands exactly on a corner faces the segment it is
  leaving for that one frame. Phases come from a hash, so landing exactly on a corner is
  not reachable in practice.

## Issue #16 — bounded ground reflections and night finish (2026-09-14)

This section describes the current implementation. Earlier issue sections above are
historical measurements/settings, not validation of these new effects.

### Implemented scope and numerical bounds

- The existing single ground mesh and its `MeshStandardMaterial` remain:
  `color='#101925'`, roughness **0.86**, metalness **0.55**, standard lighting and fog.
  `GroundReflection` borrows this geometry for an **off-scene** Reflector. Its stock
  material is never drawn onto the ground, and no overlapping surface is added.
- Before the composer, Reflector renders the scene with the ground hidden, then a
  fixed `[0.25, 0.5, 0.25]` filter runs once horizontally and once vertically, with
  offsets of exactly **one texel**. There are no time or normal perturbation inputs.
- The source RT uses **HalfFloatType, 4× MSAA**; both blur RTs also use HalfFloatType.
  Backing dimensions are scaled uniformly to a longest side of at most **1024**,
  with nearest-integer rounding of the other side (minimum one pixel). For example,
  3440×1352 and 5160×2028 both produce **1024×402**; 1352×3440 produces **402×1024**.
- The standard material's `outgoingLight` receives only
  `0.08 * R / (1 + max(R.r, R.g, R.b))`, with `R=max(sample.rgb, 0)`.
  For `M=max(R) >= 0`, each additional component is at most `0.08*M/(1+M) < 0.08`.
  Fog and the standard output chunks remain after this addition.
- Reflection validity resets to zero **before every attempt**, and on resize. The
  guard uses world-space plane/camera positions and the same facing predicate as
  r186 Reflector. A back-facing or hidden ground never samples the previous image.
  Validity becomes one only after reflection generation and both blur draws finish.
  Exceptions restore the original ground visibility, render target, XR and shadow
  state, while leaving validity zero.
- The composer is now **RenderPass → UnrealBloomPass → NightFinishPass → OutputPass**.
  ACES, exposure **1.0**, and Bloom **0.48 / 0.42 / 1.15** are unchanged.
- `NightFinishPass` uses integer framebuffer coordinates and a uint hash. Each pair
  of adjacent horizontal pixels has equal and opposite grain, bounded by **±0.012**;
  an odd-width row's last pixel is zero. Thus the generated additive grain has zero
  spatial sum without relying on a statistical average. It is independent of time
  and source luminance. The pass adds grain after the vignette so vignette weights
  do not unbalance those pairs. No positive-only clamp is applied in this pass.
- With `d=length(2*uv-1)/sqrt(2)`, the vignette multiplier is
  `1 - 0.16*smoothstep(0.55, 1, d)`: **1.0 for d≤0.55**, reaching **0.84 at corners**.
  These are shader-space bounds. The center is unchanged by the vignette; grain
  still applies there. All numerical bounds above are before the fixed OutputPass.
  **±0.012 linear HDR is not a promise of exactly ±3/255 in the final sRGB PNG**:
  ACES, sRGB encoding, clipping and quantization are nonlinear. Likewise zero-mean
  input grain does not guarantee zero change in the encoded image's mean brightness.
  No measured display-space amplitude or visual-quality claim is made here.
- `capturePng()` is unchanged: **resize → renderFinal → toDataURL**, synchronously,
  with no animation/control update. Reflection and finish use this same final path.
- Reflection disposal releases its RT, two blur RTs, both shader materials and the
  fullscreen quad, and restores the ground material hooks. The ground owner alone
  disposes its borrowed geometry/material. The new finish pass is also disposed.
  Existing instance and composer cleanup remains intact.

### Executed verification

`npm run build` exited **0** with this actual output:

```text
Test Files  17 passed (17)
     Tests  352 passed (352)

vite v8.3.0 building client environment for production...
✓ 48 modules transformed.
dist/index.html                   2.45 kB │ gzip:   0.97 kB
dist/assets/index-ckli2u_d.css    4.30 kB │ gzip:   1.58 kB
dist/assets/index-DiNFTrm-.js   640.36 kB │ gzip: 163.45 kB
✓ built in 125ms
```

The unchanged checkout was built before editing: **630.68 kB / 160.79 kB gzip**.
The JS increase is **9.68 kB** (gzip **2.66 kB**). Against the brief's **630.52 kB**
reference, the increase is **9.84 kB**, also below **100 kB**. Vite's existing
>500 kB chunk warning remains; it is not a build failure. The browser test page is
outside the production entry graph and does not enter this bundle.

The tests executed include:

- The unchanged AST architecture gate; no allowlist changes, and no changes to
  `domain`, `application`, or `WindowMaterial.ts`.
- Ground reflection front→back invalidation, transformed planes, hidden ground,
  resize invalidation, and failures in each of the three render stages.
- Actual r186 Reflector CPU callback and RT objects against a stub renderer:
  RT formats/samples/sizes, two blur directions and their input textures, shader
  hook ordering relative to fog, resource ownership/disposal and state restoration.
  **The stub's three `render()` calls are not measured GPU draw calls.**
- Composer ordering, fixed Bloom values, DPR sizing, reflection-before-composer,
  finish pass cleanup, and the existing capture/animation lifecycle checks.

These are CPU/unit tests and source integration checks. They do **not** execute GLSL,
link GPU programs, compare rendered pixels or establish visual acceptance.

### Real WebGL acceptance — NOT EXECUTED

The browser permission review rejected navigation to
`http://127.0.0.1:5198/tests/browser/night-look.html`, reporting that the user had
not permitted that access. No alternate browser/automation route was attempted.
Therefore **draw calls ≤238 are unmeasured**, and **consecutive real-WebGL PNG
identity is unverified**. Both acceptance items remain open. There is no new GPU,
DPR, screenshot, Walk, appearance, FPS or frame-time measurement for issue #16.

Vitest uses jsdom for `threeCityRenderer.test.ts`; that test explicitly substitutes
WebGLRenderer, postprocessing, `getContext()` and `toDataURL()`. Its successful
capture-order assertion is not image equality evidence. jsdom in this project does
not provide a real WebGL graphics context.

A runnable alternative is provided in **`tests/browser/night-look.html`** and
**`tests/browser/night-look.ts`**, not registered as a passing Vitest image test:

1. Run `npm run dev -- --host 127.0.0.1 --port 5198 --strictPort` and open
   `http://127.0.0.1:5198/tests/browser/night-look.html` in permitted desktop Chrome.
2. The page builds a fixed synthetic **100-repository** city from the existing sample
   fields via the real `BuildCity`, with recent activity and forks=8200 to exercise
   street-life batches/population limits. It mounts the production renderer, with
   **real WebGL and a real PNG encoder**, and advances the scene once by 3.25 seconds.
   It has no RAF loop and fetches no GitHub data.
3. The page records the production **`[starscraper scene]` DEV log** and rejects
   `calls>238`. It checks context availability/loss and preserveDrawingBuffer=false,
   captures console errors (including shader compilation errors), and records GPU
   identity. It tests renderer DPR inputs **1 and 1.5**, explicitly overriding the
   page's DPR property temporarily; it records the native browser DPR separately.
   This exercises backing-store scaling without claiming a native high-DPR display.
4. For CSS sizes **3440×1352, 801×601 and 601×801** at each DPR input, it resizes the
   container and executes the actual `adapter.capturePng()` **twice as adjacent
   synchronous statements in the same JS execution**, with no await/update/events
   between them. It asserts exact data-URL equality, PNG prefix, expected backing
   dimensions and a minimum payload size. It disposes each mount and restores DPR.
5. Read and retain the displayed JSON. **Only `status: "PASS"` with six
   `identical: true` results, both scene logs within budget, and no errors is a
   completed run.** `RUNNING`, typechecking the page, or adding the file is not a
   pass. Record browser/GPU/native DPR, scene logs and results here after execution.
   This is an opening-camera test on synthetic data, not Walk or visual approval.

### Rejected measures and reasons

| Measure | Reason it was not adopted |
| --- | --- |
| B: Window glass texture/roughness changes | Would disturb the distant window-area averaging and alter how lit ratio communicates repository activity. `WindowMaterial.ts` is untouched. |
| Chromatic aberration / RGBShiftShader | The proposed 0.005 offset moves each side by 17.2 pixels at width 3440, harming window edges and language-color readability. No channel shift is added. |
| Stock FilmPass / FilmShader | Its positive, luminance-dependent noise does not satisfy zero-mean, uniform additive grain. The one custom pass uses deterministic signed pairs instead. |
| D: Exposure / tone mapping retuning | Would invalidate the established lighting baseline and change how existing emission reads. ACES, exposure 1.0 and existing Bloom constants stay fixed. |
| E: Depth of field | Blurring buildings would hide height, language color and lit-ratio information, and would require camera-distance-dependent visual validation unavailable here. |
| F: Additional Bloom stages | UnrealBloomPass already uses five mip levels; adding more stages is unnecessary for this bounded change and adds rendering cost. |
| Stock Reflector ground replacement | Its overlay blend does not preserve the ground's standard lighting, roughness or fog. Only its reflected-image generation is used. |
| Animated ripples / stretched wet streaks | Outside the specified static, softly blurred reflection; a planar Reflector does not itself produce elongated wet streaks. |

Before committing these changes, `npm run build` was run again on 2026-09-14:
typechecking, all **352 tests across 17 files**, and the production build passed.
The JS bundle remained **640.36 kB / 163.45 kB gzip**, with the existing chunk-size
warning. Real WebGL acceptance remains unexecuted as described above.
