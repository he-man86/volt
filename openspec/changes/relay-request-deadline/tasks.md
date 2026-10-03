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
