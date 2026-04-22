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
import Space from 'antd/lib/space';
import Tag from 'antd/lib/tag';
import Typography from 'antd/lib/typography';
import { getPredictionDispatchStatus, PredictionDispatchStatus } from './remote-client';

interface GlobalQueueStatusSectionProps {
    status: PredictionDispatchStatus | null;
    stale: boolean;
    disableETAConfidence: boolean;
    loading: boolean;
    error: string | null;
}

const OBSERVABILITY_I18N_KEYS = {
    sectionGlobalQueueTitle: 'plugins.samRemote.observability.section.globalQueue.title',
    loadErrorBannerMessage: 'plugins.samRemote.observability.error.dataUnavailable',
    dispatchDegradedMessage: 'plugins.samRemote.observability.warning.dispatchDegraded',
    staleLabel: 'plugins.samRemote.observability.status.stale',
    queueNearCapacityLabel: 'plugins.samRemote.observability.status.nearCapacity',
};

const OBSERVABILITY_TEXT: Record<keyof typeof OBSERVABILITY_I18N_KEYS, string> = {
    sectionGlobalQueueTitle: 'Global Queue Status',
    loadErrorBannerMessage: 'Observability data unavailable',
    dispatchDegradedMessage: 'Prediction dispatch is degraded (Redis unavailable)',
    staleLabel: 'stale',
    queueNearCapacityLabel: 'Near capacity',
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
                style={{ width: '100%', minWidth: 0 }}
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
                                    <Typography.Text strong style={{ wordBreak: 'break-word' }}>{pathwayName}</Typography.Text>
                                    {stale ? <Tag color='gold'>{OBSERVABILITY_TEXT.staleLabel}</Tag> : null}
                                    {nearCapacity ? <Tag color='orange'>{OBSERVABILITY_TEXT.queueNearCapacityLabel}</Tag> : null}
                                </Space>
                                <Typography.Text style={{ wordBreak: 'break-word' }}>
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

export default function SAMRemoteObservabilityTab(): JSX.Element {
    const [dispatchStatus, setDispatchStatus] = useState<PredictionDispatchStatus | null>(null);
    const [lastFreshDispatchStatus, setLastFreshDispatchStatus] = useState<PredictionDispatchStatus | null>(null);
    const [dispatchError, setDispatchError] = useState<string | null>(null);
    const [dispatchLoading, setDispatchLoading] = useState(false);
    const pollingTimerRef = useRef<number | null>(null);

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
        setDispatchLoading(true);
        setDispatchError(null);

        try {
            const status = await getPredictionDispatchStatus();
            setDispatchStatus(status);
            if (status.redis_ok) {
                setLastFreshDispatchStatus(status);
            }
        } catch (error: unknown) {
            setDispatchError(error instanceof Error ? error.message : 'Failed to load global queue status.');
        } finally {
            setDispatchLoading(false);
        }
    }, []);

    useEffect(() => {
        loadObservability().catch(() => {
            // Error handling is already managed in loadObservability.
        });
    }, [loadObservability]);

    useEffect(() => {
        if (pollingTimerRef.current !== null) {
            window.clearTimeout(pollingTimerRef.current);
        }

        pollingTimerRef.current = window.setTimeout(() => {
            loadObservability().catch(() => {
                // Error handling is already managed in loadObservability.
            });
        }, 30000);

        return () => {
            if (pollingTimerRef.current !== null) {
                window.clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
        };
    }, [dispatchStatus, loadObservability]);

    return (
        <Space direction='vertical' style={{ width: '100%' }} size={12}>
            <Space>
                <Button
                    size='small'
                    loading={dispatchLoading}
                    onClick={(): void => {
                        loadObservability().catch(() => {
                            // Error handling is already managed in loadObservability.
                        });
                    }}
                >
                    Refresh
                </Button>
            </Space>
            {dispatchError ? (
                <Alert
                    type='warning'
                    showIcon
                    message={OBSERVABILITY_TEXT.loadErrorBannerMessage}
                    description='Failed to load global queue status.'
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
        </Space>
    );
}
