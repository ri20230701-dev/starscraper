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

## Browser acceptance still pending

Browser navigation to `http://127.0.0.1:5174/` was rejected by the automatic browser
approval review with: “The user declined permission for this action.” No alternate
browser access was attempted after that rejection. A preceding headless Chrome
launch also exited with SIGABRT/EPERM before a browser context was available.

Consequently, **visible night scene/bloom, actual GLSL compilation, decoded PNG
pixels, resize behavior, Orbit interaction, and FPS have not been measured or
verified**. Source inspection confirms the required composer capture path, but no
nonblack-image or 30/60fps claim is made. Issue #1 is not acceptance-complete yet.

When browser access is authorized:

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
