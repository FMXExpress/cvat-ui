# Plan: Migrate CVAT UI from Mouse Events to Pointer Events (iPad + Apple Pencil support)

**Status:** Proposal
**Target:** Make the CVAT annotation experience fully usable on iPad Safari with Apple Pencil (and touch generally), by replacing MouseEvent-based interaction with the Pointer Events API.

---

## 1. Why this is needed

CVAT's interaction layer is written almost entirely against `mousedown` / `mousemove` / `mouseup` / `mouseenter` / `mouseleave`. On iPad Safari:

- **Pencil and finger input arrive as pointer/touch events, not real mouse events.** Safari synthesizes "compatibility" mouse events only for simple tap sequences (`mousedown` → `mouseup` → `click` fired together after the tap ends). It does **not** synthesize continuous `mousemove` during a drag — so dragging a bounding-box corner, drawing a polygon, panning the frame, or using the brush simply does not work.
- **Hover doesn't exist for touch**, and hover-gated UI (tooltips, `mouseenter`-based shape activation) either never triggers or gets "stuck".
- **Scrolling/gestures steal the interaction.** Without `touch-action` CSS, the browser interprets a Pencil/finger drag on the canvas as page scroll or pinch-zoom and fires `pointercancel`, aborting the drag.

The Pointer Events API fixes all of this and is a near-superset of mouse events:

- `PointerEvent` **inherits from `MouseEvent`** — `clientX/Y`, `button`, `buttons`, `target`, etc. all keep working, so most handlers only need the *listener name* changed.
- One code path handles mouse, touch, and pen; `event.pointerType` (`'mouse' | 'touch' | 'pen'`) lets us specialize (e.g., pen draws / finger pans).
- `setPointerCapture()` replaces the "attach `mousemove`/`mouseup` on `window`" drag pattern and is more robust (no lost `mouseup` outside the window).
- Bonus capabilities for Pencil: `pressure`, `tiltX/tiltY`, `pointerenter` hover (Pencil Pro / M2 hover).
- Browser support is universal for our targets (`browserslist` is already Chrome ≥ 99, Firefox ≥ 110; Safari has supported Pointer Events since 13).

## 2. Scope: what lives where

This repository contains **`cvat-ui` only**. But `cvat-ui/package.json` links three sibling packages (`cvat-canvas`, `cvat-canvas3d`, `cvat-core`) that are pulled in from the upstream CVAT monorepo at build time (`Dockerfile.ui` copies `cvat-canvas/`, `cvat-canvas3d/`, etc.). **The 2D annotation canvas — the single most important surface for Pencil support — lives in `cvat-canvas`, outside this repo.**

Consequently the work splits into three tracks:

| Track | Where | Impact on iPad usability | Can be done in this repo? |
|---|---|---|---|
| A. `cvat-ui` React app (pages, sidebars, editors, overlays) | this repo | Medium — makes chrome/controls touch-friendly | ✅ Yes |
| B. `cvat-canvas` (SVG.js-based 2D annotation canvas) | sibling package (upstream) | **Critical** — drawing, editing, dragging, zooming shapes | ❌ Needs the sibling package added to the build (vendored, forked, or patched) |
| C. `cvat-canvas3d` (Three.js point-cloud canvas) | sibling package (upstream) | Low priority for iPad | ❌ Same as B |

> **Decision needed before Track B/C:** either (a) vendor `cvat-canvas`/`cvat-canvas3d` sources into this fork so they can be modified here, (b) maintain patches applied during the Docker build, or (c) contribute the changes upstream. Recommendation: **vendor `cvat-canvas` into this fork** — it is the heart of this migration, iterating via upstream PRs would be too slow, and the Docker build already expects the directory to exist.

## 3. Migration principles (the rules every change follows)

1. **Rename, don't rewrite.** `mousedown → pointerdown`, `mousemove → pointermove`, `mouseup → pointerup`, `mouseenter/leave → pointerenter/leave`, `mouseover/out → pointerover/out`. Since `PointerEvent extends MouseEvent`, handler bodies typed as `(e: MouseEvent) => void` keep compiling; tighten types to `PointerEvent` as files are touched.
2. **Always handle `pointercancel`** wherever `pointerup` ends a gesture. Touch/pen interactions can be cancelled by the OS (palm, gesture, notification); a drag that never cleans up leaves the UI stuck.
3. **Use `setPointerCapture(e.pointerId)` for drags** instead of adding `pointermove`/`pointerup` listeners on `window`. Where the window-listener pattern is kept, filter by `pointerId` so a second finger doesn't hijack the drag, and treat `isPrimary === false` as ignorable for single-pointer gestures.
4. **`touch-action` CSS is half the battle.** Every interactive surface (annotation canvas, skeleton configurator SVG, draggable overlays, sliders) gets `touch-action: none;` so the browser never converts the gesture into scroll/zoom and never fires `pointercancel` mid-drag. Scrollable panels keep `touch-action: pan-y`.
5. **`pointerType` policy on the canvas:** `pen` and `mouse` draw/edit; single `touch` pans the frame; two-finger `touch` pinch = zoom (Procreate/GoodNotes convention). This gives palm rejection for free — while a pen is active, ignore `touch` pointers on the canvas.
6. **Never require hover.** Anything that only appears on `mouseenter` (activation, tooltips, popovers) must have a tap-equivalent path. Keep hover as an enhancement (works for mouse and hover-capable Pencil).
7. **Synthetic-event dispatches targeting antd internals stay as `MouseEvent`.** Several places dispatch `new MouseEvent('mousedown')` to force antd popovers closed (see §4.3). antd v5 listens for real `mousedown`, and a synthetic `PointerEvent('pointerdown')` would *not* trigger those listeners. These sites are intentionally exempt.
8. **Guard against double-firing during the transition.** Browsers fire compatibility mouse events after pointer events for taps. While both handler generations coexist, an element must never listen to both `pointerdown` and `mousedown` for the same action. Migrate per-interaction, atomically.
9. **Lint the floor.** Once a file is migrated, an ESLint `no-restricted-syntax` rule bans `addEventListener('mouse*')` / `onMouse*` JSX props so mouse handlers don't creep back in.

## 4. Track A — `cvat-ui` (this repository)

### Phase A0: Foundations (small, do first)

- **Viewport/gesture hardening:** in `cvat-ui/src/index.html`, ensure `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`, and suppress iOS double-tap-zoom on app chrome via `touch-action: manipulation` on `body`.
- **CSS pass:** add `touch-action: none` + `-webkit-user-select: none` to: the canvas wrapper (`components/annotation-page/canvas/views/canvas2d/styles.scss`), skeleton configurator SVG (`components/labels-editor/styles.scss`), and draggable overlay containers. Today there are **zero `touch-action` declarations in the codebase**.
- **ESLint rule** (added but only enabled per-directory as directories are migrated).
- **`utils/pointer-events.ts` helper module:** small utilities shared by later phases — `isPrimaryButtonLike(e)` (pen tip == left button), long-press-to-contextmenu synthesizer for touch, and a `capturedDrag(element, { onMove, onEnd })` helper wrapping `setPointerCapture` + `pointercancel` cleanup.

### Phase A1: Drag interactions (the things that are hard-broken on iPad)

| File | Today | Change |
|---|---|---|
| `components/annotation-page/canvas/views/canvas2d/draggable-hoc.tsx` | `mousedown` on element, `mousemove` on `window`, `mouseup` on `document` | Rewrite with `pointerdown` + `setPointerCapture` + `pointermove`/`pointerup`/`pointercancel` on the element itself. This HOC drags the "propagate confirm" and similar floating panels. |
| `components/labels-editor/skeleton-configurator.tsx` | `mousedown`/`mousemove` on SVG, `mouseup` on document, plus per-element `mouseenter/leave/over/out/down` and `contextmenu` on circles/edges | Rename all to pointer equivalents; drag of skeleton points uses capture; `contextmenu` (delete/menu on points) gets a long-press fallback; SVG element gets `touch-action: none`. |
| `containers/annotation-page/canvas/canvas-context-menu.tsx` | `mousemove` on window to reposition the point context menu; `mousedown`/`mouseup` on the menu for its own dragging; `contextmenu` on canvas | `pointermove`/`pointerdown`/`pointerup` (+`pointercancel`); dragging the menu uses capture. |

### Phase A2: Outside-click / dismissal listeners

These listen for `mousedown` on `document`/`window` to close popovers. A tap on iPad *does* eventually synthesize `mousedown`, but only after the tap completes and not reliably inside scrollable/gesture regions — switching to `pointerdown` makes dismissal immediate and reliable.

- `components/bulk-wrapper.tsx` (document `mousedown` → `pointerdown`)
- `components/organization-page/top-bar.tsx` (window `mousedown` → `pointerdown`)
- `components/resource-sorting-filtering/sorting.tsx` and `filtering.tsx` (outside-click listeners)
- `components/resource-sorting-filtering/resource-selection-info.tsx` (`onMouseDown` stopPropagation → also `onPointerDown`)

⚠️ Interaction with §3.7: the synthetic `new MouseEvent('mousedown')` dispatches in `components/dropdown-menu.tsx`, `components/annotation-page/annotations-actions/annotations-actions-modal.tsx`, and `components/annotation-page/standard-workspace/controls-side-bar/handle-popover-visibility.tsx` exist to close *antd* popovers **and** our own listeners above. After A2 our listeners hear `pointerdown` instead, so these sites must dispatch **both** a `PointerEvent('pointerdown')` and the existing `MouseEvent('mousedown')` (antd still needs the latter). Wrap this in a `dispatchDismissEvents()` helper in `utils/pointer-events.ts` so it's one decision in one place.

### Phase A3: Hover-dependent UI

- `objects-side-bar/object-item.tsx`, `object-item-element.tsx`: `onMouseEnter`/`onMouseLeave` activate/deactivate the annotation — rename to `onPointerEnter`/`onPointerLeave` (tap then fires enter, giving touch users activation-by-tap for free).
- `issues-list.tsx`, `review/conflict-label.tsx`, `review/hidden-issue-label.tsx`, `top-bar/chapter-menu.tsx`, `labels-editor/label-form.tsx`: same rename; audit each for "leave never fires on touch" stuck states (pointerleave *does* fire after tap on another element, unlike mouseleave — this is an improvement).
- Audit antd `Popover`/`Tooltip`/`Dropdown` usages with `trigger="hover"` on functional controls (not informational tooltips) and add `click` to the trigger list.

### Phase A4: Canvas-adjacent handlers in `cvat-ui`

- `components/annotation-page/canvas/views/canvas2d/canvas-wrapper.tsx`: the direct `mousedown` listener on `canvasInstance.html()` (`onCanvasMouseDown`, lines ~607/761/1072) → `pointerdown`. The handler only reads `e.target` and `e.button`; pen taps report `button === 0`, so behavior is preserved.
- `components/annotation-page/canvas/views/canvas3d/canvas-wrapper3D.tsx`: `click`/custom `canvas.contextmenu` usage — `click` works on touch already; verify after Track C.
- `utils/event-recorder.ts` + `components/cvat-app.tsx`: keep recording `click` (clicks still fire on tap), but widen `recordMouseEvent(event: MouseEvent)` typing/semantics to accept `PointerEvent` and record `pointerType` for telemetry — useful to measure iPad adoption.
- `utils/hooks.ts` `useContextMenuClick` + `utils/context-menu-helper.ts`: keep dispatching a synthetic `MouseEvent('contextmenu')` (nothing antd-related needs pointer semantics), but add the long-press synthesizer so touch users can open these context menus at all.

### Phase A5: Lint enforcement + sweep

Enable the ESLint ban repo-wide; grep-verify no runtime `mouse*` listeners remain except the documented antd-synthetic exemptions (`dropdown-menu.tsx`, `annotations-actions-modal.tsx`, `handle-popover-visibility.tsx`, `context-menu-helper.ts`, `label-form.tsx` `mouseout` dispatch).

## 5. Track B — `cvat-canvas` (the critical path for Pencil)

All of drawing, shape editing, dragging, resizing, grouping, splitting, slicing, region selection, and zooming is implemented here against mouse events. This is where "works on iPad + Pencil" is actually won. Once the package is vendored (see §2 decision), the work is:

### B1. Event wiring in `canvasView.ts`

The view attaches `mousedown`/`mousemove`/`mouseup`/`dblclick`/`wheel`/`contextmenu` on the canvas root and per-shape `mouseenter`/`mouseleave`/`mousedown` for activation and cursor logic. Rename to pointer equivalents; route everything through a small gesture layer that:

- tracks active pointers in a `Map<pointerId, …>`;
- implements the §3.5 policy (pen/mouse = interact, one finger = pan, two fingers = pinch-zoom, palm rejection while pen active);
- emits `pointercancel`-safe state resets for every stateful mode (drawing, editing, dragging, merging…).

### B2. Handlers

Each handler owns a gesture built on document/canvas mouse listeners; each gets the same rename + capture + cancel treatment:

- `drawHandler.ts` (all shape drawing incl. polygon point placement — also uses `dblclick`/`shift` to finish: add a "finish" affordance reachable by pen: double-tap detection via pointer timestamps and/or the existing on-screen Done button),
- `editHandler.ts` (vertex editing), `interactionHandler.ts` (AI interactors — the `button` field in `InteractionResult` consumed by `cvat-ui`'s `convertShapesForInteractor` keeps working since pen reports buttons),
- `zoomHandler.ts` (rubber-band zoom) + wheel zoom → add pinch,
- `masksHandler.ts`: built on **fabric.js**, which has native pointer support — enable `enablePointerEvents: true` in the fabric build/config; brush size can optionally map to Pencil `pressure` later,
- `sliceHandler.ts`, `regionSelector.ts`, `groupHandler.ts`, `splitHandler.ts`, `objectSelector.ts`.

### B3. SVG.js plugin forks

`cvat-canvas` ships patched copies of `svg.draggable.js`, `svg.resize.js`, `svg.select.js`, `svg.draw.js`. These register `mousedown.<ns>`/`mousemove.<ns>` (some already add parallel `touchstart` handlers, which iPad Safari + Pencil handles poorly). Since they're already forked, convert them to pointer events directly and delete the touch-event branches — this simultaneously fixes shape dragging and corner-resizing, the two most-used gestures.

### B4. Canvas CSS & iOS quirks

`touch-action: none` on the canvas root; `-webkit-user-select: none`; `preventDefault()` on `gesturestart` (Safari-proprietary) so the OS pinch never fires; ensure Apple Pencil **Scribble** doesn't intercept (touch-action none + no focused text input during canvas gestures).

## 6. Track C — `cvat-canvas3d`

Three.js r150+ already uses pointer events internally for controls. Work is limited to: renaming the package's own `mousemove`/`mousedown` listeners in `canvas3dView.ts`, verifying orbit/perspective camera controls on touch, and `touch-action: none` on the three views. Lower priority — 3D point-cloud annotation on iPad is a niche; ship Tracks A+B first.

## 7. Testing & verification

- **Unit/typecheck:** `yarn type-check` and `yarn lint` in `cvat-ui` per phase.
- **Playwright pointer-emulation suite** (new, runs in CI headless Chromium + WebKit): drag a floating panel (A1), open/dismiss popovers by tap (A2), tap-activate an object in the sidebar (A3); after Track B: draw rect/polygon, drag/resize a shape, two-finger pan/pinch — all driven with `page.touchscreen` and synthetic pen `pointer` events (`pointerType: 'pen'`).
- **Manual device matrix (release gate):** iPad Safari + Pencil (draw, edit, pan/zoom, long-press context menu, palm rejection), iPad finger-only, Android Chrome tablet, desktop mouse regression pass, Windows pen/touch laptop if available.
- **Regression guard:** desktop mouse behavior must be pixel-identical; the compatibility-event double-fire check (§3.8) is part of every phase's review.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `cvat-canvas` not in this repo blocks the critical path | Resolve the §2 vendoring decision first; Track A proceeds regardless |
| antd v5 internals listen to `mousedown`/touch, not pointer | Keep synthetic `MouseEvent` dispatches (§3.7); antd handles its own touch support |
| Double-firing during partial migration | Migrate per-interaction atomically; §3.8 review checklist |
| `pointercancel` paths untested → stuck drag states | Every gesture helper funnels `pointerup` and `pointercancel` into one `end()`; Playwright tests cancel mid-drag |
| Upstream merge conflicts if this fork tracks upstream CVAT | Keep renames mechanical and per-file; the ESLint rule documents intent for future merges |
| Safari-specific quirks (gesturestart, Scribble, hover Pencil) | Dedicated iPad manual pass per release (§7); quirks isolated in `utils/pointer-events.ts` and canvas CSS |

## 9. Suggested sequencing & effort

| Step | Contents | Est. effort |
|---|---|---|
| 1 | A0 foundations + A1 drags | 1–2 days |
| 2 | A2 dismissal + synthetic-dispatch helper | 1 day |
| 3 | A3 hover + A4 canvas-adjacent + A5 lint | 1–2 days |
| 4 | Vendoring decision + import `cvat-canvas` | 0.5–1 day |
| 5 | B1 gesture layer + B3 SVG.js plugins | 3–5 days |
| 6 | B2 handlers (draw/edit/zoom/masks/…) | 4–6 days |
| 7 | B4 iOS quirks + Playwright suite + device QA | 2–3 days |
| 8 | Track C (3D) | 2–3 days (optional, later) |

Total for a Pencil-usable 2D annotation experience (Tracks A+B): **roughly 2.5–4 weeks** of focused work, shippable incrementally after each step (each step is desktop-safe on its own).
