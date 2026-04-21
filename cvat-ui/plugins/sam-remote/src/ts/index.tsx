// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import Button from 'antd/lib/button';
import Dropdown from 'antd/lib/dropdown';
import Alert from 'antd/lib/alert';
import { PluginEntryPoint, ComponentBuilder } from 'components/plugins-entrypoint';
import SAMRemoteRunner, { InteractorExtraProps, InteractorPluginTargetProps } from './remote-runner';

export type {
    PredictionDispatchHealth,
    PredictionDispatchPathway,
    PredictionDispatchStatus,
    JobPredictionRequest,
    JobPredictionRequestState,
} from './remote-client';

const SAM_REMOTE_PLUGIN_NAME = 'Segment Anything Remote';
const AI_TOOLS_INTERACTOR_EXTRAS_PATH = 'aiTools.interactors.extras';
const ANNOTATION_TOP_BAR_ACTIONS_PATH = 'annotationPage.topBar.actions.items';

interface SAMRemotePluginConfig {
    remoteURL?: string;
    endpoint?: string; // deprecated alias of remoteURL
    requireRemoteURL?: boolean;
    requireEndpoint?: boolean; // deprecated alias of requireRemoteURL
}

function resolveSAMRemotePluginConfig(): SAMRemotePluginConfig {
    const pluginConfig = (window as any as {
        CVAT_SAM_REMOTE_PLUGIN_CONFIG?: SAMRemotePluginConfig;
    }).CVAT_SAM_REMOTE_PLUGIN_CONFIG;

    if (pluginConfig && typeof pluginConfig === 'object') {
        return pluginConfig;
    }

    return {};
}

function shouldRenderOnVideoAnnotationPage(targetProps: object = {}): boolean {
    const { jobInstance, frame } = targetProps as InteractorPluginTargetProps;
    return Boolean(jobInstance && jobInstance.mode === 'interpolation' && typeof frame === 'number');
}

function makeSAMRemoteExtra(
    onChangeFrame: (frame: number) => void,
    pluginConfig: SAMRemotePluginConfig,
): React.FC<InteractorExtraProps> {
    return function SAMRemoteExtra({ targetProps = {} }: InteractorExtraProps): JSX.Element {
        return (
            <SAMRemoteRunner
                targetProps={targetProps}
                onChangeFrame={onChangeFrame}
                pluginConfig={pluginConfig}
            />
        );
    };
}

function makeSAMRemoteTopBarAction(
    onChangeFrame: (frame: number) => void,
    pluginConfig: SAMRemotePluginConfig,
): React.FC<InteractorExtraProps> {
    return function SAMRemoteTopBarAction({ targetProps = {} }: InteractorExtraProps): JSX.Element {
        const requireRemoteURL = pluginConfig.requireRemoteURL ?? pluginConfig.requireEndpoint;
        const resolvedRemoteURL = pluginConfig.remoteURL?.trim() || pluginConfig.endpoint?.trim();
        const hasMissingRequiredConfig = Boolean(requireRemoteURL && !resolvedRemoteURL);

        return (
            <Dropdown
                trigger={['click']}
                overlayClassName='cvat-sam-remote-top-bar-dropdown'
                dropdownRender={() => (
                    <div style={{
                        width: 360,
                        maxWidth: 'min(90vw, 360px)',
                        padding: 12,
                        background: '#fff',
                        boxShadow: '0 6px 16px rgba(0,0,0,0.2)',
                    }}
                    >
                        {hasMissingRequiredConfig && (
                            <Alert
                                type='warning'
                                showIcon
                                style={{ marginBottom: 12 }}
                                message='SAM Remote needs plugin configuration'
                                description='Set remoteURL in CVAT_SAM_REMOTE_PLUGIN_CONFIG to run remote sampling. CVAT will call the remote service and manage webhook updates.'
                            />
                        )}
                        <SAMRemoteRunner
                            targetProps={targetProps}
                            onChangeFrame={onChangeFrame}
                            pluginConfig={pluginConfig}
                        />
                    </div>
                )}
            >
                <Button
                    type='link'
                    className='cvat-annotation-header-button'
                    aria-label='SAM Remote: Get keyframes'
                    title='SAM Remote: Get keyframes from video'
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                    }}
                >
                    <span style={{ fontSize: '1.05em', lineHeight: 1 }} aria-hidden>
                        🎬
                    </span>
                    <span>Get KF</span>
                </Button>
            </Dropdown>
        );
    };
}

const builder: ComponentBuilder = ({
    dispatch,
    actionCreators,
}) => {
    const pluginConfig = resolveSAMRemotePluginConfig();
    const remoteSAMExtra = makeSAMRemoteExtra(
        (frame: number): void => {
            dispatch(actionCreators.changeFrameAsync(frame));
        },
        pluginConfig,
    );
    const remoteSAMTopBarAction = makeSAMRemoteTopBarAction(
        (frame: number): void => {
            dispatch(actionCreators.changeFrameAsync(frame));
        },
        pluginConfig,
    );

    dispatch(actionCreators.addUIComponent(AI_TOOLS_INTERACTOR_EXTRAS_PATH, remoteSAMExtra as any, {
        shouldBeRendered: shouldRenderOnVideoAnnotationPage,
        weight: 120,
    }));
    dispatch(actionCreators.addUIComponent(ANNOTATION_TOP_BAR_ACTIONS_PATH, remoteSAMTopBarAction as any, {
        shouldBeRendered: shouldRenderOnVideoAnnotationPage,
        weight: 125,
    }));

    return {
        name: SAM_REMOTE_PLUGIN_NAME,
        destructor: () => {
            dispatch(actionCreators.removeUIComponent(AI_TOOLS_INTERACTOR_EXTRAS_PATH, remoteSAMExtra as any));
            dispatch(actionCreators.removeUIComponent(ANNOTATION_TOP_BAR_ACTIONS_PATH, remoteSAMTopBarAction as any));
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
