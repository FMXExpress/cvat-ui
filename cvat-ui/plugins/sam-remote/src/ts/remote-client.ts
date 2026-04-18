// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export type RemoteResultState = 'pending' | 'running' | 'success' | 'failed';

export interface NormalizedRemoteResult {
    state: RemoteResultState;
    error?: string;
    selected_indices?: number[];
    candidate_indices?: number[];
    n_total_frames?: number;
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

export interface SubmitVideoPredictionResponse extends JobVideoPredictionSubmitResponse {
    pollResult: NormalizedRemoteResult;
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
    [key: string]: unknown;
}

export interface PollVideoPredictionStatusOptions {
    maxTimeoutMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    signal?: AbortSignal;
}

const DEFAULT_MAX_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;

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
    if (['success', 'completed', 'done', 'finished'].includes(value)) {
        return 'success';
    }

    if (['failed', 'error', 'expired'].includes(value)) {
        return 'failed';
    }

    if (['pending', 'queued', 'created'].includes(value)) {
        return 'pending';
    }

    return 'running';
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

function normalizeResponse(payload: Record<string, unknown>): NormalizedRemoteResult {
    const error = extractDetailMessage(payload) || payload.error || payload.message;
    const selected = toNumberArray(payload.selected_indices || payload.selectedIndices || payload.selectedFrames);
    const candidate = toNumberArray(payload.candidate_indices || payload.candidateIndices || payload.candidateFrames);
    const nTotalFrames = Number(payload.n_total_frames || payload.nTotalFrames || payload.totalFrames);

    return {
        state: normalizeState(payload.state || payload.status),
        error: typeof error === 'string' && error ? error : undefined,
        selected_indices: selected,
        candidate_indices: candidate,
        n_total_frames: Number.isFinite(nTotalFrames) ? nTotalFrames : undefined,
    };
}

function extractDetailMessage(payload: Record<string, unknown>): string | undefined {
    const detail = payload.detail;
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
        throw new Error(extractDetailMessage(payload) || `Failed to mint video access: ${response.status}`);
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
): Promise<SubmitVideoPredictionResponse> {
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
        throw new Error(extractDetailMessage(responsePayload) || `Prediction request failed with status ${response.status}`);
    }

    const requestId = String(responsePayload.request_id || '').trim();
    if (!requestId) {
        throw new Error('Prediction response is missing request_id');
    }

    return {
        request_id: requestId,
        status: typeof responsePayload.status === 'string' ? responsePayload.status : undefined,
        detail: responsePayload.detail,
        pollResult: normalizeResponse(responsePayload),
    };
}

export async function pollVideoPredictionStatus(
    jobId: number,
    requestId: string,
    options: PollVideoPredictionStatusOptions = {},
): Promise<NormalizedRemoteResult> {
    const maxTimeoutMs = options.maxTimeoutMs || DEFAULT_MAX_TIMEOUT_MS;
    const initialDelayMs = options.initialDelayMs || DEFAULT_INITIAL_DELAY_MS;
    const maxDelayMs = options.maxDelayMs || DEFAULT_MAX_DELAY_MS;

    const statusURL = `/api/jobs/${jobId}/video/predictions/${encodeURIComponent(requestId)}`;
    const deadline = Date.now() + maxTimeoutMs;
    let delay = initialDelayMs;

    while (Date.now() < deadline) {
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
                error: normalized.error || `Polling request failed: ${response.status}`,
            };
        }

        if (normalized.state === 'success') {
            return {
                ...normalized,
                state: 'success',
            };
        }

        if (normalized.state === 'failed') {
            return {
                ...normalized,
                state: 'failed',
                error: normalized.error || 'Prediction request failed',
            };
        }

        await sleep(delay, options.signal);
        delay = Math.min(delay * 2, maxDelayMs);
    }

    return {
        state: 'failed',
        error: `Timed out after ${maxTimeoutMs}ms while polling remote job status`,
    };
}
