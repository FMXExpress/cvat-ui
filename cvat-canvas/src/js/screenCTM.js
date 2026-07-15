// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

const debugState = {
    probed: null,
    corrections: 0,
    lastError: null,
    lastTransform: null,
};

// diagnostic snapshot for the pointer debug overlay (see canvasView)
export function getScreenCTMDebugInfo() {
    return { ...debugState };
}

let ctmIncludesCSSTransformCache = null;
function ctmIncludesCSSTransform() {
    // WebKit's getScreenCTM() ignores CSS transforms applied to the SVG
    // element (https://bugs.webkit.org/show_bug.cgi?id=209220), while
    // Chromium/Firefox include them. Probe once at runtime.
    if (ctmIncludesCSSTransformCache === null) {
        const container = window.document.createElement('div');
        container.style.cssText = 'position: absolute; left: -9999px; top: -9999px; width: 10px; height: 10px;';
        const svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '10');
        svg.setAttribute('height', '10');
        svg.style.transform = 'scale(2)';
        container.appendChild(svg);
        window.document.body.appendChild(container);
        const ctm = svg.getScreenCTM();
        ctmIncludesCSSTransformCache = !!ctm && Math.abs(ctm.a - 2) < 0.01;
        container.remove();
        debugState.probed = ctmIncludesCSSTransformCache;
    }

    return ctmIncludesCSSTransformCache;
}

// getScreenCTM() with the WebKit CSS-transform bug corrected. cvat-canvas
// zooms/rotates the content SVG via a CSS transform (scale() rotate() with
// the default center origin), which WebKit omits from getScreenCTM(); without
// the correction every client<->image coordinate conversion is wrong on
// Safari (drawn shapes are discarded as out-of-frame, pinch zoom is centered
// incorrectly, etc.). The reconstruction relies on the transform being
// uniform-scale/rotation about the element center, so the center of the
// transformed bounding rect is a fixed point of the CSS transform.
export function getScreenCTMCompat(element) {
    const ctm = element.getScreenCTM();

    // whatever happens here, coordinate conversion sits on the hot input path
    // (every pointer event) - it must never throw, or all canvas input dies
    try {
        if (ctmIncludesCSSTransform()) {
            return ctm;
        }

        const root = element instanceof SVGSVGElement ? element : element.ownerSVGElement;
        if (!root) {
            return ctm;
        }

        const cssTransform = window.getComputedStyle(root).transform;
        if (!cssTransform || cssTransform === 'none') {
            return ctm;
        }

        // WebKitCSSMatrix fallback: older WebKit lacks the DOMMatrix
        // string constructor
        const MatrixClass = typeof DOMMatrix !== 'undefined' ? DOMMatrix : window.WebKitCSSMatrix;
        const cssMatrix = new MatrixClass(cssTransform);
        const rect = root.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const correction = new MatrixClass().translate(cx, cy).multiply(cssMatrix).translate(-cx, -cy);
        debugState.corrections += 1;
        debugState.lastTransform = cssTransform;
        return correction.multiply(ctm);
    } catch (error) {
        debugState.lastError = error instanceof Error ? error.message : `${error}`;
        return ctm;
    }
}
