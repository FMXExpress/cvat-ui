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

// 2D affine components of a computed CSS transform string
function parseCSSTransform(text) {
    if (text.startsWith('matrix3d(')) {
        const v = text.slice(9, -1).split(',').map(Number);
        return {
            a: v[0], b: v[1], c: v[4], d: v[5], e: v[12], f: v[13],
        };
    }

    if (text.startsWith('matrix(')) {
        const v = text.slice(7, -1).split(',').map(Number);
        return {
            a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5],
        };
    }

    return null;
}

// m1 x m2 for plain {a,b,c,d,e,f} 2D affine matrices (m2 applied first)
function multiplyAffine(m1, m2) {
    return {
        a: m1.a * m2.a + m1.c * m2.b,
        b: m1.b * m2.a + m1.d * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        d: m1.b * m2.c + m1.d * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        f: m1.b * m2.e + m1.d * m2.f + m1.f,
    };
}

// getScreenCTM() with the WebKit CSS-transform bug corrected. cvat-canvas
// zooms/rotates the content SVG via a CSS transform (scale() rotate() with
// the default center origin), which WebKit omits from getScreenCTM(); without
// the correction every client<->image coordinate conversion is wrong on
// Safari (drawn shapes are discarded as out-of-frame, pinch zoom is centered
// incorrectly, etc.). The reconstruction relies on the transform being
// uniform-scale/rotation about the element center, so the center of the
// transformed bounding rect is a fixed point of the CSS transform.
//
// IMPORTANT: the return value must be a real SVGMatrix, not a DOMMatrix -
// WebKit's SVGPoint.matrixTransform() throws
// "Argument 1 ('matrix') ... must be an instance of SVGMatrix" for anything
// else, so the corrected matrix is composed with plain arithmetic and copied
// into a matrix created by createSVGMatrix().
export function getScreenCTMCompat(element) {
    const ctm = element.getScreenCTM();

    // whatever happens here, coordinate conversion sits on the hot input path
    // (every pointer event) - it must never throw, or all canvas input dies
    try {
        if (ctmIncludesCSSTransform()) {
            return ctm;
        }

        const root = element instanceof SVGSVGElement ? element : element.ownerSVGElement;
        if (!root || !ctm) {
            return ctm;
        }

        const cssTransform = window.getComputedStyle(root).transform;
        if (!cssTransform || cssTransform === 'none') {
            return ctm;
        }

        const cssMatrix = parseCSSTransform(cssTransform);
        if (!cssMatrix) {
            return ctm;
        }

        const rect = root.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // correction = translate(cx, cy) x css x translate(-cx, -cy)
        const correction = multiplyAffine(
            multiplyAffine({
                a: 1, b: 0, c: 0, d: 1, e: cx, f: cy,
            }, cssMatrix),
            {
                a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy,
            },
        );

        const corrected = multiplyAffine(correction, ctm);
        const result = root.createSVGMatrix();
        result.a = corrected.a;
        result.b = corrected.b;
        result.c = corrected.c;
        result.d = corrected.d;
        result.e = corrected.e;
        result.f = corrected.f;

        debugState.corrections += 1;
        debugState.lastTransform = cssTransform;
        return result;
    } catch (error) {
        debugState.lastError = error instanceof Error ? error.message : `${error}`;
        return ctm;
    }
}
