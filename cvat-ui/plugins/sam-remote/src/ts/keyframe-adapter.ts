// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export type KeyframeDiagnosticCode = 'UNKNOWN_SHAPE' | 'INVALID_INDEX' | 'OUT_OF_RANGE';

export interface KeyframeAdapterDiagnostic {
    code: KeyframeDiagnosticCode;
    message: string;
    path: string;
    value?: unknown;
}

export interface KeyframeAdapterBounds {
    start: number;
    stop: number;
}

export interface AdaptedKeyframes {
    selected_indices: number[];
    candidate_indices?: number[];
    diagnostics: KeyframeAdapterDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addDiagnostic(
    diagnostics: KeyframeAdapterDiagnostic[],
    code: KeyframeDiagnosticCode,
    path: string,
    message: string,
    value?: unknown,
): void {
    diagnostics.push({
        code,
        message,
        path,
        value,
    });
}

function normalizeFrameIndex(
    value: unknown,
    path: string,
    diagnostics: KeyframeAdapterDiagnostic[],
    bounds?: KeyframeAdapterBounds,
): number | null {
    if (!Number.isInteger(value)) {
        addDiagnostic(
            diagnostics,
            'INVALID_INDEX',
            path,
            'Expected an integer frame index.',
            value,
        );
        return null;
    }

    const index = value as number;
    if (bounds && (index < bounds.start || index > bounds.stop)) {
        addDiagnostic(
            diagnostics,
            'OUT_OF_RANGE',
            path,
            `Frame index ${index} is outside the current job bounds (${bounds.start}-${bounds.stop}).`,
            value,
        );
        return null;
    }

    return index;
}

function parseIndexArray(
    value: unknown,
    path: string,
    diagnostics: KeyframeAdapterDiagnostic[],
    bounds?: KeyframeAdapterBounds,
): number[] {
    if (!Array.isArray(value)) {
        addDiagnostic(
            diagnostics,
            'UNKNOWN_SHAPE',
            path,
            'Expected an array of frame indices.',
            value,
        );
        return [];
    }

    return Array.from(new Set(value
        .map((item: unknown, index: number): number | null => normalizeFrameIndex(
            item,
            `${path}[${index}]`,
            diagnostics,
            bounds,
        ))
        .filter((item: number | null): item is number => item !== null))).sort((a: number, b: number): number => a - b);
}

function parseIndexedObject(
    value: Record<string, unknown>,
    path: string,
    diagnostics: KeyframeAdapterDiagnostic[],
    bounds?: KeyframeAdapterBounds,
): number[] {
    return Object.entries(value)
        .flatMap(([key, item]: [string, unknown]): number[] => {
            if (item !== true && item !== 1 && item !== '1') {
                return [];
            }

            const parsed = Number(key);
            if (!Number.isInteger(parsed)) {
                addDiagnostic(
                    diagnostics,
                    'INVALID_INDEX',
                    `${path}.${key}`,
                    'Keyframe index keys must be integers.',
                    key,
                );
                return [];
            }

            const normalized = normalizeFrameIndex(parsed, `${path}.${key}`, diagnostics, bounds);
            return normalized === null ? [] : [normalized];
        })
        .sort((a: number, b: number): number => a - b);
}

export function adaptKeyframesPayload(
    keyframes: unknown,
    bounds?: KeyframeAdapterBounds,
): AdaptedKeyframes {
    const diagnostics: KeyframeAdapterDiagnostic[] = [];

    if (keyframes === undefined || keyframes === null) {
        return { selected_indices: [], diagnostics };
    }

    if (Array.isArray(keyframes)) {
        return {
            selected_indices: parseIndexArray(keyframes, 'keyframes', diagnostics, bounds),
            diagnostics,
        };
    }

    if (!isRecord(keyframes)) {
        addDiagnostic(
            diagnostics,
            'UNKNOWN_SHAPE',
            'keyframes',
            'Unsupported keyframes payload: expected an object or array.',
            keyframes,
        );
        return { selected_indices: [], diagnostics };
    }

    const objectKeyframes = keyframes as Record<string, unknown>;
    let selected: number[] = [];
    let candidate: number[] | undefined;

    if (Array.isArray(objectKeyframes.selected_indices)) {
        selected = parseIndexArray(objectKeyframes.selected_indices, 'keyframes.selected_indices', diagnostics, bounds);
    } else if (Array.isArray(objectKeyframes.selected)) {
        selected = parseIndexArray(objectKeyframes.selected, 'keyframes.selected', diagnostics, bounds);
    } else if (Array.isArray(objectKeyframes.indices)) {
        selected = parseIndexArray(objectKeyframes.indices, 'keyframes.indices', diagnostics, bounds);
    } else if (Array.isArray(objectKeyframes.keyframes)) {
        selected = parseIndexArray(objectKeyframes.keyframes, 'keyframes.keyframes', diagnostics, bounds);
    } else if (isRecord(objectKeyframes.selected_map)) {
        selected = parseIndexedObject(objectKeyframes.selected_map, 'keyframes.selected_map', diagnostics, bounds);
    } else {
        addDiagnostic(
            diagnostics,
            'UNKNOWN_SHAPE',
            'keyframes',
            'Could not find selected keyframe indices. Expected selected_indices, selected, indices, keyframes, or selected_map.',
            keyframes,
        );
    }

    if (Array.isArray(objectKeyframes.candidate_indices)) {
        candidate = parseIndexArray(
            objectKeyframes.candidate_indices,
            'keyframes.candidate_indices',
            diagnostics,
            bounds,
        );
    } else if (Array.isArray(objectKeyframes.candidates)) {
        candidate = parseIndexArray(objectKeyframes.candidates, 'keyframes.candidates', diagnostics, bounds);
    }

    return {
        selected_indices: selected,
        ...(candidate ? { candidate_indices: candidate } : {}),
        diagnostics,
    };
}
