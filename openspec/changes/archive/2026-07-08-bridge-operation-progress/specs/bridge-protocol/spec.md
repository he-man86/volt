## ADDED Requirements

### Requirement: Long operations stream progress on their own response

The bridge SHALL stream progress for a long operation (`/fetch`, `/push`, `/build`) on that operation's OWN
response when the client requests it via `Accept: application/x-ndjson` — not on a separate endpoint the client
must poll. When streaming is requested, the bridge SHALL respond with a stream of newline-delimited JSON:
zero or more progress frames `{"progress": {operation, done, total, phase}}` emitted as the operation proceeds,
followed by exactly one terminal frame — `{"result": …}` on success or `{"error": …}` on failure. Progress SHALL
be reported on the operation's OWN response (not a separate endpoint the client must poll), so it is inherently
correlated to that operation. When the total work is known up front (fetch item count, push op count) the frames
SHALL carry `done` and `total`; when the IDE exposes no granularity (a build) they MAY carry a phase message and
no fraction. When the client does NOT send `Accept: application/x-ndjson`, the bridge SHALL return the operation's
single JSON body unchanged (backward-compatible). Both vendor bridges SHALL stream identically (Core-level).

#### Scenario: A streaming client receives progress then a result
- **WHEN** a client sends `/fetch` with `Accept: application/x-ndjson`
- **THEN** it receives zero or more `progress` frames and then exactly one terminal `result` frame carrying the
  full fetch response

#### Scenario: A non-streaming client is unaffected
- **WHEN** a client sends `/fetch` without `Accept: application/x-ndjson`
- **THEN** it receives the current single JSON body, unchanged

#### Scenario: A known total yields a fraction; a build does not fabricate one
- **WHEN** the operation has a known total (fetch/push) versus none (build)
- **THEN** the progress frames carry `done`/`total` for the former and a phase message with no fraction for the latter

#### Scenario: A failure ends the stream with an error frame
- **WHEN** a streamed operation fails partway
- **THEN** the stream ends with a single `{"error": …}` terminal frame, not a truncated result
