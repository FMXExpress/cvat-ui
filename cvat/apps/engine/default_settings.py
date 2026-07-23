# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

import logging as log
import os

from attrs.converters import to_bool
from django.core.exceptions import ImproperlyConfigured

logger = log.getLogger("cvat")

MEDIA_CACHE_ALLOW_STATIC_CACHE = to_bool(os.getenv("CVAT_ALLOW_STATIC_CACHE", False))
"""
Allow or disallow static media cache for new tasks.
If disabled, CVAT will not allow task creation with static media cache.
New tasks requesting static media cache will be automatically switched to the dynamic cache.
When enabled, CVAT will allow task creation with static media chunks.

Static media cache can increase data access speed and reduce server load,
but significantly increase disk space occupied by tasks.
"""

CVAT_CACHE_ITEM_MAX_SIZE = 500 * 1024 * 1024
"""
Kvrocks limits the item size to 512 MB, which results “Connection reset” exception.
Let's check the data size and raise an understandable exception instead of the redis-py exception
Sets the maximum size in bytes of a data chunk item stored on redis_ondisk
"""

CVAT_CHUNK_CREATE_TIMEOUT = 50
"""
Sets the chunk preparation timeout in seconds after which the backend will respond with 429 code.
"""

CVAT_CHUNK_CREATE_CHECK_INTERVAL = 0.2
"""
Sets the frequency of checking the readiness of the chunk
"""
default_export_cache_ttl = 60 * 60 * 24
default_export_cache_lock_ttl = 30
default_export_cache_lock_acquisition_timeout = 50
default_export_locked_retry_interval = 60
default_job_video_download_token_ttl = 10 * 60
default_job_video_prediction_request_ttl = 24 * 60 * 60
default_job_video_prediction_webhook_grace_timeout = 15 * 60
default_job_video_prediction_reconciliation_max_scan = 1000
default_job_video_prediction_dispatch_mode = "queued"
default_job_video_prediction_max_concurrency_fast = 1
default_job_video_prediction_max_concurrency_slow = 1
default_job_video_prediction_dispatch_queue_timeout_seconds = 30.0
default_job_video_prediction_dispatch_max_queue_length_fast = 0
default_job_video_prediction_dispatch_max_queue_length_slow = 0
default_job_video_prediction_dispatch_poll_interval_seconds = 0.1
default_job_video_prediction_dispatch_lease_ttl_seconds = 120

EXPORT_CACHE_TTL = os.getenv("CVAT_DATASET_CACHE_TTL")
"Base lifetime for cached export files, in seconds"

if EXPORT_CACHE_TTL is not None:
    EXPORT_CACHE_TTL = int(EXPORT_CACHE_TTL)
    logger.warning(
        "The CVAT_DATASET_CACHE_TTL is deprecated, use CVAT_EXPORT_CACHE_TTL instead",
    )
else:
    EXPORT_CACHE_TTL = int(os.getenv("CVAT_EXPORT_CACHE_TTL", default_export_cache_ttl))


EXPORT_CACHE_LOCK_TTL = os.getenv("CVAT_DATASET_EXPORT_LOCK_TTL")
"Default lifetime for the export cache lock, in seconds."

if EXPORT_CACHE_LOCK_TTL is not None:
    EXPORT_CACHE_LOCK_TTL = int(EXPORT_CACHE_LOCK_TTL)
    logger.warning(
        "The CVAT_DATASET_EXPORT_LOCK_TTL is deprecated, use CVAT_EXPORT_CACHE_LOCK_TTL instead",
    )
else:
    EXPORT_CACHE_LOCK_TTL = int(
        os.getenv("CVAT_EXPORT_CACHE_LOCK_TTL", default_export_cache_lock_ttl)
    )

EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT = os.getenv("CVAT_DATASET_CACHE_LOCK_TIMEOUT")
"Timeout for cache lock acquiring, in seconds"

if EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT is not None:
    EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT = int(EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT)
    logger.warning(
        "The CVAT_DATASET_CACHE_LOCK_TIMEOUT is deprecated, "
        "use CVAT_EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT instead",
    )
else:
    EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT = int(
        os.getenv(
            "CVAT_EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT",
            default_export_cache_lock_acquisition_timeout,
        )
    )

if EXPORT_CACHE_LOCK_ACQUISITION_TIMEOUT <= EXPORT_CACHE_LOCK_TTL:
    raise ImproperlyConfigured("Lock acquisition timeout must be more than lock TTL")

EXPORT_LOCKED_RETRY_INTERVAL = os.getenv("CVAT_DATASET_EXPORT_LOCKED_RETRY_INTERVAL")
"Retry interval for cases the export cache lock was unavailable, in seconds"

if EXPORT_LOCKED_RETRY_INTERVAL is not None:
    EXPORT_LOCKED_RETRY_INTERVAL = int(EXPORT_LOCKED_RETRY_INTERVAL)
    logger.warning(
        "The CVAT_DATASET_EXPORT_LOCKED_RETRY_INTERVAL is deprecated, "
        "use CVAT_EXPORT_LOCKED_RETRY_INTERVAL instead",
    )
else:
    EXPORT_LOCKED_RETRY_INTERVAL = int(
        os.getenv("CVAT_EXPORT_LOCKED_RETRY_INTERVAL", default_export_locked_retry_interval)
    )

MAX_CONSENSUS_REPLICAS = int(os.getenv("CVAT_MAX_CONSENSUS_REPLICAS", 11))
if MAX_CONSENSUS_REPLICAS < 1:
    raise ImproperlyConfigured(f"MAX_CONSENSUS_REPLICAS must be >= 1, got {MAX_CONSENSUS_REPLICAS}")

DEFAULT_DB_BULK_CREATE_BATCH_SIZE = int(os.getenv("CVAT_DEFAULT_DB_BULK_CREATE_BATCH_SIZE", 5000))

DEFAULT_DB_ANNO_CHUNK_SIZE = int(os.getenv("CVAT_DEFAULT_DB_ANNO_CHUNK_SIZE", 2000))

MAX_JOBS_PER_TASK = int(os.getenv("CVAT_MAX_JOBS_PER_TASK", 5_000))

JOB_VIDEO_DOWNLOAD_TOKEN_TTL_SECONDS = int(
    os.getenv("CVAT_JOB_VIDEO_DOWNLOAD_TOKEN_TTL_SECONDS", default_job_video_download_token_ttl)
)
"Signed token TTL for job video downloads, in seconds."

JOB_VIDEO_DOWNLOAD_TOKEN_ONE_TIME_USE = to_bool(
    os.getenv("CVAT_JOB_VIDEO_DOWNLOAD_TOKEN_ONE_TIME_USE", False)
)
"If enabled, each job video token can be used only once."

JOB_VIDEO_DOWNLOAD_MAX_SIZE_BYTES = int(os.getenv("CVAT_JOB_VIDEO_DOWNLOAD_MAX_SIZE_BYTES", 0))
"""
Optional maximum allowed job video file size in bytes.
If <= 0, the size limit is disabled.
"""

JOB_VIDEO_DOWNLOAD_RATE_LIMIT_BPS = int(os.getenv("CVAT_JOB_VIDEO_DOWNLOAD_RATE_LIMIT_BPS", 0))
"""
Optional response transfer rate limit in bytes per second.
If > 0, sets X-Accel-Limit-Rate for reverse proxies that support it.
"""

JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS",
        default_job_video_prediction_request_ttl,
    )
)
"""
Video prediction request cache lifetime in seconds.
Must be between 1 and 24 hours.
"""
if not 60 * 60 <= JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS <= 24 * 60 * 60:
    raise ImproperlyConfigured(
        "JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS must be between 3600 and 86400 seconds"
    )

JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS",
        default_job_video_prediction_webhook_grace_timeout,
    )
)
"""
Grace timeout for pending video prediction requests before reconciliation triggers.
Must be > 0 and <= JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS.
"""
if (
    JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS <= 0
    or JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS > JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS
):
    raise ImproperlyConfigured(
        "JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS must be > 0 and <= "
        "JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS"
    )

JOB_VIDEO_PREDICTION_RECONCILIATION_MAX_SCAN = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_RECONCILIATION_MAX_SCAN",
        default_job_video_prediction_reconciliation_max_scan,
    )
)
"Maximum number of recent video prediction requests scanned in each reconciliation run."
if JOB_VIDEO_PREDICTION_RECONCILIATION_MAX_SCAN < 1:
    raise ImproperlyConfigured("JOB_VIDEO_PREDICTION_RECONCILIATION_MAX_SCAN must be >= 1")

JOB_VIDEO_PREDICTION_DISPATCH_MODE = os.getenv(
    "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_MODE",
    default_job_video_prediction_dispatch_mode,
).lower()
"Dispatch mode for outbound video prediction submits. Supported values: queued, parallel."
if JOB_VIDEO_PREDICTION_DISPATCH_MODE not in {"queued", "parallel"}:
    raise ImproperlyConfigured(
        "JOB_VIDEO_PREDICTION_DISPATCH_MODE must be one of: queued, parallel"
    )

JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_FAST = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_FAST",
        default_job_video_prediction_max_concurrency_fast,
    )
)
"Maximum concurrent outbound submissions for the fast pathway in parallel mode."
if JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_FAST < 1:
    raise ImproperlyConfigured("JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_FAST must be >= 1")

JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_SLOW = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_SLOW",
        default_job_video_prediction_max_concurrency_slow,
    )
)
"Maximum concurrent outbound submissions for the slow pathway in parallel mode."
if JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_SLOW < 1:
    raise ImproperlyConfigured("JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_SLOW must be >= 1")

JOB_VIDEO_PREDICTION_DISPATCH_QUEUE_TIMEOUT_SECONDS = float(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_QUEUE_TIMEOUT_SECONDS",
        default_job_video_prediction_dispatch_queue_timeout_seconds,
    )
)
"Timeout waiting for a dispatch slot in the prediction dispatch queue."
if JOB_VIDEO_PREDICTION_DISPATCH_QUEUE_TIMEOUT_SECONDS <= 0:
    raise ImproperlyConfigured(
        "JOB_VIDEO_PREDICTION_DISPATCH_QUEUE_TIMEOUT_SECONDS must be > 0"
    )

JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_FAST = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_FAST",
        default_job_video_prediction_dispatch_max_queue_length_fast,
    )
)
"Maximum queue length for fast-pathway prediction dispatch waiting slots. 0 disables limit."
if JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_FAST < 0:
    raise ImproperlyConfigured("JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_FAST must be >= 0")

JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_SLOW = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_SLOW",
        default_job_video_prediction_dispatch_max_queue_length_slow,
    )
)
"Maximum queue length for slow-pathway prediction dispatch waiting slots. 0 disables limit."
if JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_SLOW < 0:
    raise ImproperlyConfigured("JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_SLOW must be >= 0")

JOB_VIDEO_PREDICTION_DISPATCH_POLL_INTERVAL_SECONDS = float(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_POLL_INTERVAL_SECONDS",
        default_job_video_prediction_dispatch_poll_interval_seconds,
    )
)
"Poll interval while waiting for an outbound dispatch slot."
if JOB_VIDEO_PREDICTION_DISPATCH_POLL_INTERVAL_SECONDS <= 0:
    raise ImproperlyConfigured(
        "JOB_VIDEO_PREDICTION_DISPATCH_POLL_INTERVAL_SECONDS must be > 0"
    )

JOB_VIDEO_PREDICTION_DISPATCH_LEASE_TTL_SECONDS = int(
    os.getenv(
        "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_LEASE_TTL_SECONDS",
        default_job_video_prediction_dispatch_lease_ttl_seconds,
    )
)
"TTL for redis-backed in-flight dispatch counters."
if JOB_VIDEO_PREDICTION_DISPATCH_LEASE_TTL_SECONDS <= 0:
    raise ImproperlyConfigured("JOB_VIDEO_PREDICTION_DISPATCH_LEASE_TTL_SECONDS must be > 0")

JOB_VIDEO_PREDICTION_DISPATCH_KEY_PREFIX = os.getenv(
    "CVAT_JOB_VIDEO_PREDICTION_DISPATCH_KEY_PREFIX",
    "job-video-prediction:dispatch",
)
"Redis key prefix for prediction dispatch counters."

JOB_VIDEO_PREDICTION_FAST_URL = os.getenv("CVAT_JOB_VIDEO_PREDICTION_FAST_URL", "")
"Outbound remote URL for the 'fast' video prediction pathway."

JOB_VIDEO_PREDICTION_SLOW_URL = os.getenv("CVAT_JOB_VIDEO_PREDICTION_SLOW_URL", "")
"Outbound remote URL for the 'slow' video prediction pathway."

JOB_VIDEO_PREDICTION_AUTH_TOKEN = os.getenv("CVAT_JOB_VIDEO_PREDICTION_AUTH_TOKEN", "")
(
    "Optional bearer token sent as the Authorization header when submitting a "
    "video prediction request. Empty means no Authorization header (unauthenticated "
    "remotes such as a self-hosted SAM2 cog keep working); set a Replicate API "
    "token (r8_...) to call api.replicate.com."
)

JOB_VIDEO_PREDICTION_FAST_AUTH_TOKEN = os.getenv("CVAT_JOB_VIDEO_PREDICTION_FAST_AUTH_TOKEN", "")
"Per-pathway override of JOB_VIDEO_PREDICTION_AUTH_TOKEN for the 'fast' pathway."

JOB_VIDEO_PREDICTION_SLOW_AUTH_TOKEN = os.getenv("CVAT_JOB_VIDEO_PREDICTION_SLOW_AUTH_TOKEN", "")
"Per-pathway override of JOB_VIDEO_PREDICTION_AUTH_TOKEN for the 'slow' pathway."

JOB_VIDEO_PREDICTION_VERSION = os.getenv("CVAT_JOB_VIDEO_PREDICTION_VERSION", "")
(
    "Optional pinned model version added to the prediction payload. Set it (e.g. "
    "'owner/model:hash') to run a specific version via Replicate's POST "
    "/v1/predictions; leave empty for the /v1/models/{owner}/{model}/predictions "
    "latest-version endpoint or a self-hosted cog."
)

JOB_VIDEO_PREDICTION_FAST_VERSION = os.getenv("CVAT_JOB_VIDEO_PREDICTION_FAST_VERSION", "")
"Per-pathway override of JOB_VIDEO_PREDICTION_VERSION for the 'fast' pathway."

JOB_VIDEO_PREDICTION_SLOW_VERSION = os.getenv("CVAT_JOB_VIDEO_PREDICTION_SLOW_VERSION", "")
"Per-pathway override of JOB_VIDEO_PREDICTION_VERSION for the 'slow' pathway."

JOB_VIDEO_PREDICTION_AUTH_SCHEME = os.getenv("CVAT_JOB_VIDEO_PREDICTION_AUTH_SCHEME", "Bearer")
(
    "Authorization scheme prefixed to the token (default 'Bearer', which Replicate "
    "accepts; use 'Token' for services that require it, or empty to send the raw token)."
)

JOB_VIDEO_PREDICTION_ALLOW_REMOTE_URL_INPUT = to_bool(
    os.getenv("CVAT_JOB_VIDEO_PREDICTION_ALLOW_REMOTE_URL_INPUT", True)
)
"Temporary compatibility flag for legacy submit payloads that include remote_url."
