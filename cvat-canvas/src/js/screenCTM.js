// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

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

    const cssMatrix = new DOMMatrix(cssTransform);
    const rect = root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const correction = new DOMMatrix().translate(cx, cy).multiply(cssMatrix).translate(-cx, -cy);
    return correction.multiply(ctm);
}
