// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Several antd popovers/dropdowns in the app are force-closed by emulating a
// click outside of them. antd v5 internals listen for a real 'mousedown', our
// own outside-click listeners use 'pointerdown' (so that they also work for
// pen/touch input without waiting for compatibility mouse events). Dispatch
// both so every listener is notified.
export function dispatchDismissEvents(target: EventTarget = window.document.body): void {
    if (window.PointerEvent) {
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

const TAP_SLOP_PX = 10;

// Outside-"click" dismissal that treats input types correctly: mouse (and
// synthetic events from dispatchDismissEvents) dismiss on pointerdown as
// before, but touch/pen dismiss only on a completed tap - a pointerdown that
// begins a scroll/pan gesture must not dismiss anything.
// Returns a cleanup function removing the listeners.
export function addDismissListener(
    onDismiss: (event: Event) => void,
    target: EventTarget = window.document,
): () => void {
    let tapCandidate: { x: number; y: number; id: number } | null = null;

    const onPointerDown = (event: Event): void => {
        const pointerEvent = event as PointerEvent;
        if (!event.isTrusted || pointerEvent.pointerType === 'mouse' || pointerEvent.pointerType === undefined) {
            onDismiss(event);
            return;
        }

        tapCandidate = {
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
            id: pointerEvent.pointerId,
        };
    };

    const onPointerUp = (event: Event): void => {
        const pointerEvent = event as PointerEvent;
        if (tapCandidate && pointerEvent.pointerId === tapCandidate.id &&
            Math.hypot(
                pointerEvent.clientX - tapCandidate.x,
                pointerEvent.clientY - tapCandidate.y,
            ) < TAP_SLOP_PX
        ) {
            onDismiss(event);
        }
        tapCandidate = null;
    };

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointerup', onPointerUp);
    return () => {
        target.removeEventListener('pointerdown', onPointerDown);
        target.removeEventListener('pointerup', onPointerUp);
    };
}
