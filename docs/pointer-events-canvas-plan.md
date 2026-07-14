# cvat-canvas: Mouse → Pointer Events Upgrade Plan

**Status:** Proposal (implementation-ready)
**Scope:** the `cvat-canvas` package (2D annotation canvas). Companion to
[`pointer-events-migration-plan.md`](./pointer-events-migration-plan.md) (Track B), now grounded in the
actual sources checked into this repo.
**Baseline:** `cvat-canvas@2.20.10`, which currently type-checks clean under its own tsconfig
(`tsc --noEmit -p cvat-canvas/tsconfig.json` → 0 errors). That is the regression gate for every step below.

---

## 1. How input flows through cvat-canvas today

There are four distinct input layers, and each needs a different treatment:

1. **Native listeners on DOM nodes** — `canvasView.ts` constructor (canvas `mousedown`/`dblclick`/`wheel`/`mousemove`, document `mouseup`), `regionSelector.ts`, `objectSelector.ts`, `zoomHandler.ts`, `splitHandler.ts`, `autoborderHandler.ts`, `masksHandler.ts` (document `mouseup`, parent `contextmenu`).
2. **SVG.js namespaced bindings** — `this.canvas.on('mousedown.draw', …)` style, in `drawHandler.ts`,
   `editHandler.ts`, `interactionHandler.ts`, `sliceHandler.ts`, and per-shape/per-circle bindings in
   `canvasView.ts` and `svg.patch.ts`. SVG.js `.on()` is a thin wrapper over `addEventListener` with
   namespace bookkeeping, so `'pointerdown.draw'` works identically.
3. **Third-party npm plugins** — `svg.draggable.js@2.2.2`, `svg.resize.js@1.4.3`, `svg.select.js@3.0.1`,
   `svg.draw.js@2.0.4`. These bind their own `mousedown.drag` / `touchstart.drag` / document
   `mousemove`/`mouseup` listeners **inside node_modules**; `svg.patch.ts` monkey-patches their prototypes
   but not their event wiring. They power the two most-used gestures: dragging and resizing shapes.
4. **fabric.js (masks)** — `masksHandler.ts` consumes fabric's abstracted `mouse:down` / `mouse:move`
   events. fabric 5.2.1 binds both mouse and touch natively, so it is *mostly* insulated already.

Cross-layer couplings that constrain the migration (must be changed in lock-step):

- `canvasView.ts:1257` and `:1447` dispatch a **synthetic `window` `mouseup`** to force
  svg.draggable/svg.resize to end an in-flight drag/resize when the canvas mode changes. Once the plugins
  listen for `pointerup`, these dispatches must become synthetic `pointerup` (same commit as the plugin
  change, or drags become unstoppable).
- `editHandler.ts:65` builds a **dummy `MouseEvent('mousedown')`** and fires it at svg.draw.js to start
  point insertion at exact coordinates. Must become `PointerEvent('pointerdown')` in the same commit that
  migrates svg.draw.js.
- `canvasView.ts:3586-3588` re-fires `new MouseEvent('click', event)` to proxy clicks from an expanded
  hit-area polyline to the real one. `click` fires for taps and pen alike — leave as-is.

**Bug found during this audit (fix in Step 1 regardless):** `zoomHandler.ts:126` calls
`removeEventListener('mouseup ', …)` — note the trailing space — so the zoom rubber-band's `mouseup`
listener is never removed after cancel.

## 2. Target interaction model

| Input | Behavior on canvas |
|---|---|
| Mouse | Exactly as today (left = interact, middle = pan-drag, wheel = zoom, right = context menu) |
| Pen (`pointerType === 'pen'`) | Behaves like the left mouse button: draw, edit, drag, resize. Barrel-button (`button === 5`/`buttons & 2`) maps to right-click/context menu where supported |
| 1 finger (`touch`) | Pan the frame in IDLE/DRAG_CANVAS; taps activate/select shapes (compat `click` still fires) |
| 2 fingers | Pinch-zoom (centered between fingers) + two-finger pan |
| Palm while pen active | Ignored: while any `pen` pointer is down, all `touch` pointers on the canvas are discarded |

Implemented once, in a new **`PointerGestureRouter`** (new file `pointerRouter.ts`, owned by
`canvasView.ts`): tracks active pointers in a `Map<pointerId, {type, x, y}>`, decides
pan/pinch/interact per the table, and forwards "interact-intent" pointer events to the existing
mode machinery unchanged. Handlers below stay single-pointer and only ever see events the router
lets through — they additionally gain a shared `isInteractionPointer(e)` guard
(`e.pointerType !== 'touch' || router.touchInteractionAllowed(e)`) exported from `shared.ts`.

## 3. File-by-file migration table

Every rename below is `mousedown→pointerdown`, `mousemove→pointermove`, `mouseup→pointerup` (+ a
`pointercancel` twin wherever `pointerup` finalizes state), `mouseenter/leave→pointerenter/leave`,
`mouseover/out→pointerover/out`, unless noted. `PointerEvent` subclasses `MouseEvent`, so existing
`(e: MouseEvent)` signatures keep compiling; tighten to `PointerEvent` while touching each file.

| File | What it does | Specific work beyond renames |
|---|---|---|
| `canvasView.ts` (constructor wiring ~1700-1783) | canvas `mousedown` (pan start, incl. middle button), document `mouseup` (pan end), `mousemove` (drag + `canvas.moved` event), `wheel` (zoom), `dblclick` (fit/focus), `contextmenu` suppression | Route through `PointerGestureRouter`; add pinch-zoom producing the same `controller.zoom()` calls as `wheel`; `dblclick` still fires for pen/touch double-taps in Safari/Chrome — keep, but drive fit/focus from the router's own double-tap detector for reliability; `pointercancel` ends pan like `pointerup` |
| `canvasView.ts` per-point circles (~1063-1094, ~3446-3504) | vertex hover highlight, `mousedown` (drag point), `dblclick` (delete point), `contextmenu` (point menu) | Renames; point context menu additionally reachable via router long-press (fires the same `canvas.contextmenu` CustomEvent with `pointType` detail) |
| `canvasView.ts:1516 onMouseUp` | ends canvas pan on button 0/1 | `pointerup` + `pointercancel`; pen reports button 0 — no logic change |
| `canvasView.ts:1257,1447` synthetic `mouseup` | force-stop plugin drag/resize | switch to `new PointerEvent('pointerup')` **in the same commit as Step 3 (plugins)** |
| `drawHandler.ts` (`mousedown.draw` ×4, `mousemove.draw` ×6, `mousemove.crosshair`) | click-place points for polygon/polyline/points/cuboid/rect-by-4-points; crosshair tracking | Renames via SVG.js namespaces; guard with `isInteractionPointer`; drawing relies on svg.draw.js `'click'` internally for point placement — verify tap-to-place after Step 3; polygon finish gains router double-tap in addition to `dblclick` |
| `editHandler.ts` | vertex insertion/removal, edge editing | Renames (`mousedown.edit`, `mousemove.edit`, per-circle enter/leave/down); dummy event at `:65` → `PointerEvent('pointerdown')` (with Step 3) |
| `interactionHandler.ts` | AI interactor clicks (pos/neg points), crosshair, drag-to-box | Renames (`mousedown.interaction`, `mousemove.interaction`, shape enter/leave/down). Negative points use right-click (`button === 2`): keep for mouse, add pen barrel-button, and expose long-press → negative-point via router for touch/pen without barrel |
| `zoomHandler.ts` | rubber-band zoom-select | Renames; **fix the `'mouseup '` typo**; use `setPointerCapture` on the canvas node so the rubber band survives leaving the element; `pointercancel` = cancel selection |
| `regionSelector.ts` | drag-select a region (issues) | Renames + capture + cancel; same shape as zoomHandler |
| `objectSelector.ts` | drag-select multiple objects | Renames (canvas `pointerdown/move`, document `pointerup`) + capture + cancel |
| `splitHandler.ts` | hover-highlight track to split, click to split | `mousemove` → `pointermove`; on touch there is no hover: tap = find + split in one step (already works — `findObject` runs on `click` via `onFindObject`; verify) |
| `mergeHandler.ts` | same hover/click pattern as split | same treatment |
| `sliceHandler.ts` | slice a mask/polygon: `mousedown.slice`, `mousemove.slice`, shape `mousedown` | Renames; slicing is a precision gesture — pen/mouse only (guard with `isInteractionPointer`); `pointercancel` = `resetState()` |
| `autoborderHandler.ts` | `mousedown`/`dblclick` on neighbor-shape points while drawing | Renames; these circles are small (consts below) — enlarge hit radius for pen/touch |
| `masksHandler.ts` | fabric brush/eraser/polygon tools; document `mouseup`; parent `contextmenu` | Document `mouseup` → `pointerup`+`pointercancel`. fabric 5.2.1 already binds touch (Pencil arrives as Safari touch events with `touchType: 'stylus'`) — primarily **verify**; if fabric's touch path misbehaves, flip its canvases to pointer events via fabric's `enablePointerEvents`. Follow-up (non-blocking): map `e.pressure` to brush size for pen |
| `svg.patch.ts` (`ondblclick` ×2, `mouseover/out` ~925-932) | cuboid edge/point interactions, resize-handle hover | Renames only |
| `crosshair.ts`, `canvasModel/Controller` | no direct listeners (consume coordinates) | no changes |
| `canvas.scss` | styling for `#cvat_canvas_wrapper` etc. | add `touch-action: none;` and `-webkit-user-select: none;` on the canvas wrapper/content; without this every drag is hijacked by scroll and killed via `pointercancel`. Also `overscroll-behavior: none` |

## 4. The npm SVG.js plugins (the one structural decision)

`svg.draggable.js`, `svg.resize.js`, `svg.select.js`, `svg.draw.js` bind `mousedown`/`touchstart` (+
document `mousemove`/`mouseup`/`touchmove`/`touchend`) inside `node_modules`. Their touch branches
technically fire on iPad, but they fight the browser (no capture, no `pointercancel` handling, no palm
rejection, and `touchmove`-based drags die once the page scrolls). Options:

- **(a) Vendor the four plugins into `cvat-canvas/src/js/`** and convert them to pointer events
  (drop the touch branches, add capture + `pointercancel`). ~1,200 lines total, all simple. They are
  abandoned upstream (last releases 2017-2019), so vendoring loses nothing. **Recommended.**
- (b) Yarn 4 `patch:` protocol on the installed packages. Less repo noise, but patches on minified-ish
  dist files are brittle to review and we already monkey-patch their prototypes heavily in `svg.patch.ts`.

With (a), `svg.patch.ts` keeps working unchanged (it patches prototypes, not events), imports at
`svg.patch.ts:7-8` just point at the vendored copies, and the plugin's unified `start/drag/end` handlers
become: `pointerdown` → `setPointerCapture` → `pointermove` → `pointerup|pointercancel`, filtering
`isPrimary === false`.

`svg.select.js` also draws the selection handles; while in there, scale handle/point hit-areas by input
type: bump `consts.BASE_POINT_SIZE`-derived radii ~1.75× when the activating pointer is pen/touch
(fat-finger tolerance; pen is precise but hands shake more than a mouse on a desk).

## 5. Sequencing (each step lands green on desktop before the next)

| Step | Contents | Depends on | Est. |
|---|---|---|---|
| 1 | `canvas.scss` touch-action; `pointerRouter.ts` (pan/pinch/palm policy) wired into `canvasView.ts` constructor listeners; fix zoomHandler typo; document-level `pointerup`+`pointercancel` | — | 2-3 days |
| 2 | Simple drag handlers: `zoomHandler`, `regionSelector`, `objectSelector`, `splitHandler`, `mergeHandler` | 1 | 1 day |
| 3 | Vendor + convert the four SVG.js plugins; flip synthetic `mouseup` dispatches (`canvasView.ts:1257,1447`) and `editHandler.ts:65` dummy event; hit-area scaling | 1 | 2-3 days |
| 4 | `drawHandler`, `editHandler`, `interactionHandler`, `sliceHandler`, `autoborderHandler`, `svg.patch.ts` renames + double-tap/long-press affordances | 3 | 2-3 days |
| 5 | `masksHandler` verification (fabric touch path with Pencil), fixes if needed | 1 | 1-2 days |
| 6 | End-to-end: Playwright pointer/touch suite at the cvat-ui level (draw rect/polygon with pen events, drag/resize, pinch, mid-gesture `pointercancel`); manual iPad+Pencil pass | 2-5 | 2-3 days |

Total: **~2-3 weeks**. After Step 3 the two most-used gestures (drag/resize shapes) work with Pencil;
after Step 4 all drawing modes do.

## 6. Verification per step

- `tsc --noEmit -p cvat-canvas/tsconfig.json` stays at 0 errors (current baseline).
- `yarn build:cvat-canvas` (webpack) succeeds.
- Desktop regression: every gesture in the step's files exercised with a mouse in a dev build —
  behavior must be unchanged (pointer events fire for mice too, so this catches routing mistakes).
- Grep gate: no `mouse*`/`touch*` listener registrations remain in migrated files except the
  documented synthetic dispatches until their step lands.
- Emulated pen/touch: Chromium DevTools + Playwright `pointerType: 'pen'` injection per gesture.

## 7. Risks specific to cvat-canvas

| Risk | Mitigation |
|---|---|
| A missed synthetic-event coupling (§1) strands an in-flight drag | The three known sites are pinned to specific steps above; grep for `new MouseEvent(` in cvat-canvas is part of each step's review |
| svg.draw.js uses `click` internally for point placement — double-fire with new `pointerdown` paths | Step 4 verifies each drawing mode; where both fire, the pointer path wins and the click path is removed in the vendored plugin |
| fabric touch path subtly differs from pointer path (coordinates under zoom) | Step 5 is verification-first; `enablePointerEvents` is the fallback, changed only if a defect is demonstrated |
| Pinch-zoom fights Safari's page zoom | `touch-action: none` + `gesturestart` preventDefault on the wrapper (Step 1) |
| `dblclick` reliability for pen double-taps varies by browser | Router-level double-tap detection is the primary path; native `dblclick` kept as harmless duplicate-guarded fallback |
