# Tasks

## Spike — go/no-go

- [ ] `ClientWebSocket` connects from inside a live CODESYS (IronPython host, net48) to a test WSS endpoint.
      Script written: `scripts/spike_codesys_websocket.py` — run via Tools -> Scripting -> Execute Script File.
      Five separately-failing steps (type loads / construct + Bearer header / TLS upgrade / frame round-trip /
      clean close); writes its verdict to `%LOCALAPPDATA%\Volt\logs\spike-websocket.txt`. **Awaiting a run on a
      machine with CODESYS.**
- [ ] Round-trip `refs` / `fetch` / `push` / `build` through a throwaway relay to both vendors; errors arrive coded.

## Volt.Relay

- [x] `packages/volt-cli/docs/relay-protocol.md` — the protocol as in design.md; written before the code.
- [ ] `src/Volt.Relay` (`netstandard2.0`, refs Contracts + Wire only): handshake, allowlist, per-request
      `PipeClient`, frame tagging, ping/watchdog, reconnect backoff, sidecar loader.
- [ ] `test/Volt.Relay.Tests`: against an in-memory relay + `FakeIde` pipe — allowlist refusal, coded errors,
      progress ordering, concurrent `health` during a long op, reconnect, malformed sidecar fails loud.
- [ ] `WireVocabularyGuardTests` covers the new assembly (op names only via `Ops`).

## The `logs` op

- [x] `Ops.Logs` + `LogsRequest`/`LogsResponse` in `Volt.Contracts`; `WireVocabularyGuardTests` sees them.
      (`VoltLog.cs` is allowlisted for the op vocabulary: it holds "logs" as the directory name.)
- [x] `BridgePipeHost` serves it off the IDE thread and past the disconnect gate, like `health`.
- [x] Tail logic (newest-first, spills into the previous day, line-boundary cut, `truncated`, shared read) as a
      pure function over a directory — unit-tested without a host. `LogTail.Read`, 14 tests in
      `Volt.Contracts.Tests/LogTailTests.cs`, including the 00:05 day-spill and reading a file VoltLog is
      appending to.
- [x] Test: `logs` answers while a long op holds the IDE thread (same shape as the `health` pipe test).
      `PipeTransportTests.Logs_answers_while_the_one_IDE_thread_is_busy_with_a_long_op` — its own test rather
      than an assertion bolted onto the health one, because the two sit in different dispatch arms and a later
      refactor could marshal one without the other.
- [ ] Test: the relay token never appears in the log after a tunnel start, reconnect and handshake failure.

## `refs` lists libraries

- [ ] Hoist `LibraryFetch.AppendLibrarySignatures`' LISTING half so `RefsService` can call it — names, folders
      and versions only. Rendering (`LibSignatureRenderer`) stays behind `fetch`.
- [ ] Test: `refs.items[lib] == fetch.items[lib]` for the same project state. `LibraryLayout`'s own header
      records that three views of a library item once disagreed (written folder, reported folder, version hash
      basis); `refs` is a fourth, and a mismatch makes `ifVersion` mis-fire on library items.
- [ ] Test: `refs` renders no signature body — assert the renderer is not called, so the push receipt (same
      `ProjectSnapshot` walk) pays nothing.
- [ ] Measure `refs` on the largest real project before/after; it is the op `volt status` runs.

## Hosts

- [ ] CODESYS: `start_volt_codesys.py` starts the tunnel when `volt-relay.json` sits beside it; `stop_volt_codesys.py`
      stops it.
- [ ] TwinCAT: standalone mode (no `--xae-pid`) + tunnel start from the sidecar.
- [ ] TwinCAT: single-file self-contained publish profile; `build-cli.ps1` emits `dist/TwincatStandalone/`.

## Docs

- [ ] ARCHITECTURE.md: rewrite the "never a network socket" bullet (see proposal); add `Volt.Relay` to the
      assembly list and the reference-graph rules.
- [ ] README.md layout table + `scripts/README.md` for the new publish output.
