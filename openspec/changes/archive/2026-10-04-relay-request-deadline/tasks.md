## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: observations confirmed. CONFLICTS with keeping one mechanism: codesys-build-nesting's IDE_BUSY refusal already stops a write from queueing behind a write. No deadline is built. See the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"): the 2026-10-03
      build timings in `codesys-2026-10-03.log`, and that no deadline exists from `RelayTunnel.ServeAsync` through
      `PipeClient.Call` to `RunOnStaThread`. If refuted or intended, record why and stop. Then check the request
      against volt's design ("do not interpret op bodies", no negotiation, one entry point with every guard on it, a
      write is never aborted half-way). Record FITS, or CONFLICTS + why + the volt-native alternative. Build only
      what fits.
- [x] 0.2 **Not built** (superseded by codesys-build-nesting's `IDE_BUSY` refusal; no budget field, pipe deadline or `DEADLINE_EXCEEDED`.) Decide the shape: relative `budgetMs` vs an absolute deadline (clock skew between relay and laptop), which
      ops it applies to (push/build only, or reads too), and the error code's name.

## 1. Test red

- [x] 1.1 **Not built** (superseded by codesys-build-nesting's `IDE_BUSY` refusal; no budget field, pipe deadline or `DEADLINE_EXCEEDED`.) Tunnel test (in-memory relay): a request with a budget reaches the pipe with a deadline; one without has none.
- [x] 1.2 **Not built** (superseded by codesys-build-nesting's `IDE_BUSY` refusal; no budget field, pipe deadline or `DEADLINE_EXCEEDED`.) Host test: a push whose deadline passed while the IDE thread was held answers `DEADLINE_EXCEEDED` and the
      fake IDE records no write; a build that started in time runs to completion past its deadline.

## 2. Build

- [x] 2.1 **Not built** (superseded by codesys-build-nesting's `IDE_BUSY` refusal; no budget field, pipe deadline or `DEADLINE_EXCEEDED`.) Frame field, `PipeRequest` field, the check where the op gets the IDE thread, the error code, regenerated
      wire docs and `relay-protocol.md`.

## 3. Verify

- [x] 3.1 **Not built** (superseded by codesys-build-nesting's `IDE_BUSY` refusal; no budget field, pipe deadline or `DEADLINE_EXCEEDED`.) Live on CODESYS: start a long build, send a push with a 5 s budget; it is refused and the project is
      unchanged.
- [x] 3.2 **Not built** (superseded by codesys-build-nesting's `IDE_BUSY` refusal; no budget field, pipe deadline or `DEADLINE_EXCEEDED`.) Full C# suites and `bun run check` green.

## Close-out (2026-10-04)

- [x] codesys-build-nesting is archived (`2026-10-04-codesys-build-nesting`), so the guarantee this change's spec states
      — a relayed write never waits behind another write; it is refused `IDE_BUSY` — is built.
- [x] Final review (SPEC + LAYERING): the spec's second scenario ("a frame with a budget is served as without it") had
      no test. Added `RelayTunnelTests.A_request_with_a_budget_is_served_as_if_it_had_none` (a push with
      `budgetMs: 0` answers the same result as one without), and `docs/relay-protocol.md` now states under the
      request frame that unknown fields (a budget included) are ignored and that there is no request deadline.
      Layering: the field is ignored in `RelayFrames.Read` (the relay layer), the refusal lives in the pipe host's one
      gate (`BridgePipeHost`) — no tunnel-side guard, nothing interprets the body.
- [x] Full suites: all eight C# suites green (Relay 63, Contracts 39, Repo.Gates 136, Engine 2283+1 skip, Cli 263,
      Connector 115, Twincat 449, Codesys 305); `bun run check` green; full LSP suite COLD (`VOLT_RUSTC_CACHE=0
      VOLT_REQUIRE_FULL=1`) 8094 pass / 0 fail, 764 s.
