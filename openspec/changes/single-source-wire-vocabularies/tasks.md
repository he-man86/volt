## 0. Ground rules (apply to every phase)

- [x] 0.1 Each phase is its own commit. Introduce the constant initialized to the EXACT current literal, then swap
      call sites literal→reference in the SAME commit, so the diff is provably value-preserving.
- [x] 0.2 After every phase: `dotnet test test/Volt.Engine.Tests/` (incl. `WireContractParityTests`) +
      `dotnet test test/Volt.Cli.Tests/` green, and `bun volt-scripts/check-wiring.ts` green. Never change a wire value.

## 1. Item kinds — the highest-value win (kills the hand-maintained reverse map)

- [x] 1.1 In `Volt.Engine/Workspace/ItemKind.cs`: add a nested `static class Kinds` of `const string` members for
      every kind name currently produced by `Map()` (`Kinds.FunctionBlock = "function_block"`, `Program`, `Function`,
      `Interface`, `Dut`, `Gvl`, `Method`, `Action`, `Property`, `Library`, `Device`, `Task`, …) — values IDENTICAL to
      today's. Rewrite `Map()`'s switch ARMS to return these consts, so the string values live in one place.
- [x] 1.2 NOTE (corrected after reading the code): `PushService.PouKindToCode`/`ChildKindToCode` (530-547) are NOT a
      pure `Map()` inverse — they're legit domain maps (kind→IDE *create* code, with the interface/non-interface split).
      Do NOT delete them. The duplication is the kind-string LITERALS in their `case` labels; swap those for the
      `Kinds.*` consts (a `const string` is a valid switch pattern). Same for every `kind is "gvl" or "dut"` comparison.
- [x] 1.3 Replace the raw kind literals with the consts across the ~15 sites the audit listed: `PushService.cs`
      (294/391/396/399), `FetchService.cs` (100/120), `DebugService.cs:61`, `Materializer.cs` (13/151),
      `PouToStText.cs` (29/45/66/69), `StAssembler.cs` (47/72/143/166/169), `StSplitter.cs`
      (91/104/243/331-332/443/539), `CodeHelper.cs:55-71`, `Graphical/PouToXml.cs` (51-52/72),
      `CodesysDriver.Code.cs` (46/51), `BeckhoffDriver.Code.cs` (56/61). Leave the PLCopen-XML vocabulary
      (`PouToXml.cs:85-88`, `PlcOpenPouParser.cs`) ALONE — it's a different closed set.
- [x] 1.4 Confirm `WireContractParityTests` + `check-wiring.ts` still green (kind values are a cross-language contract).

## 2. Op codes + progress/active-op labels — one `Ops` const class

- [x] 2.1 Add `Ops` (`static class`, `const string`) in `Volt.Engine/Wire` with the 9 op names, values identical to
      today's wire strings.
- [x] 2.2 Reference it in `BridgePipeHost.cs` (the dispatch `case`s + `AllowedWhilePaused` + the `Busy(...)` labels),
      `BridgeClient.cs` (the `.Call(...)` sites), and both connector sources (`CodesysProjectSource.cs`,
      `PipeProjectSource.cs`) + `HealthProbe.cs:39`.
- [x] 2.3 Route the `ProgressFrame.Operation` labels (`RefsService`, `FetchService`, `PushService`, `BuildService`,
      `ProjectSnapshot`, `Commands.cs`) through the SAME `Ops` consts — the vocabulary that was duplicated a second time.
- [x] 2.4 Fix the `HealthProbe.cs:25` doc that says the active op is `"pull"` — the wire carries `"fetch"`. (Doc-only.)

## 3. Vendor id + display name — `Vendors` (C#) and one shared TS source

- [x] 3.1 Add `Vendors` (`const string` id + display name) in `Volt.Cli.Transport` beside `PipeNames`; `ForVendor`
      keys off the id. Values identical to today's (`codesys`/`CODESYS`, `twincat`/`TwinCAT`).
- [x] 3.2 Reference it across the connector/CLI/driver layers the audit listed (`Program.cs:52`, `BridgeResolver.cs:20`,
      `CodesysProjectSource.cs:18-19`, `ConnectorSetup.cs:24/31`, `CodesysDriver.cs:36/61/82`, `BeckhoffDriver.cs:56`,
      `PipeHost.cs:65`, `Twincat/Program.cs:11`). Do NOT touch `Volt.Engine` (the parity guard forbids vendor literals
      there — nothing to change).
- [x] 3.3 TS: pick the single source (`volt-control/src/bridge/health.ts` already has `Vendor`/`VENDORS`; `display.ts`
      has `displayName()`), export it, and import from `volt-lsp-iec` (`analysis/config.ts:11`, `detect-vendor.ts:18`)
      and `volt-vscode`/`volt-control` inline sites — deleting the 3 re-declarations + the 5 copy-pasted display ternaries.
      Run `bun typecheck` in each touched TS package.

## 4. Health-status words — a C# const set

- [x] 4.1 Add `HealthStatus` consts (`Healthy`/`Degraded`/`Unavailable`) — on `HealthResponse` or beside it in
      `Volt.Engine/Wire`. Reference from `DriverBase.cs:92`, `HealthResponse.cs:9` (default), `BridgePipeHost.cs:66`
      (pause), and the consumer match in `HealthProbe.cs:52-57`. C#-only vocabulary; values unchanged.

## 5. Error-code leaks — reference the canonical spelling

- [x] 5.1 Replace the 3 raw `"PLC_DISCONNECTED"` literals (`BridgeClient.cs:68`, `BridgeResolver.cs:33`, `:44`) with the
      canonical constant. The client-assembly `BridgeError` can't see `Volt.Engine`'s `BridgeErrorCodes` — give that
      assembly a one-line shared const (or reference the canonical) rather than leave the literal.
- [x] 5.2 Name `"INTERNAL_ERROR"` (`PipeServer.cs:99`) as a `BridgeErrorCodes` member and reference it.

## 6. Cross-language: only the reference-extension gap

- [x] 6.1 Extend `volt-scripts/check-wiring.ts` to also cross-check the reference extensions (`.library`/`.device`/
      `.task`) — the `server.ts:272` list — against the C# canonical, exactly as it already does for the 6 source
      extensions. Nothing else crosses the CLI boundary that needs a guard.

## 7. Rot-guard (turns the cleanup into a gate)

- [x] 7.1 Add a C# test on the `VendorParityGuardTests` model: strip comments, fail if a raw literal of a centralized
      vocabulary (kinds, ops, vendor ids, health-status, the error codes) appears outside its definition file. Prove it
      red by temporarily reintroducing one literal, then green. Scoped to intra-C# — it does not reach across the CLI.

## 8. Optional — internal enums (lowest value, last, droppable)

- [ ] 8.1 Result-kind discriminators (`ok`/`error`/`refused`/`conflict`/`rejected`, `Types.cs`) → a C# `enum`; update the
      `Program.cs`/`Commands.cs`/`Git.cs` comparisons. Internal only (no wire role).
- [ ] 8.2 Diff-row kind (`add`/`delete`/`rename`/`modify`, `Git.cs`/`Commands.cs`/`StatusModel.cs`) → a C# `enum`.
- [ ] 8.3 If the churn isn't paying for itself, STOP — these are cosmetic vs. phases 1–7.
