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
import Skeleton from 'antd/lib/skeleton';
import Space from 'antd/lib/space';
import Table from 'antd/lib/table';
import Tag from 'antd/lib/tag';
import Typography from 'antd/lib/typography';
import dayjs from 'dayjs';
import { getJobPredictionRequests, JobPredictionRequest } from './remote-client';

interface SAMRemotePredictionRequestsTabProps {
    jobId?: number;
    highlightedRequestId?: string;
}

interface PredictionRequestsSectionProps {
    jobId?: number;
    requests: JobPredictionRequest[];
    highlightedRequestId?: string;
    loading: boolean;
    error: string | null;
}

const PREDICTION_REQUESTS_I18N_KEYS = {
    statusPending: 'plugins.samRemote.observability.request.state.pending',
    statusCompleted: 'plugins.samRemote.observability.request.state.completed',
    statusFailed: 'plugins.samRemote.observability.request.state.failed',
    statusExpired: 'plugins.samRemote.observability.request.state.expired',
    sectionPredictionRequestsTitle: 'plugins.samRemote.observability.section.predictionRequests.title',
    loadErrorBannerMessage: 'plugins.samRemote.observability.error.dataUnavailable',
    currentLabel: 'plugins.samRemote.observability.status.current',
    copyRequestIdTooltip: 'plugins.samRemote.observability.action.copyRequestId',
    openStatusEndpointTooltip: 'plugins.samRemote.observability.action.openStatusEndpoint',
};

const PREDICTION_REQUESTS_TEXT: Record<keyof typeof PREDICTION_REQUESTS_I18N_KEYS, string> = {
    statusPending: 'Pending',
    statusCompleted: 'Completed',
    statusFailed: 'Failed',
    statusExpired: 'Expired',
    sectionPredictionRequestsTitle: 'Prediction Requests (current job)',
    loadErrorBannerMessage: 'Observability data unavailable',
    currentLabel: 'Current',
    copyRequestIdTooltip: 'Copy request_id',
    openStatusEndpointTooltip: 'Open status endpoint',
};

type RequestState = 'pending' | 'completed' | 'failed' | 'expired' | string;
const REQUEST_STATE_UI: Record<string, { color: string; text: string }> = {
    pending: { color: 'processing', text: PREDICTION_REQUESTS_TEXT.statusPending },
    completed: { color: 'success', text: PREDICTION_REQUESTS_TEXT.statusCompleted },
    failed: { color: 'error', text: PREDICTION_REQUESTS_TEXT.statusFailed },
    expired: { color: 'warning', text: PREDICTION_REQUESTS_TEXT.statusExpired },
};

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
                                <Tag color='gold'>{PREDICTION_REQUESTS_TEXT.currentLabel}</Tag> :
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
                                {PREDICTION_REQUESTS_TEXT.copyRequestIdTooltip}
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
                                    {PREDICTION_REQUESTS_TEXT.openStatusEndpointTooltip}
                                </Button>
                            ) : null}
                        </Space>
                    ),
                },
            ]}
        />
    );
}

export default function SAMRemotePredictionRequestsTab(
    { jobId, highlightedRequestId }: SAMRemotePredictionRequestsTabProps,
): JSX.Element {
    const [jobRequests, setJobRequests] = useState<JobPredictionRequest[]>([]);
    const [requestsError, setRequestsError] = useState<string | null>(null);
    const [requestsLoading, setRequestsLoading] = useState(false);
    const pollingTimerRef = useRef<number | null>(null);

    const hasPendingRequests = useMemo(
        () => jobRequests.some((request: JobPredictionRequest) => !TERMINAL_REQUEST_STATES.has(request.state)),
        [jobRequests],
    );

    const loadPredictionRequests = useCallback(async (): Promise<void> => {
        if (!jobId) {
            setJobRequests([]);
            setRequestsError('Task/job context is unavailable on the current page.');
            return;
        }

        setRequestsLoading(true);
        setRequestsError(null);

        try {
            const requests = await getJobPredictionRequests(jobId);
            setJobRequests(requests);
        } catch (error: unknown) {
            setRequestsError(error instanceof Error ? error.message : 'Failed to load prediction requests.');
        } finally {
            setRequestsLoading(false);
        }
    }, [jobId]);

    useEffect(() => {
        loadPredictionRequests().catch(() => {
            // Error handling is already managed in loadPredictionRequests.
        });
    }, [loadPredictionRequests]);

    useEffect(() => {
        if (pollingTimerRef.current !== null) {
            window.clearTimeout(pollingTimerRef.current);
        }

        pollingTimerRef.current = window.setTimeout(() => {
            loadPredictionRequests().catch(() => {
                // Error handling is already managed in loadPredictionRequests.
            });
        }, hasPendingRequests ? 5000 : 30000);

        return () => {
            if (pollingTimerRef.current !== null) {
                window.clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
        };
    }, [hasPendingRequests, loadPredictionRequests, jobRequests]);

    return (
        <Space direction='vertical' style={{ width: '100%' }} size={12}>
            <Space>
                <Button
                    size='small'
                    loading={requestsLoading}
                    onClick={(): void => {
                        loadPredictionRequests().catch(() => {
                            // Error handling is already managed in loadPredictionRequests.
                        });
                    }}
                >
                    Refresh
                </Button>
            </Space>
            {requestsError ? (
                <Alert
                    type='warning'
                    showIcon
                    message={PREDICTION_REQUESTS_TEXT.loadErrorBannerMessage}
                    description='Failed to load prediction requests.'
                />
            ) : null}

            <div>
                <Typography.Text strong>{PREDICTION_REQUESTS_TEXT.sectionPredictionRequestsTitle}</Typography.Text>
                <Divider style={{ margin: '8px 0' }} />
                <PredictionRequestsSection
                    jobId={jobId}
                    requests={jobRequests}
                    highlightedRequestId={highlightedRequestId}
                    loading={requestsLoading}
                    error={requestsError}
                />
            </div>
        </Space>
    );
}
