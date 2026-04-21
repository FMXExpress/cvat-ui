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
import Table from 'antd/lib/table';
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
    jobId?: number;
    requests: JobPredictionRequest[];
    highlightedRequestId?: string;
}

const TERMINAL_REQUEST_STATES = new Set(['completed', 'failed', 'expired']);

function renderTimestamp(value: string | null): string {
    if (!value) {
        return 'N/A';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString();
}

function PredictionRequestsSection(
    { jobId, requests, highlightedRequestId }: PredictionRequestsSectionProps,
): JSX.Element {
    return (
        <Table<JobPredictionRequest>
            size='small'
            bordered
            rowKey='request_id'
            dataSource={requests}
            pagination={false}
            locale={{ emptyText: 'No prediction requests yet' }}
            columns={[
                {
                    title: 'Request ID',
                    dataIndex: 'request_id',
                    key: 'request_id',
                    render: (value: string, request: JobPredictionRequest): JSX.Element => (
                        <Space size={6} wrap>
                            <Typography.Text strong>{value || 'N/A'}</Typography.Text>
                            {highlightedRequestId && request.request_id === highlightedRequestId ?
                                <Tag color='gold'>Current</Tag> :
                                null}
                        </Space>
                    ),
                },
                {
                    title: 'State',
                    dataIndex: 'state',
                    key: 'state',
                    render: (value: string): JSX.Element => {
                        let tagColor = 'blue';
                        if (value === 'completed') {
                            tagColor = 'green';
                        } else if (value === 'failed' || value === 'expired') {
                            tagColor = 'red';
                        }

                        return <Tag color={tagColor}>{value}</Tag>;
                    },
                },
                {
                    title: 'Pathway',
                    dataIndex: 'pathway',
                    key: 'pathway',
                    render: (value: string | null): string => value || 'N/A',
                },
                {
                    title: 'Created',
                    dataIndex: 'created_at',
                    key: 'created_at',
                    render: (value: string | null): string => renderTimestamp(value),
                },
                {
                    title: 'Updated',
                    dataIndex: 'updated_at',
                    key: 'updated_at',
                    render: (value: string | null): string => renderTimestamp(value),
                },
                {
                    title: 'Remote prediction ID',
                    dataIndex: 'remote_prediction_id',
                    key: 'remote_prediction_id',
                    render: (value: string | null): string => value || 'N/A',
                },
                {
                    title: 'Error message',
                    dataIndex: 'error',
                    key: 'error',
                    render: (value: string | null): JSX.Element => {
                        if (value) {
                            return <Typography.Text type='danger'>{value}</Typography.Text>;
                        }

                        return <Typography.Text type='secondary'>—</Typography.Text>;
                    },
                },
                {
                    title: 'Actions',
                    key: 'actions',
                    render: (_: unknown, request: JobPredictionRequest): JSX.Element => (
                        <Space size={4} wrap>
                            <Button
                                size='small'
                                onClick={(): void => {
                                    navigator.clipboard.writeText(request.request_id).catch(() => {
                                        // Browser clipboard API can be unavailable depending on page permissions.
                                    });
                                }}
                            >
                                Copy request_id
                            </Button>
                            {jobId ? (
                                <Button
                                    size='small'
                                    onClick={(): void => {
                                        const statusURL = `/api/jobs/${jobId}/video/predictions/${
                                            encodeURIComponent(request.request_id)
                                        }`;
                                        window.open(statusURL, '_blank', 'noopener');
                                    }}
                                >
                                    Open status endpoint
                                </Button>
                            ) : null}
                        </Space>
                    ),
                },
            ]}
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
    const hasPendingRequests = useMemo(
        () => jobRequests.some((request: JobPredictionRequest) => !TERMINAL_REQUEST_STATES.has(request.state)),
        [jobRequests],
    );

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
        const scheduleNextRefresh = (): void => {
            if (pollingTimerRef.current !== null) {
                window.clearTimeout(pollingTimerRef.current);
            }
            pollingTimerRef.current = window.setTimeout(() => {
                loadObservability().catch(() => {
                    // Error handling is already managed in loadObservability.
                });
            }, hasPendingRequests ? 5000 : 30000);
        };

        scheduleNextRefresh();

        return () => {
            if (pollingTimerRef.current !== null) {
                window.clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
        };
    }, [hasPendingRequests, loadObservability]);

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
                        jobId={jobId}
                        requests={jobRequests}
                        highlightedRequestId={remoteResult?.request_id}
                    />
                </div>
            </Space>
        </Spin>
    );
}
