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
