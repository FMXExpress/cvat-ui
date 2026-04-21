// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { __internal__ } from './remote-client';

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

export function testNormalizeJobPredictionRequestWithNullableFields(): void {
    const result = __internal__.normalizeJobPredictionRequest({
        request_id: 'rq-1',
        state: 'running',
        remote_prediction_id: null,
        details: null,
        error: null,
    });

    assertEqual(result.state, 'pending', 'Running state should map to pending');
    assertEqual(result.remote_prediction_id, null, 'remote_prediction_id should keep null values');
    assertEqual(result.details, null, 'details should keep null values');
    assertEqual(result.error, null, 'error should keep null values');
}
