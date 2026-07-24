# Tasks

## Phase 0 — orient (do this first, in the fresh session)
- [ ] Read `proposal.md` + `design.md` (the antipattern catalog A–G and the NOT-a-finding guard).
- [ ] Read the two reference commits as worked examples: `git show 787381e991`, `git show 47ab25c7a1`.
- [ ] Skim `packages/volt-cli/ARCHITECTURE.md` for the load-bearing asymmetries that must NOT be flagged.

## Phase 1 — fan-out audit (read-only, one agent per subsystem)
Spawn one audit agent per subsystem below. Each gets `design.md`, its path, and the two reference commits, and
returns a structured findings list (file:line · class A–G · severity · one-line scenario · proposed action).
Nothing is edited in this phase.
- [ ] 1. `Volt.Cli` — CLI verbs + `Sync/*` (BridgeClient, BridgeResolver, Config, Commands, sidecar)
- [ ] 2. `Volt.Cli.Connector*` — connector core, ControlServer, TrayContext, the two `IProjectSource`s
- [ ] 3. `Volt.Engine` — `Wire/` (host, DTOs), `Ide/` (driver contract), `Sync/` (op services)
- [ ] 4. `Volt.Cli.Ide.Codesys` + `Volt.Cli.Ide.Twincat` — the drivers (asymmetry-aware; file `keep?` when unsure)
- [ ] 5. `volt-control/src` — health/status/actions/connector (class B/F most likely)
- [ ] 6. `volt-vscode/src` + `volt-desktop/src` — the frontends (class F: UI re-deriving what the endpoint returns)
- [ ] 7. `volt-lsp-iec/src` — the LSP (class D/G most likely)

## Phase 2 — synthesize + triage
- [ ] One synthesis agent merges all findings, dedups cross-subsystem ones (a shape duplicated across packages = ONE
      finding), and fills the ledger below, ranked most-impactful first.
- [ ] A human skims the ledger and marks each row `go` / `skip` / `discuss` before any edits.

### Findings ledger (filled by Phase 2 — CLI package fan-out, 4 agents)
Ranked most-impactful first. `Verdict` column awaits a human `go`/`skip`/`discuss`.

| # | Class | Location | Finding (1 line) | Sev | Action | Verdict |
|---|-------|----------|------------------|-----|--------|---------|
| 1 | E+B | `ConnectionManager.cs:118-147,209-238` · `PipeProjectSource.cs` · `CodesysProjectSource.cs` · `IProjectSource.cs` | Per-source `ProbeAsync` + per-vendor `State.Health` re-fetch `health` a 2nd time each tick, duplicating serving/status the enumerated rows already carry; only adds "bridge up but 0 projects" (amber vs gray). The 787 fix, surviving one level up. | high | collapse: `EnumerateAsync`→`(rows,reachable)`; derive `Aggregate` from rows; delete `ProbeAsync`+`State.Health`+`HealthOf` | |
| 1b | C | `HealthProbe.cs:29-43,73-86` · `HealthProbe.cs:23-24` · `PipeProjectSource.cs:100` | Falls out of #1: `HealthProbe.ProbeAsync(vendor)` (0 callers, obsolete one-pipe-per-vendor), `Describe` (0 callers), `BridgeHealth.ProjectName`/`ProjectDirty` (write-only), `WireProjectRow.Vendor` (deserialized, never read). | high | delete | |
| 2 | C | `Twincat/Ide/TcObjectModel.cs:30,44,65` · `Twincat/Ide/RotInstances.cs:164` | Dead `ProgId`/`_ideProgId`/`IdeProgId` chain — 0 consumers, computed every `Connect`. Orphaned by the 787 wire cleanup. | med | delete | |
| 3 | C | `Twincat/Ide/RotInstances.cs:145,155` · `TcInstance.IdeName`/`.Solution` | `IdeName`+`Solution` populated in `Enumerate()` but never read; `Solution.FullName` is a cross-process COM read **per instance every ~5s poll** — wasted hot-path work. | med | delete fields + stop reading `solution.FullName` | |
| 4 | C | `Ide/DriverBase.cs:18,25` · `Ide/IIdeSession.cs:23` | `DegradedReason` is write-only (set, never read in prod; `RowStatus` reads the separate `_isDegraded` bool). Wire field gone in 787, backing state left. | med | delete getter+field+assignments; keep `reason` param on `MarkDegraded` | |
| 5 | C | `Sync/Commands.cs:147-149` · `Sync/Config.cs:75-84` | Pull's `fetched.Platform is null && fetched.ProjectName is null` compat branch is **always false** (single-versioned toolchain; `Platform` is non-null `""`). Dead branch + its extra `GetHealth()` round-trip + `Config.VerifyBinding` (sole caller). | med-high | collapse: call `VerifyFetchedIdentity` unconditionally; delete `VerifyBinding` | |
| 6 | G | `Sync/Scaffold.cs:37-38` | `.vscode/settings.json` hardcodes the `*.fb *.prg …` source-extension set that `ItemKind.FileExtensions` owns and `Extensions.cs` already derives from → new kind silently drifts. | med-low | derive from `ItemKind.FileExtensions.Where(IsSource)` | |
| 7 | G | `Sync/Commands.cs:234,235,252,263,284,292` | Push compares `r.Kind` against raw `"delete"`/`"rename"` literals; `DiffKinds` constants used everywhere else → rename a constant, Push silently stops matching. | low | use `DiffKinds.Delete`/`.Rename` | |
| 8 | B | `Ide/ProjectItem.cs:12` | `IsTopLevelCrud` duplicates `ItemKind.IsTopLevelCrud(KindCode)`; internal DTO, one consumer (`PushService.cs:51`). | low | derive at the call site; drop the field | |
| 9 | A | `Program.cs:133` | `status --json` hand-builds an anonymous subset of `StatusData` → add a field, edit two places. | low | `[JsonIgnore]` the pretty-only fields, serialize the type | |
| 10 | E | `Twincat/Driver/BeckhoffDriver.Tree.cs:104,106` | `FindItemByName` calls `_om.ItemType(child)` twice (2 COM reads) for the same child. | low | cache in a local | |
| 11 | C | `Twincat/Ide/TcObjectModel.cs:51` | `WantProject` getter unused (`_wantProject` read directly). | low | delete getter | |
| 12 | D | `Ide/IIdeSession.cs:29` | `TriggerAsyncProbe` on the vendor seam is only ever a driver self-call, never polymorphic. | low | keep `abstract` on `DriverBase`, remove from `IIdeSession` | |
| 13 | C | `Wire/Instances.cs` | Filename is a leftover from the removed `instances` op; file holds `ProjectEntry`+`ConnectRequest`, no `Instances` type. | low | rename file to `ProjectEntry.cs` | |
| 14 | G | `Sync/BridgeResolver.cs:38,46` | `AMBIGUOUS_BRIDGE` bare literal where siblings use `BridgeErrorCodes` constants. | low | shared code constant | |
| K1 | — | `IProjectSource` (2 impls) | CODESYS per-pipe vs TwinCAT one-worker discovery — load-bearing asymmetry (ARCHITECTURE). | keep | — | |
| K2 | B | `ConnectionManager.cs:40,140` `State.Serving` | Duplicates row `Serving` BUT compensates for a stale stored `Selected` at connect-time (`Aggregate` line 225). Only `Snapshot`'s lookup is redundant. | keep | — | |
| K3 | G | `Codesys/Driver/CodesysDriver.Code.cs:32-41` + `Twincat/Driver/BeckhoffDriver.Code.cs:32-46` | `WriteXml` restore-on-failed-import (data-safety policy) is byte-identical in both drivers → could drift per vendor and lose a POU. | keep? | consider a Core `WriteXmlWithRestore(read,delete,import)` helper | |
| K4 | G | `CodesysTypeMap.cs:111-125` + `BeckhoffDriver.Tree.cs:137-146` | warn-once-unclassified-kind pattern hand-copied into both drivers (diagnostic only). | keep? | optional tiny shared `warn-once(key,msg)` helper | |
| K5 | A/D | `Sync/Types.cs:126-137` + `Commands.cs:375` | `BuildResult` re-wraps `BuildResponse` 1:1 + a `Refuse()` factory — the only verb that re-wraps its wire DTO. | keep? | legitimate `--json` output boundary; flagged for the inconsistency | |

**Out of CLI scope, found in passing:** `packages/volt-control/src/bridge/connector.test.ts:83` still asserts `h.health.ideName` — a wire field removed in 787. Stale test.

## Phase 3 — apply the wins
- [ ] Work the ledger top-down. Each finding (or a tight cluster) = one self-contained commit.
- [ ] Every commit lands with the C# (`Volt.Cli.Tests` / `Volt.Engine.Tests` / `Volt.Cli.Connector.Tests`),
      volt-control (`bun test`), and — where touched — e2e suites green. Update `ARCHITECTURE.md` when a shape changes.
- [ ] For any wire/CLI-contract change, update the client-side DTOs on the far side (connector, volt-control, e2e
      harness) in the SAME commit — the two reference commits show the full blast radius.

## Phase 4 — guard against re-rot
- [ ] For each class that can silently regress (a collapsed shape re-nested, a vocabulary re-spelled, a field
      re-duplicated), add a cheap guard test where one exists in the `VendorParityGuardTests` /
      `WireVocabularyGuardTests` mould. Skip where a guard would cost more than the drift it prevents — record that
      decision so the next audit doesn't re-litigate it.

## Notes
- Keep it **endpoint-first**: the target end-state is that what each layer exposes IS its source's shape. When in
  doubt between "add a field to the source" and "derive it in the consumer", prefer putting it on the source once
  (that is the direction both reference fixes went — e.g. per-project `status` moved onto the row).
- This change archives when the ledger is worked through (or its remaining rows are explicitly deferred with a
  reason). Partial completion is fine — it is an audit, not an all-or-nothing migration.
