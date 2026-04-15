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
import Switch from 'antd/lib/switch';
import Space from 'antd/lib/space';
import message from 'antd/lib/message';
import notification from 'antd/lib/notification';
import { CVATCore, Job } from 'cvat-core-wrapper';
import { getCVATStore } from 'cvat-store';
import { pollJobStatus, submitVideoJob } from './remote-client';

interface InteractorPluginTargetProps {
    jobInstance?: Job;
    frame?: number;
}

interface InteractorExtraProps {
    targetProps?: InteractorPluginTargetProps;
}

interface RemoteRunnerValues {
    endpoint: string;
    stride: number;
    nClusters: number;
    budget: number;
    includeFirst: boolean;
    callbackURL?: string;
    callbackToken?: string;
}

const DEFAULT_VALUES: RemoteRunnerValues = {
    endpoint: '/api/lambda/functions/sam-remote',
    stride: 5,
    nClusters: 20,
    budget: 8,
    includeFirst: true,
    callbackURL: '',
    callbackToken: '',
};

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

export default function SAMRemoteRunner(
    { targetProps = {}, core, store }: InteractorExtraProps & {
        core: CVATCore;
        store: ReturnType<typeof getCVATStore>;
    },
): JSX.Element {
    const { jobInstance, frame } = targetProps;
    const [form] = Form.useForm<RemoteRunnerValues>();
    const [loading, setLoading] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const runnerStorageKey = useMemo(() => storageKey(jobInstance), [jobInstance?.id, jobInstance?.taskId]);

    const pluginCount = useMemo(() => {
        const state = store.getState() as { plugins?: { current?: Record<string, unknown> } };
        return Object.keys(state.plugins?.current || {}).length;
    }, [store]);

    useEffect(() => {
        form.setFieldsValue(loadLastValues(runnerStorageKey));
    }, [form, runnerStorageKey]);

    useEffect(() => (): void => {
        abortControllerRef.current?.abort();
    }, []);

    const cancelRequest = (): void => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setLoading(false);
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

                abortControllerRef.current?.abort();
                const abortController = new AbortController();
                abortControllerRef.current = abortController;

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
                            stride: values.stride,
                            n_clusters: values.nClusters,
                            budget: values.budget,
                            include_first: values.includeFirst,
                            pluginCount,
                            coreReady: Boolean(core),
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
                        saveLastValues(runnerStorageKey, values);
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
        </Form>
    );
}

export type { InteractorExtraProps, InteractorPluginTargetProps };
