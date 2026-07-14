// Copyright (C) 2019-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import * as SVG from 'svg.js';
import consts from './consts';

import { translateToSVG, isInteractionPointer } from './shared';

import { Geometry } from './canvasModel';

export interface ZoomHandler {
    zoom(): void;
    cancel(): void;
    transform(geometry: Geometry): void;
}

export class ZoomHandlerImpl implements ZoomHandler {
    private onZoomRegion: (x: number, y: number, width: number, height: number) => void;
    private bindedOnSelectStart: (event: PointerEvent) => void;
    private bindedOnSelectUpdate: (event: PointerEvent) => void;
    private bindedOnSelectStop: (event: PointerEvent) => void;
    private bindedOnSelectCancel: (event: PointerEvent) => void;
    private geometry: Geometry;
    private canvas: SVG.Container;
    private selectionRect: SVG.Rect | null;
    private startSelectionPoint: {
        x: number;
        y: number;
    };

    private onSelectStart(event: PointerEvent): void {
        if (!this.selectionRect && event.button === 0 && isInteractionPointer(event)) {
            const point = translateToSVG((this.canvas.node as any) as SVGSVGElement, [event.clientX, event.clientY]);
            this.startSelectionPoint = {
                x: point[0],
                y: point[1],
            };

            this.selectionRect = this.canvas.rect().addClass('cvat_canvas_zoom_selection');
            this.selectionRect.attr({
                'stroke-width': consts.BASE_STROKE_WIDTH / this.geometry.scale,
                ...this.startSelectionPoint,
            });
        }
    }

    private getSelectionBox(
        event: PointerEvent,
    ): {
            x: number;
            y: number;
            width: number;
            height: number;
        } {
        const point = translateToSVG((this.canvas.node as any) as SVGSVGElement, [event.clientX, event.clientY]);
        const stopSelectionPoint = {
            x: point[0],
            y: point[1],
        };

        const xtl = Math.min(this.startSelectionPoint.x, stopSelectionPoint.x);
        const ytl = Math.min(this.startSelectionPoint.y, stopSelectionPoint.y);
        const xbr = Math.max(this.startSelectionPoint.x, stopSelectionPoint.x);
        const ybr = Math.max(this.startSelectionPoint.y, stopSelectionPoint.y);

        return {
            x: xtl,
            y: ytl,
            width: xbr - xtl,
            height: ybr - ytl,
        };
    }

    private onSelectUpdate(event: PointerEvent): void {
        if (!isInteractionPointer(event)) return;
        if (this.selectionRect) {
            this.selectionRect.attr({
                ...this.getSelectionBox(event),
            });
        }
    }

    private onSelectStop(event: PointerEvent): void {
        if (!isInteractionPointer(event)) return;
        if (this.selectionRect) {
            const box = this.getSelectionBox(event);
            this.selectionRect.remove();
            this.selectionRect = null;
            this.startSelectionPoint = {
                x: 0,
                y: 0,
            };
            const threshold = 5;
            if (box.width > threshold && box.height > threshold) {
                this.onZoomRegion(box.x, box.y, box.width, box.height);
            }
        }
    }

    private onSelectCancel(): void {
        if (this.selectionRect) {
            this.selectionRect.remove();
            this.selectionRect = null;
            this.startSelectionPoint = {
                x: 0,
                y: 0,
            };
        }
    }

    public constructor(
        onZoomRegion: ZoomHandlerImpl['onZoomRegion'],
        canvas: SVG.Container,
        geometry: Geometry,
    ) {
        this.onZoomRegion = onZoomRegion;
        this.canvas = canvas;
        this.geometry = geometry;
        this.selectionRect = null;
        this.startSelectionPoint = {
            x: 0,
            y: 0,
        };
        this.bindedOnSelectStart = this.onSelectStart.bind(this);
        this.bindedOnSelectUpdate = this.onSelectUpdate.bind(this);
        this.bindedOnSelectStop = this.onSelectStop.bind(this);
        this.bindedOnSelectCancel = this.onSelectCancel.bind(this);
    }

    public zoom(): void {
        this.canvas.node.addEventListener('pointerdown', this.bindedOnSelectStart);
        this.canvas.node.addEventListener('pointermove', this.bindedOnSelectUpdate);
        this.canvas.node.addEventListener('pointerup', this.bindedOnSelectStop);
        this.canvas.node.addEventListener('pointercancel', this.bindedOnSelectCancel);
    }

    public cancel(): void {
        this.canvas.node.removeEventListener('pointerdown', this.bindedOnSelectStart);
        this.canvas.node.removeEventListener('pointermove', this.bindedOnSelectUpdate);
        this.canvas.node.removeEventListener('pointerup', this.bindedOnSelectStop);
        this.canvas.node.removeEventListener('pointercancel', this.bindedOnSelectCancel);
    }

    public transform(geometry: Geometry): void {
        this.geometry = geometry;
        if (this.selectionRect) {
            this.selectionRect.style({
                'stroke-width': consts.BASE_STROKE_WIDTH / geometry.scale,
            });
        }
    }
}
