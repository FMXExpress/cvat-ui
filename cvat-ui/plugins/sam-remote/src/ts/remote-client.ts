// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export type RemoteResultState = 'pending' | 'running' | 'completed' | 'failed' | 'expired';

export interface NormalizedRemoteResult {
    state: RemoteResultState;
    error?: string;
    http_status?: number;
    request_id?: string;
    selected_indices?: number[];
    candidate_indices?: number[];
    n_total_frames?: number;
    keyframes?: unknown;
    webhook_payload?: unknown;
}

export class RemoteRequestError extends Error {
    stage: 'access' | 'submit';
    status: number;
    detail?: string;
    requestId?: string;

    constructor(
        stage: 'access' | 'submit',
        status: number,
        message: string,
        detail?: string,
        requestId?: string,
    ) {
        super(message);
        this.name = 'RemoteRequestError';
        this.stage = stage;
        this.status = status;
        this.detail = detail;
        this.requestId = requestId;
    }
}

export interface SubmitVideoPredictionInput {
    stride: number;
    n_clusters: number;
    budget: number;
    include_first: boolean;
    video: string;
    [key: string]: unknown;
}

export interface SubmitVideoPredictionOptions {
    remote_url: string;
    input: SubmitVideoPredictionInput;
}

export interface JobVideoPredictionSubmitResponse {
    request_id: string;
    status?: string;
    detail?: unknown;
}

export interface MintVideoAccessOptions {
    ttl_sec?: number;
    single_use?: boolean;
}

export interface JobVideoAccess {
    download_url: string;
    expires_at?: string;
    frame_hints?: Record<string, unknown>;
    media?: Record<string, unknown>;
}

export interface JobVideoPredictionStatus {
    state: string;
    detail?: unknown;
    selected_indices?: unknown;
    candidate_indices?: unknown;
    n_total_frames?: unknown;
    keyframes?: unknown;
    [key: string]: unknown;
}

export interface PollVideoPredictionStatusOptions {
    maxTimeoutMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    signal?: AbortSignal;
}

const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;

export interface PredictionDispatchPathway {
    [key: string]: unknown;
}

export interface PredictionDispatchStatus {
    mode: string | null;
    queue_timeout_seconds: number | null;
    poll_interval_seconds: number | null;
    lease_ttl_seconds: number | null;
    redis_ok: boolean;
    redis_error: string | null;
    server_time: string | null;
    pathways: Record<string, PredictionDispatchPathway>;
    [key: string]: unknown;
}

export interface PredictionDispatchHealth {
    status: string;
    redis_ok: boolean;
    acquire_ok: boolean;
    latency_ms: number | null;
}

export type JobPredictionRequestState = 'pending' | 'completed' | 'failed' | 'expired';

export interface JobPredictionRequest {
    state: JobPredictionRequestState;
    request_id: string;
    pathway: string | null;
    created_at: string | null;
    updated_at: string | null;
    remote_prediction_id: string | null;
    details: unknown | null;
    error: string | null;
    [key: string]: unknown;
}

function getCookie(name: string): string | null {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
}

function getCSRFToken(): string | null {
    return getCookie('csrftoken');
}

function normalizeState(rawState: unknown): RemoteResultState {
    const value = String(rawState || '').toLowerCase();
    if (['completed', 'done', 'finished', 'success'].includes(value)) {
        return 'completed';
    }

    if (['expired'].includes(value)) {
        return 'expired';
    }

    if (['failed', 'error'].includes(value)) {
        return 'failed';
    }

    if (['pending', 'queued', 'created'].includes(value)) {
        return 'pending';
    }

    return 'running';
}

function normalizeJobPredictionRequestState(rawState: unknown): JobPredictionRequestState {
    const state = normalizeState(rawState);
    if (state === 'running') {
        return 'pending';
    }

    return state;
}

function toNumberArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const normalized = value
        .map((item: unknown): number => Number(item))
        .filter((item: number): boolean => Number.isFinite(item));

    return normalized.length ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getNestedRecord(
    source: Record<string, unknown>,
    path: string[],
): Record<string, unknown> | undefined {
    let cursor: unknown = source;
    for (const key of path) {
        if (!isRecord(cursor) || !(key in cursor)) {
            return undefined;
        }
        cursor = cursor[key];
    }

    return isRecord(cursor) ? cursor : undefined;
}

function getFirstNumberArray(
    sources: Record<string, unknown>[],
    keys: string[],
): number[] | undefined {
    for (const source of sources) {
        for (const key of keys) {
            const parsed = toNumberArray(source[key]);
            if (parsed) {
                return parsed;
            }
        }
    }

    return undefined;
}

function getFirstFiniteNumber(
    sources: Record<string, unknown>[],
    keys: string[],
): number | undefined {
    for (const source of sources) {
        for (const key of keys) {
            const parsed = Number(source[key]);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }

    return undefined;
}

function extractDetailMessage(payload: Record<string, unknown>): string | undefined {
    const { detail } = payload;
    if (typeof detail === 'string' && detail.trim()) {
        return detail.trim();
    }

    if (Array.isArray(detail)) {
        const parts = detail
            .map((item: unknown): string => {
                if (typeof item === 'string') {
                    return item.trim();
                }

                if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') {
                    return item.msg.trim();
                }

                return '';
            })
            .filter((item: string): boolean => Boolean(item));

        if (parts.length) {
            return parts.join('; ');
        }
    }

    if (detail && typeof detail === 'object') {
        const nestedDetail = (detail as { detail?: unknown }).detail;
        if (typeof nestedDetail === 'string' && nestedDetail.trim()) {
            return nestedDetail.trim();
        }
    }

    return undefined;
}

function normalizeResponse(payload: Record<string, unknown>): NormalizedRemoteResult {
    const error = extractDetailMessage(payload) || payload.error || payload.message;
    const keyframes = getNestedRecord(payload, ['keyframes']);
    const webhookPayload = getNestedRecord(payload, ['webhook_payload']) || getNestedRecord(payload, ['webhookPayload']);
    const webhookOutput = webhookPayload ? getNestedRecord(webhookPayload, ['output']) : undefined;
    const valueSources = [payload, keyframes, webhookOutput].filter(isRecord);

    const selected = getFirstNumberArray(valueSources, ['selected_indices', 'selectedIndices', 'selectedFrames']);
    const candidate = getFirstNumberArray(valueSources, ['candidate_indices', 'candidateIndices', 'candidateFrames']);
    const nTotalFrames = getFirstFiniteNumber(valueSources, ['n_total_frames', 'nTotalFrames', 'totalFrames']);

    return {
        state: normalizeState(payload.state || payload.status),
        error: typeof error === 'string' && error ? error : undefined,
        http_status: Number.isFinite(Number(payload.status_code)) ? Number(payload.status_code) : undefined,
        request_id: typeof payload.request_id === 'string' ? payload.request_id : undefined,
        selected_indices: selected,
        candidate_indices: candidate,
        n_total_frames: nTotalFrames,
        keyframes: payload.keyframes,
        webhook_payload: payload.webhook_payload || payload.webhookPayload,
    };
}

function toNullableString(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    return String(value);
}

function toNullableFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeJobPredictionRequest(payload: Record<string, unknown>): JobPredictionRequest {
    const requestID = toNullableString(payload.request_id)?.trim() || '';
    const remotePredictionID = toNullableString(payload.remote_prediction_id);
    const detailsValue = isRecord(payload.details) ? payload.details : null;
    const errorPayload = payload.error;
    const errorFromDetails = detailsValue ? extractDetailMessage(detailsValue) : undefined;
    const errorValue = typeof errorPayload === 'string' ?
        errorPayload :
        toNullableString(extractDetailMessage(isRecord(errorPayload) ? errorPayload : {}) || errorFromDetails);

    return {
        ...payload,
        request_id: requestID,
        pathway: toNullableString(payload.pathway),
        created_at: toNullableString(payload.created_at),
        updated_at: toNullableString(payload.updated_at),
        remote_prediction_id: remotePredictionID,
        state: normalizeJobPredictionRequestState(payload.state || payload.status),
        details: detailsValue,
        error: errorValue,
    };
}

export const __internal__ = {
    normalizeResponse,
    normalizeJobPredictionRequest,
};

async function parseJSONResponse(response: Response): Promise<Record<string, unknown>> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return await response.json() as Record<string, unknown>;
    }

    const text = await response.text();
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return { detail: text || response.statusText, status: response.status };
    }
}

function sleep(timeout: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let timer = 0;
        const onAbort = (): void => {
            window.clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };

        timer = window.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, timeout);

        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

export async function mintVideoAccess(
    jobId: number,
    options: MintVideoAccessOptions = { ttl_sec: 600, single_use: true },
): Promise<JobVideoAccess> {
    const csrfToken = getCSRFToken();
    const response = await fetch(`/api/jobs/${jobId}/video/access`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        },
        body: JSON.stringify({
            ttl_sec: options.ttl_sec ?? 600,
            single_use: options.single_use ?? true,
        }),
    });

    const payload = await parseJSONResponse(response);
    if (!response.ok) {
        const detail = extractDetailMessage(payload);
        throw new RemoteRequestError(
            'access',
            response.status,
            detail || `Failed to mint video access: ${response.status}`,
            detail,
        );
    }

    const downloadURL = typeof payload.download_url === 'string' ? payload.download_url.trim() : '';
    if (!downloadURL) {
        throw new Error('Video access response is missing download_url');
    }

    return {
        download_url: downloadURL,
        expires_at: typeof payload.expires_at === 'string' ? payload.expires_at : undefined,
        frame_hints: payload.frame_hints && typeof payload.frame_hints === 'object' ?
            payload.frame_hints as Record<string, unknown> : undefined,
        media: payload.media && typeof payload.media === 'object' ? payload.media as Record<string, unknown> : undefined,
    };
}

export async function submitVideoPrediction(
    jobId: number,
    options: SubmitVideoPredictionOptions,
    signal?: AbortSignal,
): Promise<JobVideoPredictionSubmitResponse> {
    const csrfToken = getCSRFToken();
    const response = await fetch(`/api/jobs/${jobId}/video/predictions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        },
        body: JSON.stringify(options),
        signal,
    });

    const responsePayload = await parseJSONResponse(response);
    if (!response.ok) {
        const detail = extractDetailMessage(responsePayload);
        const requestId = typeof responsePayload.request_id === 'string' ? responsePayload.request_id : undefined;
        throw new RemoteRequestError(
            'submit',
            response.status,
            detail || `Prediction request failed with status ${response.status}`,
            detail,
            requestId,
        );
    }

    const requestId = String(responsePayload.request_id || '').trim();
    if (!requestId) {
        throw new Error('Prediction response is missing request_id');
    }

    return {
        request_id: requestId,
        status: typeof responsePayload.status === 'string' ? responsePayload.status : undefined,
        detail: responsePayload.detail,
    };
}

export async function pollVideoPredictionStatus(
    jobId: number,
    requestId: string,
    options: PollVideoPredictionStatusOptions = {},
): Promise<NormalizedRemoteResult> {
    const {
        maxTimeoutMs,
        initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
        maxDelayMs = DEFAULT_MAX_DELAY_MS,
    } = options;

    const statusURL = `/api/jobs/${jobId}/video/predictions/${encodeURIComponent(requestId)}`;
    const deadline = Number.isFinite(maxTimeoutMs) && Number(maxTimeoutMs) > 0 ?
        Date.now() + Number(maxTimeoutMs) : null;
    let delay = initialDelayMs;

    let shouldPoll = deadline === null || Date.now() < deadline;
    while (shouldPoll) {
        const response = await fetch(statusURL, {
            method: 'GET',
            credentials: 'same-origin',
            signal: options.signal,
        });
        const payload = await parseJSONResponse(response) as JobVideoPredictionStatus;
        const normalized = normalizeResponse(payload);
        if (!response.ok) {
            return {
                ...normalized,
                state: 'failed',
                http_status: response.status,
                request_id: requestId,
                error: normalized.error || `Polling request failed: ${response.status}`,
            };
        }

        if (normalized.state === 'completed') {
            return {
                ...normalized,
                state: 'completed',
                request_id: normalized.request_id || requestId,
            };
        }

        if (normalized.state === 'failed' || normalized.state === 'expired') {
            return {
                ...normalized,
                state: normalized.state,
                request_id: normalized.request_id || requestId,
                error: normalized.error || 'Prediction request failed',
            };
        }

        await sleep(delay, options.signal);
        delay = Math.min(delay * 2, maxDelayMs);
        shouldPoll = deadline === null || Date.now() < deadline;
    }

    return {
        state: 'failed',
        request_id: requestId,
        error: `Timed out after ${Number(maxTimeoutMs)}ms while polling remote job status`,
    };
}

export async function getPredictionDispatchStatus(): Promise<PredictionDispatchStatus> {
    const response = await fetch('/api/server/predictions/dispatch', {
        method: 'GET',
        credentials: 'same-origin',
    });
    const payload = await parseJSONResponse(response);
    if (!response.ok) {
        const detail = extractDetailMessage(payload);
        throw new Error(detail || `Failed to fetch prediction dispatch status: ${response.status}`);
    }

    const pathways = payload.pathways && typeof payload.pathways === 'object' && !Array.isArray(payload.pathways) ?
        payload.pathways as Record<string, PredictionDispatchPathway> : {};

    return {
        ...payload,
        mode: toNullableString(payload.mode),
        queue_timeout_seconds: toNullableFiniteNumber(payload.queue_timeout_seconds),
        poll_interval_seconds: toNullableFiniteNumber(payload.poll_interval_seconds),
        lease_ttl_seconds: toNullableFiniteNumber(payload.lease_ttl_seconds),
        redis_ok: Boolean(payload.redis_ok),
        redis_error: toNullableString(payload.redis_error),
        server_time: toNullableString(payload.server_time),
        pathways,
    };
}

export async function getPredictionDispatchHealth(): Promise<PredictionDispatchHealth> {
    const response = await fetch('/api/server/predictions/dispatch/health', {
        method: 'GET',
        credentials: 'same-origin',
    });
    const payload = await parseJSONResponse(response);
    if (!response.ok) {
        const detail = extractDetailMessage(payload);
        throw new Error(detail || `Failed to fetch prediction dispatch health: ${response.status}`);
    }

    return {
        status: typeof payload.status === 'string' ? payload.status : '',
        redis_ok: Boolean(payload.redis_ok),
        acquire_ok: Boolean(payload.acquire_ok),
        latency_ms: toNullableFiniteNumber(payload.latency_ms),
    };
}

export async function getJobPredictionRequests(jobId: number): Promise<JobPredictionRequest[]> {
    const response = await fetch(`/api/jobs/${jobId}/video/predictions/requests`, {
        method: 'GET',
        credentials: 'same-origin',
    });
    const payload = await parseJSONResponse(response);
    if (!response.ok) {
        const detail = extractDetailMessage(payload);
        throw new Error(detail || `Failed to fetch prediction requests: ${response.status}`);
    }

    if (Array.isArray(payload)) {
        return payload.filter(isRecord).map(normalizeJobPredictionRequest);
    }

    if (Array.isArray(payload.results)) {
        return payload.results.filter(isRecord).map(normalizeJobPredictionRequest);
    }

    return [];
}
