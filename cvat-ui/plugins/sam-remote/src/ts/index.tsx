// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useMemo, useState } from 'react';
import Button from 'antd/lib/button';
import Form from 'antd/lib/form';
import Input from 'antd/lib/input';
import message from 'antd/lib/message';
import { CVATCore, Job } from 'cvat-core-wrapper';
import { PluginEntryPoint, ComponentBuilder } from 'components/plugins-entrypoint';
import { getCVATStore } from 'cvat-store';

const SAM_REMOTE_PLUGIN_NAME = 'Segment Anything Remote';
const AI_TOOLS_INTERACTOR_EXTRAS_PATH = 'aiTools.interactors.extras';

interface InteractorPluginTargetProps {
    jobInstance?: Job;
    frame?: number;
}

interface InteractorExtraProps {
    targetProps?: InteractorPluginTargetProps;
}

function shouldRenderOnVideoAnnotationPage(targetProps: object = {}): boolean {
    const { jobInstance, frame } = targetProps as InteractorPluginTargetProps;
    return Boolean(jobInstance && jobInstance.mode === 'interpolation' && typeof frame === 'number');
}

function makeSAMRemoteExtra(
    core: CVATCore,
    store: ReturnType<typeof getCVATStore>,
): React.FC<InteractorExtraProps> {
    function SAMRemoteExtra({ targetProps = {} }: InteractorExtraProps): JSX.Element {
        const { jobInstance, frame } = targetProps;
        const [endpoint, setEndpoint] = useState('/api/lambda/functions/sam-remote');
        const [prompt, setPrompt] = useState('');
        const [loading, setLoading] = useState(false);

        const pluginCount = useMemo(() => {
            const state = store.getState() as { plugins?: { current?: Record<string, unknown> } };
            return Object.keys(state.plugins?.current || {}).length;
        }, [store]);

        return (
            <Form
                layout='vertical'
                size='small'
                onFinish={async () => {
                    if (!jobInstance || typeof frame !== 'number') {
                        return;
                    }

                    setLoading(true);
                    try {
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                task: jobInstance.taskId,
                                job: jobInstance.id,
                                frame,
                                prompt,
                                mode: jobInstance.mode,
                                plugin: SAM_REMOTE_PLUGIN_NAME,
                                pluginCount,
                                coreReady: Boolean(core),
                            }),
                        });

                        if (!response.ok) {
                            throw new Error(`Request failed with status ${response.status}`);
                        }

                        message.success('Remote SAM request sent successfully');
                    } catch (error: any) {
                        message.error(error?.message || 'Could not send remote SAM request');
                    } finally {
                        setLoading(false);
                    }
                }}
            >
                <Form.Item label='Remote endpoint' style={{ marginBottom: 8 }}>
                    <Input
                        value={endpoint}
                        onChange={(event) => setEndpoint(event.target.value)}
                        placeholder='https://server.example/sam-remote'
                    />
                </Form.Item>
                <Form.Item label='Prompt / payload hint' style={{ marginBottom: 8 }}>
                    <Input
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder='Optional user hint for the remote SAM service'
                    />
                </Form.Item>
                <Button type='primary' htmlType='submit' loading={loading} block>
                    Run Remote SAM
                </Button>
            </Form>
        );
    }

    return SAMRemoteExtra;
}

const builder: ComponentBuilder = ({ dispatch, actionCreators, store, core }) => {
    const remoteSAMExtra = makeSAMRemoteExtra(core, store);

    dispatch(actionCreators.addUIComponent(AI_TOOLS_INTERACTOR_EXTRAS_PATH, remoteSAMExtra, {
        shouldBeRendered: shouldRenderOnVideoAnnotationPage,
        weight: 120,
    }));

    return {
        name: SAM_REMOTE_PLUGIN_NAME,
        destructor: () => {
            dispatch(actionCreators.removeUIComponent(AI_TOOLS_INTERACTOR_EXTRAS_PATH, remoteSAMExtra));
        },
    };
};

function register(): void {
    if (Object.prototype.hasOwnProperty.call(window, 'cvatUI')) {
        (window as any as { cvatUI: { registerComponent: PluginEntryPoint } })
            .cvatUI.registerComponent(builder);
    }
}

window.addEventListener('plugins.ready', register, { once: true });
