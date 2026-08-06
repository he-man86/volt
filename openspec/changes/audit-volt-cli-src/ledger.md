# Audit ledger — `packages/volt-cli/src`

Written by the main loop from schema-forced agent output — never appended to by agents concurrently.

## Baseline

| | |
|---|---|
| Files (source, excl. generated `obj/`) | 118 |
| LOC | 15,160 |
| Baseline build | ✓ 0 errors, **14 warnings** (see below — they are findings) |
| Baseline `Volt.Engine.Tests` | ✓ 313 passed / 0 failed |
| Baseline `Volt.Cli.Tests` | ✓ 116 passed / 0 failed |
| **Baseline e2e (live headless CODESYS)** | ✓ **92 passed / 8 skipped / 0 failed** — 100 tests, 19 files, 51 s |
| Started | 2026-07-30 |

The e2e baseline is the one that matters: it is the only gate that drives a real IDE over the pipe and proves
round-trip fidelity. CODESYS 3.5.21.40 headless, fixture `CodesysTestProject.project`, pipe
`volt.bridge.codesys.<pid>`, bridge rebuilt from this tree.

### The full e2e picture (both vendors, every skip accounted for)

| Suite | Result |
|---|---|
| CODESYS, main suite | ✓ 92 pass / 0 fail |
| CODESYS, `parallel-instances` (was skipped) | ✓ 3/3 — needs `VOLT_PIPE_SLOW`/`FAST`; SLOW must be the 9.9 MB `Pro2193…` fixture |
| TwinCAT, main suite | ✓ 90 pass / 0 fail |
| TwinCAT, `ide-restart` (was skipped) | **1 pass / 1 fail** — see `arch-notes.md`, top entry |
| TwinCAT, `libcache` | skipped **by design** — TwinCAT has no library-signature extraction (tracked parity gap, not config) |
| `Volt.Cli.Connector.Tests` (not in the documented gate) | ✓ 76/76 |

So: **nothing is skipped for want of configuration.** Of the original 8 (CODESYS) / 11 (TwinCAT) skips, the
counts include per-`describe` hook entries; the real content is `parallel-instances` (now run, green),
`ide-restart` (now run, one real failure) and `libcache` (a feature gap that cannot be unskipped).

Two test defects fixed while getting there, both instances of the **"no fallbacks" house rule broken in test
code** — a harness that guesses makes its own bug look like a product bug:

1. `harness.ts` picked `livePipes()[0]` including pipes whose **IDE pid is dead** (a killed XAE's worker serves
   its pipe for up to ~15 s until the connector reaps it, answering "waiting for an IDE project"). Now filtered
   by pid liveness — the pipe is named after the IDE's pid, so it's a cheap sync check — and there is no
   fall-back-to-dead-pipes branch.
2. `harness.ts` connected to the bare **prefix** when nothing was live, producing
   `ENOENT \\.\pipe\volt.bridge.codesys`. Now a loud error naming the actual condition and the launcher command.
3. `parallel-instances.test.ts:100` asserted the two instances' `projectVersion` **differ**, using a content hash
   as a proxy for identity. Volt's identity is vendor+name, never content, and two distinct projects with
   identical content hash identically — correct, and a normal real-world case (a project copied as a template
   stays byte-identical until edited). Both small CODESYS fixtures are the untouched stock empty project, so
   they legitimately collide. Assertion replaced; the distinct-project check off `health` above it already covers
   the intent.
4. `ide-restart.test.ts` now asserts its environment (**exactly one live XAE**) up front with the reset command
   in the message, instead of racing a kill-by-project-name against a second IDE.

> **Warm-up, not flake.** The first run 3 min after `codesys-pipe.ps1 up` gave 3 failures: the harness resolves
> the per-pid pipe **once**, and when CODESYS hasn't created it yet it falls back to connecting the bare prefix
> `volt.bridge.codesys` → `ENOENT`. Re-run warm: green. **Always wait for `\\.\pipe\volt.bridge.codesys.<pid>`
> to exist before running the suite**, or a comparison against this baseline is meaningless. (The harness's
> connect-to-prefix fallback is itself a finding — a fallback that hides "the IDE isn't up yet" behind a
> confusing `ENOENT`. Test-harness code, so out of the src audit's edit scope; logged in `arch-notes.md`.)

**Baseline compiler warnings** (pre-existing; each is a finding to be resolved in its batch):

- `Volt.Cli.Connector/StatusWindow.cs:274` CS0108 — `Capture(ProcessStartInfo)` hides `Control.Capture` → batch 12
- `Volt.Cli.Connector/StatusWindow.cs:242` CS8604 — possible null argument → batch 12
- test-project warnings (CS8767 nullability mismatch, xUnit1026 unused theory param, xUnit1031 blocking task
  ops ×8) — tests are out of scope for edits; logged for a separate pass

The target is **0 warnings in `src/` at close-out**; a warning that survives must be justified in this ledger.

## Totals

| | Found | Fixed | Skipped | LOC before | LOC after | Δ |
|---|---|---|---|---|---|---|
| **running total** | 0 | 0 | 0 | 0 | 0 | 0 |

Findings by kind: `bug` 0 · `legacy` 0 · `inconsistency` 0 · `dead-code` 0 · `defensive-fallback` 0 ·
`doc-drift` 0 · `style` 0

## Batches

## Batch 1 — `Volt.Cli.Transport` (9 files, 422 LOC) — PILOT

Gate: build ✓ 0 errors · `Volt.Engine.Tests` ✓ 313/313 · `Volt.Cli.Tests` ✓ 116/116 ·
`Volt.Cli.Connector.Tests` ✓ 76/76 · verifier verdict **accept, zero reverts** · committed `4c63935` (the bridge fix is `1082190`)

| File | Found | Fixed | Skipped (reason) | LOC before → after |
|---|---|---|---|---|
| `PipeServer.cs` | 3 | 3 | — | 129 → 120 |
| `PipeClient.cs` | 4 | 4 | — | 81 → 89 |
| `PipeMessages.cs` | 2 | 2 | — | 44 → 55 |
| `Ops.cs` | 1 | 1 | — | 20 → 20 |
| `PipeDiscovery.cs`, `PipeNames.cs`, `Vendors.cs`, `BridgeErrorCodes.cs`, `HealthStatus.cs` | 0 | 0 | — | unchanged |
| **group** | | | | **422 → 432 (+10)** |

Net +10 LOC: the group *gained* lines because two duplicated `JsonSerializerOptions` blocks were replaced by one
shared `PipeJson.Options` with a doc comment explaining the wire contract, and the error-frame branch grew a
loud protocol-violation path. Fewer moving parts, more explanation — the right direction for a wire.

### Notable

- **`PipeClient.cs` — dead defensive fallbacks removed** (`defensive-fallback`). The error-frame handler read
  `code`/`message` with `?? "ERROR"` / `?? ""`. The verifier proved repo-wide that neither can be missing: all 27
  `new BridgeException(` sites in `src/` pass a `BridgeErrorCodes.` const, `PipeError.Code/Message` are
  non-nullable with `= ""` defaults, `WhenWritingNull` omits only nulls, and `PipeServer.WriteFrame` is the only
  frame writer in the repo. So the fallbacks were unreachable *and* they hid a protocol violation behind an
  invented code. Now a malformed frame throws `MALFORMED_ERROR` carrying the raw frame JSON. **This removes a
  fallback; it does not add one.**
- **Duplicated JSON options unified** (`inconsistency`) — `PipeServer` and `PipeClient` each held a
  byte-identical `JsonSerializerOptions`; now one `PipeJson.Options`. Verified byte-neutral: both copies were
  CamelCase + `WhenWritingNull`, and every frame DTO carries an explicit `[JsonPropertyName]`.
- **`_acceptThread` was write-only** (`dead-code`) — assigned, never read; `Stop()`/`Dispose()` never touched it.
  A started thread is runtime-rooted, so demoting it changes no lifetime.
- **HTTP-era narrative removed** (`legacy` ×4) — "Mirrors the old NDJSON-over-pipe client", a stale op list in
  `PipeRequest` that omitted `connect`/`disconnect`, a `HealthProbe` reference that survives only in archived
  openspec prose, and `Volt.Cli.Transport.csproj:4` "the wire that replaces the HTTP server".
- Verifier follow-ups applied by hand: `PipeClient` is the single **C#** client (the TS e2e harness is a second,
  independent client), and the malformed-error throw carries `e.GetRawText()` so an operator gets the server's
  actual text.
- Skipped deliberately: `MALFORMED_ERROR`/`NO_RESULT` live outside `BridgeErrorCodes` and outside
  `WireContractTests`' vocabulary list. They are client-local and never travel on the wire, and the surgeon
  documented that in place — but a future re-spelling won't be caught by the guard. Left as-is; recorded here.

## Batch 2 — `Volt.Engine` contracts (3 groups, 22 files, 1,272 LOC)

Gate: build ✓ 0 errors / 11 warnings · 313/313 · 116/116 · 76/76 · verdicts **accept ×3, zero reverts** ·
not yet committed

| File | LOC before → after |
|---|---|
| `Ide/DriverBase.cs` | 155 → 171 |
| `Ide/ICodeStore.cs` | 32 → 45 |
| `Ide/IProjectTree.cs` | 40 → 47 |
| `Ide/PlcOpenTransport.cs` | 20 → 27 |
| `Ide/IIdeSession.cs` | 78 → 79 |
| `Ide/IIdeDriver.cs`, `Ide/IDebugIntrospect.cs` | 8 → 8, 16 → 16 (comment-only) |
| `BridgeException.cs` | 29 → 34 |
| `Wire/BridgePipeHost.cs` | 163 → 160 |
| `Wire/HealthResponse.cs` | 50 → 47 |
| `Wire/ProjectEntry.cs` | 39 → 40 |
| `Wire/PushModels.cs`, `Wire/RefsFetch.cs` | 115 → 115, 94 → 94 (comment-only) |
| `Diagnostics/VoltLog.cs` | 111 → 116 |
| `Library/LibraryManifest.cs` | 37 → 47 |
| `Library/LibSignatureRenderer.cs` | 129 → 134 |
| **batch** | **1,272 → 1,325 (+53)** |

Mostly comments, deliberately: this batch is the contract layer, and the surgeons applied a small fraction of what
was found (`Engine/Wire` applied **5 of 20**, skipping the rest as behavior-changing or out-of-group). +53 LOC of
*correct* documentation on the interfaces that define the vendor seam is a good trade.

### Notable — three comments were actively FALSE, which is worse than missing

- **`LibraryManifest.cs`** claimed "neither formats the manifest itself, so CODESYS and TwinCAT emit the same shape
  on the wire". False: CODESYS never calls `LibraryManifest.Resolution` at all
  (`CodesysObjectModel.cs:217-219` formats its own, and `ManagedLibDisplay` produces a comma-less, paren-less
  `title + " " + ver`), and `system:` is real on CODESYS but hardcoded `false` at `BeckhoffDriver.Code.cs:86`. The
  replacement documents the difference instead of denying it — and the stakes are higher than the old text implied:
  `FetchService.cs:107` parses `^RESOLUTION (.+)$` into `libByResolution` and looks it up by `sig.LibraryPath`, so
  "tidying" CODESYS's RESOLUTION format would desynchronize it from the language model's own path and dump **every
  library element into `(unresolved)`**. Refusing to unify it is correct, not timid.
- **`LibSignatureRenderer.cs`** said `__`-**prefixed** names are skipped; the code is `!n.Contains("__")`. Also
  marked a real defect it found: `Block()` tests `vs.Count == 0` on the *unfiltered* list, so an all-`__` pin set
  emits a bare `VAR_INPUT`/`END_VAR` pair (recorded as a `ponytail:` deferral, not silently fixed).
- **`DriverBase.cs`** claimed a "uniform health-response shape"; `BuildHealthResponse` is abstract and composed
  per vendor. The one real code change in the group: `_lastOkTick` now uses `Volatile.Read`/`Volatile.Write`
  instead of plain access, adding the fences its lock-free contract already assumed (the `unchecked` wraparound
  arithmetic preserved verbatim; `TickCount64` is unavailable on netstandard2.0, which is why the int subtraction
  stays).
- `VoltLog.cs`: the `Level` getter's lock was decorative — the hot path in `Write` already read `_level` unlocked —
  so the field became `volatile` and the lock went. Verified no consumer parses these log lines.

### Verifier follow-ups worth acting on (not applied by the surgeons)

1. **`DebugService` and the three `IIdeSession` debug members are unreachable from any client.** `Ops.cs` lists
   only health/connect/disconnect/refs/fetch/init/push/build, `BridgePipeHost.Dispatch` has no `debug` case, and
   nothing in the repo calls `DebugService.Handle`. **`ARCHITECTURE.md:84` still lists `DebugService` (`debug`) as
   a served op.** → dead code + doc drift; resolve in batch 3 (`Sync/DebugService.cs`).
2. `PlcOpenTransport.cs` restore-on-failed-import: when the *restore* also fails the POU is permanently gone, but
   the CLI error still says only "import failed" — the not-restored fact reaches the log, not the user. Worst case
   on the data-loss path. → `arch-notes.md`.
3. A proposed arch follow-up (move health's cache+throttle into Core) must not erase the fact that the ~5 s
   throttle exists **only on TwinCAT** (out-of-process COM) while CODESYS probes in-proc every call. → `arch-notes.md`.

> Line endings: git's "LF will be replaced by CRLF" notice on three files is the normal autocrlf message
> (index LF / worktree CRLF). Verified 100% CRLF, 0 LF-only lines, in every file. Not mixed endings; don't re-chase.

## Batch 3 — `Volt.Engine/Sync` (3 groups, 7 files, 930 LOC)

Gate: build ✓ 0 errors, **`src/Volt.Engine` warning-free** · 317/317 · 116/116 · 76/76 · verdicts **accept ×3,
zero reverts** · committed `4c63935` (the bridge fix is `1082190`)

| File | LOC before → after |
|---|---|
| `PushService.cs` | 550 → 545 |
| `ProjectSnapshot.cs` | 77 → 86 |
| `Hasher.cs` | 60 → 62 |
| `DebugService.cs` | 117 → 120 |
| `RefsService.cs` | 36 → 39 |
| `Versioning.cs`, `BuildService.cs` | 36 → 36, 54 → 54 |
| **batch** | **930 → 942 (+12)** |

**Scope note:** `FetchService.cs` and `OpGuard.cs` were **excluded** from this batch — the
`fix-connected-precondition` change had just rewritten them, and the verifier judges a group by its `git diff`, so
including them would have attributed my hunks to the surgeon. They still need an audit pass once that fix is
committed.

### Notable — one data-loss bug found and correctly ESCALATED, not fixed

- **A CFC/SFC POU *child* body is flattened on push** (`PushService.cs:372`). The child read-only guard sniffs
  content with `VgBody.Is`, which matches only a `NETWORK <n> <LANG>` header — but CFC/SFC materializes as
  `(* @volt-graphical: CFC *)`, which `Is` rejects, so the child falls through to the textual path and the marker
  comment is written into the live IDE. The root guard reads the live `BodyLanguage` and is safe; the asymmetry IS
  the bug. Full write-up in `arch-notes.md`. The surgeon escalated rather than fixing — correct, it is
  behavior-changing and needs a red-first test plus live two-vendor verification.
- **Four dead fallbacks removed from `PushService`**, each proven unreachable rather than assumed: `?? ""` on
  `PouDeclaration`/`PouImplementation` (all three `StSplitResult` construction sites provably non-null, and no
  `with` expression exists in the repo), `?? "FBD"`/`?? "ST"` (two independent proofs — `VgBody.Is` and
  `VgBody.LanguageOf` share one regex over the same unmodified string, and `GraphicalCode.Validate` already threw
  unless the language was FBD/LD), and a constant-true `&& existing is null` that `git log -L` showed was sediment
  from a different code shape. The verifier specifically confirmed the structurally similar but genuinely
  non-constant `isInterface && existingChild is null` at `:404` was left alone.
- **`FirstChild` extraction kept COM traffic byte-identical** — the verifier compared emitted call sequences and
  confirmed `Name` is still read before `KindCode` (`&&` short-circuit preserved), and that
  `RemoveOrphanChildren` — which snapshots a level before mutating, so folding it in would be a real bug — was
  correctly excluded, with a comment saying why.

### Cross-group regression I caught at the gate (the partition's one blind spot)

Group 3.2 tightened `Hasher.ComputeItemVersion` and `Versioning` to non-nullable parameters — sound reasoning
(defaulting a missing folder to `""` hashes like a legitimately empty one and drifts the version silently) — but
its **caller lives in `FetchService.cs`, which I had excluded**, so nobody updated it and the build gained a
`CS8604`. I first reverted the tightening, then realised the surgeon was right and restored it, fixing the real
upstream instead: `FetchService`'s walk loop now **fails loud** with a coded `BridgeException` naming the item.
`src/Volt.Engine` is warning-free again.

Two lessons recorded rather than papered over: a surgeon can legitimately change a signature whose callers are
outside its group, so **excluding a file from a batch can strand a caller** — the gate catches it, but only if the
warning count is watched. And the tightening's stated goal is **not actually achieved**: annotations are
compile-time only, so a null folder still hashes as `""` at runtime. That, plus the 4 new CS8625 warnings in
`HasherTests.Null_text_is_stable` (which passes null deliberately and still passes), is a decision left for a
human in `arch-notes.md` — I did **not** edit that test to match the new signature.

## Batch 4 — `Volt.Engine/Workspace` (4 groups, 9 files, 1,650 LOC)

Gate: build ✓ 0 errors · 317/317 · 116/116 · 76/76 · verdicts **accept ×3 + accept-with-reverts ×1 (1 hunk
reverted)**

| File | LOC before → after |
|---|---|
| `SourceText/StSplitter.cs` | 688 → **593** (−95) |
| `SourceText/StAssembler.cs` | 205 → 211 |
| `SourceText/CodeHelper.cs` | 103 → **89** (−14) |
| `ItemKind.cs` | 250 → 251 |
| `PouToStText.cs` | 101 → 116 |
| `PouData.cs` | 26 → 33 |
| `Materializer.cs`, `FolderPath.cs`, `WorkspaceItem.cs` | unchanged in size |
| **batch** | **1,650 → 1,580 (−70)** |

First net **reduction** of the audit, and it came from the biggest file in the layer: `StSplitter` lost 95 lines
(unread record properties `PouName`/`AccessModifier`, a `StSplitterExtensions.Slice` helper, capture groups that
were captured and never read) with no behavioural change.

### The verification bar this batch set

The `StSplitter` verifier did not read the diff and opine — it **built a differential oracle**: compiled the HEAD
and working-tree versions side by side in a throwaway project against the real `CodeHelper`/`ItemKind`, rendered
the *full* `StSplitResult` for both (every child's kind/name/decl/impl/folder/return type/accessors, newlines
escaped so whitespace shows), and compared them over **583,225 inputs** — 26,175 real corpus files from five
CODESYS projects, 400,000 fuzzed programs built from 45 adversarial fragments (unterminated `(*`, orphan
`GET`/`END_SET`, bare `%FOLDER`, `METHOD PUBLIC FINAL M : INT`), and 157,050 mutations designed to desynchronize
the block-comment scanner. **Zero differences.** It then instrumented the old copy to prove which degenerate
branches actually execute (8,389 / 33,552 / 797 / 27,663 hits) and proved the three never-hit ones unreachable by
reading, rather than accepting them as covered.

### The one revert — a rot-guard earning its keep

Group 4.2 replaced the centralized `ItemKind.Kinds.Folder` const with a bare `"folder"` literal in
`StAssembler.cs:147`. `WireVocabularyGuardTests` scans `src/` for re-spelled centralized vocabulary outside its
home file and went **RED** — the verifier ran it, identified the single offender, and required the revert. Restored
with a comment naming the guard, so the next person doesn't re-do it. This is the first time the three-role
pipeline caught a real regression rather than confirming a clean diff.

### Two follow-ups applied by hand from the verifier's `missed` list

- **`StSplitter`'s "column 0" claim was false in a way that matters** — and the rewrite had fixed four other false
  claims in the same block while leaving this one. `LineStartsWithKeyword` does `TrimStart()`, so every keyword
  scan matches at **any indentation**; the comment said column 0 in three places. That is the difference between
  an indented `END_METHOD` terminating a child block or not, i.e. where the split lands on real source.
- **`CodeHelper.ExtractAcl` became dead in this very batch** (its last caller went with the `AccessModifier`
  property) and, being `public static`, would never surface as a compiler warning. Verified unreferenced
  repo-wide, then deleted.

<!-- One section per batch, appended after its gate passes. Format:

## Batch N — <project/slice>  (gate: build ✓ · Engine.Tests ✓ 000/000 · Cli.Tests ✓ 000/000 · commit abc1234)

| File | Found | Fixed | Skipped (reason) | LOC before → after | Verdict |
|---|---|---|---|---|---|

### Notable
- `path/file.cs:123` — <kind> — what it was, why it mattered, what replaced it.

-->

---

# TOTALS — batches 5-12 (2026-08-06)

The remaining ~10,570 LOC of `packages/volt-cli/src`, audited in 8 batches / 22 groups by 66 agents
(auditor -> surgeon -> verifier per group, groups concurrent, gates serial).

| batch | slice | findings | behaviour-CHANGING | applied | skipped |
|---|---|---|---|---|---|
| 5 | `Graphical` I | 51 | 27 | 21 | 33 |
| 6 | `Graphical` II + Sync deferrals | 42 | 15 | 24 | 20 |
| 7 | `Ide.Codesys` | 50 | 20 | 24 | 28 |
| 8 | `Ide.Twincat` | 51 | 24 | 25 | 25 |
| 9 | `Volt.Cli` core | 47 | 28 | 17 | 31 |
| 10 | `Volt.Cli` support | 30 | 21 | 5 | 25 |
| 11 | `Connector.Core` | 47 | 12 | 25 | 25 |
| 12 | `Connector` | 48 | 21 | 23 | 26 |
| **total** | | **366** | **168** | **164** | **213** |

**By kind:** bug 108 · doc-drift 83 · inconsistency 54 · defensive-fallback 52 · dead-code 39 · legacy 16 ·
style 14.

**Zero behaviour deltas shipped.** All 168 behaviour-changing findings are escalated to `arch-notes.md` with the
auditors' quoted evidence; only the 164 behaviour-preserving ones were applied. Two `mustRevert`s were raised by
verifiers and both were applied — in each case the surgeon had made a change that was arguably RIGHT (a scoped
`GraphicalBodyLang`; an unconditional COM release with a ref-count argument) but that a behaviour-preserving pass
does not get to make.

## Acceptance gate (task 13.1-13.2)

| gate | result |
|---|---|
| build | 0 errors |
| `Volt.Engine.Tests` / `Volt.Cli.Tests` / `Volt.Cli.Connector.Tests` | **337 / 122 / 80** |
| **e2e CODESYS** | **92 pass / 8 skip / 0 fail** |
| **e2e TwinCAT** | **90 pass / 11 skip / 0 fail** (pinned to a stable XAE) |
| `bun run check` | 14 passed, 0 failed |
| `bun run typecheck` | 0 across all 5 packages |
| `bun run lint` | 0 errors (405 pre-existing warnings) |

The live runs are the only real gate for batches 7, 8 and 12: **no test csproj can reference either IDE host**,
so the three C# suites execute zero lines of ~3,100 audited LOC. Both vendors came back at baseline.

## What the audit is actually worth — read this before commissioning another

The 108 `bug` findings are the product, and the ones that matter share a shape: **they live where no automated
gate can see them.** The three most serious — `CreateChild` making a FUNCTION BLOCK named "Get" instead of a
property accessor; `InvokeMethod` turning a failed write into a silent no-op that still reports success;
`CloseDesktopGui` force-killing an in-flight `volt push` mid-write to a live PLC — are all in code the suites
cannot reach.

Two counterweights, recorded because they are the honest half:

1. **Three audit traces did not survive measurement** in this programme (the crashing XAE filed as a
   session-model defect; move 18's wire-`kind` story; and finding 11.1's "the first reconcile destroys the
   restored edge"). Where a finding CAN be measured, measure it before acting — batch 11's confirmed half became
   a red-first fix in one commit, and its unconfirmed half stayed a claim.
2. **Two findings were corroborated independently** (`IdeTree`'s name-vs-path bug, found by batch 9 reading the
   caller and batch 10 reading the callee, neither seeing the other). Independent corroboration is the strongest
   signal this method produces, and it is free — it comes from partitioning by file rather than by concern.
