// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import Button from 'antd/lib/button';
import Form from 'antd/lib/form';
import Input from 'antd/lib/input';
import InputNumber from 'antd/lib/input-number';
import Switch from 'antd/lib/switch';
import message from 'antd/lib/message';
import notification from 'antd/lib/notification';
import { CVATCore, Job } from 'cvat-core-wrapper';
import { getCVATStore } from 'cvat-store';

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
}

const DEFAULT_VALUES: RemoteRunnerValues = {
    endpoint: '/api/lambda/functions/sam-remote',
    stride: 5,
    nClusters: 20,
    budget: 8,
    includeFirst: true,
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

    const runnerStorageKey = useMemo(() => storageKey(jobInstance), [jobInstance?.id, jobInstance?.taskId]);

    const pluginCount = useMemo(() => {
        const state = store.getState() as { plugins?: { current?: Record<string, unknown> } };
        return Object.keys(state.plugins?.current || {}).length;
    }, [store]);

    useEffect(() => {
        form.setFieldsValue(loadLastValues(runnerStorageKey));
    }, [form, runnerStorageKey]);

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

                setLoading(true);
                const hideMessage = message.loading('Sending video processing request...', 0);
                try {
                    const response = await fetch(values.endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
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
                        }),
                    });

                    if (!response.ok) {
                        throw new Error(`Request failed with status ${response.status}`);
                    }

                    saveLastValues(runnerStorageKey, values);
                    message.success('Video processing request has been started');
                } catch (error: any) {
                    notification.error({
                        message: 'Failed to process video',
                        description: error?.message || 'Could not send remote SAM request',
                    });
                } finally {
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
                style={{ marginBottom: 12 }}
            >
                <Switch />
            </Form.Item>
            <Button type='primary' htmlType='submit' loading={loading} disabled={loading} block>
                Process video
            </Button>
        </Form>
    );
}

export type { InteractorExtraProps, InteractorPluginTargetProps };
