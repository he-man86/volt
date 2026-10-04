## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, except that the push verdict IS logged at Info, without the id and version. PARTLY FITS: the abandoned-outcome line, built within relay-request-logging, and the build end line at Info. No ledger, report frame or pipe tag. See the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"): that a pipe call
      outlives its connection and its outcome reaches only a Debug line (`RelayTunnel.cs:298-303`), and that no engine
      line carries the relay id. If refuted or intended, record why and stop. Then check the request against volt's
      design ("exactly one terminal frame, or the socket closes", "do not answer an id the relay has given up on",
      "do not synthesize frames"). Record FITS, or CONFLICTS + why + the volt-native alternative (for example a
      relayable `outcome {id}` query instead of a pushed report). Build only what fits.
- [x] 0.2 **Not built** (no ledger and no report frame: the identical re-send under the lease already resolves it.) Decide the ledger's bound (count and age) and the report's frame shape.

## 1. Test red

- [x] 1.1 **Not built** (no ledger and no report frame: the identical re-send under the lease already resolves it.) Tunnel test (in-memory relay): drop the socket while a fake push runs, let it complete, redial; the new
      connection carries one report naming the id and verdict, and no `result` frame for that id.
- [x] 1.2 Tunnel test: the abandoned request's Info line names op, id and outcome. (Green on arrival: relay-request-logging
      built the line. `A_push_completed_after_the_connection_went_logs_its_verdict_and_is_never_answered` pins the push
      case with a redial and no frame for the id; the relay-close end-line test pins "nothing in flight, no line".)
- [x] 1.3 **Not built** (no request tag on `PipeRequest`: the tunnel's terminal line pairs id and outcome. The build end line at Info is tested under 2.1.) Host test: a tagged push and a tagged build log the tag; an untagged one logs as before.

## 2. Build

- [x] 2.1 Built PARTLY: the abandoned request's outcome in relay-request-logging's terminal line (push: verdict and
      `newProjectVersion`, `delivered=no`), and `BuildService`'s end line at Info. Not built: ledger and report in
      `RelayTunnel`, the optional tag on `PipeRequest`, ids in push/build lines, a build-start line, and the report
      in `relay-protocol.md`.

## 3. Verify

- [ ] 3.1 Live on CODESYS: start a push, drop the relay connection mid-push (restart a local relay while the
      push runs); the bridge log has the push's outcome on one line with its id, and the redialled connection
      carries nothing for it. (Changed from "reports the outcome": no report frame is built.)
- [ ] 3.2 Full C# suites and `bun run check` green.
