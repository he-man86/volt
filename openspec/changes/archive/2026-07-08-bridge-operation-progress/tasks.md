## Bridge (Core) — stream the operation
- [x] `BridgeHttpServer`: when the request carries `Accept: application/x-ndjson`, respond to `/fetch`, `/push`,
      `/build` as a stream — write `{"progress":{…}}` frames as they fire, then one terminal `{"result":{…}}`
      (or `{"error":{…}}`). Without the header, keep the current single-JSON body (backward-compatible).
- [x] `FetchService` / `PushService` / `BuildService`: take an `Action<Progress>` callback; invoke it in the
      loop — fetch: `done` of the walked item count; push: `done` of the op count; build: phase/indeterminate.
- [x] The `progress` frame wire type (`{operation, done, total, phase, message}`).
- [x] Parity: Core-level; both vendors stream identically.

## Client (volt-git) — read the stream
- [x] A streaming `BridgeClient` read: parse NDJSON, invoke `onProgress(frame)` per progress frame, return the
      terminal result (or throw on the error frame). `getHealth`/`getRefs` stay buffered.
- [x] `progress` frame schema in `bridge/types.ts`.

## CLI (terminal + AI)
- [x] `pull`/`push`/`build` use the streaming read and print a live progress line to **stderr**, gated to a TTY
      or `--progress` so `--json` stdout stays clean.

## VS Code (GUI)
- [x] `volt-control`: a streaming spawn variant that surfaces the CLI's stderr progress lines via `onProgressLine`.
- [x] Drive the existing `withProgress` — `progress.report({ increment, message })` from the stream; indeterminate
      build → message only.

## Clean seams (refactor, don't bolt on)
- [x] `BridgeHttpServer`: one response-writer used for BOTH buffered (`application/json`) and framed
      (`application/x-ndjson`) responses, chosen by `Accept` — streaming is a first-class path, not a branch.
- [x] Services take an `Action<ProgressFrame>` callback (no shared/static progress sink).
- [x] Streaming client keys off the response `Content-Type` (x-ndjson → frames, json → single body) so an
      opted-in client that hits a plain response still works.

## CLI robustness
- [x] A final one-line summary ALWAYS prints (not TTY-gated) so it survives capture; progress LINES are TTY/
      `--progress`-gated; `--json` stdout stays the single outcome object (progress → stderr only).

## Docs
- [x] Update `packages/volt-bridge/openapi.yaml`: the `Accept: application/x-ndjson` variant on `/fetch`/`/push`/
      `/build`, the `application/x-ndjson` streamed response, and the `progress`/`result`/`error` frame schemas —
      so `/swagger` + contract consumers see the streamed shape.

## Tests
- [x] Bridge: an NDJSON request yields ≥1 progress frame then exactly one result frame; a non-NDJSON request
      yields the unchanged single body (backward-compat); a mid-op failure ends with a single `error` frame.
- [x] `volt-git`: the streaming read invokes `onProgress` per frame and returns the terminal result; a plain
      `json` response (opted-in but unstreamed) still parses.
- [x] AI path: the `volt` tool output contains the summary line (progress trace is captured stderr).

## Notes
- No `/progress` poll endpoint (superseded by streaming). Single active op (single STA thread). Build percentage
  is best-effort — phase text where the IDE exposes no granularity.
