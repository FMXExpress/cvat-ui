# cvat-ui module

## Description

This is a client UI for Computer Vision Annotation Tool based on React, Redux and Antd

## Commands

- Installing dependencies:
```bash
yarn --immutable
```

- Running development UI server with autorebuild on change

```bash
yarn run start
```

- Building the module from sources in the `dist` directory:

```bash
yarn run build
yarn run build --mode=development     # without a minification
```

Important: You also have to run CVAT server (please read `https://docs.cvat.ai/docs/contributing/`)
to correct working since UI gets all necessary data (tasks, users, annotations) from there

## Client plugins

The UI webpack build always includes the built-in plugins:

- `plugins/sam`
- `plugins/sam-remote`

To customize plugin loading, pass `CLIENT_PLUGINS` as a colon-separated list:

```bash
CLIENT_PLUGINS="plugins/custom-plugin" yarn run build
```

`CLIENT_PLUGINS` supports optional prefixes for built-in plugins:

- `-<path>` disables a default plugin
- `+<path>` (or no prefix) enables/adds a plugin

Examples:

```bash
# Keep SAM enabled, disable SAM remote, and add a custom plugin
CLIENT_PLUGINS="-plugins/sam-remote:plugins/my-plugin" yarn run build

# Disable SAM while leaving SAM remote enabled
CLIENT_PLUGINS="-plugins/sam" yarn run build
```

### CVAT-managed remote prediction flow (`plugins/sam-remote`)

- Works even when Models app is disabled, via annotation top-bar fallback entry.
- The browser talks only to CVAT endpoints. CVAT backend calls the configured remote SAM predictor and handles webhook/callback delivery.

Flow overview (request lifecycle):

1. **Video access minting** (browser → CVAT)
   - `POST /api/jobs/<job_id>/video/access`
   - CVAT returns a temporary `download_url` for the current job video and optional metadata (`expires_at`, `media`, `frame_hints`).

2. **Prediction submit** (browser → CVAT)
   - `POST /api/jobs/<job_id>/video/predictions`
   - Payload:
     - `remote_url`: predictor URL CVAT backend should call (absolute URL or CVAT path)
     - `input`: SAM request payload sent by CVAT to the remote service
   - CVAT responds with `request_id` (and optional `status`/`detail`).

3. **Prediction status polling** (browser → CVAT)
   - `GET /api/jobs/<job_id>/video/predictions/<request_id>`
   - Poll until terminal state:
     - `completed`, `failed`, or `expired`
   - Non-terminal states include `pending` and `running`.
   - Polling timeout semantics in `pollVideoPredictionStatus`:
     - `maxTimeoutMs` is optional.
     - If `maxTimeoutMs` is a finite positive number, polling stops on timeout and returns a failed result.
     - If `maxTimeoutMs` is omitted (default in `remote-runner.tsx`), polling continues until a terminal state
       or explicit cancellation (`AbortSignal`, e.g. UI **Cancel** button / component unmount).
     - Exponential backoff is unchanged (`initialDelayMs` default 1000, `maxDelayMs` default 10000).

4. **Webhook handling** (CVAT backend ↔ remote SAM service)
   - CVAT backend owns callback/webhook communication with the remote predictor.
   - Final status payload returned by CVAT may include normalized fields from webhook data (`selected_indices`, `candidate_indices`, `n_total_frames`, `keyframes`, optional `webhook_payload`).

#### Required `input` fields for remote SAM service

`input` is passed through by CVAT to the remote predictor. The plugin currently sends:

- `stride` (number)
- `n_clusters` (number)
- `budget` (number)
- `include_first` (boolean)
- `video` (string, usually the minted CVAT `download_url`)

#### Where `remote_url` is configured

`remote_url` can come from:

- Plugin runtime config: `window.CVAT_SAM_REMOTE_PLUGIN_CONFIG.remoteURL` (or deprecated alias `endpoint`)
- User override in the SAM Remote form (`Remote prediction URL`)

Default UI value is `/api/lambda/functions/sam-remote`.

#### Example API snippets (`request_id` lifecycle)

Submit prediction request:

```http
POST /api/jobs/42/video/predictions
Content-Type: application/json

{
  "remote_url": "https://predictor.example/sam/predict",
  "input": {
    "stride": 5,
    "n_clusters": 16,
    "budget": 20,
    "include_first": true,
    "video": "https://cvat.example/api/jobs/42/video/access/download?token=..."
  }
}
```

Submit response:

```json
{
  "request_id": "req_01JY8M7J6FX9K2E1WQ9KAH3WQ2",
  "status": "pending"
}
```

Status polling response (running):

```json
{
  "request_id": "req_01JY8M7J6FX9K2E1WQ9KAH3WQ2",
  "state": "running"
}
```

Status polling response (completed):

```json
{
  "request_id": "req_01JY8M7J6FX9K2E1WQ9KAH3WQ2",
  "state": "completed",
  "selected_indices": [0, 21, 42, 63],
  "candidate_indices": [0, 7, 14, 21, 28, 35, 42, 49, 56, 63],
  "n_total_frames": 64,
  "keyframes": {
    "selected_indices": [0, 21, 42, 63]
  }
}
```
