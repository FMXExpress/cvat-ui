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
import Skeleton from 'antd/lib/skeleton';
import Table from 'antd/lib/table';
import Space from 'antd/lib/space';
import Tag from 'antd/lib/tag';
import Typography from 'antd/lib/typography';
import dayjs from 'dayjs';
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
    loading: boolean;
    error: string | null;
}

const OBSERVABILITY_I18N_KEYS = {
    statusPending: 'plugins.samRemote.observability.request.state.pending',
    statusCompleted: 'plugins.samRemote.observability.request.state.completed',
    statusFailed: 'plugins.samRemote.observability.request.state.failed',
    statusExpired: 'plugins.samRemote.observability.request.state.expired',
    sectionGlobalQueueTitle: 'plugins.samRemote.observability.section.globalQueue.title',
    sectionPredictionRequestsTitle: 'plugins.samRemote.observability.section.predictionRequests.title',
    loadErrorBannerMessage: 'plugins.samRemote.observability.error.dataUnavailable',
    dispatchDegradedMessage: 'plugins.samRemote.observability.warning.dispatchDegraded',
    staleLabel: 'plugins.samRemote.observability.status.stale',
    currentLabel: 'plugins.samRemote.observability.status.current',
    queueNearCapacityLabel: 'plugins.samRemote.observability.status.nearCapacity',
    copyRequestIdTooltip: 'plugins.samRemote.observability.action.copyRequestId',
    openStatusEndpointTooltip: 'plugins.samRemote.observability.action.openStatusEndpoint',
};

const OBSERVABILITY_TEXT: Record<keyof typeof OBSERVABILITY_I18N_KEYS, string> = {
    statusPending: 'Pending',
    statusCompleted: 'Completed',
    statusFailed: 'Failed',
    statusExpired: 'Expired',
    sectionGlobalQueueTitle: 'Global Queue Status',
    sectionPredictionRequestsTitle: 'Prediction Requests (current job)',
    loadErrorBannerMessage: 'Observability data unavailable',
    dispatchDegradedMessage: 'Prediction dispatch is degraded (Redis unavailable)',
    staleLabel: 'stale',
    currentLabel: 'Current',
    queueNearCapacityLabel: 'Near capacity',
    copyRequestIdTooltip: 'Copy request_id',
    openStatusEndpointTooltip: 'Open status endpoint',
};

type RequestState = 'pending' | 'completed' | 'failed' | 'expired' | string;
const REQUEST_STATE_UI: Record<string, { color: string; text: string }> = {
    pending: { color: 'processing', text: OBSERVABILITY_TEXT.statusPending },
    completed: { color: 'success', text: OBSERVABILITY_TEXT.statusCompleted },
    failed: { color: 'error', text: OBSERVABILITY_TEXT.statusFailed },
    expired: { color: 'warning', text: OBSERVABILITY_TEXT.statusExpired },
};

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
    loading,
    error,
}: GlobalQueueStatusSectionProps): JSX.Element {
    const pathways = useMemo(() => Object.entries(status?.pathways || {}), [status]);
    if (loading) {
        return (
            <Space direction='vertical' style={{ width: '100%' }}>
                <Skeleton active paragraph={{ rows: 4 }} title={false} />
                <Skeleton active paragraph={{ rows: 4 }} title={false} />
            </Space>
        );
    }

    if (error) {
        return <Alert type='error' showIcon message={error} />;
    }

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
                                    {stale ? <Tag color='gold'>{OBSERVABILITY_TEXT.staleLabel}</Tag> : null}
                                    {nearCapacity ? <Tag color='orange'>{OBSERVABILITY_TEXT.queueNearCapacityLabel}</Tag> : null}
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
    loading: boolean;
    error: string | null;
}

const TERMINAL_REQUEST_STATES = new Set(['completed', 'failed', 'expired']);

function renderTimestamp(value: string | null): string {
    if (!value) {
        return 'N/A';
    }

    const parsed = dayjs(value);
    if (!parsed.isValid()) {
        return value;
    }

    return parsed.format('MMM Do YY, H:mm');
}

function renderStateTag(value: RequestState): JSX.Element {
    const stateUI = REQUEST_STATE_UI[value] || { color: 'default', text: value };
    return <Tag color={stateUI.color}>{stateUI.text}</Tag>;
}

function PredictionRequestsSection(
    {
        jobId,
        requests,
        highlightedRequestId,
        loading,
        error,
    }: PredictionRequestsSectionProps,
): JSX.Element {
    if (loading) {
        return <Skeleton active paragraph={{ rows: 6 }} title={false} />;
    }

    if (error) {
        return <Alert type='error' showIcon message={error} />;
    }

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
                                <Tag color='gold'>{OBSERVABILITY_TEXT.currentLabel}</Tag> :
                                null}
                        </Space>
                    ),
                },
                {
                    title: 'State',
                    dataIndex: 'state',
                    key: 'state',
                    render: (value: string): JSX.Element => renderStateTag(value),
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
                                {OBSERVABILITY_TEXT.copyRequestIdTooltip}
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
                                    {OBSERVABILITY_TEXT.openStatusEndpointTooltip}
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
    const [dispatchError, setDispatchError] = useState<string | null>(null);
    const [requestsError, setRequestsError] = useState<string | null>(null);
    const [dispatchLoading, setDispatchLoading] = useState(false);
    const [requestsLoading, setRequestsLoading] = useState(false);
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
            setDispatchError('Task/job context is unavailable on the current page.');
            setRequestsError('Task/job context is unavailable on the current page.');
            return;
        }

        setDispatchLoading(true);
        setRequestsLoading(true);
        setDispatchError(null);
        setRequestsError(null);
        const [statusResult, requestsResult] = await Promise.allSettled([
            getPredictionDispatchStatus(),
            getJobPredictionRequests(jobId),
        ]);

        if (statusResult.status === 'fulfilled') {
            const status = statusResult.value;
            setDispatchStatus(status);
            if (status.redis_ok) {
                setLastFreshDispatchStatus(status);
            }
        } else {
            setDispatchError(statusResult.reason instanceof Error ?
                statusResult.reason.message :
                'Failed to load global queue status.');
        }

        if (requestsResult.status === 'fulfilled') {
            setJobRequests(requestsResult.value);
        } else {
            setRequestsError(requestsResult.reason instanceof Error ?
                requestsResult.reason.message :
                'Failed to load prediction requests.');
        }

        setDispatchLoading(false);
        setRequestsLoading(false);
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
        <Space direction='vertical' style={{ width: '100%' }} size={12}>
            <Space>
                <Button
                    size='small'
                    loading={dispatchLoading || requestsLoading}
                    onClick={(): void => {
                        loadObservability().catch(() => {
                            // Error handling is already managed in loadObservability.
                        });
                    }}
                >
                    Refresh
                </Button>
            </Space>
            {(dispatchError && requestsError) ? (
                <Alert
                    type='warning'
                    showIcon
                    message={OBSERVABILITY_TEXT.loadErrorBannerMessage}
                    description='Failed to load global queue status and prediction requests.'
                />
            ) : null}
            {dispatchStatus && !dispatchStatus.redis_ok ? (
                <Alert
                    type='warning'
                    showIcon
                    message={OBSERVABILITY_TEXT.dispatchDegradedMessage}
                    description={dispatchStatus.redis_error || 'Confidence messaging is disabled until Redis connectivity recovers.'}
                />
            ) : null}

            <div>
                <Typography.Text strong>{OBSERVABILITY_TEXT.sectionGlobalQueueTitle}</Typography.Text>
                <Divider style={{ margin: '8px 0' }} />
                <GlobalQueueStatusSection
                    status={displayedDispatchStatus}
                    stale={isDispatchDegraded}
                    disableETAConfidence={isDispatchDegraded}
                    loading={dispatchLoading}
                    error={dispatchError}
                />
            </div>

            <div>
                <Typography.Text strong>{OBSERVABILITY_TEXT.sectionPredictionRequestsTitle}</Typography.Text>
                <Divider style={{ margin: '8px 0' }} />
                <PredictionRequestsSection
                    jobId={jobId}
                    requests={jobRequests}
                    highlightedRequestId={remoteResult?.request_id}
                    loading={requestsLoading}
                    error={requestsError}
                />
            </div>
        </Space>
    );
}
