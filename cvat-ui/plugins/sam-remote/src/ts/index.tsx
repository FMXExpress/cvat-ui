// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import Button from 'antd/lib/button';
import Dropdown from 'antd/lib/dropdown';
import { CVATCore } from 'cvat-core-wrapper';
import { getCVATStore } from 'cvat-store';
import { PluginEntryPoint, ComponentBuilder } from 'components/plugins-entrypoint';
import SAMRemoteRunner, { InteractorExtraProps, InteractorPluginTargetProps } from './remote-runner';

const SAM_REMOTE_PLUGIN_NAME = 'Segment Anything Remote';
const AI_TOOLS_INTERACTOR_EXTRAS_PATH = 'aiTools.interactors.extras';
const ANNOTATION_TOP_BAR_ACTIONS_PATH = 'annotationPage.topBar.actions.items';

function shouldRenderOnVideoAnnotationPage(targetProps: object = {}): boolean {
    const { jobInstance, frame } = targetProps as InteractorPluginTargetProps;
    return Boolean(jobInstance && jobInstance.mode === 'interpolation' && typeof frame === 'number');
}

function makeSAMRemoteExtra(
    core: CVATCore,
    store: ReturnType<typeof getCVATStore>,
    onChangeFrame: (frame: number) => void,
): React.FC<InteractorExtraProps> {
    return function SAMRemoteExtra({ targetProps = {} }: InteractorExtraProps): JSX.Element {
        return <SAMRemoteRunner targetProps={targetProps} core={core} store={store} onChangeFrame={onChangeFrame} />;
    };
}

function shouldRenderInTopBar(store: ReturnType<typeof getCVATStore>, targetProps: object = {}): boolean {
    const pluginsState = store.getState().plugins;
    return !pluginsState.list.MODELS && shouldRenderOnVideoAnnotationPage(targetProps);
}

function makeSAMRemoteTopBarAction(
    core: CVATCore,
    store: ReturnType<typeof getCVATStore>,
    onChangeFrame: (frame: number) => void,
): React.FC<InteractorExtraProps> {
    return function SAMRemoteTopBarAction({ targetProps = {} }: InteractorExtraProps): JSX.Element {
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
                        <SAMRemoteRunner targetProps={targetProps} core={core} store={store} onChangeFrame={onChangeFrame} />
                    </div>
                )}
            >
                <Button type='link' className='cvat-annotation-header-button'>
                    SAM Remote
                </Button>
            </Dropdown>
        );
    };
}

const builder: ComponentBuilder = ({
    dispatch,
    actionCreators,
    store,
    core,
}) => {
    const remoteSAMExtra = makeSAMRemoteExtra(
        core,
        store,
        (frame: number): void => {
            dispatch(actionCreators.changeFrameAsync(frame));
        },
    );
    const remoteSAMTopBarAction = makeSAMRemoteTopBarAction(
        core,
        store,
        (frame: number): void => {
            dispatch(actionCreators.changeFrameAsync(frame));
        },
    );

    dispatch(actionCreators.addUIComponent(AI_TOOLS_INTERACTOR_EXTRAS_PATH, remoteSAMExtra as any, {
        shouldBeRendered: shouldRenderOnVideoAnnotationPage,
        weight: 120,
    }));
    dispatch(actionCreators.addUIComponent(ANNOTATION_TOP_BAR_ACTIONS_PATH, remoteSAMTopBarAction as any, {
        shouldBeRendered: (targetProps: object = {}) => shouldRenderInTopBar(store, targetProps),
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
