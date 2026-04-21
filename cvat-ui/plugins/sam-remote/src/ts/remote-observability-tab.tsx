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
    getPredictionDispatchStatus,
    JobPredictionRequest,
    NormalizedRemoteResult,
    PredictionDispatchStatus,
} from './remote-client';

interface SAMRemoteObservabilityTabProps {
    jobId?: number;
    remoteResult: NormalizedRemoteResult | null;
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
                acc[key] = 'disabled while redis is unavailable';
                return acc;
            }
            acc[key] = disableETAConfidenceIndicators(nestedValue);
            return acc;
        },
        {},
    );
}

function getNumericField(pathway: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = Number(pathway[key]);
        if (Number.isFinite(value)) {
            return value;
        }
    }

    return null;
}

function GlobalQueueStatusSection({
    status,
    stale,
    disableETAConfidence,
}: GlobalQueueStatusSectionProps): JSX.Element {
    const pathways = useMemo(() => Object.entries(status?.pathways || {}), [status]);

    if (!status) {
        return <Typography.Text type='secondary'>No global queue status loaded yet.</Typography.Text>;
    }

    if (!pathways.length) {
        return <Typography.Text type='secondary'>No global queue pathways reported by backend.</Typography.Text>;
    }

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>
            <Space direction='vertical' size={2} style={{ width: '100%' }}>
                <Typography.Text>
                    Mode:
                    {' '}
                    {status.mode || 'N/A'}
                </Typography.Text>
                <Typography.Text>
                    Queue timeout:
                    {' '}
                    {status.queue_timeout_seconds ?? 'N/A'}
                    {' '}
                    sec
                </Typography.Text>
                <Typography.Text>
                    Poll interval:
                    {' '}
                    {status.poll_interval_seconds ?? 'N/A'}
                    {' '}
                    sec
                </Typography.Text>
                <Typography.Text>
                    Lease TTL:
                    {' '}
                    {status.lease_ttl_seconds ?? 'N/A'}
                    {' '}
                    sec
                </Typography.Text>
                <Typography.Text>
                    Redis:
                    {' '}
                    {status.redis_ok ? 'Healthy' : 'Unavailable'}
                </Typography.Text>
                {!status.redis_ok && status.redis_error ? (
                    <Typography.Text type='danger'>
                        Redis error:
                        {' '}
                        {status.redis_error}
                    </Typography.Text>
                ) : null}
                <Typography.Text>
                    Server time:
                    {' '}
                    {status.server_time || 'N/A'}
                </Typography.Text>
            </Space>
            <List
                size='small'
                bordered
                dataSource={pathways}
                renderItem={([pathwayName, pathwayValue]: [string, unknown]) => {
                    const normalizedValue = disableETAConfidence ?
                        disableETAConfidenceIndicators(pathwayValue) :
                        pathwayValue;
                    const pathway = normalizedValue && typeof normalizedValue === 'object' && !Array.isArray(normalizedValue) ?
                        normalizedValue as Record<string, unknown> :
                        {};
                    const queueLength = getNumericField(pathway, ['queue_length', 'queueLength']);
                    const maxQueueLength = getNumericField(pathway, ['max_queue_length', 'maxQueueLength']);
                    const inflight = getNumericField(pathway, ['inflight']);
                    const slotLimit = getNumericField(pathway, ['slot_limit', 'slotLimit']);
                    const configuredState = pathway.configured_state ?? pathway.configuredState ?? 'N/A';
                    const nearCapacity = Boolean(
                        maxQueueLength &&
                        maxQueueLength > 0 &&
                        queueLength !== null &&
                        queueLength >= (maxQueueLength * 0.8),
                    );

                    return (
                        <List.Item>
                            <Space direction='vertical' size={2} style={{ width: '100%' }}>
                                <Space size={6} wrap>
                                    <Typography.Text strong>{pathwayName}</Typography.Text>
                                    {stale ? <Tag color='gold'>stale</Tag> : null}
                                    {nearCapacity ? <Tag color='orange'>Near capacity</Tag> : null}
                                </Space>
                                <Typography.Text>
                                    Configured state:
                                    {' '}
                                    {String(configuredState)}
                                </Typography.Text>
                                <Typography.Text>
                                    Queue length:
                                    {' '}
                                    {queueLength ?? 'N/A'}
                                </Typography.Text>
                                <Typography.Text>
                                    Inflight / slot limit:
                                    {' '}
                                    {inflight ?? 'N/A'}
                                    {' / '}
                                    {slotLimit ?? 'N/A'}
                                </Typography.Text>
                                <Typography.Text>
                                    Max queue length:
                                    {' '}
                                    {maxQueueLength ?? 'N/A'}
                                </Typography.Text>
                                {nearCapacity ? (
                                    <Typography.Text type='warning'>Queue is at or above 80% of configured capacity.</Typography.Text>
                                ) : null}
                            </Space>
                        </List.Item>
                    );
                }}
            />
        </Space>
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
    const [dispatchStatus, setDispatchStatus] = useState<PredictionDispatchStatus | null>(null);
    const [lastFreshDispatchStatus, setLastFreshDispatchStatus] = useState<PredictionDispatchStatus | null>(null);
    const [jobRequests, setJobRequests] = useState<JobPredictionRequest[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const pollingTimerRef = useRef<number | null>(null);
    const intervalMs = 15000;

    const isDispatchDegraded = useMemo(() => {
        if (!dispatchStatus) {
            return false;
        }

        return !dispatchStatus.redis_ok;
    }, [dispatchStatus]);

    const displayedDispatchStatus = useMemo(() => {
        if (isDispatchDegraded) {
            return lastFreshDispatchStatus || dispatchStatus;
        }

        return dispatchStatus;
    }, [dispatchStatus, isDispatchDegraded, lastFreshDispatchStatus]);

    const loadObservability = useCallback(async (): Promise<void> => {
        if (!jobId) {
            setDispatchStatus(null);
            setLastFreshDispatchStatus(null);
            setJobRequests([]);
            setError('Task/job context is unavailable on the current page.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const [status, requests] = await Promise.all([
                getPredictionDispatchStatus(),
                getJobPredictionRequests(jobId),
            ]);
            setDispatchStatus(status);
            if (status.redis_ok) {
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
                {dispatchStatus && !dispatchStatus.redis_ok ? (
                    <Alert
                        type='warning'
                        showIcon
                        message='Prediction dispatch is degraded (Redis unavailable)'
                        description={dispatchStatus.redis_error || 'Confidence messaging is disabled until Redis connectivity recovers.'}
                    />
                ) : null}

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
