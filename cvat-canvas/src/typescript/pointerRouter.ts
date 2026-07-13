// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export interface PointerRouterCallbacks {
    // single-finger pan
    onPanStart(clientX: number, clientY: number): void;
    onPanEnd(): void;
    // two-finger pinch; factor > 1 means zoom in, centered at (clientX, clientY)
    onPinch(clientX: number, clientY: number, factor: number): void;
    // double tap with a finger or pen (browsers are inconsistent about
    // synthesizing dblclick for these inputs)
    onDoubleTap(event: PointerEvent): void;
    // gate for long-press -> contextmenu synthesis
    longPressAllowed(): boolean;
}

interface TrackedPointer {
    pointerType: string;
    clientX: number;
    clientY: number;
    target: EventTarget | null;
    isPrimary: boolean;
}

const LONG_PRESS_MS = 650;
const LONG_PRESS_SLOP_PX = 10;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 30;
const PALM_REJECTION_MS = 500;

// Routes raw pointer events into canvas gestures:
//   mouse/pen  -> passed through to the regular interaction code
//   1 finger   -> pans the frame
//   2 fingers  -> pinch zoom
//   touch while a pen is (recently) active -> ignored (palm rejection)
// It also synthesizes contextmenu on long-press and reports double taps
// for touch/pen input.
export class PointerGestureRouter {
    private callbacks: PointerRouterCallbacks;
    private pointers: Map<number, TrackedPointer> = new Map();
    private penDown: boolean = false;
    private lastPenEventTimestamp: number = 0;
    private panPointerID: number | null = null;
    private pinchDistance: number | null = null;
    private longPressTimeout: number | null = null;
    private longPressCandidate: { pointerId: number; clientX: number; clientY: number; target: EventTarget | null } | null = null;
    private lastTap: { timestamp: number; clientX: number; clientY: number } | null = null;

    public constructor(callbacks: PointerRouterCallbacks) {
        this.callbacks = callbacks;
    }

    private get touchPointers(): [number, TrackedPointer][] {
        return [...this.pointers.entries()].filter(([, value]) => value.pointerType === 'touch');
    }

    private cancelLongPress(): void {
        if (this.longPressTimeout !== null) {
            window.clearTimeout(this.longPressTimeout);
            this.longPressTimeout = null;
        }
        this.longPressCandidate = null;
    }

    private scheduleLongPress(event: PointerEvent): void {
        this.cancelLongPress();
        if (!this.callbacks.longPressAllowed()) return;
        this.longPressCandidate = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            target: event.target,
        };
        this.longPressTimeout = window.setTimeout(() => {
            const candidate = this.longPressCandidate;
            this.longPressTimeout = null;
            this.longPressCandidate = null;
            if (candidate && this.pointers.has(candidate.pointerId) &&
                this.pinchDistance === null && this.callbacks.longPressAllowed()
            ) {
                // reuse every existing contextmenu code path (point menus,
                // canvas context menu in cvat-ui, etc.)
                (candidate.target || window.document).dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: candidate.clientX,
                    clientY: candidate.clientY,
                    button: 2,
                    buttons: 2,
                }));
            }
        }, LONG_PRESS_MS);
    }

    private startPinchIfPossible(): void {
        const touches = this.touchPointers;
        if (touches.length === 2) {
            if (this.panPointerID !== null) {
                this.panPointerID = null;
                this.callbacks.onPanEnd();
            }
            const [[, first], [, second]] = touches;
            this.pinchDistance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
            this.cancelLongPress();
        }
    }

    // returns true when the event should be handled by regular
    // (mouse-oriented) interaction code
    public pointerDown(event: PointerEvent): boolean {
        if (event.pointerType === 'pen') {
            this.penDown = true;
            this.lastPenEventTimestamp = performance.now();
        }

        if (event.pointerType === 'touch') {
            if (this.penDown || performance.now() - this.lastPenEventTimestamp < PALM_REJECTION_MS) {
                // palm rejection: a pen is being used right now
                return false;
            }

            this.pointers.set(event.pointerId, {
                pointerType: event.pointerType,
                clientX: event.clientX,
                clientY: event.clientY,
                target: event.target,
                isPrimary: event.isPrimary,
            });

            const touches = this.touchPointers;
            if (touches.length === 1) {
                this.panPointerID = event.pointerId;
                this.callbacks.onPanStart(event.clientX, event.clientY);
                this.scheduleLongPress(event);
                this.checkDoubleTap(event);
            } else {
                this.startPinchIfPossible();
            }

            return false;
        }

        // mouse and pen interact as usual; pen long-press emulates right click
        this.pointers.set(event.pointerId, {
            pointerType: event.pointerType,
            clientX: event.clientX,
            clientY: event.clientY,
            target: event.target,
            isPrimary: event.isPrimary,
        });

        if (event.pointerType === 'pen') {
            this.scheduleLongPress(event);
            this.checkDoubleTap(event);
        }

        return true;
    }

    private checkDoubleTap(event: PointerEvent): void {
        const now = performance.now();
        if (this.lastTap && now - this.lastTap.timestamp < DOUBLE_TAP_MS &&
            Math.hypot(event.clientX - this.lastTap.clientX, event.clientY - this.lastTap.clientY) < DOUBLE_TAP_SLOP_PX
        ) {
            this.lastTap = null;
            this.cancelLongPress();
            this.callbacks.onDoubleTap(event);
        } else {
            this.lastTap = { timestamp: now, clientX: event.clientX, clientY: event.clientY };
        }
    }

    // returns true when the event should be handled by regular
    // (mouse-oriented) interaction code
    public pointerMove(event: PointerEvent): boolean {
        if (event.pointerType === 'pen') {
            this.lastPenEventTimestamp = performance.now();
        }

        if (this.longPressCandidate && this.longPressCandidate.pointerId === event.pointerId) {
            if (Math.hypot(
                event.clientX - this.longPressCandidate.clientX,
                event.clientY - this.longPressCandidate.clientY,
            ) > LONG_PRESS_SLOP_PX) {
                this.cancelLongPress();
            }
        }

        const tracked = this.pointers.get(event.pointerId);
        if (tracked) {
            tracked.clientX = event.clientX;
            tracked.clientY = event.clientY;
        }

        if (event.pointerType !== 'touch') {
            return true;
        }

        if (!tracked) {
            // rejected palm touch
            return false;
        }

        if (this.pinchDistance !== null) {
            const touches = this.touchPointers;
            if (touches.length >= 2) {
                const [[, first], [, second]] = touches;
                const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
                if (distance > 0 && this.pinchDistance > 0) {
                    const centerX = (first.clientX + second.clientX) / 2;
                    const centerY = (first.clientY + second.clientY) / 2;
                    this.callbacks.onPinch(centerX, centerY, distance / this.pinchDistance);
                }
                this.pinchDistance = distance;
            }
            return false;
        }

        // single-finger pan: the caller feeds coordinates to the drag logic
        return this.panPointerID === event.pointerId;
    }

    public pointerUp(event: PointerEvent): void {
        if (event.pointerType === 'pen') {
            this.penDown = false;
            this.lastPenEventTimestamp = performance.now();
        }

        if (this.longPressCandidate && this.longPressCandidate.pointerId === event.pointerId) {
            this.cancelLongPress();
        }

        this.pointers.delete(event.pointerId);

        if (event.pointerType === 'touch') {
            const touches = this.touchPointers;
            if (this.pinchDistance !== null && touches.length < 2) {
                this.pinchDistance = null;
                // a remaining finger continues as pan
                if (touches.length === 1) {
                    const [[pointerId, pointer]] = touches;
                    this.panPointerID = pointerId;
                    this.callbacks.onPanStart(pointer.clientX, pointer.clientY);
                }
            }

            if (this.panPointerID === event.pointerId) {
                this.panPointerID = null;
                this.callbacks.onPanEnd();
            }
        }
    }

    public get penIsActive(): boolean {
        return this.penDown;
    }
}
