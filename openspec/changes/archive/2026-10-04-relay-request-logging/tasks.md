## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, except that the end line is Warn, not Info. FITS. Total time only, the connection-end line names the pipe, and one line format shared with relay-outcome-ledger. See the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"): the unpaired ids in
      `twincat-2026-09-24.log`, the unlogged paths in `RelayTunnel.ServeAsync`, and the shared `try` that logs a failed
      send as "failed on pipe". If refuted or intended, record why and stop. Then check the request against volt's
      design (what the local log is for, no token in it, log volume) and against `relay-outcome-ledger` (one line
      format for an abandoned request). Record FITS, or CONFLICTS + why + the volt-native alternative. Build only
      what fits.
- [x] 0.2 (decided: only the total is logged. The queue/run split is **not built**: the tunnel cannot see the IDE-thread start without a new pipe field, and IDE_BUSY removes write-behind-write waits; only the total is logged.) Decide whether the queue wait is measured in the host (when the IDE-thread work starts) or only the total
      is logged.

## 1. Test red

- [x] 1.1 Tunnel tests with the injected log: a coded error, a non-relayable op, an abandoned request and a failed
      result send each produce exactly one terminal line with the expected outcome and `delivered` value.
- [x] 1.2 (watchdog cadence injectable via optional `pingEvery`/`silenceLimit` ctor args, test-only; defaults are the protocol's 25 s / 60 s) Tunnel tests: a relay close, a drop, the watchdog and a refused upgrade each produce one connection-end line
      with cause, age, in-flight ids and next dial.

## 2. Build

- [x] 2.1 (also carries relay-outcome-ledger's push verdict: `ok accepted|rejected newProjectVersion=<v>`, on every push and inside `abandoned`) The terminal line, separate pipe and delivery outcomes, the connection-end line; `relay-protocol.md` lists
      the lines.

## 3. Verify

- [x] 3.1 (2026-10-04, CODESYS SP21 fixture instance + the real tunnel with a ClientWebSocket against a local Bun relay: every `<-` paired; the coded error was WRONG_PROJECT — a fixture IDE serves a project, so PLC_DISCONNECTED is covered by the tunnel test, same code path; relay terminate mid-fetch logged `ended after 3s — dropped without a close … in flight: c1-fetch` then `-> fetch (c1-fetch) abandoned ok 1687ms delivered=no`; watchdog `ended after 75s — the watchdog dropped it (no frame for 60s)`; closes 1001/1000 each one Info line) Live: a session with a disconnected project, a relay restart mid-fetch and a watchdog drop; every `<-` in the
      log has its terminal line, and every end has its cause.
- [x] 3.2 (2026-10-04: Relay 58, Contracts 39, Connector 115, Codesys 305, Repo.Gates 136, Cli 262, Engine 2282+1 skipped; TwinCAT 447 green on a clean worktree of HEAD + this change — in the shared tree another session's uncommitted TcObjectModel edits fail 9; `bun run check` 18/0; typecheck green) Full C# suites and `bun run check` green.
