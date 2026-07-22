// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { getCore } from 'cvat-core-wrapper';

const core = getCore();

// Downloads the original video file backing a job, reusing the signed
// download-link endpoint that also feeds the remote keyframe system
// (see plugins/sam-remote/src/ts/remote-client.ts mintVideoAccess):
// POST /api/jobs/{id}/video/access mints a short-lived token URL, GET on
// that URL streams the file. Tokens are cheap - every call mints a fresh
// one. Deployment note: with CVAT_JOB_VIDEO_DOWNLOAD_TOKEN_ONE_TIME_USE
// enabled, a paused-and-resumed browser download re-sends the same token
// and fails - keep it disabled where users download large videos.
export async function downloadJobVideo(jobId: number): Promise<void> {
    // the cvat-core request layer attaches the CSRF header and the current
    // organization context, and normalizes DRF error bodies into a
    // ServerError with a readable .message
    const response = await core.server.request(
        `${core.config.backendAPI}/jobs/${jobId}/video/access`,
        { method: 'POST' },
    );

    const payload = response.data as {
        download_url?: unknown;
        media?: { path?: unknown };
    };
    const downloadURL = typeof payload.download_url === 'string' ? payload.download_url.trim() : '';
    if (!downloadURL) {
        throw new Error('Video access response is missing download_url');
    }

    const mediaPath = typeof payload.media?.path === 'string' ? payload.media.path : '';
    const filename = mediaPath.split('/').pop() || `job_${jobId}_video`;

    // the download endpoint serves the file inline (no Content-Disposition),
    // so a plain navigation would play the video in a tab; the app's shared
    // download anchor with the download attribute forces saving (honored
    // because the URL is same-origin)
    const anchor = window.document.getElementById('downloadAnchor') as HTMLAnchorElement | null;
    if (!anchor) {
        throw new Error('Download anchor is not available');
    }
    anchor.href = downloadURL;
    anchor.download = filename;
    anchor.click();
    // restore the bare download attribute so other consumers of the shared
    // anchor (export requests, skeleton SVGs) keep their server-side or
    // default filenames
    anchor.download = '';
}
