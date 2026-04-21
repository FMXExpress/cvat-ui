// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
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

    const normalizedStatus = (health.status || 'unknown').toLowerCase();
    let healthTagColor = 'orange';
    if (normalizedStatus === 'ok') {
        healthTagColor = 'green';
    } else if (normalizedStatus === 'degraded') {
        healthTagColor = 'red';
    }

    return (
        <Space direction='vertical' size={4} style={{ width: '100%' }}>
            <Typography.Text>
                Status:
                {' '}
                <Tag color={healthTagColor}>{health.status || 'unknown'}</Tag>
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
    stale: boolean;
    disableETAConfidence: boolean;
}

function disableETAConfidenceIndicators(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item: unknown) => disableETAConfidenceIndicators(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
        (acc, [key, nestedValue]) => {
            if (/eta[_\s-]*confidence|confidence[_\s-]*eta/i.test(key)) {
                acc[key] = 'disabled while dispatch is degraded';
                return acc;
            }
            acc[key] = disableETAConfidenceIndicators(nestedValue);
            return acc;
        },
        {},
    );
}

function GlobalQueueStatusSection({
    status,
    stale,
    disableETAConfidence,
}: GlobalQueueStatusSectionProps): JSX.Element {
    const pathways = useMemo(() => Object.entries(status?.pathways || {}), [status]);
    const pathwaysToRender = useMemo(
        () => pathways.map(([name, value]: [string, unknown]) => (
            [name, disableETAConfidence ? disableETAConfidenceIndicators(value) : value] as [string, unknown]
        )),
        [pathways, disableETAConfidence],
    );

    if (!pathwaysToRender.length) {
        return <Typography.Text type='secondary'>No global queue pathways reported by backend.</Typography.Text>;
    }

    return (
        <List
            size='small'
            bordered
            dataSource={pathwaysToRender}
            renderItem={([pathwayName, pathwayValue]: [string, unknown]) => (
                <List.Item>
                    <Space direction='vertical' size={2} style={{ width: '100%' }}>
                        <Space size={6} wrap>
                            <Typography.Text strong>{pathwayName}</Typography.Text>
                            {stale ? <Tag color='gold'>stale</Tag> : null}
                        </Space>
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
    const [lastFreshDispatchStatus, setLastFreshDispatchStatus] = useState<PredictionDispatchStatus | null>(null);
    const [jobRequests, setJobRequests] = useState<JobPredictionRequest[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const pollingTimerRef = useRef<number | null>(null);
    const intervalMs = 15000;

    const isDispatchDegraded = useMemo(
        () => dispatchHealth?.status?.toLowerCase() === 'degraded',
        [dispatchHealth],
    );

    const displayedDispatchStatus = useMemo(() => {
        if (isDispatchDegraded) {
            return lastFreshDispatchStatus || dispatchStatus;
        }

        return dispatchStatus;
    }, [dispatchStatus, isDispatchDegraded, lastFreshDispatchStatus]);

    const loadObservability = useCallback(async (): Promise<void> => {
        if (!jobId) {
            setDispatchHealth(null);
            setDispatchStatus(null);
            setLastFreshDispatchStatus(null);
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
            if (health.status.toLowerCase() === 'ok') {
                setLastFreshDispatchStatus(status);
            }
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
        if (pollingTimerRef.current !== null) {
            window.clearInterval(pollingTimerRef.current);
        }
        pollingTimerRef.current = window.setInterval(() => {
            loadObservability().catch(() => {
                // Error handling is already managed in loadObservability.
            });
        }, intervalMs);

        return () => {
            if (pollingTimerRef.current !== null) {
                window.clearInterval(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
        };
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
                {isDispatchDegraded ? (
                    <Alert
                        type='error'
                        showIcon
                        message='prediction dispatch unavailable'
                        description='Showing last-known queue snapshot as stale. ETA confidence indicators are disabled until dispatch health recovers.'
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
                    <GlobalQueueStatusSection
                        status={displayedDispatchStatus}
                        stale={isDispatchDegraded}
                        disableETAConfidence={isDispatchDegraded}
                    />
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
