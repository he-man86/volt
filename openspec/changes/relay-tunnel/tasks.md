# Tasks

## Platform floor (NOT a go/no-go — see below)

There was a `ClientWebSocket` go/no-go here. It is removed: `start_volt_codesys.py` only LOADS
`Volt.Ide.Codesys` (`clr.AddReferenceToFileAndPath` → `PipeHost.Start`), that assembly is `net48`, and
`ClientWebSocket` ships in `System.dll` on .NET Framework 4.5+. There is nothing to discover. The spike script
that tested it through IronPython interop was testing a layer production never executes, and could only have
produced a false negative.

What actually needs deciding, and it is implementation detail rather than a gate:

- [ ] **Windows 8 is the floor.** `ClientWebSocket` on .NET Framework goes through the native WebSocket Protocol
      Component (`websocket.dll`), which Windows 7 / Server 2008 R2 do not have — it throws
      `PlatformNotSupportedException` there, and CODESYS 3.5 does run on Win7. Decide: refuse at tunnel start
      with a clear message naming the OS, or state the floor in the download. Either way the failure must not
      look like "the relay is down".
- [ ] **Proxy and TLS are explicit, not inherited by luck.** Set `Options.Proxy` from the system proxy and be
      deliberate about `ServicePointManager.SecurityProtocol` rather than relying on a machine's registry being
      sane. A corporate proxy that needs credentials is the likely field failure, and it should be a named
      error, not a silent reconnect loop.
- [ ] Round-trip `refs` / `fetch` / `push` / `build` through a throwaway relay to both vendors; errors arrive coded.

## Volt.Relay

- [x] `packages/volt-cli/docs/relay-protocol.md` — the protocol as in design.md; written before the code.
- [x] `src/Volt.Relay` (`netstandard2.0`, refs Contracts + Wire only): handshake, allowlist, per-request
      `PipeClient`, frame tagging, ping/watchdog, reconnect backoff, sidecar loader. Builds with 0 warnings.
      The socket is behind `IRelaySocket` so the tests drive the REAL tunnel against an in-memory relay.
- [x] `test/Volt.Relay.Tests`: against an in-memory relay + a REAL `BridgePipeHost` over a real named pipe —
      33 tests. `connect`/`disconnect` refused without touching the pipe, coded errors crossing intact,
      progress strictly before the terminal frame, `health` answering while a fetch holds the IDE thread,
      exactly one terminal frame per id, a malformed frame not taking the connection down, reconnect after a
      drop, and 14 sidecar cases (every malformed shape throws and names the file; no message carries a token).
      Only the socket is faked: mocking the pipe would assert the design's central claim against itself.
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
