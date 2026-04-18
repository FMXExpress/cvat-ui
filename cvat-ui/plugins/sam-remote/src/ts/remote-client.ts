// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export type RemoteResultState = 'pending' | 'running' | 'success' | 'failed' | 'canceled';

export interface NormalizedRemoteResult {
    state: RemoteResultState;
    error?: string;
    selected_indices?: number[];
    candidate_indices?: number[];
    n_total_frames?: number;
}

export interface SubmitVideoJobParams {
    stride: number;
    n_clusters: number;
    budget: number;
    include_first: boolean;
    // Remote API key for the source media location.
    video: string;
}

export interface VideoSource {
    file?: Blob;
    signedURL?: string;
}

export interface SubmitVideoJobOptions {
    endpoint: string;
    videoSource?: VideoSource;
    params: SubmitVideoJobParams;
    callbackURL?: string;
    callbackToken?: string;
    signal?: AbortSignal;
}

export interface SubmitVideoJobResponse {
    jobID: string;
    statusURL: string;
    resultURL?: string;
    pollResult: NormalizedRemoteResult;
}

export interface MintVideoAccessOptions {
    ttl_sec?: number;
    single_use?: boolean;
}

export interface MintVideoAccessResponse {
    download_url: string;
    expires_at?: string;
    media?: {
        start_frame?: number;
        stop_frame?: number;
    };
}

interface PollResponse {
    state: RemoteResultState;
    payload: Record<string, unknown>;
    resultURL?: string;
}

export interface PollJobStatusOptions {
    endpoint: string;
    statusURL?: string;
    resultURL?: string;
    jobID?: string;
    callbackToken?: string;
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

    if (['failed', 'error'].includes(value)) {
        return 'failed';
    }

    if (['canceled', 'cancelled', 'aborted'].includes(value)) {
        return 'canceled';
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
    const error = payload.error || payload.message || payload.detail;
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

function resolveURL(value: string, base: string): string {
    return new URL(value, base).toString();
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

function buildStatusURL(options: Pick<PollJobStatusOptions, 'endpoint' | 'statusURL' | 'jobID'>): string {
    if (options.statusURL) {
        return resolveURL(options.statusURL, options.endpoint);
    }

    if (options.jobID) {
        return resolveURL(`/status/${encodeURIComponent(options.jobID)}`, options.endpoint);
    }

    return resolveURL('/status', options.endpoint);
}

function extractSubmitInfo(payload: Record<string, unknown>, endpoint: string): {
    jobID: string;
    statusURL: string;
    resultURL?: string;
} {
    const jobID = String(payload.job_id || payload.jobId || payload.id || '').trim();
    const statusURLRaw = payload.status_url || payload.statusUrl || payload.url || '';
    const resultURLRaw = payload.result_url || payload.resultUrl || undefined;

    if (!jobID && !statusURLRaw) {
        throw new Error('Remote service did not return a job identifier or status URL');
    }

    const statusURL = String(statusURLRaw || `/status/${encodeURIComponent(jobID)}`);

    return {
        jobID,
        statusURL: resolveURL(statusURL, endpoint),
        resultURL: resultURLRaw ? resolveURL(String(resultURLRaw), endpoint) : undefined,
    };
}

async function fetchPollResponse(url: string, signal?: AbortSignal): Promise<PollResponse> {
    const response = await fetch(url, { method: 'GET', signal });
    const payload = await parseJSONResponse(response);

    if (!response.ok) {
        const normalized = normalizeResponse(payload);
        return {
            state: 'failed',
            payload: {
                ...payload,
                error: normalized.error || `Polling request failed: ${response.status}`,
            },
        };
    }

    let resultURL: string | undefined;
    if (typeof payload.result_url === 'string') {
        resultURL = payload.result_url;
    } else if (typeof payload.resultUrl === 'string') {
        resultURL = payload.resultUrl;
    }

    return {
        state: normalizeState(payload.state || payload.status),
        payload,
        resultURL,
    };
}

async function fetchResult(url: string, signal?: AbortSignal): Promise<NormalizedRemoteResult> {
    const response = await fetch(url, { method: 'GET', signal });
    const payload = await parseJSONResponse(response);
    const normalized = normalizeResponse(payload);

    if (!response.ok) {
        return {
            ...normalized,
            state: 'failed',
            error: normalized.error || `Failed to retrieve remote result: ${response.status}`,
        };
    }

    return normalized;
}

export async function mintVideoAccess(
    jobId: number,
    options: MintVideoAccessOptions = { ttl_sec: 600, single_use: true },
): Promise<MintVideoAccessResponse> {
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
        throw new Error((typeof payload.detail === 'string' && payload.detail) || `Failed to mint video access: ${response.status}`);
    }

    const downloadURL = typeof payload.download_url === 'string' ? payload.download_url.trim() : '';
    if (!downloadURL) {
        throw new Error('Video access response is missing download_url');
    }

    const media = (typeof payload.media === 'object' && payload.media ? payload.media : null) as Record<string, unknown> | null;
    const startFrame = Number(media?.start_frame);
    const stopFrame = Number(media?.stop_frame);

    return {
        download_url: downloadURL,
        expires_at: typeof payload.expires_at === 'string' ? payload.expires_at : undefined,
        media: media ? {
            ...(Number.isFinite(startFrame) ? { start_frame: startFrame } : {}),
            ...(Number.isFinite(stopFrame) ? { stop_frame: stopFrame } : {}),
        } : undefined,
    };
}

export async function submitVideoJob(options: SubmitVideoJobOptions): Promise<SubmitVideoJobResponse> {
    const payload: Record<string, unknown> = {
        ...options.params,
    };
    if (options.videoSource?.file || options.videoSource?.signedURL) {
        payload.video = {
            ...(options.videoSource.file ? { file: options.videoSource.file } : {}),
            ...(options.videoSource.signedURL ? { url: options.videoSource.signedURL } : {}),
        };
    }

    if (options.callbackURL) {
        payload.callback_url = options.callbackURL;
    }

    if (options.callbackToken) {
        payload.callback_token = options.callbackToken;
    }

    const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: payload }),
        signal: options.signal,
    });

    const responsePayload = await parseJSONResponse(response);
    if (!response.ok) {
        const normalized = normalizeResponse(responsePayload);
        throw new Error(normalized.error || `Remote request failed with status ${response.status}`);
    }

    const submitInfo = extractSubmitInfo(responsePayload, options.endpoint);

    return {
        ...submitInfo,
        pollResult: normalizeResponse(responsePayload),
    };
}

export async function pollJobStatus(options: PollJobStatusOptions): Promise<NormalizedRemoteResult> {
    const maxTimeoutMs = options.maxTimeoutMs || DEFAULT_MAX_TIMEOUT_MS;
    const initialDelayMs = options.initialDelayMs || DEFAULT_INITIAL_DELAY_MS;
    const maxDelayMs = options.maxDelayMs || DEFAULT_MAX_DELAY_MS;

    const statusURL = buildStatusURL(options);
    const deadline = Date.now() + maxTimeoutMs;
    let delay = initialDelayMs;

    while (Date.now() < deadline) {
        const poll = await fetchPollResponse(statusURL, options.signal);
        const normalized = normalizeResponse(poll.payload);

        if (poll.state === 'success') {
            const returnedResultURL = poll.resultURL ? resolveURL(poll.resultURL, options.endpoint) : undefined;
            const explicitResultURL = options.resultURL ? resolveURL(options.resultURL, options.endpoint) : undefined;
            const resumeResultURL = options.callbackToken ?
                resolveURL(`/result/${encodeURIComponent(options.callbackToken)}`, options.endpoint) :
                undefined;

            const resultURL = returnedResultURL || explicitResultURL || resumeResultURL;

            if (resultURL && (!normalized.selected_indices || !normalized.candidate_indices)) {
                return fetchResult(resultURL, options.signal);
            }

            return {
                ...normalized,
                state: 'success',
            };
        }

        if (poll.state === 'failed' || poll.state === 'canceled') {
            return {
                ...normalized,
                state: poll.state,
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
