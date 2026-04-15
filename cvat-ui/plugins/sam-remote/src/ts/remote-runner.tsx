// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, {
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import Button from 'antd/lib/button';
import Form from 'antd/lib/form';
import Input from 'antd/lib/input';
import InputNumber from 'antd/lib/input-number';
import Select from 'antd/lib/select';
import Switch from 'antd/lib/switch';
import Space from 'antd/lib/space';
import message from 'antd/lib/message';
import notification from 'antd/lib/notification';
import Alert from 'antd/lib/alert';
import { getCore, Job, Task } from 'cvat-core-wrapper';
import { NormalizedRemoteResult, pollJobStatus, submitVideoJob } from './remote-client';

interface InteractorPluginTargetProps {
    jobInstance?: Job;
    frame?: number;
}

interface InteractorExtraProps {
    targetProps?: InteractorPluginTargetProps;
}

interface SAMRemotePluginConfig {
    endpoint?: string;
    callbackToken?: string;
    requireEndpoint?: boolean;
    requireCallbackToken?: boolean;
}

interface RemoteRunnerValues {
    endpoint: string;
    stride: number;
    nClusters: number;
    budget: number;
    includeFirst: boolean;
    video: string;
    callbackURL?: string;
    callbackToken?: string;
}

const DEFAULT_VALUES: RemoteRunnerValues = {
    endpoint: '/api/lambda/functions/sam-remote',
    stride: 5,
    nClusters: 20,
    budget: 8,
    includeFirst: true,
    video: '',
    callbackURL: '',
    callbackToken: '',
};

function getMissingConfigFields(config: SAMRemotePluginConfig): string[] {
    const missingFields: string[] = [];
    if (config.requireEndpoint && !config.endpoint?.trim()) {
        missingFields.push('endpoint');
    }

    if (config.requireCallbackToken && !config.callbackToken?.trim()) {
        missingFields.push('token');
    }

    return missingFields;
}

function validateEndpoint(_: unknown, value: string): Promise<void> {
    if (!value?.trim()) {
        return Promise.reject(new Error('Base URL is required'));
    }

    try {
        const parsedUrl = new URL(value, window.location.origin);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Only HTTP(S) URLs are supported');
        }
        return Promise.resolve();
    } catch {
        return Promise.reject(new Error('Enter a valid base URL or path'));
    }
}

function validateVideoReference(_: unknown, value: string): Promise<void> {
    const trimmedValue = value?.trim();
    if (!trimmedValue) {
        return Promise.reject(new Error('Video URL or data URI is required'));
    }

    if (trimmedValue.startsWith('data:')) {
        return Promise.resolve();
    }

    try {
        const parsedUrl = new URL(trimmedValue);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Only HTTP(S) URLs are supported');
        }
        return Promise.resolve();
    } catch {
        return Promise.reject(new Error('Enter a valid HTTP(S) URL or data URI'));
    }
}

function storageKey(jobInstance?: Job): string | null {
    if (!jobInstance) {
        return null;
    }

    return `sam-remote-runner:${jobInstance.taskId}:${jobInstance.id}`;
}

function loadLastValues(key: string | null): RemoteRunnerValues {
    if (!key) {
        return DEFAULT_VALUES;
    }

    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return DEFAULT_VALUES;
        }

        const parsed = JSON.parse(raw) as Partial<RemoteRunnerValues>;
        return {
            endpoint: parsed.endpoint || DEFAULT_VALUES.endpoint,
            stride: Math.max(1, Number(parsed.stride) || DEFAULT_VALUES.stride),
            nClusters: Math.max(1, Number(parsed.nClusters) || DEFAULT_VALUES.nClusters),
            budget: Math.max(1, Number(parsed.budget) || DEFAULT_VALUES.budget),
            includeFirst: typeof parsed.includeFirst === 'boolean' ? parsed.includeFirst : DEFAULT_VALUES.includeFirst,
            video: typeof parsed.video === 'string' ? parsed.video : DEFAULT_VALUES.video,
            callbackURL: typeof parsed.callbackURL === 'string' ? parsed.callbackURL : '',
            callbackToken: typeof parsed.callbackToken === 'string' ? parsed.callbackToken : '',
        };
    } catch {
        return DEFAULT_VALUES;
    }
}

function saveLastValues(key: string | null, values: RemoteRunnerValues): void {
    if (!key) {
        return;
    }

    window.localStorage.setItem(key, JSON.stringify(values));
}

type UnknownRecord = Record<string, unknown>;

const SIGNED_VIDEO_KEYS = [
    'signedurl',
    'signed_url',
    'temporaryurl',
    'temporary_url',
    'presignedurl',
    'presigned_url',
];

const CANONICAL_VIDEO_KEYS = [
    'sourceurl',
    'source_url',
    'originalurl',
    'original_url',
    'remoteurl',
    'remote_url',
    'mediaurl',
    'media_url',
    'url',
    'video',
    'video_url',
];

function asRecord(value: unknown): UnknownRecord | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return value as UnknownRecord;
}

function normalizeCandidateURL(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsedURL = new URL(trimmed);
        return ['http:', 'https:'].includes(parsedURL.protocol) ? parsedURL.toString() : null;
    } catch {
        return null;
    }
}

function collectCandidateURLs(
    source: unknown,
    keys: string[],
    maxDepth = 2,
    currentDepth = 0,
    visited = new Set<unknown>(),
): string[] {
    const record = asRecord(source);
    if (!record || visited.has(record) || currentDepth > maxDepth) {
        return [];
    }

    visited.add(record);
    const normalizedKeys = new Set(keys.map((key: string): string => key.toLowerCase()));
    const results: string[] = [];

    Object.entries(record).forEach(([key, value]: [string, unknown]) => {
        const normalizedKey = key.toLowerCase();
        if (normalizedKeys.has(normalizedKey)) {
            const candidate = normalizeCandidateURL(value);
            if (candidate) {
                results.push(candidate);
            }
        }

        if (Array.isArray(value)) {
            value.forEach((item: unknown) => {
                results.push(...collectCandidateURLs(item, keys, maxDepth, currentDepth + 1, visited));
            });
        } else if (value && typeof value === 'object') {
            results.push(...collectCandidateURLs(value, keys, maxDepth, currentDepth + 1, visited));
        }
    });

    return results;
}

function pickFirstURL(source: unknown, keys: string[]): string | null {
    const [firstURL] = collectCandidateURLs(source, keys);
    return firstURL || null;
}

function resolveVideoReferenceFromContext(
    targetProps?: InteractorPluginTargetProps,
    jobInstance?: Job,
): string | null {
    const signedFromTargetProps = pickFirstURL(targetProps, SIGNED_VIDEO_KEYS);
    if (signedFromTargetProps) {
        return signedFromTargetProps;
    }

    const signedFromJob = pickFirstURL(jobInstance, SIGNED_VIDEO_KEYS);
    if (signedFromJob) {
        return signedFromJob;
    }

    const canonicalFromTargetProps = pickFirstURL(targetProps, CANONICAL_VIDEO_KEYS);
    if (canonicalFromTargetProps) {
        return canonicalFromTargetProps;
    }

    const canonicalFromJob = pickFirstURL(jobInstance, CANONICAL_VIDEO_KEYS);
    return canonicalFromJob || null;
}

async function resolveVideoReferenceViaCoreAPI(
    targetProps?: InteractorPluginTargetProps,
    jobInstance?: Job,
): Promise<string | null> {
    const core = getCore();

    const jobID = jobInstance?.id;
    const taskID = jobInstance?.taskId;

    const initialContextURL = resolveVideoReferenceFromContext(targetProps, jobInstance);
    if (initialContextURL) {
        return initialContextURL;
    }

    let resolvedJob: Job | null = null;
    if (typeof jobID === 'number' && Number.isFinite(jobID)) {
        try {
            [resolvedJob] = await core.jobs.get({ jobID });
            const resolvedJobURL = resolveVideoReferenceFromContext(targetProps, resolvedJob);
            if (resolvedJobURL) {
                return resolvedJobURL;
            }
        } catch {
            // Keep manual input fallback when lookup is unavailable.
        }
    }

    if (typeof taskID === 'number' && Number.isFinite(taskID)) {
        try {
            const [taskInstance] = await core.tasks.get({ id: taskID }) as Task[];
            const resolvedTaskURL = pickFirstURL(taskInstance, SIGNED_VIDEO_KEYS) ||
                pickFirstURL(taskInstance, CANONICAL_VIDEO_KEYS);
            if (resolvedTaskURL) {
                return resolvedTaskURL;
            }
        } catch {
            // Keep manual input fallback when lookup is unavailable.
        }
    }

    return null;
}

export default function SAMRemoteRunner(
    { targetProps = {}, onChangeFrame, pluginConfig = {} }: InteractorExtraProps & {
        onChangeFrame: (frame: number) => void;
        pluginConfig?: SAMRemotePluginConfig;
    },
): JSX.Element {
    const { jobInstance, frame } = targetProps;
    const [form] = Form.useForm<RemoteRunnerValues>();
    const [loading, setLoading] = useState(false);
    const [defaultVideoReference, setDefaultVideoReference] = useState<string | null>(null);
    const [remoteResult, setRemoteResult] = useState<NormalizedRemoteResult | null>(null);
    const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const runnerStorageKey = useMemo(() => storageKey(jobInstance), [jobInstance?.id, jobInstance?.taskId]);

    const missingConfigFields = useMemo(() => getMissingConfigFields(pluginConfig), [pluginConfig]);
    const hasRequiredConfig = missingConfigFields.length === 0;

    useEffect(() => {
        const lastValues = loadLastValues(runnerStorageKey);
        const isVideoDirty = form.isFieldTouched('video');
        const currentVideoValue = form.getFieldValue('video');
        const currentVideo = typeof currentVideoValue === 'string' ? currentVideoValue.trim() : '';
        const storedVideo = lastValues.video?.trim() || '';
        const resolvedCurrentVideoURL = defaultVideoReference?.trim() || '';

        let videoValue = currentVideo;
        if (!isVideoDirty) {
            videoValue = storedVideo || resolvedCurrentVideoURL || '';

            // If auto-resolved video differs from locally stored data, keep the
            // stored/manual override unless the field is still pristine and empty.
            if (
                resolvedCurrentVideoURL &&
                storedVideo &&
                resolvedCurrentVideoURL !== storedVideo &&
                currentVideo
            ) {
                videoValue = currentVideo;
            }
        }

        form.setFieldsValue({
            ...lastValues,
            endpoint: pluginConfig.endpoint?.trim() || lastValues.endpoint,
            callbackToken: pluginConfig.callbackToken?.trim() || lastValues.callbackToken,
            video: videoValue,
        });
    }, [form, runnerStorageKey, pluginConfig.endpoint, pluginConfig.callbackToken, defaultVideoReference]);

    useEffect(() => {
        let isMounted = true;
        resolveVideoReferenceViaCoreAPI(targetProps, jobInstance)
            .then((resolvedURL: string | null) => {
                if (!isMounted) {
                    return;
                }
                setDefaultVideoReference(resolvedURL);
            })
            .catch(() => {
                if (!isMounted) {
                    return;
                }
                setDefaultVideoReference(null);
            });

        return (): void => {
            isMounted = false;
        };
    }, [targetProps, jobInstance?.id, jobInstance?.taskId]);

    useEffect(() => (): void => {
        abortControllerRef.current?.abort();
    }, []);

    const cancelRequest = (): void => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setLoading(false);
    };

    const frameBounds = useMemo(() => {
        if (!jobInstance) {
            return null;
        }

        return {
            start: jobInstance.startFrame,
            stop: jobInstance.stopFrame,
            count: jobInstance.stopFrame - jobInstance.startFrame + 1,
        };
    }, [jobInstance?.id, jobInstance?.startFrame, jobInstance?.stopFrame]);

    const filteredSelectedIndices = useMemo((): number[] => {
        if (!remoteResult?.selected_indices || !frameBounds) {
            return [];
        }

        return remoteResult.selected_indices.filter(
            (index: number): boolean => (
                Number.isInteger(index) &&
                index >= frameBounds.start &&
                index <= frameBounds.stop
            ),
        );
    }, [remoteResult?.selected_indices, frameBounds]);

    const hasNextSelectedFrame = useMemo((): boolean => {
        if (typeof frame !== 'number') {
            return false;
        }

        return filteredSelectedIndices.some((index: number): boolean => index > frame);
    }, [filteredSelectedIndices, frame]);

    const hasPreviousSelectedFrame = useMemo((): boolean => {
        if (typeof frame !== 'number') {
            return false;
        }

        return filteredSelectedIndices.some((index: number): boolean => index < frame);
    }, [filteredSelectedIndices, frame]);

    const navigateToIndex = (index: number): void => {
        onChangeFrame(index);
        setSelectedFrame(index);
    };

    const navigateToNextSelected = (): void => {
        if (typeof frame !== 'number') {
            return;
        }

        const nextFrame = filteredSelectedIndices.find((index: number): boolean => index > frame);
        if (typeof nextFrame === 'number') {
            navigateToIndex(nextFrame);
            return;
        }

        message.info('No next selected frame in range.');
    };

    const navigateToPreviousSelected = (): void => {
        if (typeof frame !== 'number') {
            return;
        }

        const previousFrame = [...filteredSelectedIndices]
            .reverse()
            .find((index: number): boolean => index < frame);

        if (typeof previousFrame === 'number') {
            navigateToIndex(previousFrame);
            return;
        }

        message.info('No previous selected frame in range.');
    };

    return (
        <Form
            form={form}
            layout='vertical'
            size='small'
            initialValues={DEFAULT_VALUES}
            onFinish={async (values) => {
                if (!jobInstance || typeof frame !== 'number') {
                    notification.warning({
                        message: 'Cannot process video',
                        description: 'Task/job context is unavailable on the current page.',
                    });
                    return;
                }
                if (!hasRequiredConfig) {
                    notification.warning({
                        message: 'SAM Remote plugin is not configured',
                        description: `Missing required plugin configuration: ${missingConfigFields.join(', ')}.`,
                    });
                    return;
                }
                const videoReference = values.video?.trim();
                if (!videoReference) {
                    notification.warning({
                        message: 'Cannot process video',
                        description: 'Provide a video URL or data URI before submitting.',
                    });
                    return;
                }

                abortControllerRef.current?.abort();
                const abortController = new AbortController();
                abortControllerRef.current = abortController;
                setRemoteResult(null);
                setSelectedFrame(null);

                setLoading(true);
                const hideMessage = message.loading('Sending video processing request...', 0);
                try {
                    const submitResult = await submitVideoJob({
                        endpoint: values.endpoint,
                        signal: abortController.signal,
                        callbackURL: values.callbackURL?.trim() || undefined,
                        callbackToken: values.callbackToken?.trim() || undefined,
                        params: {
                            task: jobInstance.taskId,
                            job: jobInstance.id,
                            frame,
                            mode: jobInstance.mode,
                            video: videoReference,
                            stride: values.stride,
                            n_clusters: values.nClusters,
                            budget: values.budget,
                            include_first: values.includeFirst,
                            source_reference: {
                                task: jobInstance.taskId,
                                job: jobInstance.id,
                            },
                        },
                    });

                    const result = await pollJobStatus({
                        endpoint: values.endpoint,
                        statusURL: submitResult.statusURL,
                        resultURL: submitResult.resultURL,
                        callbackToken: values.callbackToken?.trim() || undefined,
                        signal: abortController.signal,
                    });

                    if (result.state === 'success') {
                        saveLastValues(runnerStorageKey, {
                            ...values,
                            video: videoReference,
                        });
                        setRemoteResult(result);
                        const safeSelectedIndices = (result.selected_indices || []).filter((index: number): boolean => {
                            if (!frameBounds) {
                                return false;
                            }
                            return Number.isInteger(index) && index >= frameBounds.start && index <= frameBounds.stop;
                        });

                        if (safeSelectedIndices.length) {
                            setSelectedFrame(safeSelectedIndices[0]);
                        }

                        if (result.n_total_frames && frameBounds && result.n_total_frames !== frameBounds.count) {
                            notification.warning({
                                message: 'Frame count mismatch',
                                description: `Remote n_total_frames=${result.n_total_frames} differs from ` +
                                    `current CVAT media frame count=${frameBounds.count}.`,
                            });
                        }

                        const outOfRangeSelectedCount = (
                            result.selected_indices || []
                        ).length - safeSelectedIndices.length;
                        const outOfRangeCandidateCount = (result.candidate_indices || []).filter(
                            (index: number): boolean => !frameBounds ||
                                !Number.isInteger(index) ||
                                index < frameBounds.start ||
                                index > frameBounds.stop,
                        ).length;

                        if (outOfRangeSelectedCount > 0 || outOfRangeCandidateCount > 0) {
                            notification.warning({
                                message: 'Remote indices outside current frame range',
                                description: `${[
                                    outOfRangeSelectedCount > 0 ? `${outOfRangeSelectedCount} selected indices` : '',
                                    outOfRangeCandidateCount > 0 ? `${outOfRangeCandidateCount} candidate indices` : '',
                                ]
                                    .filter((item: string): boolean => Boolean(item))
                                    .join(' and ')} are outside ${frameBounds?.start}-${frameBounds?.stop}.`,
                            });
                        }

                        message.success('Video processing request completed successfully');
                    } else if (result.state === 'canceled') {
                        notification.warning({
                            message: 'Remote SAM request canceled',
                            description: 'The remote job was canceled before completion.',
                        });
                    } else {
                        throw new Error(result.error || 'Remote SAM job failed');
                    }
                } catch (error: unknown) {
                    const isAbort = error instanceof DOMException && error.name === 'AbortError';
                    if (isAbort) {
                        message.info('Video processing request canceled');
                    } else {
                        const description = error instanceof Error ? error.message : 'Could not process remote SAM request';
                        notification.error({
                            message: 'Failed to process video',
                            description,
                        });
                    }
                } finally {
                    if (abortControllerRef.current === abortController) {
                        abortControllerRef.current = null;
                    }
                    hideMessage();
                    setLoading(false);
                }
            }}
        >
            {!hasRequiredConfig && (
                <Alert
                    style={{ marginBottom: 12 }}
                    type='warning'
                    showIcon
                    message='SAM Remote plugin is not configured'
                    description={`Missing required plugin configuration: ${missingConfigFields.join(', ')}.`}
                />
            )}
            <Form.Item
                label='Base URL / predict URL'
                name='endpoint'
                style={{ marginBottom: 8 }}
                rules={[{ validator: validateEndpoint }]}
            >
                <Input placeholder='https://server.example/predict or /api/lambda/functions/sam-remote' />
            </Form.Item>
            <Form.Item
                label='stride'
                name='stride'
                style={{ marginBottom: 8 }}
                rules={[
                    {
                        required: true,
                        type: 'number',
                        min: 1,
                        message: 'Stride must be >= 1',
                    },
                ]}
            >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
                label='n_clusters'
                name='nClusters'
                style={{ marginBottom: 8 }}
                rules={[
                    {
                        required: true,
                        type: 'number',
                        min: 1,
                        message: 'n_clusters must be >= 1',
                    },
                ]}
            >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
                label='budget'
                name='budget'
                style={{ marginBottom: 8 }}
                rules={[
                    {
                        required: true,
                        type: 'number',
                        min: 1,
                        message: 'Budget must be >= 1',
                    },
                ]}
            >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
                label='include_first'
                name='includeFirst'
                valuePropName='checked'
                style={{ marginBottom: 8 }}
            >
                <Switch />
            </Form.Item>
            <Form.Item
                label='callback_url (optional)'
                name='callbackURL'
                style={{ marginBottom: 8 }}
            >
                <Input placeholder='https://backend.example/sam-callback' allowClear />
            </Form.Item>
            <Form.Item
                label='video URL or data URI'
                name='video'
                style={{ marginBottom: 8 }}
                rules={[{ validator: validateVideoReference }]}
            >
                <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    placeholder='https://storage.example/video.mp4 or data:video/mp4;base64,...'
                />
            </Form.Item>
            <Form.Item
                label='callback_token (optional)'
                name='callbackToken'
                style={{ marginBottom: 12 }}
            >
                <Input placeholder='token to resume webhook result retrieval' allowClear />
            </Form.Item>

            <Space.Compact block>
                <Button type='primary' htmlType='submit' loading={loading} disabled={loading} style={{ width: '100%' }}>
                    Process video
                </Button>
                <Button danger onClick={cancelRequest} disabled={!loading}>
                    Cancel
                </Button>
            </Space.Compact>

            {!!remoteResult && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                        <strong>Remote result summary</strong>
                        <div>
selected_indices:
                            {remoteResult.selected_indices?.length || 0}
                        </div>
                        <div>
candidate_indices:
                            {remoteResult.candidate_indices?.length || 0}
                        </div>
                        <div>
n_total_frames:
                            {remoteResult.n_total_frames ?? 'N/A'}
                        </div>
                    </div>
                    <Space.Compact block style={{ marginBottom: 8 }}>
                        <Button
                            onClick={navigateToPreviousSelected}
                            disabled={!filteredSelectedIndices.length || !hasPreviousSelectedFrame}
                        >
                            Go to previous selected frame
                        </Button>
                        <Button
                            onClick={navigateToNextSelected}
                            disabled={!filteredSelectedIndices.length || !hasNextSelectedFrame}
                        >
                            Go to next selected frame
                        </Button>
                    </Space.Compact>
                    <Select<number>
                        placeholder='Jump to selected frame list'
                        style={{ width: '100%', marginBottom: 8 }}
                        value={selectedFrame ?? undefined}
                        onChange={(value: number): void => navigateToIndex(value)}
                        options={filteredSelectedIndices.map((index: number) => ({
                            value: index,
                            label: `Frame ${index}`,
                        }))}
                    />
                    <div style={{
                        maxHeight: 160, overflowY: 'auto', border: '1px solid #f0f0f0', padding: 8,
                    }}
                    >
                        {filteredSelectedIndices.map((index: number) => (
                            <Button
                                key={`selected-frame-${index}`}
                                size='small'
                                style={{ margin: '0 8px 8px 0' }}
                                onClick={(): void => navigateToIndex(index)}
                            >
                                {index}
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </Form>
    );
}

export type { InteractorExtraProps, InteractorPluginTargetProps };
