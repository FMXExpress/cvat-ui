// Copyright (C) 2024 CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Col, Row } from 'antd/lib/grid';
import Input from 'antd/lib/input';
import Button from 'antd/lib/button';
import Tag from 'antd/lib/tag';
import Select from 'antd/lib/select';
import Text from 'antd/lib/typography/Text';

import { CombinedState } from 'reducers';
import {
    addSelectedFrames as addSelectedFramesAction,
    clearSelectedFrames as clearSelectedFramesAction,
    removeSelectedFrame as removeSelectedFrameAction,
    rememberObject,
} from 'actions/annotation-actions';
import { clamp } from 'utils/math';
import { LabelType, ObjectType, ShapeType } from 'cvat-core-wrapper';

export default function SelectedFramesPanel(): JSX.Element {
    const dispatch = useDispatch();
    const [selectedFramesInput, setSelectedFramesInput] = useState<string>('');
    const {
        selectedFrames,
        labels,
        activeLabelID,
        activeShapeType,
        activeObjectType,
        startFrame,
        stopFrame,
    } = useSelector((state: CombinedState) => ({
        selectedFrames: state.annotation.player.selectedFrames,
        labels: state.annotation.job.labels,
        activeLabelID: state.annotation.drawing.activeLabelID,
        activeShapeType: state.annotation.drawing.activeShapeType,
        activeObjectType: state.annotation.drawing.activeObjectType,
        startFrame: state.annotation.job.instance?.startFrame ?? 0,
        stopFrame: state.annotation.job.instance?.stopFrame ?? 0,
    }));

    const addSelectedFrames = useCallback(() => {
        if (!selectedFramesInput.trim()) {
            return;
        }

        const parsedFrames = selectedFramesInput
            .split(/[,\s]+/)
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value))
            .map((value) => Math.floor(clamp(value, startFrame, stopFrame)));

        if (parsedFrames.length) {
            dispatch(addSelectedFramesAction(parsedFrames));
            setSelectedFramesInput('');
        }
    }, [selectedFramesInput, startFrame, stopFrame, dispatch]);

    const onTraceLabelChange = useCallback((labelID: number) => {
        const label = labels.find((_label) => _label.id === labelID);
        if (!label) {
            return;
        }

        if (label.type === LabelType.TAG) {
            dispatch(rememberObject({ activeLabelID: labelID, activeObjectType: ObjectType.TAG }, false));
        } else if (label.type === LabelType.MASK) {
            dispatch(rememberObject({
                activeLabelID: labelID,
                activeObjectType: ObjectType.SHAPE,
                activeShapeType: ShapeType.MASK,
            }, false));
        } else {
            dispatch(rememberObject({
                activeLabelID: labelID,
                activeObjectType: activeObjectType !== ObjectType.TAG ? activeObjectType : ObjectType.SHAPE,
                activeShapeType: label.type === LabelType.ANY && activeShapeType !== ShapeType.SKELETON ?
                    activeShapeType : label.type as unknown as ShapeType,
            }, false));
        }
    }, [labels, activeShapeType, activeObjectType, dispatch]);

    const traceLabelID = labels.some((label) => label.id === activeLabelID && label.type !== LabelType.TAG) ?
        activeLabelID : undefined;

    return (
        <div className='cvat-selected-frames-panel'>
            <Text strong>Selected frames</Text>
            <Row align='middle' className='cvat-selected-frames-controls'>
                <Col className='cvat-selected-frames-label'>
                    <Text type='secondary'>Trace label:</Text>
                </Col>
                <Col className='cvat-selected-frames-label-select'>
                    <Select
                        value={traceLabelID}
                        onChange={onTraceLabelChange}
                        placeholder='Select label'
                        options={labels
                            .filter((label) => label.type !== LabelType.TAG)
                            .map((label) => ({
                                value: label.id,
                                label: label.name,
                            }))}
                        className='cvat-selected-frames-label-dropdown'
                    />
                </Col>
                <Col className='cvat-selected-frames-input'>
                    <Input
                        placeholder='Add frames (e.g., 1, 5, 20)'
                        value={selectedFramesInput}
                        onChange={(event) => setSelectedFramesInput(event.target.value)}
                        onPressEnter={addSelectedFrames}
                        allowClear
                    />
                </Col>
                <Col>
                    <Button type='primary' onClick={addSelectedFrames}>
                        Add
                    </Button>
                </Col>
                {selectedFrames.length > 0 && (
                    <Col>
                        <Button type='link' onClick={() => dispatch(clearSelectedFramesAction())}>
                            Clear
                        </Button>
                    </Col>
                )}
            </Row>
            <div className='cvat-selected-frames-tags'>
                {selectedFrames.map((frame) => (
                    <Tag
                        key={frame}
                        closable
                        onClose={(event) => {
                            event.preventDefault();
                            dispatch(removeSelectedFrameAction(frame));
                        }}
                    >
                        #{frame}
                    </Tag>
                ))}
            </div>
        </div>
    );
}
