// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { CVATCore } from 'cvat-core-wrapper';
import { getCVATStore } from 'cvat-store';
import { PluginEntryPoint, ComponentBuilder } from 'components/plugins-entrypoint';
import SAMRemoteRunner, { InteractorExtraProps, InteractorPluginTargetProps } from './remote-runner';

const SAM_REMOTE_PLUGIN_NAME = 'Segment Anything Remote';
const AI_TOOLS_INTERACTOR_EXTRAS_PATH = 'aiTools.interactors.extras';

function shouldRenderOnVideoAnnotationPage(targetProps: object = {}): boolean {
    const { jobInstance, frame } = targetProps as InteractorPluginTargetProps;
    return Boolean(jobInstance && jobInstance.mode === 'interpolation' && typeof frame === 'number');
}

function makeSAMRemoteExtra(
    core: CVATCore,
    store: ReturnType<typeof getCVATStore>,
): React.FC<InteractorExtraProps> {
    return function SAMRemoteExtra({ targetProps = {} }: InteractorExtraProps): JSX.Element {
        return <SAMRemoteRunner targetProps={targetProps} core={core} store={store} />;
    };
}

const builder: ComponentBuilder = ({
    dispatch,
    actionCreators,
    store,
    core,
}) => {
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
