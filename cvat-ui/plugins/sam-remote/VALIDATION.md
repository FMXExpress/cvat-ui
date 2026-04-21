# SAM Remote Observability Targeted Validation

Date: 2026-04-21 (UTC)
Scope: `cvat-ui/plugins/sam-remote/src/ts`
Method: targeted static validation + TypeScript/lint checks in CI-like local environment.

## Validation summary

1. **Observability tab is present in the SAM Remote dialog** ✅
   - Verified in `remote-runner.tsx` tabs list (`key: 'observability'`, `label: 'Observability'`, renders `SAMRemoteObservabilityTab`).

2. **Health degraded behavior** ⚠️ **Partially validated**
   - **Stale marker:** implemented as a gold `Tag` (`stale`) when Redis is degraded.
   - **Unavailable message:** implemented with warning `Alert` message `Prediction dispatch is degraded (Redis unavailable)`.
   - **Red badge:** not found in current implementation (no `Badge` usage in SAM Remote runner/observability components).

3. **Pathway metrics render for multiple/dynamic pathway keys** ✅
   - Implemented with `Object.entries(status?.pathways || {})` and rendered through `List` rows.

4. **Per-job requests auto-refresh interval behavior** ✅
   - Auto-refresh schedules at **5s** when any request is non-terminal (`hasPendingRequests` true), otherwise **30s**.

5. **Removed debug override field and payload references** ✅
   - No `debug`/`override` tokens found in `plugins/sam-remote/src/ts`.
   - Submission payload in `submitVideoPrediction` only includes: `stride`, `n_clusters`, `budget`, `include_first`, `video`.

6. **Empty/error handling for new API responses** ✅
   - Dispatch status and requests API calls throw explicit errors on non-OK responses.
   - Requests API gracefully returns empty array for non-list payloads.
   - Observability tab displays section-level errors and empty-state messages.

## Commands used

```bash
rg -n "observability|Observability" cvat-ui/plugins/sam-remote/src/ts/remote-runner.tsx
rg -n "dispatchDegradedMessage|staleLabel|redis_ok|Alert|Tag" cvat-ui/plugins/sam-remote/src/ts/remote-observability-tab.tsx
rg -n "Object\.entries\(status\?\.pathways" cvat-ui/plugins/sam-remote/src/ts/remote-observability-tab.tsx
rg -n "setTimeout|hasPendingRequests \? 5000 : 30000|TERMINAL_REQUEST_STATES" cvat-ui/plugins/sam-remote/src/ts/remote-observability-tab.tsx
rg -n "debug|override" cvat-ui/plugins/sam-remote/src/ts
rg -n "submitVideoPrediction|stride:|n_clusters:|budget:|include_first:|video:" cvat-ui/plugins/sam-remote/src/ts/remote-runner.tsx
rg -n "getPredictionDispatchStatus|getJobPredictionRequests|Failed to fetch|No prediction requests yet|No global queue pathways reported" cvat-ui/plugins/sam-remote/src/ts/remote-client.ts cvat-ui/plugins/sam-remote/src/ts/remote-observability-tab.tsx
yarn workspace cvat-ui run type-check
./node_modules/.bin/eslint cvat-ui/plugins/sam-remote/src/ts/remote-observability-tab.tsx cvat-ui/plugins/sam-remote/src/ts/remote-runner.tsx cvat-ui/plugins/sam-remote/src/ts/remote-client.ts
```
