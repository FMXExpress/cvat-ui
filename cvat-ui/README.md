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

### Remote endpoint contract (`plugins/sam-remote`)

- Works even when Models app is disabled, via annotation top-bar fallback entry.

The remote plugin expects an endpoint that supports:

1. **Submit** (`POST <endpoint>`):
   - Body (`multipart/form-data`):
     - `video_file` (optional) or `video_url` (optional)
     - `params` (required JSON string with sampler params)
     - `callback_url` (optional)
     - `callback_token` (optional)
   - Response (`application/json`) should include:
     - `job_id` (or `jobId`/`id`) and/or `status_url` (or `statusUrl`)
     - optional `result_url` (`resultUrl`)

2. **Status** (`GET <status_url>` or `GET <endpoint>/status/<job_id>`):
   - Response should include `state` or `status` with values normalized to:
     - `pending`, `running`, `success`, `failed`, `canceled`
   - Optional `result_url` to fetch final result payload

3. **Output JSON schema** (status/result payload):
   - `selected_indices: number[]` (optional)
   - `candidate_indices: number[]` (optional)
   - `n_total_frames: number` (optional)
   - `error`/`message`/`detail` (optional error string for failures)
