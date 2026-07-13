// Copyright (C) 2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useRef } from 'react';

export default function useDraggable(
    getPosition: () => number[],
    onDrag: (diffX: number, diffY: number) => void,
    component: JSX.Element,
): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!ref.current) return () => {};
        const element = ref.current;
        const click = [0, 0];
        const position = getPosition();
        let activePointerID: number | null = null;

        const pointerMoveListener = (event: PointerEvent): void => {
            if (activePointerID === null || event.pointerId !== activePointerID) return;
            const dy = event.clientY - click[0];
            const dx = event.clientX - click[1];
            onDrag(position[0] + dy, position[1] + dx);
            event.stopPropagation();
            event.preventDefault();
        };

        const pointerUpListener = (event: PointerEvent): void => {
            if (event.pointerId !== activePointerID) return;
            activePointerID = null;
            if (element.hasPointerCapture(event.pointerId)) {
                element.releasePointerCapture(event.pointerId);
            }
        };

        const pointerDownListener = (event: PointerEvent): void => {
            if (activePointerID !== null || !event.isPrimary) return;
            const [initialTop, initialLeft] = getPosition();
            position[0] = initialTop;
            position[1] = initialLeft;
            click[0] = event.clientY;
            click[1] = event.clientX;
            activePointerID = event.pointerId;
            // capture keeps receiving pointermove/up even when the pointer
            // leaves the element or the window
            element.setPointerCapture(event.pointerId);
            event.stopPropagation();
            event.preventDefault();
        };

        element.addEventListener('pointerdown', pointerDownListener);
        element.addEventListener('pointermove', pointerMoveListener);
        element.addEventListener('pointerup', pointerUpListener);
        element.addEventListener('pointercancel', pointerUpListener);

        return () => {
            element.removeEventListener('pointerdown', pointerDownListener);
            element.removeEventListener('pointermove', pointerMoveListener);
            element.removeEventListener('pointerup', pointerUpListener);
            element.removeEventListener('pointercancel', pointerUpListener);
        };
    }, [ref.current]);

    return (
        <div ref={ref} style={{ touchAction: 'none' }}>
            {component}
        </div>
    );
}
