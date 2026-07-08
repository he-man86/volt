## Why

Long bridge operations run for many seconds with **no feedback**. A verbose `/fetch` materializes thousands of
items (pro2193 = 7 451; bakon-nano = 6 141); `/build` and a large `/push` are similarly slow. That latency is
fair — but today the VS Code extension shows only an **indeterminate spinner** (`vscode.window.withProgress` with
a title and no percentage — `commands.ts:52/81/180`), and the CLI/AI see nothing until the call returns. No sense
of "how far along am I", or whether it's wedged.

## Approach: events, not polling

Progress is **client-initiated** — the caller already holds the connection it opened for `/fetch`/`/push`/
`/build` and is waiting on it. So the right model is not a `/progress` endpoint to poll; it is to **stream the
operation's own response** — progress frames as the bridge works, then the final result frame. This is exactly
how `docker pull` / `npm install` / `git clone` report progress: one request, events stream back, result at the
end. No polling, perfectly correlated (progress belongs to *this* op — no "whose progress is this?"), real-time.

## What Changes

- **The wire streams (opt-in NDJSON).** When a client sends `Accept: application/x-ndjson`, `/fetch`, `/push`, and
  `/build` respond as a stream of newline-delimited JSON: zero or more `{"progress":{operation,done,total,phase}}`
  frames, then exactly one terminal `{"result":{…}}` (or `{"error":{…}}`). Without that header the response is
  the current single JSON body — so the change is **backward-compatible** and opt-in (cheap endpoints like
  `/refs` and `/health` never stream).
- **The service reports progress; the handler streams it.** The Sync/Build services take a progress callback and
  invoke it as they iterate (fetch: `done` of the known item count; push: `done` of the op count; build:
  coarse phases / indeterminate where the IDE exposes no granularity). The HTTP handler writes each frame to the
  open response as it fires (on the STA thread — a loopback write, serialized with the op), then the result frame.
- **`BridgeClient` reads incrementally.** A streaming variant reads NDJSON, invokes an `onProgress` callback per
  frame, and returns the terminal result. `getHealth`/`getRefs` stay buffered.
- **CLI → stderr (the AI + terminal see it).** `pull`/`push`/`build` use the streaming client and print a live
  progress line to **stderr** (gated to a TTY / a `--progress` flag so `--json` stdout stays clean).
- **VS Code → a real bar.** `volt-control` gains a streaming spawn (an `onProgressLine` from the CLI's stderr);
  the extension's existing `withProgress` calls `progress.report({ increment, message })`. Here the streaming
  spawn is the *right* seam — with a genuinely streaming CLI, the extension is legitimately downstream of it (no
  fabricated protocol; it consumes what the CLI already emits).

**Non-goals** (deliberately lazy): no separate `/progress` poll endpoint (superseded by streaming — it would be
polling, correlation-ambiguous, and wasteful); no generic job queue (single-IDE / single-STA-thread → one active
op); no fabricated build percentage where the IDE gives none (phase text instead).

## Consumers (CLI · UI · AI)

- **CLI** — `pull`/`push`/`build` send `Accept: application/x-ndjson`, read the stream, and print progress to
  stderr; a final one-line summary ("pulled 574 items, 3 changed, in 3.2s") ALWAYS prints (not TTY-gated) so it
  survives capture. In `--json` mode, stdout stays the single outcome object — progress/summary go to stderr only.
- **UI** — the extension already wraps these in `withProgress`; `volt-control`'s streaming spawn surfaces the
  CLI's progress lines, which drive `progress.report({ increment, message })` → a real bar.
- **AI** — the `volt` custom tool captures stdout+stderr, so the AI sees the progress trace + the summary line
  in the tool output (evidence the op advanced and how much work it did); the `--json` outcome it parses is
  unchanged. No AI-specific wiring — it rides the same stderr the CLI already emits.

## Clean implementation (not bolted on)

- **One response-writer seam.** `BridgeHttpServer` currently serializes-then-`Write`s a single body. Introduce a
  small writer the handler uses for BOTH shapes — buffered (`application/json`) and framed (`application/x-ndjson`)
  — chosen by the `Accept` header, so streaming is a first-class path, not a special-case branch bolted onto the
  existing write.
- **A progress callback, not global state.** The services take an `Action<ProgressFrame>` (no shared/static
  progress sink) — the STA op reports; the handler frames it. Explicitly NOT the `/progress` poll sink an earlier
  draft proposed.
- **Robust client.** The streaming read keys off the RESPONSE `Content-Type`: `x-ndjson` → frames; `json` → the
  single body. So a client that opted in but hit a plain response still works. (Wire-version mismatch is already
  refused by the preflight, so this is belt-and-suspenders.)
- **No mid-op cancellation (non-goal).** A client disconnect stops the stream; the op completes server-side (the
  STA fetch/build can't be safely interrupted mid-flight). Documented, not silently surprising.

## Docs

- **Update `packages/volt-bridge/openapi.yaml`** (the embedded contract served at `/openapi.yaml` + `/swagger`):
  document the `Accept: application/x-ndjson` variant on `/fetch`/`/push`/`/build`, the `application/x-ndjson`
  streamed response, and the `progress`/`result`/`error` frame schemas — so the Swagger UI and any contract
  consumer see the streamed shape, not just the buffered one.

## Impact

- `packages/volt-bridge` — `BridgeHttpServer` streams NDJSON for the three long verbs when
  `Accept: application/x-ndjson` (writes frames incrementally instead of one buffered `Write`); `FetchService` /
  `PushService` / `BuildService` take a progress callback and invoke it in their loops; the `progress` frame wire
  type. **Parity**: Core-level; both vendors stream identically.
- `packages/volt-git` — a streaming `BridgeClient` read (NDJSON) with an `onProgress` callback; the `progress`
  frame schema; `pull`/`push`/`build` emit stderr progress.
- `packages/volt-control` — a streaming spawn variant (`onProgressLine`) parsing the CLI's progress lines.
- `packages/volt-vscode` — drive the existing `withProgress` percentage from that stream.
- Backward-compatible: without the `Accept` header the wire is unchanged; a client that never opts in is
  unaffected.
