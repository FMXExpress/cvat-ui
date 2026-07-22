// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Downloads the original video file backing a job, reusing the signed
// download-link endpoint that also feeds the remote keyframe system
// (see plugins/sam-remote/src/ts/remote-client.ts mintVideoAccess):
// POST /api/jobs/{id}/video/access mints a short-lived (optionally
// one-time) token URL, GET on that URL streams the file. Tokens are
// cheap - every call here mints a fresh one.

export class JobVideoExportError extends Error {
    public status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'JobVideoExportError';
        this.status = status;
    }
}

function getCSRFToken(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

// DRF error responses here are either a bare JSON string
// ('This job is not associated with a video') or { detail: '...' }
async function readErrorMessage(response: Response): Promise<string> {
    const text = await response.text();
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string' && parsed.trim()) {
            return parsed.trim();
        }
        if (parsed && typeof parsed.detail === 'string' && parsed.detail.trim()) {
            return parsed.detail.trim();
        }
    } catch {
        // not JSON, fall through to raw text
    }

    return text.trim() || response.statusText || `Request failed with status ${response.status}`;
}

export async function downloadJobVideo(jobId: number): Promise<void> {
    const csrfToken = getCSRFToken();
    const response = await fetch(`/api/jobs/${jobId}/video/access`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        },
        body: JSON.stringify({}),
    });

    if (!response.ok) {
        throw new JobVideoExportError(response.status, await readErrorMessage(response));
    }

    const payload = await response.json() as {
        download_url?: unknown;
        media?: { path?: unknown };
    };
    const downloadURL = typeof payload.download_url === 'string' ? payload.download_url.trim() : '';
    if (!downloadURL) {
        throw new JobVideoExportError(response.status, 'Video access response is missing download_url');
    }

    const mediaPath = typeof payload.media?.path === 'string' ? payload.media.path : '';
    const filename = mediaPath.split('/').pop() || `job_${jobId}_video`;

    // the download endpoint serves the file inline (no Content-Disposition),
    // so a plain navigation would play the video in a tab; the download
    // attribute forces saving and is honored because the URL is same-origin
    const anchor = window.document.createElement('a');
    anchor.href = downloadURL;
    anchor.download = filename;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}
