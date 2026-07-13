# Deployment configuration

## Video prediction dispatch environment variables

The backend reads these settings on startup from environment variables. To apply changes, restart CVAT backend workers and web containers.

* `CVAT_JOB_VIDEO_PREDICTION_DISPATCH_MODE` - dispatch strategy, one of `queued` or `parallel`.
* `CVAT_JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_FAST` - max concurrent in-flight submits for the fast pathway (`>= 1`).
* `CVAT_JOB_VIDEO_PREDICTION_MAX_CONCURRENCY_SLOW` - max concurrent in-flight submits for the slow pathway (`>= 1`).
* `CVAT_JOB_VIDEO_PREDICTION_DISPATCH_QUEUE_TIMEOUT_SECONDS` - maximum wait time in queue before submit returns `503` (`> 0`).
* `CVAT_JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_FAST` - max number of waiting requests for the fast pathway (`>= 0`, `0` disables limit).
* `CVAT_JOB_VIDEO_PREDICTION_DISPATCH_MAX_QUEUE_LENGTH_SLOW` - max number of waiting requests for the slow pathway (`>= 0`, `0` disables limit).
* `CVAT_JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS` - grace period for `pending` requests before reconciliation considers the webhook missing (`> 0` and `<= CVAT_JOB_VIDEO_PREDICTION_REQUEST_TTL_SECONDS`).
* `CVAT_JOB_VIDEO_PREDICTION_RECONCILIATION_MAX_SCAN` - max number of recent requests scanned in one reconciliation run (`>= 1`).

Validation is performed during startup. Invalid values fail fast with `ImproperlyConfigured`.

### Prediction dispatch lifecycle logs

Video prediction dispatch emits structured lifecycle logs through the job logger (`slogger.job[...]`) with machine-parseable payloads under `extra.log_fields`.

Lifecycle events:

* `request_enqueued`
* `queue_head_acquired`
* `dispatch_slot_acquired`
* `dispatch_timeout`
* `queue_full`
* `remote_submit_success`
* `remote_submit_failure`

Each event includes consistent keys:

* `event`
* `request_id`
* `job_id`
* `pathway`
* `queue_wait_ms`
* `inflight_count`
* `dispatch_mode`
* `remote_url`

Failure events additionally include:

* `error_class`
* `error_detail`

## Video prediction webhook contract and fallback reconciliation

CVAT sends each prediction submit request with a callback URL in `webhook`. Providers are expected to:

1. Accept async submit (`Prefer: respond-async`).
2. Persist CVAT's `request_id`-bound callback URL.
3. POST the final payload to `/api/jobs/{job_id}/video/predictions/webhook/{request_id}?token=...`.
4. Include a `status` in the webhook payload when available.

Status precedence and finalization rules:

* Explicit failure statuses (`failed`, `error`, `cancelled`, etc.) finalize the request as `failed`.
* Non-terminal textual statuses (`pending`, `processing`, `queued`, `running`) normally keep the request `pending`.
* **Terminal output data has higher precedence than a non-terminal textual status.** If the webhook payload contains a non-empty `output` (or `keyframes`) object/array/string, CVAT finalizes the request as `completed`.
* After a request is no longer `pending`, CVAT acknowledges duplicate or late webhook deliveries idempotently with HTTP `202 Accepted` (after request/job/token validation).
* If a late webhook conflicts with already persisted terminal data/status, CVAT keeps the existing terminal result unchanged and only acknowledges receipt.

Concrete precedence example:

```json
{
  "status": "processing",
  "output": {
    "tracks": [
      {"id": "trk-1", "label": "car", "score": 0.98}
    ]
  }
}
```

Even though `status` is `processing`, CVAT treats this payload as terminal and marks the request `completed` because `output` is populated.

If the webhook is not delivered before the grace timeout (`CVAT_JOB_VIDEO_PREDICTION_WEBHOOK_GRACE_TIMEOUT_SECONDS`), CVAT can reconcile stale `pending` requests using:

```bash
python manage.py reconcile_video_predictions --limit 1000
```

Reconciliation behavior:

* If a `remote_prediction_id` exists and a status URL can be derived (`Location` response header, URL-like prediction id, or `{remote_url}/predictions/{id}`), CVAT polls provider status and finalizes the request (`reconciled` event).
* If status polling is unavailable or still non-terminal, CVAT finalizes the request as `failed` with `webhook_timeout`.

Both transitions are persisted through the same request result cache path and emitted as structured log events (`event: reconciled` or `event: webhook_timeout`).
