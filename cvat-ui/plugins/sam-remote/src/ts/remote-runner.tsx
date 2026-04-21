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
import Tabs from 'antd/lib/tabs';
import message from 'antd/lib/message';
import notification from 'antd/lib/notification';
import Alert from 'antd/lib/alert';
import { Job } from 'cvat-core-wrapper';
import {
    mintVideoAccess,
    NormalizedRemoteResult,
    pollVideoPredictionStatus,
    RemoteRequestError,
    submitVideoPrediction,
} from './remote-client';
import { adaptKeyframesPayload } from './keyframe-adapter';
import SAMRemoteObservabilityTab from './remote-observability-tab';

interface InteractorPluginTargetProps {
    jobInstance?: Job;
    frame?: number;
}

interface InteractorExtraProps {
    targetProps?: InteractorPluginTargetProps;
}

interface SAMRemotePluginConfig {
    remoteURL?: string;
    endpoint?: string; // deprecated alias of remoteURL
    requireRemoteURL?: boolean;
    requireEndpoint?: boolean; // deprecated alias of requireRemoteURL
}

interface RemoteRunnerValues {
    remoteURL: string;
    stride: number;
    nClusters: number;
    budget: number;
    includeFirst: boolean;
}

const DEFAULT_VALUES: RemoteRunnerValues = {
    remoteURL: '/api/lambda/functions/sam-remote',
    stride: 5,
    nClusters: 20,
    budget: 8,
    includeFirst: true,
};

function getMissingConfigFields(config: SAMRemotePluginConfig): string[] {
    const missingFields: string[] = [];
    const requireRemoteURL = config.requireRemoteURL ?? config.requireEndpoint;
    const configuredRemoteURL = config.remoteURL?.trim() || config.endpoint?.trim();
    if (requireRemoteURL && !configuredRemoteURL) {
        missingFields.push('remoteURL');
    }

    return missingFields;
}

function validateRemoteURL(_: unknown, value: string): Promise<void> {
    if (!value?.trim()) {
        return Promise.reject(new Error('Remote prediction URL is required'));
    }

    try {
        const parsedUrl = new URL(value, window.location.origin);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Only HTTP(S) URLs are supported');
        }
        return Promise.resolve();
    } catch {
        return Promise.reject(new Error('Enter a valid remote prediction URL or path'));
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

        const parsed = JSON.parse(raw) as Partial<RemoteRunnerValues> & { endpoint?: string };
        return {
            remoteURL: parsed.remoteURL || parsed.endpoint || DEFAULT_VALUES.remoteURL,
            stride: Math.max(1, Number(parsed.stride) || DEFAULT_VALUES.stride),
            nClusters: Math.max(1, Number(parsed.nClusters) || DEFAULT_VALUES.nClusters),
            budget: Math.max(1, Number(parsed.budget) || DEFAULT_VALUES.budget),
            includeFirst: typeof parsed.includeFirst === 'boolean' ? parsed.includeFirst : DEFAULT_VALUES.includeFirst,
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

function mapHttpError(stage: 'submit' | 'status' | 'access', status: number): string | null {
    if (stage === 'submit' && status === 400) {
        return 'Unable to submit remote job: request payload is invalid (HTTP 400).';
    }
    if (stage === 'submit' && status === 502) {
        return 'Unable to submit remote job: remote service is unavailable (HTTP 502).';
    }
    if (stage === 'status' && status === 400) {
        return 'Unable to read remote job status: invalid request identifier (HTTP 400).';
    }
    if (stage === 'status' && status === 403) {
        return 'Unable to read remote job status: access denied (HTTP 403).';
    }
    if (stage === 'access' && status === 400) {
        return 'Unable to mint video access URL: request is invalid (HTTP 400).';
    }
    if (stage === 'access' && status === 422) {
        return 'Unable to mint video access URL: server could not process this job request (HTTP 422).';
    }

    return null;
}

function summarizeWebhookPayload(payload: unknown): string | null {
    if (payload === undefined || payload === null) {
        return null;
    }

    try {
        const text = JSON.stringify(payload);
        if (!text) {
            return null;
        }

        return text.length > 240 ? `${text.slice(0, 240)}...` : text;
    } catch {
        return null;
    }
}

function requestIdDetails(requestId?: string): string {
    return requestId?.trim() ? `Request ID: ${requestId.trim()}` : 'Request ID: unavailable';
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
    const [activeTab, setActiveTab] = useState<'prediction' | 'observability'>('prediction');
    const abortControllerRef = useRef<AbortController | null>(null);

    const runnerStorageKey = useMemo(() => storageKey(jobInstance), [jobInstance?.id, jobInstance?.taskId]);

    const missingConfigFields = useMemo(() => getMissingConfigFields(pluginConfig), [pluginConfig]);
    const hasRequiredConfig = missingConfigFields.length === 0;

    useEffect(() => {
        const lastValues = loadLastValues(runnerStorageKey);

        form.setFieldsValue({
            ...lastValues,
            remoteURL: pluginConfig.remoteURL?.trim() || pluginConfig.endpoint?.trim() || lastValues.remoteURL,
        });
    }, [form, runnerStorageKey, pluginConfig.remoteURL, pluginConfig.endpoint]);

    useEffect(() => (): void => {
        abortControllerRef.current?.abort();
    }, []);

    const cancelRequest = (): void => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setLoading(false);
        message.info('Stopped UI polling. Remote processing may still continue on the backend.');
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

    const selectedIndicesCSV = useMemo((): string => (
        (remoteResult?.selected_indices || []).join(',')
    ), [remoteResult?.selected_indices]);

    const candidateIndicesCSV = useMemo((): string => (
        (remoteResult?.candidate_indices || []).join(',')
    ), [remoteResult?.candidate_indices]);

    const copyIndicesCSV = async (value: string, label: string): Promise<void> => {
        if (!value) {
            message.info(`${label}: no indices returned.`);
            return;
        }

        try {
            await navigator.clipboard.writeText(value);
            message.success(`${label} copied to clipboard`);
        } catch {
            message.error(`Failed to copy ${label}`);
        }
    };

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
                    const submitResult = await submitVideoPrediction(jobInstance.id, {
                        remote_url: values.remoteURL,
                        input: {
                            stride: values.stride,
                            n_clusters: values.nClusters,
                            budget: values.budget,
                            include_first: values.includeFirst,
                            video: access.download_url,
                        },
                    });

                    // Intentionally omit maxTimeoutMs: UI polling is unbounded unless user cancels.
                    const result = await pollVideoPredictionStatus(jobInstance.id, submitResult.request_id, {
                        signal: abortController.signal,
                    });

                    if (result.state === 'completed') {
                        saveLastValues(runnerStorageKey, {
                            ...values,
                        });
                        const adaptedKeyframes = adaptKeyframesPayload(result.keyframes, accessBounds);
                        const extractedFrameIndices = Array.from(new Set([
                            ...adaptedKeyframes.selected_indices,
                            ...(result.selected_indices || []),
                        ])).sort((left: number, right: number): number => left - right);
                        const safeSelectedIndices = extractedFrameIndices.filter((index: number): boolean => (
                            Number.isInteger(index) &&
                            index >= accessBounds.start &&
                            index <= accessBounds.stop
                        ));
                        setRemoteResult({
                            ...result,
                            selected_indices: extractedFrameIndices,
                            candidate_indices: adaptedKeyframes.candidate_indices || result.candidate_indices,
                        });

                        if (adaptedKeyframes.diagnostics.length > 0) {
                            notification.warning({
                                message: 'Keyframe payload requires attention',
                                description: adaptedKeyframes.diagnostics
                                    .map((diagnostic): string => `${diagnostic.path}: ${diagnostic.message}`)
                                    .join(' '),
                            });
                        }

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

                        const outOfRangeSelectedCount = extractedFrameIndices
                            .filter((index: number): boolean => (
                                !Number.isInteger(index) ||
                                index < accessBounds.start ||
                                index > accessBounds.stop
                            ))
                            .length;

                        if (outOfRangeSelectedCount > 0) {
                            notification.warning({
                                message: 'Remote indices outside current frame range',
                                description: `${outOfRangeSelectedCount} selected indices are outside ` +
                                    `${accessBounds.start}-${accessBounds.stop}.`,
                            });
                        }

                        message.success('Video processing request completed successfully');
                        notification.success({
                            message: 'Remote job completed',
                            description: requestIdDetails(result.request_id || submitResult.request_id),
                        });
                    } else if (result.state === 'failed') {
                        const statusMessage = result.http_status ?
                            mapHttpError('status', result.http_status) : null;
                        const webhookSummary = summarizeWebhookPayload(result.webhook_payload);
                        const details = [
                            statusMessage || result.error || 'Remote SAM job failed.',
                            webhookSummary ? `Webhook payload: ${webhookSummary}` : null,
                            requestIdDetails(result.request_id || submitResult.request_id),
                        ].filter(Boolean).join('\n');

                        notification.error({
                            message: 'Remote job failed',
                            description: details,
                        });
                    } else if (result.state === 'expired') {
                        const details = [
                            result.error || 'Remote job expired before completion.',
                            'Please resubmit the job to start a new remote run.',
                            requestIdDetails(result.request_id || submitResult.request_id),
                        ].join('\n');

                        notification.warning({
                            message: 'Remote job expired',
                            description: details,
                        });
                    }
                } catch (error: unknown) {
                    const isAbort = error instanceof DOMException && error.name === 'AbortError';
                    if (isAbort) {
                        // User-facing cancellation message is handled in cancelRequest().
                    } else if (error instanceof RemoteRequestError) {
                        const statusMessage = mapHttpError(error.stage, error.status);
                        const details = [
                            statusMessage || error.detail || error.message,
                            requestIdDetails(error.requestId),
                        ].filter(Boolean).join('\n');
                        notification.error({
                            message: `Failed to ${error.stage === 'access' ? 'mint video access' : 'submit remote job'}`,
                            description: details,
                        });
                    } else {
                        const description = error instanceof Error ? error.message : 'Could not process remote SAM request';
                        notification.error({
                            message: 'Failed to process video',
                            description: `${description}\n${requestIdDetails()}`,
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
            <Tabs
                activeKey={activeTab}
                onChange={(activeKey: string): void => setActiveTab(activeKey as 'prediction' | 'observability')}
                destroyInactiveTabPane={false}
                items={[
                    {
                        key: 'prediction',
                        label: 'Prediction',
                        children: (
                            <>
                                <Form.Item
                                    label='Remote prediction URL'
                                    name='remoteURL'
                                    style={{ marginBottom: 8 }}
                                    extra='CVAT sends the request to this URL and handles callback/webhook updates for the job.'
                                    rules={[{ validator: validateRemoteURL }]}
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
                                        <Form.Item label='selected_indices (CSV)' style={{ marginBottom: 8 }}>
                                            <Input.TextArea
                                                readOnly
                                                allowClear
                                                autoSize={{ minRows: 2, maxRows: 4 }}
                                                value={selectedIndicesCSV}
                                            />
                                            <Space style={{ marginTop: 4 }}>
                                                <Button
                                                    size='small'
                                                    onClick={(): void => {
                                                        copyIndicesCSV(selectedIndicesCSV, 'selected_indices').catch(() => {
                                                            // Error handling is already managed in copyIndicesCSV.
                                                        });
                                                    }}
                                                >
                                                    Copy
                                                </Button>
                                                {!selectedIndicesCSV && (
                                                    <span style={{ color: 'rgba(0, 0, 0, 0.45)' }}>No indices returned</span>
                                                )}
                                            </Space>
                                        </Form.Item>
                                        <Form.Item label='candidate_indices (CSV)' style={{ marginBottom: 8 }}>
                                            <Input.TextArea
                                                readOnly
                                                allowClear
                                                autoSize={{ minRows: 2, maxRows: 4 }}
                                                value={candidateIndicesCSV}
                                            />
                                            <Space style={{ marginTop: 4 }}>
                                                <Button
                                                    size='small'
                                                    onClick={(): void => {
                                                        copyIndicesCSV(candidateIndicesCSV, 'candidate_indices').catch(() => {
                                                            // Error handling is already managed in copyIndicesCSV.
                                                        });
                                                    }}
                                                >
                                                    Copy
                                                </Button>
                                                {!candidateIndicesCSV && (
                                                    <span style={{ color: 'rgba(0, 0, 0, 0.45)' }}>No indices returned</span>
                                                )}
                                            </Space>
                                        </Form.Item>
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
                            </>
                        ),
                    },
                    {
                        key: 'observability',
                        label: 'Observability',
                        children: (
                            <SAMRemoteObservabilityTab
                                jobId={jobInstance?.id}
                                remoteResult={remoteResult}
                            />
                        ),
                    },
                ]}
            />
        </Form>
    );
}

export type { InteractorExtraProps, InteractorPluginTargetProps };
