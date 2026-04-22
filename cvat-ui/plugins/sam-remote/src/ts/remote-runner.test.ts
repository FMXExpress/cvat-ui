// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { __internal__ } from './remote-runner';

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    const actualJSON = JSON.stringify(actual);
    const expectedJSON = JSON.stringify(expected);
    assert(actualJSON === expectedJSON, `${message}. Actual: ${actualJSON}, expected: ${expectedJSON}`);
}

export function testParseFrameMarkersReturnsEmptyForBlankInput(): void {
    const parsed = __internal__.parseFrameMarkers('   ', 10, 30);
    assertEqual(parsed, [], 'Blank CSV input should parse to empty markers list');
}

export function testParseFrameMarkersParsesCSVAndDedupesSorted(): void {
    const parsed = __internal__.parseFrameMarkers('25, 13,13, 18\n25   17', 10, 30);
    assertEqual(parsed, [13, 17, 18, 25], 'Frame markers should parse, dedupe, and sort ascending');
}

export function testParseFrameMarkersClampsToBoundsAndSkipsInvalidTokens(): void {
    const parsed = __internal__.parseFrameMarkers('5, 10, nope, 42, -1, 28', 10, 30);
    assertEqual(parsed, [10, 28, 30], 'Frame markers should clamp to bounds and skip invalid tokens');
}
