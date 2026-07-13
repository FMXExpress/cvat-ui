# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import time
from abc import ABCMeta, abstractmethod
from contextlib import contextmanager
from dataclasses import dataclass
from hashlib import sha256
from typing import Generator
from uuid import uuid4

from django.conf import settings
from django_rq.queues import get_redis_connection

from .log import ServerLogManager

slogger = ServerLogManager(__name__)


class PredictionDispatchTimeoutError(RuntimeError):
    pass


class PredictionDispatchQueueFullError(RuntimeError):
    pass


@dataclass(frozen=True)
class PredictionDispatchLease:
    mode: str
    pathway: str
    queue_wait_ms: int
    inflight_count: int


@dataclass(frozen=True)
class PredictionDispatchLogContext:
    request_id: str
    job_id: int
    pathway: str
    remote_url: str


class PredictionDispatch(metaclass=ABCMeta):
    @contextmanager
    @abstractmethod
    def acquire(
        self,
        *,
        pathway: str,
        log_context: PredictionDispatchLogContext | None = None,
    ) -> Generator[PredictionDispatchLease, None, None]:
        pass


class RedisPredictionDispatch(PredictionDispatch):
    def __init__(
        self,
        *,
        mode: str,
        max_concurrency_fast: int,
        max_concurrency_slow: int,
        queue_timeout_seconds: float,
        max_queue_length_fast: int,
        max_queue_length_slow: int,
        poll_interval_seconds: float,
        lease_ttl_seconds: int,
        key_prefix: str,
        fast_url: str,
        slow_url: str,
    ) -> None:
        self._mode = mode
        self._max_concurrency_fast = max_concurrency_fast
        self._max_concurrency_slow = max_concurrency_slow
        self._queue_timeout_seconds = queue_timeout_seconds
        self._max_queue_length_fast = max_queue_length_fast
        self._max_queue_length_slow = max_queue_length_slow
        self._poll_interval_seconds = poll_interval_seconds
        self._lease_ttl_seconds = lease_ttl_seconds
        self._key_prefix = key_prefix
        self._fast_url = fast_url.rstrip("/")
        self._slow_url = slow_url.rstrip("/")
        self._redis = get_redis_connection(settings.REDIS_INMEM_SETTINGS)

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def queue_timeout_seconds(self) -> float:
        return self._queue_timeout_seconds

    @property
    def poll_interval_seconds(self) -> float:
        return self._poll_interval_seconds

    @property
    def lease_ttl_seconds(self) -> int:
        return self._lease_ttl_seconds

    def _pathway_name(self, pathway: str) -> str:
        normalized_pathway = pathway.rstrip("/")
        if normalized_pathway == f"{self._fast_url}/predictions" or normalized_pathway == self._fast_url:
            return "fast"
        if normalized_pathway == f"{self._slow_url}/predictions" or normalized_pathway == self._slow_url:
            return "slow"
        return "unknown"

    def _slot_limit(self, *, pathway_name: str) -> int:
        if self._mode == "queued":
            return 1
        if pathway_name == "fast":
            return self._max_concurrency_fast
        if pathway_name == "slow":
            return self._max_concurrency_slow
        return min(self._max_concurrency_fast, self._max_concurrency_slow)

    def _counter_key(self, pathway: str) -> str:
        pathway_digest = sha256(pathway.encode("utf-8")).hexdigest()
        return f"{self._key_prefix}:{pathway_digest}"

    def _queue_list_key(self, pathway_name: str) -> str:
        return f"{self._key_prefix}:queue:list:{pathway_name}"

    def _max_queue_length(self, *, pathway_name: str) -> int:
        if pathway_name == "fast":
            return self._max_queue_length_fast
        if pathway_name == "slow":
            return self._max_queue_length_slow
        return max(self._max_queue_length_fast, self._max_queue_length_slow)

    def get_queue_length(self, *, pathway_name: str) -> int:
        queue_list_key = self._queue_list_key(pathway_name)
        queue_length = self._redis.llen(queue_list_key)
        return int(queue_length)

    def get_inflight_count(self, *, pathway: str) -> int:
        counter_value = self._redis.get(self._counter_key(pathway))
        if isinstance(counter_value, bytes):
            counter_value = counter_value.decode("utf-8")
        return int(counter_value or 0)

    def get_slot_limit(self, *, pathway_name: str) -> int:
        return self._slot_limit(pathway_name=pathway_name)

    def get_max_queue_length(self, *, pathway_name: str) -> int:
        return self._max_queue_length(pathway_name=pathway_name)

    def health(self) -> dict[str, object]:
        diagnostic_pathway = f"{self._key_prefix}:diagnostic:pathway"
        started_at = time.monotonic()
        details: dict[str, object] = {
            "mode": self._mode,
            "diagnostic_pathway": diagnostic_pathway,
        }

        redis_ok = False
        acquire_ok = False
        try:
            redis_ok = bool(self._redis.ping())
            acquired, inflight = self._try_acquire(pathway=diagnostic_pathway, limit=1)
            details["diagnostic_inflight"] = inflight
            acquire_ok = acquired
            if acquired:
                self._release(pathway=diagnostic_pathway)
            else:
                details["acquire_error"] = "Unable to acquire diagnostic lease"
        except Exception as exc:  # nosec B110
            details["error"] = str(exc)

        latency_ms = round((time.monotonic() - started_at) * 1000, 3)
        return {
            "redis_ok": redis_ok,
            "acquire_ok": acquire_ok,
            "latency_ms": latency_ms,
            "details": details,
        }

    def _enqueue_waiter(self, *, pathway_name: str, token: str) -> int:
        queue_list_key = self._queue_list_key(pathway_name)
        queue_size = self._redis.eval(
            """
            local list_key = KEYS[1]
            local ttl = tonumber(ARGV[1])
            local token = ARGV[2]
            local current = redis.call('rpush', list_key, token)
            redis.call('expire', list_key, ttl)
            return current
            """,
            1,
            queue_list_key,
            self._lease_ttl_seconds,
            token,
        )
        return int(queue_size)

    def _remove_waiter(self, *, pathway_name: str, token: str) -> None:
        queue_list_key = self._queue_list_key(pathway_name)
        self._redis.eval(
            """
            local list_key = KEYS[1]
            local ttl = tonumber(ARGV[1])
            local token = ARGV[2]
            redis.call('lrem', list_key, 1, token)
            if redis.call('llen', list_key) == 0 then
                redis.call('del', list_key)
            else
                redis.call('expire', list_key, ttl)
            end
            """,
            1,
            queue_list_key,
            self._lease_ttl_seconds,
            token,
        )

    def _is_head_waiter(self, *, pathway_name: str, token: str) -> bool:
        queue_list_key = self._queue_list_key(pathway_name)
        head_token = self._redis.lindex(queue_list_key, 0)
        if isinstance(head_token, bytes):
            head_token = head_token.decode("utf-8")
        return head_token == token

    def _try_acquire(self, *, pathway: str, limit: int) -> tuple[bool, int]:
        key = self._counter_key(pathway)
        acquired, inflight = self._redis.eval(
            """
            local key = KEYS[1]
            local limit = tonumber(ARGV[1])
            local ttl = tonumber(ARGV[2])
            local current = tonumber(redis.call('get', key) or '0')
            if current < limit then
                current = redis.call('incr', key)
                redis.call('expire', key, ttl)
                return {1, current}
            end
            return {0, current}
            """,
            1,
            key,
            limit,
            self._lease_ttl_seconds,
        )
        return bool(acquired), int(inflight)

    def _release(self, *, pathway: str) -> int:
        key = self._counter_key(pathway)
        inflight = self._redis.eval(
            """
            local key = KEYS[1]
            local ttl = tonumber(ARGV[1])
            local current = tonumber(redis.call('get', key) or '0')
            if current <= 1 then
                redis.call('del', key)
                return 0
            end
            current = redis.call('decr', key)
            redis.call('expire', key, ttl)
            return current
            """,
            1,
            key,
            self._lease_ttl_seconds,
        )
        return int(inflight)

    def _log_lifecycle_event(
        self,
        *,
        event: str,
        log_context: PredictionDispatchLogContext | None,
        queue_wait_ms: int,
        inflight_count: int,
        error: Exception | None = None,
    ) -> None:
        if not log_context:
            return

        log_fields = {
            "event": event,
            "request_id": log_context.request_id,
            "job_id": log_context.job_id,
            "pathway": log_context.pathway,
            "queue_wait_ms": queue_wait_ms,
            "inflight_count": inflight_count,
            "dispatch_mode": self._mode,
            "remote_url": log_context.remote_url,
        }
        if error:
            log_fields["error_class"] = error.__class__.__name__
            log_fields["error_detail"] = str(error)

        logger = slogger.job[log_context.job_id]
        if error:
            logger.warning("Video prediction dispatch lifecycle", extra={"log_fields": log_fields})
        else:
            logger.info("Video prediction dispatch lifecycle", extra={"log_fields": log_fields})

    @contextmanager
    def acquire(
        self,
        *,
        pathway: str,
        log_context: PredictionDispatchLogContext | None = None,
    ) -> Generator[PredictionDispatchLease, None, None]:
        pathway_name = self._pathway_name(pathway)
        limit = self._slot_limit(pathway_name=pathway_name)
        max_queue_length = self._max_queue_length(pathway_name=pathway_name)
        queue_token = str(uuid4())
        queue_size = self._enqueue_waiter(pathway_name=pathway_name, token=queue_token)
        enqueued = True
        self._log_lifecycle_event(
            event="request_enqueued",
            log_context=log_context,
            queue_wait_ms=0,
            inflight_count=0,
        )
        if max_queue_length > 0 and queue_size > max_queue_length:
            self._remove_waiter(pathway_name=pathway_name, token=queue_token)
            enqueued = False
            exc = PredictionDispatchQueueFullError(
                f"Prediction dispatch queue is full for pathway '{pathway_name}' "
                f"(size={queue_size}, limit={max_queue_length})"
            )
            self._log_lifecycle_event(
                event="queue_full",
                log_context=log_context,
                queue_wait_ms=0,
                inflight_count=0,
                error=exc,
            )
            raise exc

        started_at = time.monotonic()
        last_inflight = 0
        queue_head_logged = False

        try:
            while True:
                if not self._is_head_waiter(pathway_name=pathway_name, token=queue_token):
                    if (time.monotonic() - started_at) >= self._queue_timeout_seconds:
                        exc = PredictionDispatchTimeoutError(
                            f"Timed out waiting for prediction dispatch slot for pathway '{pathway}' "
                            f"(mode={self._mode}, inflight={last_inflight}, limit={limit})"
                        )
                        self._log_lifecycle_event(
                            event="dispatch_timeout",
                            log_context=log_context,
                            queue_wait_ms=int((time.monotonic() - started_at) * 1000),
                            inflight_count=last_inflight,
                            error=exc,
                        )
                        raise exc
                    time.sleep(self._poll_interval_seconds)
                    continue

                if not queue_head_logged:
                    queue_wait_ms = int((time.monotonic() - started_at) * 1000)
                    self._log_lifecycle_event(
                        event="queue_head_acquired",
                        log_context=log_context,
                        queue_wait_ms=queue_wait_ms,
                        inflight_count=last_inflight,
                    )
                    queue_head_logged = True
                acquired, inflight = self._try_acquire(pathway=pathway, limit=limit)
                last_inflight = inflight
                if acquired:
                    if enqueued:
                        self._remove_waiter(pathway_name=pathway_name, token=queue_token)
                        enqueued = False
                    queue_wait_ms = int((time.monotonic() - started_at) * 1000)
                    self._log_lifecycle_event(
                        event="dispatch_slot_acquired",
                        log_context=log_context,
                        queue_wait_ms=queue_wait_ms,
                        inflight_count=inflight,
                    )
                    lease = PredictionDispatchLease(
                        mode=self._mode,
                        pathway=pathway,
                        queue_wait_ms=queue_wait_ms,
                        inflight_count=inflight,
                    )
                    try:
                        yield lease
                    finally:
                        self._release(pathway=pathway)
                    return

                if (time.monotonic() - started_at) >= self._queue_timeout_seconds:
                    exc = PredictionDispatchTimeoutError(
                        f"Timed out waiting for prediction dispatch slot for pathway '{pathway}' "
                        f"(mode={self._mode}, inflight={last_inflight}, limit={limit})"
                    )
                    self._log_lifecycle_event(
                        event="dispatch_timeout",
                        log_context=log_context,
                        queue_wait_ms=int((time.monotonic() - started_at) * 1000),
                        inflight_count=last_inflight,
                        error=exc,
                    )
                    raise exc

                time.sleep(self._poll_interval_seconds)
        finally:
            if enqueued:
                self._remove_waiter(pathway_name=pathway_name, token=queue_token)


_dispatcher: PredictionDispatch | None = None


def get_prediction_dispatcher() -> PredictionDispatch:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = RedisPredictionDispatch(
            mode=settings.JOB_VIDEO_PREDICTION_DISPATCH_MODE,
            max_concurrency_fast=settings.JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_FAST,
            max_concurrency_slow=settings.JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_SLOW,
            queue_timeout_seconds=settings.JOB_VIDEO_PREDICTION_DISPATCH_QUEUE_TIMEOUT_SECONDS,
            max_queue_length_fast=settings.JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_FAST,
            max_queue_length_slow=settings.JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_SLOW,
            poll_interval_seconds=settings.JOB_VIDEO_PREDICTION_DISPATCH_POLL_INTERVAL_SECONDS,
            lease_ttl_seconds=settings.JOB_VIDEO_PREDICTION_DISPATCH_LEASE_TTL_SECONDS,
            key_prefix=settings.JOB_VIDEO_PREDICTION_DISPATCH_KEY_PREFIX,
            fast_url=settings.JOB_VIDEO_PREDICTION_FAST_URL,
            slow_url=settings.JOB_VIDEO_PREDICTION_SLOW_URL,
        )

    return _dispatcher
