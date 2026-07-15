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

// getScreenCTM() with the WebKit CSS-transform bug corrected.
//
// cvat-canvas zooms/rotates the content SVG via a CSS transform
// (scale() rotate(), default center origin). WebKit omits that transform
// from getScreenCTM(), and what exactly its broken matrix contains is not
// something we rely on: for the SVG root the true user->client matrix is
// rebuilt from first principles instead,
//
//     trueCTM(root) = translate(rectCenter) x cssLinear x translate(-W/2, -H/2)
//
// where rectCenter is the center of getBoundingClientRect() (the fixed point
// of a center-origin transform), cssLinear is the linear part of the computed
// CSS transform, and W/H are the SVG's layout width/height (user units map
// 1:1 to layout pixels - cvat's content SVG has no viewBox). For elements
// INSIDE the SVG, WebKit's relative matrix root.getScreenCTM()^-1 x
// el.getScreenCTM() is used, where the missing CSS transform cancels out.
//
// The return value must be a real SVGMatrix - WebKit's
// SVGPoint.matrixTransform() rejects DOMMatrix - so results are composed into
// matrices created with createSVGMatrix().
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

        const css = parseCSSTransform(cssTransform);
        if (!css) {
            return ctm;
        }

        const rect = root.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const halfW = root.width.baseVal.value / 2;
        const halfH = root.height.baseVal.value / 2;

        // translate(cx, cy) x cssLinear x translate(-halfW, -halfH)
        const rootTrue = root.createSVGMatrix();
        rootTrue.a = css.a;
        rootTrue.b = css.b;
        rootTrue.c = css.c;
        rootTrue.d = css.d;
        rootTrue.e = cx - (css.a * halfW + css.c * halfH);
        rootTrue.f = cy - (css.b * halfW + css.d * halfH);

        debugState.corrections += 1;
        debugState.lastTransform = cssTransform;

        if (element === root) {
            return rootTrue;
        }

        // relative part: WebKit's missing CSS transform cancels in
        // root^-1 x element, both being equally wrong
        const rootCTM = root.getScreenCTM();
        if (!rootCTM) {
            return ctm;
        }

        return rootTrue.multiply(rootCTM.inverse().multiply(ctm));
    } catch (error) {
        debugState.lastError = error instanceof Error ? error.message : `${error}`;
        return ctm;
    }
}
