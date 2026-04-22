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

const BASE_VALUES = {
    remoteURL: 'https://remote.example/predict',
    pathwayMode: 'fast' as const,
    stride: 5,
    nClusters: 20,
    budget: 8,
    includeFirst: true,
};

export function testBuildSubmitPayloadUsesFastPathway(): void {
    const payload = __internal__.buildSubmitPayload(BASE_VALUES, 'https://video.example/url.mp4');
    assertEqual(payload, {
        pathway: 'fast',
        input: {
            stride: 5,
            n_clusters: 20,
            budget: 8,
            include_first: true,
            video: 'https://video.example/url.mp4',
        },
    }, 'Fast pathway mode should map to pathway=fast payload');
}

export function testBuildSubmitPayloadUsesSlowPathway(): void {
    const payload = __internal__.buildSubmitPayload(
        {
            ...BASE_VALUES,
            pathwayMode: 'slow',
        },
        'https://video.example/url.mp4',
    );
    assertEqual(payload, {
        pathway: 'slow',
        input: {
            stride: 5,
            n_clusters: 20,
            budget: 8,
            include_first: true,
            video: 'https://video.example/url.mp4',
        },
    }, 'Slow pathway mode should map to pathway=slow payload');
}

export function testBuildSubmitPayloadUsesRemoteURLForOtherMode(): void {
    const payload = __internal__.buildSubmitPayload(
        {
            ...BASE_VALUES,
            pathwayMode: 'other',
        },
        'https://video.example/url.mp4',
    );
    assertEqual(payload, {
        remote_url: 'https://remote.example/predict',
        input: {
            stride: 5,
            n_clusters: 20,
            budget: 8,
            include_first: true,
            video: 'https://video.example/url.mp4',
        },
    }, 'Other pathway mode should map to remote_url payload');
}
