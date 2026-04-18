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
import Collapse from 'antd/lib/collapse';
import message from 'antd/lib/message';
import notification from 'antd/lib/notification';
import Alert from 'antd/lib/alert';
import { Job } from 'cvat-core-wrapper';
import {
    mintVideoAccess,
    NormalizedRemoteResult,
    pollVideoPredictionStatus,
    submitVideoPrediction,
} from './remote-client';

interface InteractorPluginTargetProps {
    jobInstance?: Job;
    frame?: number;
}

interface InteractorExtraProps {
    targetProps?: InteractorPluginTargetProps;
}

interface SAMRemotePluginConfig {
    endpoint?: string;
    requireEndpoint?: boolean;
}

interface RemoteRunnerValues {
    endpoint: string;
    stride: number;
    nClusters: number;
    budget: number;
    includeFirst: boolean;
    debugVideoURL?: string;
}

const DEFAULT_VALUES: RemoteRunnerValues = {
    endpoint: '/api/lambda/functions/sam-remote',
    stride: 5,
    nClusters: 20,
    budget: 8,
    includeFirst: true,
    debugVideoURL: '',
};

function getMissingConfigFields(config: SAMRemotePluginConfig): string[] {
    const missingFields: string[] = [];
    if (config.requireEndpoint && !config.endpoint?.trim()) {
        missingFields.push('endpoint');
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
        return Promise.resolve();
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
            debugVideoURL: typeof parsed.debugVideoURL === 'string' ? parsed.debugVideoURL : DEFAULT_VALUES.debugVideoURL,
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

export default function SAMRemoteRunner(
    { targetProps = {}, onChangeFrame, pluginConfig = {} }: InteractorExtraProps & {
        onChangeFrame: (frame: number) => void;
        pluginConfig?: SAMRemotePluginConfig;
    },
): JSX.Element {
    const { jobInstance, frame } = targetProps;
    const [form] = Form.useForm<RemoteRunnerValues>();
    const [loading, setLoading] = useState(false);
    const [validationBounds, setValidationBounds] = useState<{ start: number; stop: number } | null>(null);
    const [remoteResult, setRemoteResult] = useState<NormalizedRemoteResult | null>(null);
    const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const runnerStorageKey = useMemo(() => storageKey(jobInstance), [jobInstance?.id, jobInstance?.taskId]);

    const missingConfigFields = useMemo(() => getMissingConfigFields(pluginConfig), [pluginConfig]);
    const hasRequiredConfig = missingConfigFields.length === 0;

    useEffect(() => {
        const lastValues = loadLastValues(runnerStorageKey);

        form.setFieldsValue({
            ...lastValues,
            endpoint: pluginConfig.endpoint?.trim() || lastValues.endpoint,
        });
    }, [form, runnerStorageKey, pluginConfig.endpoint]);

    useEffect(() => (): void => {
        abortControllerRef.current?.abort();
    }, []);

    const cancelRequest = (): void => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setLoading(false);
    };

    const fallbackJobBounds = useMemo(() => {
        if (!jobInstance) {
            return null;
        }

        return {
            start: jobInstance.startFrame,
            stop: jobInstance.stopFrame,
        };
    }, [jobInstance?.id, jobInstance?.startFrame, jobInstance?.stopFrame]);

    const frameBounds = useMemo(() => {
        const preferredBounds = validationBounds || fallbackJobBounds;
        if (!preferredBounds) {
            return null;
        }

        return {
            ...preferredBounds,
            count: preferredBounds.stop - preferredBounds.start + 1,
        };
    }, [validationBounds, fallbackJobBounds]);

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
                abortControllerRef.current?.abort();
                const abortController = new AbortController();
                abortControllerRef.current = abortController;
                setRemoteResult(null);
                setSelectedFrame(null);

                setLoading(true);
                const hideMessage = message.loading('Sending video processing request...', 0);
                try {
                    const access = await mintVideoAccess(jobInstance.id);
                    const media = access.media || {};
                    const mediaStartFrame = Number((media as Record<string, unknown>).start_frame);
                    const mediaStopFrame = Number((media as Record<string, unknown>).stop_frame);
                    const accessBounds = Number.isInteger(mediaStartFrame) &&
                        Number.isInteger(mediaStopFrame) ? {
                            start: mediaStartFrame,
                            stop: mediaStopFrame,
                        } : {
                            start: jobInstance.startFrame,
                            stop: jobInstance.stopFrame,
                        };
                    setValidationBounds(accessBounds);
                    const sourceVideoURL = values.debugVideoURL?.trim() || access.download_url;

                    const submitResult = await submitVideoPrediction(jobInstance.id, {
                        remote_url: values.endpoint,
                        input: {
                            stride: values.stride,
                            n_clusters: values.nClusters,
                            budget: values.budget,
                            include_first: values.includeFirst,
                            video: sourceVideoURL,
                        },
                    }, abortController.signal);

                    const result = await pollVideoPredictionStatus(jobInstance.id, submitResult.request_id, {
                        signal: abortController.signal,
                    });

                    if (result.state === 'success') {
                        saveLastValues(runnerStorageKey, {
                            ...values,
                        });
                        setRemoteResult(result);
                        const safeSelectedIndices = (result.selected_indices || []).filter((index: number): boolean => (
                            Number.isInteger(index) &&
                            index >= accessBounds.start &&
                            index <= accessBounds.stop
                        ));

                        if (safeSelectedIndices.length) {
                            setSelectedFrame(safeSelectedIndices[0]);
                        }

                        if (
                            result.n_total_frames &&
                            accessBounds &&
                            result.n_total_frames !== (accessBounds.stop - accessBounds.start + 1)
                        ) {
                            notification.warning({
                                message: 'Frame count mismatch',
                                description: `Remote n_total_frames=${result.n_total_frames} differs from ` +
                                    `current frame count=${accessBounds.stop - accessBounds.start + 1}.`,
                            });
                        }

                        const outOfRangeSelectedCount = (
                            result.selected_indices || []
                        ).length - safeSelectedIndices.length;
                        const outOfRangeCandidateCount = (result.candidate_indices || [])
                            .filter((index: number): boolean => (
                                !Number.isInteger(index) ||
                                index < accessBounds.start ||
                                index > accessBounds.stop
                            ))
                            .length;

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
            <Collapse
                size='small'
                style={{ marginBottom: 12 }}
                items={[
                    {
                        key: 'advanced',
                        label: 'Advanced',
                        children: (
                            <Form.Item
                                label='Debug override: source video URL or data URI (optional)'
                                name='debugVideoURL'
                                style={{ marginBottom: 0 }}
                                rules={[{ validator: validateVideoReference }]}
                            >
                                <Input.TextArea
                                    autoSize={{ minRows: 2, maxRows: 6 }}
                                    placeholder='https://storage.example/video.mp4 or data:video/mp4;base64,...'
                                />
                            </Form.Item>
                        ),
                    },
                ]}
            />

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
