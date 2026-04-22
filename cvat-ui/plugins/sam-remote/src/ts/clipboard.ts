// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

interface CopyTextOptions {
    onEmpty?: () => void;
}

export async function copyTextToClipboard(value: string, options: CopyTextOptions = {}): Promise<boolean> {
    if (!value) {
        options.onEmpty?.();
        return false;
    }

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            // Fallback to document.execCommand('copy') below when async clipboard API fails.
        }
    }

    if (typeof document === 'undefined') {
        return false;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    } finally {
        document.body.removeChild(textarea);
    }

    return copied;
}
