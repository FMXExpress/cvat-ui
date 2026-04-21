// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Divider from 'antd/lib/divider';
import List from 'antd/lib/list';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Tag from 'antd/lib/tag';
import Typography from 'antd/lib/typography';
import {
    getJobPredictionRequests,
    getPredictionDispatchHealth,
    getPredictionDispatchStatus,
    JobPredictionRequest,
    NormalizedRemoteResult,
    PredictionDispatchHealth,
    PredictionDispatchStatus,
} from './remote-client';

interface SAMRemoteObservabilityTabProps {
    jobId?: number;
    remoteResult: NormalizedRemoteResult | null;
}

interface DispatchHealthSectionProps {
    health: PredictionDispatchHealth | null;
}

function DispatchHealthSection({ health }: DispatchHealthSectionProps): JSX.Element {
    if (!health) {
        return <Typography.Text type='secondary'>No dispatch health data loaded yet.</Typography.Text>;
    }

    return (
        <Space direction='vertical' size={4} style={{ width: '100%' }}>
            <Typography.Text>
                Status:
                {' '}
                <Tag color={health.status === 'ok' ? 'green' : 'orange'}>{health.status || 'unknown'}</Tag>
            </Typography.Text>
            <Typography.Text>
                Redis connectivity:
                {' '}
                {health.redis_ok ? 'Healthy' : 'Unavailable'}
            </Typography.Text>
            <Typography.Text>
                Queue lease acquisition:
                {' '}
                {health.acquire_ok ? 'Healthy' : 'Unavailable'}
            </Typography.Text>
            <Typography.Text>
                Dispatch latency:
                {' '}
                {health.latency_ms ?? 'N/A'}
                {' '}
                ms
            </Typography.Text>
        </Space>
    );
}

interface GlobalQueueStatusSectionProps {
    status: PredictionDispatchStatus | null;
}

function GlobalQueueStatusSection({ status }: GlobalQueueStatusSectionProps): JSX.Element {
    const pathways = useMemo(() => Object.entries(status?.pathways || {}), [status]);

    if (!pathways.length) {
        return <Typography.Text type='secondary'>No global queue pathways reported by backend.</Typography.Text>;
    }

    return (
        <List
            size='small'
            bordered
            dataSource={pathways}
            renderItem={([pathwayName, pathwayValue]: [string, unknown]) => (
                <List.Item>
                    <Space direction='vertical' size={2} style={{ width: '100%' }}>
                        <Typography.Text strong>{pathwayName}</Typography.Text>
                        <Typography.Text code style={{ whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(pathwayValue, null, 2)}
                        </Typography.Text>
                    </Space>
                </List.Item>
            )}
        />
    );
}

interface PredictionRequestsSectionProps {
    requests: JobPredictionRequest[];
    highlightedRequestId?: string;
}

function PredictionRequestsSection({ requests, highlightedRequestId }: PredictionRequestsSectionProps): JSX.Element {
    if (!requests.length) {
        return <Typography.Text type='secondary'>No prediction requests found for this job.</Typography.Text>;
    }

    return (
        <List
            size='small'
            bordered
            dataSource={requests}
            renderItem={(request: JobPredictionRequest) => {
                const isHighlighted = highlightedRequestId && request.request_id === highlightedRequestId;
                let tagColor = 'blue';
                if (request.state === 'completed') {
                    tagColor = 'green';
                } else if (request.state === 'failed') {
                    tagColor = 'red';
                }

                return (
                    <List.Item>
                        <Space direction='vertical' size={2} style={{ width: '100%' }}>
                            <Space wrap>
                                <Typography.Text strong>{request.request_id}</Typography.Text>
                                <Tag color={tagColor}>{request.state}</Tag>
                                {isHighlighted ? <Tag color='gold'>Current</Tag> : null}
                            </Space>
                            <Typography.Text type='secondary'>
                                Remote prediction ID:
                                {' '}
                                {request.remote_prediction_id || 'N/A'}
                            </Typography.Text>
                            {request.error ? <Typography.Text type='danger'>{request.error}</Typography.Text> : null}
                        </Space>
                    </List.Item>
                );
            }}
        />
    );
}

export default function SAMRemoteObservabilityTab(
    { jobId, remoteResult }: SAMRemoteObservabilityTabProps,
): JSX.Element {
    const [dispatchHealth, setDispatchHealth] = useState<PredictionDispatchHealth | null>(null);
    const [dispatchStatus, setDispatchStatus] = useState<PredictionDispatchStatus | null>(null);
    const [jobRequests, setJobRequests] = useState<JobPredictionRequest[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const loadObservability = useCallback(async (): Promise<void> => {
        if (!jobId) {
            setDispatchHealth(null);
            setDispatchStatus(null);
            setJobRequests([]);
            setError('Task/job context is unavailable on the current page.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const [health, status, requests] = await Promise.all([
                getPredictionDispatchHealth(),
                getPredictionDispatchStatus(),
                getJobPredictionRequests(jobId),
            ]);
            setDispatchHealth(health);
            setDispatchStatus(status);
            setJobRequests(requests);
        } catch (fetchError: unknown) {
            setError(fetchError instanceof Error ? fetchError.message : 'Failed to load observability data.');
        } finally {
            setLoading(false);
        }
    }, [jobId]);

    useEffect(() => {
        loadObservability().catch(() => {
            // Error handling is already managed in loadObservability.
        });
    }, [loadObservability]);

    return (
        <Spin spinning={loading}>
            <Space direction='vertical' style={{ width: '100%' }} size={12}>
                <Space>
                    <Button
                        size='small'
                        onClick={(): void => {
                            loadObservability().catch(() => {
                                // Error handling is already managed in loadObservability.
                            });
                        }}
                    >
                        Refresh
                    </Button>
                </Space>
                {error ? (
                    <Alert
                        type='warning'
                        showIcon
                        message='Observability data unavailable'
                        description={error}
                    />
                ) : null}

                <div>
                    <Typography.Text strong>Dispatch Health</Typography.Text>
                    <Divider style={{ margin: '8px 0' }} />
                    <DispatchHealthSection health={dispatchHealth} />
                </div>

                <div>
                    <Typography.Text strong>Global Queue Status</Typography.Text>
                    <Divider style={{ margin: '8px 0' }} />
                    <GlobalQueueStatusSection status={dispatchStatus} />
                </div>

                <div>
                    <Typography.Text strong>Prediction Requests (current job)</Typography.Text>
                    <Divider style={{ margin: '8px 0' }} />
                    <PredictionRequestsSection
                        requests={jobRequests}
                        highlightedRequestId={remoteResult?.request_id}
                    />
                </div>
            </Space>
        </Spin>
    );
}
