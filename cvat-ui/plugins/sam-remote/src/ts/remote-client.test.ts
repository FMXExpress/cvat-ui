// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { __internal__, getVideoPredictionStatus, submitVideoPrediction } from './remote-client';

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

export function testNormalizeResponseWithTopLevelPayload(): void {
    const result = __internal__.normalizeResponse({
        status: 'completed',
        selected_indices: [1, '2', 'bad', 3],
        candidate_indices: ['5', 7],
        n_total_frames: '10',
    });

    assertEqual(result.selected_indices, [1, 2, 3], 'Top-level selected_indices should be normalized');
    assertEqual(result.candidate_indices, [5, 7], 'Top-level candidate_indices should be normalized');
    assertEqual(result.n_total_frames, 10, 'Top-level n_total_frames should be normalized');
}

export function testNormalizeResponseWithKeyframesFallback(): void {
    const result = __internal__.normalizeResponse({
        status: 'completed',
        keyframes: {
            selected_indices: [4, '6'],
            candidate_indices: [8, '9'],
            n_total_frames: 20,
        },
    });

    assertEqual(result.selected_indices, [4, 6], 'keyframes selected_indices should be used');
    assertEqual(result.candidate_indices, [8, 9], 'keyframes candidate_indices should be used');
    assertEqual(result.n_total_frames, 20, 'keyframes n_total_frames should be used');
}

export function testNormalizeResponseWithWebhookOutputFallback(): void {
    const result = __internal__.normalizeResponse({
        status: 'completed',
        webhook_payload: {
            output: {
                selected_indices: ['10', 12],
                candidate_indices: ['14', 16],
                n_total_frames: '30',
            },
        },
    });

    assertEqual(result.selected_indices, [10, 12], 'webhook_payload.output selected_indices should be used');
    assertEqual(result.candidate_indices, [14, 16], 'webhook_payload.output candidate_indices should be used');
    assertEqual(result.n_total_frames, 30, 'webhook_payload.output n_total_frames should be used');
}

export function testNormalizeCompletedResponseWithNullKeyframesAndWebhookOutput(): void {
    const webhookPayload = {
        output: {
            selected_indices: [17, '19'],
            candidate_indices: [21, 23],
            n_total_frames: 40,
        },
    };
    const result = __internal__.normalizeResponse({
        status: 'completed',
        keyframes: null,
        webhook_payload: webhookPayload,
    });

    assertEqual(result.selected_indices, [17, 19], 'webhook_payload.output selected_indices should be used when keyframes is null');
    assertEqual(result.candidate_indices, [21, 23], 'webhook_payload.output candidate_indices should be used when keyframes is null');
    assertEqual(result.n_total_frames, 40, 'webhook_payload.output n_total_frames should be used when keyframes is null');
    assertEqual(result.webhook_payload, webhookPayload, 'webhook_payload should be preserved in normalized response');
}

export function testNormalizeResponseWithWebhookOutputArrayFallback(): void {
    const result = __internal__.normalizeResponse({
        status: 'completed',
        webhook_payload: {
            output: [
                null,
                'invalid',
                {
                    candidate_indices: ['22', 24],
                },
                {
                    selected_indices: ['18', 20],
                    n_total_frames: '44',
                },
            ],
        },
    });

    assertEqual(result.selected_indices, [18, 20], 'webhook_payload.output array should use later record selected_indices');
    assertEqual(result.candidate_indices, [22, 24], 'webhook_payload.output array should use first record candidate_indices');
    assertEqual(result.n_total_frames, 44, 'webhook_payload.output array should normalize n_total_frames');
}

export function testNormalizeResponsePreservesTopLevelPrecedenceWithWebhookOutputArray(): void {
    const result = __internal__.normalizeResponse({
        status: 'completed',
        selected_indices: ['1', 3],
        keyframes: {
            selected_indices: [5, 7],
        },
        webhook_payload: {
            output: [
                {
                    selected_indices: [9, 11],
                },
            ],
        },
    });

    assertEqual(result.selected_indices, [1, 3], 'top-level selected_indices should remain highest precedence');
}

export function testNormalizeResponseWithEmptyWebhookOutputArray(): void {
    const result = __internal__.normalizeResponse({
        status: 'completed',
        webhook_payload: {
            output: [],
        },
    });

    assertEqual(result.selected_indices, undefined, 'empty webhook_payload.output array should not produce selected_indices');
    assertEqual(result.candidate_indices, undefined, 'empty webhook_payload.output array should not produce candidate_indices');
    assertEqual(result.n_total_frames, undefined, 'empty webhook_payload.output array should not produce n_total_frames');
}

export function testNormalizeJobPredictionRequestWithNullableFields(): void {
    const result = __internal__.normalizeJobPredictionRequest({
        request_id: 'rq-1',
        state: 'running',
        pathway: 'gpu',
        created_at: '2026-04-21T00:00:00Z',
        updated_at: '2026-04-21T00:01:00Z',
        remote_prediction_id: null,
        details: null,
        error: null,
    });

    assertEqual(result.state, 'pending', 'Running state should map to pending');
    assertEqual(result.pathway, 'gpu', 'pathway should be normalized');
    assertEqual(result.created_at, '2026-04-21T00:00:00Z', 'created_at should be normalized');
    assertEqual(result.updated_at, '2026-04-21T00:01:00Z', 'updated_at should be normalized');
    assertEqual(result.remote_prediction_id, null, 'remote_prediction_id should keep null values');
    assertEqual(result.details, null, 'details should keep null values');
    assertEqual(result.error, null, 'error should keep null values');
}

export function testNormalizeJobPredictionRequestWithObjectError(): void {
    const result = __internal__.normalizeJobPredictionRequest({
        request_id: 'rq-2',
        state: 'failed',
        error: {
            detail: [{ msg: 'remote timeout' }],
        },
        details: {
            request_context: 'demo',
        },
    });

    assertEqual(result.error, 'remote timeout', 'object error payload should be converted to readable message');
}

function mockFetchWithStatus(status = 200): { calls: unknown[]; restore: () => void } {
    const calls: unknown[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
        void url;
        if (init?.body) {
            calls.push(JSON.parse(String(init.body)));
        }

        return {
            ok: status >= 200 && status < 300,
            status,
            headers: {
                get: (name: string): string => {
                    void name;
                    return 'application/json';
                },
            },
            json: async (): Promise<Record<string, string>> => ({ request_id: 'req-1' }),
            text: async (): Promise<string> => JSON.stringify({ request_id: 'req-1' }),
            statusText: 'OK',
        } as unknown as Response;
    }) as typeof fetch;

    return {
        calls,
        restore: (): void => {
            globalThis.fetch = originalFetch;
        },
    };
}

export async function testSubmitVideoPredictionSendsPathwayForFastMode(): Promise<void> {
    const { calls, restore } = mockFetchWithStatus();
    try {
        await submitVideoPrediction(42, {
            pathway: 'fast',
            input: {
                stride: 5,
                n_clusters: 20,
                budget: 8,
                include_first: true,
                video: 'https://video.example/url.mp4',
            },
        });

        assertEqual(calls.length, 1, 'submitVideoPrediction should send one request');
        const body = calls[0] as Record<string, unknown>;
        assertEqual(body.pathway, 'fast', 'Fast submit payload should include pathway=fast');
        assert(!('remote_url' in body), 'Fast submit payload should exclude remote_url');
    } finally {
        restore();
    }
}

export async function testSubmitVideoPredictionSendsPathwayForSlowMode(): Promise<void> {
    const { calls, restore } = mockFetchWithStatus();
    try {
        await submitVideoPrediction(42, {
            pathway: 'slow',
            input: {
                stride: 5,
                n_clusters: 20,
                budget: 8,
                include_first: true,
                video: 'https://video.example/url.mp4',
            },
        });

        assertEqual(calls.length, 1, 'submitVideoPrediction should send one request');
        const body = calls[0] as Record<string, unknown>;
        assertEqual(body.pathway, 'slow', 'Slow submit payload should include pathway=slow');
        assert(!('remote_url' in body), 'Slow submit payload should exclude remote_url');
    } finally {
        restore();
    }
}

export async function testSubmitVideoPredictionSendsRemoteURLForOtherMode(): Promise<void> {
    const { calls, restore } = mockFetchWithStatus();
    try {
        await submitVideoPrediction(42, {
            remote_url: 'https://remote.example/predict',
            input: {
                stride: 5,
                n_clusters: 20,
                budget: 8,
                include_first: true,
                video: 'https://video.example/url.mp4',
            },
        });

        assertEqual(calls.length, 1, 'submitVideoPrediction should send one request');
        const body = calls[0] as Record<string, unknown>;
        assertEqual(body.remote_url, 'https://remote.example/predict', 'Other mode submit payload should include remote_url');
        assert(!('pathway' in body), 'Other mode submit payload should exclude pathway');
    } finally {
        restore();
    }
}

export async function testGetVideoPredictionStatusReturnsNormalizedCompletedResponse(): Promise<void> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string): Promise<Response> => {
        void url;
        return {
            ok: true,
            status: 200,
            headers: {
                get: (name: string): string => {
                    void name;
                    return 'application/json';
                },
            },
            json: async (): Promise<Record<string, unknown>> => ({
                status: 'completed',
                selected_indices: [1, '3'],
                request_id: 'req-2',
            }),
            text: async (): Promise<string> => JSON.stringify({
                status: 'completed',
                selected_indices: [1, '3'],
                request_id: 'req-2',
            }),
            statusText: 'OK',
        } as unknown as Response;
    }) as typeof fetch;

    try {
        const result = await getVideoPredictionStatus(42, 'req-2');
        assertEqual(result.state, 'completed', 'Single status fetch should normalize completed state');
        assertEqual(result.request_id, 'req-2', 'Single status fetch should keep request ID');
        assertEqual(result.selected_indices, [1, 3], 'Single status fetch should normalize selected indices');
    } finally {
        globalThis.fetch = originalFetch;
    }
}

export async function testGetVideoPredictionStatusReturnsFailedStateForHttpError(): Promise<void> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string): Promise<Response> => {
        void url;
        return {
            ok: false,
            status: 404,
            headers: {
                get: (name: string): string => {
                    void name;
                    return 'application/json';
                },
            },
            json: async (): Promise<Record<string, unknown>> => ({
                detail: 'missing request',
            }),
            text: async (): Promise<string> => JSON.stringify({
                detail: 'missing request',
            }),
            statusText: 'Not Found',
        } as unknown as Response;
    }) as typeof fetch;

    try {
        const result = await getVideoPredictionStatus(42, 'req-missing');
        assertEqual(result.state, 'failed', 'HTTP error should map to failed state');
        assertEqual(result.http_status, 404, 'HTTP error should be exposed in normalized result');
        assertEqual(result.error, 'missing request', 'HTTP error should preserve detail message');
        assertEqual(result.request_id, 'req-missing', 'Fallback request ID should be preserved');
    } finally {
        globalThis.fetch = originalFetch;
    }
}
