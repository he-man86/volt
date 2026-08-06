# Structural findings

Phase 2 output of `optimize-volt-cli-architecture`: 7 independent lenses over `map.md` and the code.
Written by the main loop from schema-forced JSON; agents never append here.

**49 findings** — 33 certain,
14 likely,
2 suspected.
By blast radius: 10 wire · 25 cross-project · 14 project · 0 file.

Every finding states `why it costs` as a concrete scenario. Lenses were told to delete anything they could not
state that way — a preference is not a reason to move code that writes to a live PLC.

**Read the testability section first.** A fake that has to lie names a seam in the wrong place; that is how the
audit's most valuable finding surfaced.


---

## Testability — what the fakes have to pretend

_9 findings._


### Core's `connect` post-condition checks only `IsConnected`, never that the served project is the one asked for — the fake can't express the gap, and the live suite vendor-branches around it

`wire` · **certain** · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:85` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:92` · `packages/volt-cli/test/shared/FakeIde.cs:262` · `packages/volt-cli/test/e2e/lifecycle/resilience.test.ts:114` · `packages/volt-cli/test/e2e/harness.ts:5`

**Evidence**

```
BridgePipeHost.cs:85-96 — the comment claims "a connect must leave the bridge actually SERVING the asked-for project", but the check is `if (!_ide.IsConnected) throw new BridgeException(BridgeErrorCodes.PlcDisconnected, …)`; `sel.Project` is used only to compose the message, never compared to `_ide.ServedProjectName`. FakeIde.cs:262 `public void SelectProject(ConnectRequest sel) { Selected = sel; if (!SelectConnects) _attached = false; }` — `ServedProjectName` is unaffected by `sel`, so the double asserts that selecting a project the bridge does not have leaves it connected and serving the OLD one, and the post-condition passes. The live suite documents the resulting divergence and skips it: resilience.test.ts:114-116 "CODESYS serves ONE project per pipe (the name is only confirmatory), so a bogus name still serves its project — skip there. … `if (VENDOR !== \"twincat\") return`" — inside a suite whose own header (harness.ts:5-6) says "no vendor branches: a pass on one bridge and a fail on the other is a real parity bug, not an expected difference."
```

**Why it costs.** ARCHITECTURE.md's parity rule is "any per-vendor difference that Volt can OBSERVE is a bug", and this one is observable over the wire: `connect {project: "Typo"}` answers `ok` on CODESYS and `PLC_DISCONNECTED` on TwinCAT. A connector session that declares interest in project B on a two-project TwinCAT XAE, where the driver attaches A instead without dropping the channel, gets `ok` back, so `ConnectionManager` marks B connected and the UI shows a green row for B — and the user's first push refuses WRONG_PROJECT against a bridge the UI just told them was connected. No test can catch it: the fake makes it unrepresentable and the only suite that could observe it skips CODESYS by hand.

**Smallest fix.** The Core post-condition should compare `_ide.ServedProjectName` to a non-empty `sel.Project`, not just read `IsConnected`.


### `volt init` writes the workspace binding from the CACHED health snapshot while every later op validates it against the LIVE served name — and Init holds the live answer and throws it away

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:21` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:38` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:57` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:179` · `packages/volt-cli/src/Volt.Engine/Sync/OpGuard.cs:27` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:112` · `packages/volt-cli/test/Volt.Cli.Tests/commands/InitCommandTests.cs:15`

**Evidence**

```
Commands.cs:21 `var health = bridge.GetHealth();` … :38-43 `Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = health.Platform }, Project = new() { Platform = health.Platform, ProjectName = health.ProjectName! } … });` — written BEFORE the fetch. HealthResponse.cs:29-42 marks `ProjectName`/`Platform` `[JsonIgnore]` computed off the serving row of a snapshot that BeckhoffDriver.cs:59-60 states is throttled: "Throttle the (heavier) STA refresh to ~5s: a burst of polls answers from cache". Then Commands.cs:57 `var fetched = bridge.Init(...)`, whose identity came from the LIVE read — OpGuard.cs:27-33 `if (!ide.IsConnected) …; var served = ide.ServedProjectName; … return (ide.Vendor, served);` echoed as FetchService.cs:177-178 `Platform = bound.Vendor, ProjectName = bound.ProjectName`. Init never compares the two. Pull does: Commands.cs:179 `var bindErr = Config.VerifyFetchedIdentity(cfg, fetched.Platform, fetched.ProjectName); if (bindErr is not null) return PullResult.Refused(bindErr);` and the bridge itself refuses first via OpGuard → `BridgeException.WrongProject`. Note also BridgePipeHost.cs:112 `case Ops.Init: return RunRead(() => (object)FetchService.Handle(_ide, new FetchRequest { Init = true }, …));` — the init op DISCARDS the request body, so init can never assert an expected name.
```

**Why it costs.** This is the exact signature of the PARKED e2e failure: `volt init` exits 0, the next `volt pull` errors, and both pass when run alone. Any run where the cached row lags the live selection — a TwinCAT XAE that has been `connect`/`disconnect`-churned by earlier suite files, or a bridge polled inside its ~5s throttle window — binds the workspace to the previously-served project while `src/` is seeded from the project actually walked, and even names the workspace FOLDER after the wrong project (Commands.cs:28-29 `SafeFolderName(health.ProjectName!)`). Every subsequent pull refuses WRONG_PROJECT forever until the user rebinds. For a real engineer this is: init succeeds, the folder is called `Line1`, the files are `Line2`'s, and pull is permanently broken with a message about a project they never chose. It is ARCHITECTURE.md convention 3 ("One question, one answer") violated at the one place that decides the binding for the workspace's whole life.

**Smallest fix.** Init must derive the binding from the init fetch's echoed live identity (`fetched.Platform`/`fetched.ProjectName`), not from `bridge.GetHealth()`.


### `FakeIde` cannot represent a cached health row naming a DIFFERENT project — only one naming NOTHING — so the mis-binding above is unrepresentable in 500+ unit tests

`cross-project` · **certain** · `packages/volt-cli/test/shared/FakeIde.cs:105` · `packages/volt-cli/test/shared/FakeIde.cs:227` · `packages/volt-cli/test/shared/FakeIde.cs:240` · `packages/volt-cli/test/Volt.Cli.Tests/commands/InitCommandTests.cs:36`

**Evidence**

```
FakeIde.cs:105 `public string? HealthProjectName { get; init; } = "FakeProject";` — ONE knob. :227 `public string? ServedProjectName => IsConnected ? HealthProjectName : null;` (the LIVE signal) and :240-243 `var serving = IsConnected && !StaleHealthSnapshot; var rows = Projects.Select(…); if (rows.Count == 0 && serving && !string.IsNullOrEmpty(HealthProjectName)) rows.Add(new ProjectEntry(HealthPlatform, "0", HealthProjectName!, …));` (the CACHED signal) both read that same knob. `StaleHealthSnapshot` can only force the cache to show nothing serving. InitCommandTests.cs:15 builds every init fixture through `ConnectedIde(...)` = `new FakeIde(items) { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" }`, and asserts `Assert.Equal("codesys/Demo", r.Project)` — a tautology, since both sources are "Demo" by construction.
```

**Why it costs.** The fake was split (per the map) to model TwinCAT's throttled lag, but it models only the lag-to-empty case. The lag-to-STALE-NAME case — the one that actually mis-binds a workspace, above — cannot be written as a test against the shared double, so a fix for it cannot be pinned by a regression test either. Phase 5 will fix the init binding and have no way to prove it stays fixed.

**Smallest fix.** Give the fake an independent cached-row name (e.g. `HealthSnapshotProjectName`) that defaults to `HealthProjectName` but can be set apart.


### `test/Volt.Cli.Connector.ControlHarness` does not merely re-implement the reconcile — it implements the OPPOSITE trigger semantics, so the volt-control e2e asserts behaviour the product deliberately rejects

`cross-project` · **certain** · `packages/volt-cli/test/Volt.Cli.Connector.ControlHarness/Program.cs:31` · `packages/volt-cli/src/Volt.Cli.Connector.Core/Reconciler.cs:62` · `packages/volt-control/test/e2e/connector.e2e.test.ts:90` · `packages/volt-control/test/e2e/connector.e2e.test.ts:110`

**Evidence**

```
Harness Program.cs:31-40: `var wanted = sessions.Values.SelectMany(list => list).Select(i => (i.Vendor, i.ProjectName)).ToHashSet(); var rows = Raw().ConvertAll(p => { var name = p.ProjectName ?? p.DisplayName; var serving = wanted.Contains((p.Vendor, name)); return p with { Status = serving ? … : "idle" }; });` — serve iff wanted, every pass, every row. Reconciler.cs:25-32 says the exact opposite: "**Bind is level-triggered; unbind is edge-triggered.** A bridge SERVES BY DEFAULT … so \"serve iff wanted\" would gate every bridge no session has declared — breaking standalone `volt push` and gating a neighbour the moment you connect something else." Reconciler.cs:66-68 `var lost = new HashSet<string>(previouslyWanted…); lost.ExceptWith(wanted); var toUnbind = detected.Where(p => p.Serving && (lost.Contains(p.Id) || forceOffSet.Contains(p.Id)))`. The e2e then codifies the harness's rule: connector.e2e.test.ts:90 `expect(projects.some(isServing)).toBe(false) // nothing wanted yet → nothing serving`. The harness also has NO lease expiry (Reconciler.cs:54 `if (s.ExpiresAt <= nowUtc) continue;`), NO force-off, NO one-project-per-host grouping (Reconciler.cs:75-89), and NO startup grace hold (ConnectionManager.cs:247-255).
```

**Why it costs.** The one cross-language test that exists to prove the C# control plane and the TS client agree pins the client to a reconcile the connector does not run. Concretely: a change to `Reconciler` that reverted unbind to level-triggered — re-introducing the field bug where opening a workspace in VS Code gates the CODESYS bridge a terminal `volt push` was using — passes this e2e unchanged, because the harness already behaves that way. Conversely a TS client written against "unwanted ⇒ idle" renders a project as disconnected in the UI while `volt push` to it succeeds. Neither `ControlServer` nor `ConnectionManager` is ever wired to the other in any test (ControlServerTests.cs:36-42 injects lambda stubs), so the composition exists only in the untested WinForms `TrayContext`.

**Smallest fix.** The harness should hold a `ConnectionManager` over a scripted `IProjectSource` and pass its real callbacks to `ControlServer`, instead of an inline snapshot function.


### `FakeIde` hardcodes the degraded state machine to "never degraded", so `DriverBase`'s probe/degraded/liveness machinery and `BridgePipeHost`'s recover-and-retry branch are executed by zero tests

`cross-project` · **certain** · `packages/volt-cli/test/shared/FakeIde.cs:27` · `packages/volt-cli/test/shared/FakeIde.cs:230` · `packages/volt-cli/test/shared/FakeIde.cs:246` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:124` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:145`

**Evidence**

```
FakeIde.cs:27 `public sealed class FakeIde : IIdeDriver` — it implements the interface, never `DriverBase`. :230-232 `public bool IsDegraded => false; public void MarkDegraded(string reason) { } public void ClearDegraded() { }`. :246 `public bool ShouldMarkDegraded(Exception ex) => false;`. :247 `public void Recover() { }   // in-memory fake never drops a channel`. :248-250 `RunOnStaThread` defaults to `if (_sta == null) return fn();` — no `_opInFlight`/`_lastOkTick` bracketing at all. Consequence: BridgePipeHost.cs:145 `catch (Exception ex) when (_ide.ShouldMarkDegraded(ex))` is a filter that is ALWAYS false under the shared double, so the whole self-heal block (`MarkDegraded` → `Recover()` → re-run → `ClearDegraded`) at :147-152 never executes in any unit test; and DriverBase's `RunProbeOnce`/`OnProbeFailed` (:124-135), `RowStatus` (:164) and `OverlayLiveHealth` (:182) have no caller in any test — only the pure static `DeriveServedStatus` is covered (HonestHealthTests.cs:31).
```

**Why it costs.** This is why the already-known defect (`DriverBase.SingleFlight` swallowing the health-probe failure) could exist and survive: ARCHITECTURE.md convention 4 ("Never swallow a background failure" — a bare catch there "once left health repeating a stale 'nothing serving' indefinitely with no log line to read") is asserted by no test, because the only IDE double in the repo reports `IsDegraded => false` unconditionally. A regression that deletes `OnProbeFailed` entirely, or that inverts `DeriveServedStatus`'s wiring inside `OverlayLiveHealth`, ships green and reaches an engineer as a tray that says healthy while every push fails.

**Smallest fix.** Make `FakeIde` derive from `DriverBase` (supplying the abstract vendor members) so the shared machinery runs under test.


### The shared double throws away every byte a push writes: `WriteXml` is an empty body and `WriteText` records only the item NAME

`cross-project` · **certain** · `packages/volt-cli/test/shared/FakeIde.cs:145` · `packages/volt-cli/test/shared/FakeIde.cs:216` · `packages/volt-cli/test/shared/FakeIde.cs:264` · `packages/volt-cli/src/Volt.Engine/Graphical/GraphicalCode.cs:136` · `packages/volt-cli/src/Volt.Engine/Sync/PushService.cs:29`

**Evidence**

```
FakeIde.cs:145 `public void WriteText(ItemRef item, string? declaration, string? implementation) => Recorded.Add($"write:{(string)item.Native}");` — content dropped. :216 `public void WriteXml(ItemRef item, string xml) { }` — nothing recorded at all. :264 `public void FlushPendingWrites() { }`. GraphicalCode.cs:136 `code.WriteXml(item, spliced);` is how every FBD/LD body reaches the IDE. Every assertion in PushServiceTests/PushCommandTests is therefore name-only (`Assert.Contains("write:PLC_PRG", ide.Recorded)`, PushServiceTests.cs:118) and GraphicalChildGuardTests can only assert `Assert.Empty(ide.Recorded)` for refusals (:80,:95,:110). `ReadXml` (FakeIde.cs:147) regenerates XML from the seeded `Item` record, never from what was written, so a push→fetch round-trip through the fake is structurally impossible.
```

**Why it costs.** The already-known defect "a CFC/SFC POU child body is flattened on push" is precisely a `WriteXml`-content defect, and this is the seam that hides it: PushService can hand the driver XML with a child body dropped and every unit test stays green. Worse, `FlushPendingWrites` being a silent no-op in the double is literally the shape of the 2026-08-05 bug — `TcObjectModel.FlushPendingWrites` was a no-op for its entire life behind a bare catch — so the shared fake encodes the data-loss bug as the expected contract. An engineer's edit reaching `accepted: true` and never landing in the IDE is a green suite away.

**Smallest fix.** Record content, not names: `Recorded.Add($"write:{name}:{decl}|{impl}")`, `WriteXml` stores the XML, `FlushPendingWrites` records a `flush:` entry, and `ReadXml` returns what was last written.


### The sole pin between the two declarations of the health row hand-copies the pipe's serializer options instead of using the real `PipeMessages.Options`

`cross-project` · **certain** · `packages/volt-cli/test/Volt.Cli.Connector.Tests/WireContractParityTests.cs:19` · `packages/volt-cli/src/Volt.Cli.Transport/PipeMessages.cs:11` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:100`

**Evidence**

```
WireContractParityTests.cs:10-14 states its own job: "Nothing else pins those mirrors to the authoritative Volt.Engine.Wire DTOs … These tests are that pin". But :17-23 re-declares the contract by hand — `// Mimic the pipe: camelCase + omit nulls (the bridge's server option …)` / `private static readonly JsonSerializerOptions Wire = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };` — a copy of PipeMessages.cs:11-15 `public static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, … }`, which is public and already on this assembly's reference path. The mirror it pins is PerPipeProjectSource.cs:100-102 `private sealed record WireHealth(...); private sealed record WireProjectRow(string? Version, string? Project, string? Status, bool Dirty);`.
```

**Why it costs.** Change `PipeMessages.Options` — switch to a source-generated context, drop camelCase, change null handling — and this pin stays green while the tray's cross-vendor project list silently deserializes to zero rows in production (`WireProjects.Flatten` catches the deserialize and returns an empty list, PerPipeProjectSource.cs:85-86). The one test whose stated purpose is to be "red the moment the shapes drift" is blind to drift in the thing that actually does the serializing.

**Smallest fix.** Serialize with `PipeMessages.Options` in the test rather than a locally-declared copy.


### `TwincatSupervisorTests` asserts on a `spawn` list production discards, while the de-duplication that actually runs lives in the untestable WinForms assembly

`project` · **certain** · `packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs:155` · `packages/volt-cli/src/Volt.Cli.Connector/BridgeSupervisor.cs:29` · `packages/volt-cli/test/Volt.Cli.Connector.Tests/TwincatSupervisorTests.cs:15`

**Evidence**

```
TrayContext.cs:155-159 `var (_, reap) = _twincatSupervisor.Reconcile(pids); foreach (var pid in pids) _supervisor.EnsureWorker(new WorkerSpec(TwincatWorkerId(pid), _twincatExe, $"--xae-pid {pid}")); foreach (var pid in reap) _supervisor.StopWorker(TwincatWorkerId(pid));` — the `spawn` half of the tuple is discarded (`var (_, reap)`), and EnsureWorker is called for EVERY live pid every tick. TwincatSupervisorTests.cs:15-24 asserts exactly that discarded half: `var (spawn, reap) = s.Reconcile(Pids(100)); Assert.Equal(new[] { 100 }, spawn); … (spawn, reap) = s.Reconcile(Pids(100)); Assert.Empty(spawn);`. The real de-dup is BridgeSupervisor.cs:35-42 `if (_workers.TryGetValue(w.Id, out var existing)) { if (!existing.HasExited) return; … }` plus the KILL_ON_JOB_CLOSE job object (:25) — in `Volt.Cli.Connector` (net8.0-windows/WinForms), which no test project references. BridgeSupervisor's usings are `System.Diagnostics/IO/Runtime.InteropServices` only — nothing WinForms.
```

**Why it costs.** Two costs, both concrete. (1) `A_new_xae_spawns_exactly_once_while_it_stays_present` is a test of dead output: break `Reconcile`'s spawn de-dup and the test goes red for a change that alters nothing; break `EnsureWorker`'s `_workers` de-dup (or its crash-restart path) and a second `VoltBridgeTwincat.exe` attaches COM to the same XAE and collides on the same `volt.bridge.twincat.<pid>` pipe — with no test anywhere. (2) The orphan guard (the job object whose whole documented purpose is that a connector CRASH must not leave workers holding pipes the next start collides with) has zero coverage and no seam to get any, purely because a pure-Process class lives in the UI assembly.

**Smallest fix.** `BridgeSupervisor` belongs in `Volt.Cli.Connector.Core` (it has no UI dependency), and `TrayContext` should apply the `spawn` list it already computes.


### `Volt.Cli.Connector.Tests` compiles `FakeIde` and disables its own parallelism for two integration test classes that no longer exist

`project` · **certain** · `packages/volt-cli/test/Volt.Cli.Connector.Tests/LivePipeCollection.cs:4` · `packages/volt-cli/test/Volt.Cli.Connector.Tests/Volt.Cli.Connector.Tests.csproj:19` · `packages/volt-cli/test/e2e/lifecycle/disconnect-cycle.test.ts:6`

**Evidence**

```
LivePipeCollection.cs:3-10 `// Run this assembly's tests SERIALLY … The connector suite includes live-named-pipe integration tests (DisconnectLifecycleTests, CodesysSourceLiveTests) that stand up real BridgePipeHosts …` then `[assembly: CollectionBehavior(DisableTestParallelization = true)]`. Neither class exists anywhere in the repo; `grep -rn "FakeIde\|BridgePipeHost" test/Volt.Cli.Connector.Tests/*.cs` matches only that comment. The csproj still carries `<!-- The shared in-memory IDE fake, so a live-pipe integration test can stand up real bridge hosts. --> <Compile Include="..\shared\FakeIde.cs" Link="FakeIde.cs" />`. And the live e2e justifies its own narrow scope by pointing at the vanished file: disconnect-cycle.test.ts:6-9 "`test/Volt.Cli.Connector.Tests/DisconnectLifecycleTests.cs` already proves the GATE over real pipes with a faked IDE (and does it in CI, in milliseconds)" — the coverage actually moved to PipeTransportTests.cs:243 `Disconnect_refuses_sync_until_the_next_connect_but_leaves_the_host_serving_health`.
```

**Why it costs.** Three small, real taxes. Every connector test runs serially for a reason that evaporated. `FakeIde.cs` is compiled a third time with no consumer, so any change to the 40-member `IIdeDriver` surface breaks the build of an assembly that tests none of it — a restructure of the driver seam pays a phantom cost. And an engineer following the e2e's own pointer to find the cheap CI counterpart finds nothing, and concludes the gate is only covered by the local-only suite that is currently red.

**Smallest fix.** Delete `LivePipeCollection.cs` and the `FakeIde.cs` Compile item from the connector test project, and repoint the e2e comment at `PipeTransportTests`.


> **Coverage of this lens.** "Read in full: test/shared/FakeIde.cs; test/Volt.Cli.Connector.ControlHarness/Program.cs; all four test .csproj files; LivePipeCollection.cs; TestParallelism.cs; BridgeResolverTests.cs; InitCommandTests.cs; CommandHarness.cs; WireContractParityTests.cs; HonestHealthTests.cs; VendorParityGuardTests.cs; the FakeProjectSource header + ControlServerTests' Start() stub factory; TwincatSupervisorTests' first case. On the product side: DriverBase.cs, IIdeDriver.cs, IIdeSession.cs, OpGuard.cs, BridgePipeHost.cs, FetchService.cs, HealthResponse.cs, Reconciler.cs, ConnectionManager.cs, ControlServer.cs, PerPipeProjectSource.cs, DetectedProject.cs, BridgeResolver.cs, Commands.cs (Init/Pull), BeckhoffDriver.cs health+select, BridgeSupervisor.cs (head), TrayContext.cs:100-180. On the e2e side: harness.ts in full, plus conflict-resolve, disconnect-cycle, resilience, child-roundtrip-parity, ide-restart, parallel-instances, and volt-control/test/e2e/connector.e2e.test.ts; I grepped every e2e file's beforeAll/afterAll/cleanup/PlcPrg usage to map the shared module state.\n\nDeliberately NOT covered, and left to other lenses: the whole Graphical/ VG parser+writer test bodies (VgRoundTrip, FbdCorpus, Ladder, PlcOpen*) — I checked only how they reach the IDE seam, not what they assert; the ~40 Volt.Engine.Tests materialization files; volt-lsp-iec and volt-vscode entirely; the correctness of PushService's op algebra.\n\nOn the PARKED e2e failure: I did NOT run anything (read-only) and could not confirm bun's file ordering, so I do not claim which earlier file is the trigger. What I can show from the code is the MECHANISM and why only `conflict-resolve` can hit it: it is the only e2e file that drives the product through the `volt` CLI process, so it is the only one whose bridge identity is resolved by BOUND PROJECT NAME (BridgeResolver + OpGuard) rather than by the harness's first-live-pipe pick; and `volt init` writes that bound name from the throttled health cache while the fetch it runs a line later reads it live. `init` exits 0 by construction (it never compares them) and `pull` refuses. That is finding 1, and I rate it 'certain' as a code defect and the most likely explanation of the parked symptom — but a repro (init, then compare `.git/volt/config.json` against the bridge's live `ServedProjectName` after churning `connect` on a two-project XAE) is what would settle it."


**Corrections to `map.md`**

- map.md:68 (IIdeDriver seam) calls FakeIde "truthful enough to expose divergence". It is truthful about ONE axis (health-cache lag to empty) and actively untruthful about four others: `IsDegraded => false` / `MarkDegraded {}` / `ShouldMarkDegraded => false` (the degraded state machine is unrepresentable), `WriteXml(item, xml) { }` (graphical push content is discarded and unrecorded), `WriteText` records only the item NAME (no content assertion is possible anywhere), and `FlushPendingWrites() { }` (a no-op modelled as correct — the exact 2026-08-05 TcObjectModel bug).
- map.md:30 and :81 say the ControlHarness "re-implements the interest→serving reconcile inline instead of using Reconciler". Understated: it implements the OPPOSITE trigger semantics. `Reconciler` binds level-triggered and unbinds EDGE-triggered precisely so a bridge nobody declared keeps serving (Reconciler.cs:25-32); the harness gates every un-wanted row every pass (Program.cs:35-40). It also has no lease expiry, no force-off, no one-project-per-host grouping and no startup grace hold. So the e2e does not merely 'agree with a reconcile the product does not run' — it agrees with the rule the product explicitly rejected.
- map.md:100 says test/shared/FakeIde.cs is linked into three test assemblies and that "Volt.Cli.Connector.Tests pulls it in solely so a live-pipe test can stand up real BridgePipeHosts (its csproj says so)". That test no longer exists: no file in Volt.Cli.Connector.Tests references FakeIde or BridgePipeHost. The Compile link (and LivePipeCollection.cs's parallelism ban) are both orphaned.
- map.md:95 says `SingleFlight`, `RunOnStaThread`'s freshness stamping and `OverlayLiveHealth` are "reached only by the live e2e". Add `BridgePipeHost.RunRead`'s recover-and-retry block (BridgePipeHost.cs:145-153) to that list, and note it is not reached by the live e2e either — its `when (_ide.ShouldMarkDegraded(ex))` filter needs a real COM RPC failure, which no suite can provoke.
- map.md:83 ("The error channel across the CLI boundary") lists four origins for PLC_DISCONNECTED. A fifth, wire-visible one is missing: `Ops.Init` (BridgePipeHost.cs:112) constructs `new FetchRequest { Init = true }` and DISCARDS the client's body, so the init op alone runs `OpGuard.RequireBoundProject(ide, null, null)` — it can never refuse WRONG_PROJECT, which is why `volt init` succeeds where `volt pull` on the same binding fails.

---

## State & lifetime — who owns each piece, and can two owners disagree?

_6 findings._


### `_lastOkTick` measures the dispatcher round-trip, not an IDE response — so `DeriveServedStatus`'s staleness demotion can never fire while the driver's own probe is running

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:82` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:171` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.cs:79` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Ide/TcObjectModel.cs:273`

**Evidence**

```
DriverBase.cs:28 declares the intent — `int _lastOkTick;  // Environment.TickCount of the last IDE call that RESPONDED. Staleness demotes.` — and :82-93 stamps it:
``
public T RunOnStaThread<T>(Func<T> fn) {
    Interlocked.Increment(ref _opInFlight);
    try { var r = MarshalToIdeThread(fn);
          Volatile.Write(ref _lastOkTick, Environment.TickCount); // the IDE responded => link confirmed live now
``
But `MarshalToIdeThread` on TwinCAT is `_dispatcher.Run(func)` (BeckhoffDriver.cs:48), and StaDispatcher.Run only round-trips the WORKER's own in-process STA queue (StaDispatcher.cs:43-57) — the XAE is never consulted. The only ambient traffic is the probe, `TriggerAsyncProbe() => RunProbeOnce(() => RunOnStaThread(() => { SnapshotHealth(); return 0; }))` (BeckhoffDriver.cs:66), and `SnapshotHealth` cannot throw on a dead IDE:
``
_om.EnsureAttached();
bool ideAlive = _om.ProbeIdeAlive();
if (_om.HasSelection && _om.IsConnected && ideAlive && IsDegraded) ClearDegraded();
var projects = BuildProjects();
``
`ideAlive` is READ AND DISCARDED unless it is clearing degraded — a false never marks degraded. `ProbeIdeAlive` swallows: `try { var _ = (int)_dte.Solution.Count; return true; } catch { return false; }` (TcObjectModel.cs:276-277). So the probe returns normally against a dead XAE, `_lastOkTick` is re-stamped every ~5s, and `DeriveServedStatus(degraded:false, opInFlight:false, lastOkAgeMs: ~0)` returns `HealthStatus.Healthy` (DriverBase.cs:171-177). The `lastOkAgeMs > StaleMs` branch is unreachable in production.
```

**Why it costs.** An engineer's TcXaeShell hangs or re-registers its DTE while nothing is being synced. `health` is the ONE ambient poll and it is the only writer of `_lastOkTick`, so the freshness clock keeps resetting: the row never demotes to `degraded` and the tray/UI keep showing the bridge as healthy over a channel that has been dead for minutes. The signal built specifically to catch "a silent channel drop (no op, no response)" — DriverBase.cs:79-81 — cannot see the one failure mode it names, and the only thing that ever reveals it is the engineer's next `volt push` failing.

**Smallest fix.** Stamp `_lastOkTick` from a call that actually reached the IDE (make `SnapshotHealth` throw / return the `ProbeIdeAlive` verdict) rather than from `RunOnStaThread`'s return.


### `BridgeClient.GuardEmptyItems` decides whether an empty fetch was real by reading the throttled health cache — the exact one-question-two-sources shape convention 3 forbids, on the CLI side of the wire

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:62` · `packages/volt-cli/src/Volt.Engine/Sync/OpGuard.cs:24`

**Evidence**

```
BridgeClient.cs:62-70:
``
private void GuardEmptyItems(int itemCount) {
    if (itemCount > 0) return;
    var connected = false;
    try { connected = GetHealth().Connected; } catch { /* unreachable => treat as not-connected */ }
    if (!connected)
        throw new BridgeError(BridgeErrorCodes.PlcDisconnected, "bridge reported zero items and Volt could not confirm an IDE is attached ...");
}
``
`GetHealth().Connected` is the `[JsonIgnore]` helper off the serving row of the cached snapshot — the same source OpGuard's own doc bans for exactly this decision: "It deliberately does NOT read `BuildHealthResponse()`: that is served from a per-vendor THROTTLED cache (~5s on TwinCAT), so deciding a write against it refused pushes with PLC_DISCONNECTED on stale state while reads of the same bridge succeeded... One question, one answer." (OpGuard.cs:20-25). The `fetch` that produced the zero count already ran `OpGuard.RequireBoundProject` against LIVE driver state (FetchService.cs:30); this second-guesses it from the cache.
```

**Why it costs.** `volt init` against a genuinely empty PLC project (a brand-new TwinCAT project, or a CODESYS project whose Application has no POUs yet) runs the init fetch, which correctly returns 0 items. If the ~5s TwinCAT health cache happens to still hold the pre-`connect` snapshot — the window right after `SelectProject`, which is exactly when init runs — `Connected` is false and the CLI refuses with "is the project open in the IDE?" for a project that is open and that the bridge just successfully walked. The engineer's first contact with Volt is a refusal contradicted by the very op it is guarding.

**Smallest fix.** Decide it from the identity the fetch already echoed back (`FetchResponse.Platform`/`ProjectName`, which OpGuard returned from live state), not from a second `health` call.


### A TwinCAT worker's dead-but-selected DTE can never recover: `EnsureAttached` refuses to heal it once a project is selected, and the only path that would heal it (a content op) is gated by `BridgeResolver`, which reads that same worker's health — which lists zero projects exactly then

`cross-project` · **likely** · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Ide/TcObjectModel.cs:74` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Ide/TcObjectModel.cs:141` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:52` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.cs:123`

**Evidence**

```
Healing is deliberately disabled once a project is picked (TcObjectModel.cs:74-80):
``
public void EnsureAttached() {
    if (HasSelection) return;                       // a selected project recovers fully on the next content op
    if (_dte != null && ProbeIdeAlive()) return;
    var dte = RotInstances.BindByPid(_xaePid);
``
Meanwhile the health rows come from `OwnSolution()` -> `SolutionProjectNames()`, which yields NOTHING on a dead handle (TcObjectModel.cs:141-152): `try { count = (int)_dte.Solution.Projects.Count; } catch { yield break; }`. `BuildProjects` iterates `own.Projects` (BeckhoffDriver.cs:129-141), so the worker publishes an EMPTY `health.projects`. And the CLI's pipe choice is made from exactly that list (BridgeResolver.cs:52-56, 62-66):
``
var matches = pipes.Where(p => projectsOf(p).Contains(boundName)).ToList();
...
if (matches.Count == 0) throw new BridgeError(BridgeErrorCodes.PlcDisconnected,
    $"the bound project '{boundName}' isn't open in any of the {pipes.Count} running {vendorLabel} — open it, then retry.");
...
private static IReadOnlyList<string> ProjectNamesOf(string pipe)
    => new BridgeClient(pipe).GetHealth().Projects.Select(p => p.Project).ToList();
``
The state that arms this is permanent: `SelectProject` sets `_wantProject` (TcObjectModel.cs:93) and `Disconnect()` explicitly keeps it ("the DESIRED selection (_want*) is intentionally kept", :234) — contradicting the field's own comment at :42, "Set only by an explicit project select; cleared by Disconnect." So `HasSelection` is true forever after the first `connect`.
```

**Why it costs.** Two XAE windows open (the documented multi-XAE fixture setup, and the normal case for an engineer with two machines' projects). Window A's DTE re-registers — a routine TcXaeShell event the code elsewhere plans for. Its worker keeps `_dte`/`_sysManager` non-null (so `IsConnected` is still true) but publishes zero health rows. `volt pull` now enumerates 2 pipes, finds the bound name in neither, and refuses with "the bound project 'X' isn't open in any of the 2 running TwinCAT" — a message that is false, and that sends the engineer to reopen a project that is already open. The content-op recovery (`RunRead` -> `Recover()` -> `ReattachProject`) that would fix it in one call is never reached, because the resolver refused before issuing any op. `VOLT_PIPE` bypasses the resolver entirely (BridgeResolver.cs:25), which is why the same command "works by hand" and heals the worker as a side effect — hiding the defect.

**Smallest fix.** `EnsureAttached` must re-bind a dead DTE whether or not a project is selected (bare re-bind is already safe; the selected-project resolve can stay deferred).


### `--list-xae-pids` conflates "the enumeration ran" with "every live XAE answered": a busy XAE is silently dropped from the list and the probe still exits 0, so the supervisor reaps a healthy worker

`cross-project` · **likely** · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Ide/RotInstances.cs:56` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Ide/RotInstances.cs:27` · `packages/volt-cli/src/Volt.Cli.Connector.Core/TwincatXaeProbe.cs:21` · `packages/volt-cli/src/Volt.Cli.Connector.Core/TwincatSupervisor.cs:29`

**Evidence**

```
The contract is stated twice. TwincatXaeProbe.cs:16-20: "A failure must NOT be read as 'no XAE open': the caller leaves the fleet untouched on null and only reaps on a SUCCESSFUL empty result... An empty list therefore means 'the enumeration ran and saw no XAE'." Program.cs:16-17: "Exit 0 = the enumeration RAN (empty output = 'no XAE open')".
But the enumeration is per-DTE best-effort and drops an XAE that will not answer, without affecting the exit code (RotInstances.cs:56-66):
``
public static List<int> EnumeratePids() {
    foreach (var dte in RunningDtes()) { var pid = PidOf(dte); if (pid != 0 && !pids.Contains(pid)) pids.Add(pid); Release(dte); }
``
and `PidOf` is a cross-process COM call into the XAE's UI thread that swallows everything (:27-37): `long hwnd = Convert.ToInt64(((dynamic)dte).MainWindow.HWnd); ... catch { return 0; }`. `EnumRunningDtesOnce` likewise `continue`s past a moniker whose `GetDisplayName`/`GetObject` throws (:103-108). The retry in `RunningDtes` only fires on a TOTALLY empty result (`if (hits.Count > 0 || attempt == 2) return hits;`), so a partial list is returned as final. The message filter in that probe process retries only `SERVERCALL_RETRYLATER` and CANCELS anything else (ComMessageFilter.cs:61-62: `dwRejectType == ServerCallRetryLater ? RetryAfterMs : CancelCall`).
Three such probes reap: `TwincatSupervisor.Reconcile` counts `++kv.Value.Misses >= ReapAfterMisses` (=3, :21, :45) and TrayContext runs the probe every 3rd 4s tick (TrayContext.cs:152), i.e. ~36s of a busy XAE.
```

**Why it costs.** A `volt push` or a full `volt build` pins the XAE's UI thread for tens of seconds — the normal case on a large project. During that window the probe child cannot read `MainWindow.HWnd` for that window, so the pid vanishes from a list that still exits 0. After three misses the connector kills a perfectly healthy worker: the pipe disappears mid-session, any in-flight CLI op dies with "bridge is not reachable", and the respawned worker starts with NO project bound (Program.cs:53 comment: "No project is auto-bound (the user picks one via `select`)"). Because `Reconciler` only binds WANTED projects (Reconciler.cs:86), a terminal-only user — the exact workflow ARCHITECTURE.md's disconnect section protects, "the CLI opens the pipe directly and never consults the connector" — has nobody to re-select for them, so every subsequent `volt pull/push` gets PLC_DISCONNECTED until they open a GUI. This is also the cleanest explanation for the parked e2e: the run-alone case never accumulates 36s of continuous XAE-busy time before conflict-resolve's first `pull`; the full suite does.

**Smallest fix.** Make a per-XAE read failure fail the whole probe (non-zero exit) rather than silently shortening a "successful" list.


### The wire-level `disconnect` gate has two owners: any pipe client can set `_paused`, and the connector's reconcile loop un-sets it within ~4s by re-`connect`ing any project a live session wants

`cross-project` · **suspected** · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:100` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:68` · `packages/volt-cli/src/Volt.Cli.Connector.Core/Reconciler.cs:86` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:56`

**Evidence**

```
The host gate is one flag any client can flip: `case Ops.Disconnect: _paused = true; return new { ok = true };` (BridgePipeHost.cs:105), and while paused every row is forced idle: `if (_paused) h.Projects = h.Projects.Select(p => p with { Status = HealthStatus.Idle }).ToList();` (:68). The connector reads serving purely from that status — `WireProjects.Flatten` stamps `p.Status ?? HealthStatus.Idle` onto `DetectedProject` (PerPipeProjectSource.cs:93) — so a paused bridge is indistinguishable from a detected-but-idle one. `Reconciler.Plan` then treats it as a bind candidate: `var candidate = rows.Where(p => wanted.Contains(p.Id) && !p.Serving)...; if (candidate != null) toBind.Add(candidate);` (Reconciler.cs:86-89), and `BindAsync` issues `Ops.Connect` (PerPipeProjectSource.cs:61), which un-pauses first thing: `_paused = false;` (BridgePipeHost.cs:80). The tray's own Disconnect avoids this only because it goes through `ForceOff`, which is subtracted from `wanted` (Reconciler.cs:58) — the WIRE verb has no such protection. ARCHITECTURE.md §Disconnect describes the flag's lifetime as "In-memory by design — a host or connector restart resets it to serving" and does not mention that a RUNNING connector also resets it.
```

**Why it costs.** With any frontend session live (a VS Code window bound to that project), a `disconnect` sent over the pipe — by the other frontend, by a script, or by `test/e2e/lifecycle/disconnect-cycle.test.ts` — is silently reverted on the next 4s tick. In the e2e that turns `expect(await serving()).toBe(false)` into an order- and timing-dependent assertion (the 750ms and multi-step tests in disconnect-cycle are the exposed ones), and in production it means "I disconnected" is not a state the bridge holds against a connector that disagrees. The gate exists precisely so a connector-side selection cannot decide whether `volt push` writes to a live PLC; here the decision flows the other way and nobody logs it as a conflict.

**Smallest fix.** A wire `disconnect` must be distinguishable from `idle` on the row (or recorded as a force-off), so reconcile cannot bind over it.


### The e2e harness has two answers to "which pipe is this suite driving" — a module-const snapshot and a mutable re-resolving cache — and `conflict-resolve` pins `init` to the snapshot while every other call uses the cache

`project` · **likely** · `packages/volt-cli/test/e2e/harness.ts:55` · `packages/volt-cli/test/e2e/harness.ts:64` · `packages/volt-cli/test/e2e/harness.ts:101` · `packages/volt-cli/test/e2e/lifecycle/conflict-resolve.test.ts:58`

**Evidence**

```
harness.ts keeps a mutable cache and a frozen snapshot of the same fact:
``
let cachedPipe: string | undefined
function resolvePipe(): string {
  if (cachedPipe && livePipes().includes(cachedPipe)) return cachedPipe
  cachedPipe = livePipes()[0] ?? PIPE_PREFIX
  return cachedPipe
}
export const PIPE = resolvePipe() // for labels + one-shot callers; live calls re-resolve
``
and invalidates the cache on any socket error (:101): `sock.on("error", (e) => { cachedPipe = undefined; reject(e) })`. `livePipes()` orders by `readdirSync("\\\\.\\pipe\\")`, which is not a guaranteed order. bun runs every e2e file in ONE process, so `PIPE` is evaluated once for the whole suite, hours before it is used at conflict-resolve.test.ts:58: `const r = await init(parent, VENDOR, { pipe: PIPE })`. `@volt/control`'s `init` turns that into `VOLT_PIPE` (actions.ts:169) — and `BridgeResolver.Resolve` short-circuits on an override (`if (!string.IsNullOrEmpty(pipeOverride)) return new BridgeClient(pipeOverride!);`, BridgeResolver.cs:25), skipping discovery entirely. `pull(root)` passes no env (actions.ts:96-105), so it goes through full discovery + a `health` probe of every pipe.
```

**Why it costs.** `init` and `pull` in the same test decide "which bridge" from two different sources — an env string frozen at module load vs a live probe. With more than one pipe of the vendor (the documented `twincat-instances.ps1 up` default opens both fixtures), one socket error anywhere in the preceding hour clears `cachedPipe` and the suite can silently retarget to the other IDE while `PIPE` still names the first: `init` then binds a project on pipe A while every subsequent harness call drives pipe B. The failure surfaces minutes later as an unexplained `volt pull` error in an unrelated test — which is what "passes alone, fails in order" looks like. It also means a green suite is not proof the tests ran against the bridge the label says (`BASE = \`pipe ${PIPE}\``, :65).

**Smallest fix.** `PIPE` should be a function, not a const — one resolver for labels, `init`, and every call.


> **Coverage of this lens.** Read in full: `Volt.Engine/Ide/DriverBase.cs`, `Volt.Engine/Wire/BridgePipeHost.cs`, `Volt.Engine/Sync/OpGuard.cs` + `RefsService.cs`, `Volt.Engine/Diagnostics/VoltLog.cs`, both drivers (`CodesysDriver.cs`, `BeckhoffDriver.cs`), `Volt.Cli.Ide.Twincat/{Program.cs, Ide/TcObjectModel.cs, Ide/RotInstances.cs, Ide/StaDispatcher.cs, Ide/ComMessageFilter.cs}`, `Volt.Cli.Ide.Codesys/PipeHost.cs`, `Volt.Cli.Transport/PipeServer.cs`, `Volt.Cli/Sync/BridgeResolver.cs` + the tail of `BridgeClient.cs` + `Program.cs`'s dispatch/catch chain + the `ExpectedProjectName` call sites in `Commands.cs`, `Volt.Cli.Connector.Core/{ConnectionManager.cs, Reconciler.cs, PerPipeProjectSource.cs, TwincatSupervisor.cs, TwincatXaeProbe.cs}`, `Volt.Cli.Connector/{TrayContext.cs, BridgeSupervisor.cs}`, `@volt/control`'s `bridge/actions.ts` + `bridge/gate.ts`, and the e2e `harness.ts`, `lifecycle/{conflict-resolve, disconnect-cycle, ide-restart}.test.ts`, `stability/parallel-instances.test.ts`, `test/e2e/README.md`. Grepped repo-wide for `VoltLog.Init` callers, every `.Disconnect()` call site, static mutable fields across `src/`, and every `Expected*Project*` producer/consumer.\n\nI did NOT read: `CodesysObjectModel.cs`/`CodesysTypeMap.cs` beyond grepping for event registration and caches, `PushService`/`FetchService` bodies (only their guard call sites), `Sidecar.cs`/`Git.cs`/`StatusModel.cs`, `ControlServer.cs`, `Session.cs`, `@volt/control`'s `session.ts`/`connector.ts`, and none of the C# test assemblies. I ran nothing — no build, no test, no live bridge — so every runtime claim here is derived from reading both sides of the contract, and the three findings marked `likely`/`suspected` name the trigger I could not observe.\n\nOn the parked e2e failure specifically: one thing I can state with certainty and that narrows it hard. `Commands.Pull` maps a wire-level `WRONG_PROJECT`/`PLC_DISCONNECTED` to `PullResult.Refused` (Commands.cs:13-14, 175), which `--json` prints to STDOUT, so `@volt/control` reports `{kind:\"refused\"}`. A `BridgeError` raised by `BridgeResolver` never crossed the wire, is not a `PipeCallException`, and escapes to `Program.cs:74`'s `catch (BridgeError e)` — stderr, exit 1, EMPTY stdout — which `actions.ts:103` turns into `{kind:\"error\"}`. So \"`volt pull` -> error\" (rather than \"refused\") localises the failure to pipe RESOLUTION, before any op is issued — i.e. to a moment when `PipeDiscovery.List` saw 0 pipes, or saw >1 with an ambiguous/zero name match. With a single XAE the only reachable resolver error is `pipes.Count == 0` (BridgeResolver.cs:43-46), because the 1-pipe case returns without probing at all. That points at the worker being ABSENT for a moment — findings 3 (a reaped healthy worker) and 4 (a retargeted harness pipe) — rather than at the bridge's disconnect gate. Confirming this needs only the failing run's stdout/stderr and `%LOCALAPPDATA%\\Volt\\logs\\connector-*.log` grepped for `stopped worker twincat.` / `started VoltBridgeTwincat.exe`."


**Corrections to `map.md`**

- map.md:69 (the `DriverBase` seam row) credits `DeriveServedStatus` as "the pure `DeriveServedStatus` verdict ... which is unit-testable with no IDE" and notes only that `SingleFlight`/`RunOnStaThread`'s freshness stamping are "reached only by the live e2e". It should record that the staleness branch of that verdict is UNREACHABLE in production: the only ambient writer of `_lastOkTick` is the driver's own probe, and `RunOnStaThread` stamps on the dispatcher's return, not on an IDE response (DriverBase.cs:87-89 + BeckhoffDriver.cs:79-90). A pure function whose adverse input can never occur is not covered by testing it purely.
- map.md:55 / :79 describe the `Connector -> VoltBridgeTwincat.exe` edge as an untyped command-line contract ("the exe NAME, the two flags, the exit-code semantics (0 = ran, non-zero = probe failed, so do NOT reap)"). The load-bearing half is missing: exit 0 does NOT mean the enumeration was complete. `RotInstances.EnumeratePids`/`PidOf` drop any XAE whose DTE will not answer and still exit 0 (RotInstances.cs:27-37, 56-66), so a PARTIAL success is fed to `TwincatSupervisor` as ground truth about which XAE are gone. That is the semantic the reap policy actually depends on.
- map.md:74 (the `IProjectSource` row) says the connector's vendor asymmetry "now lives strictly ABOVE the seam". True for lifecycle, but there is a second thing above the seam that the map does not name: the connector can WRITE the bridge's `_paused` gate through `BindAsync`/`UnbindAsync` (PerPipeProjectSource.cs:56-70), so `IProjectSource` is not a read-only detection seam — it is the connector's only mutating edge onto per-host state that the CLI also depends on and cannot see.
- map.md's per-project section (and ARCHITECTURE.md's `IIdeDriver` table) should record that `IIdeSession.Disconnect()` has exactly ONE production caller — `PipeHost.Stop()` (Volt.Cli.Ide.Codesys/PipeHost.cs:93) — and is NOT what the wire `disconnect` op invokes. `BeckhoffDriver.Disconnect()` (which drops the COM attach, BeckhoffDriver.cs:42) is therefore unreachable in production, and PipeHost.cs:93's comment ("drop change-event handlers from the singleton ObjectManager (no leak on restart)") is false: `CodesysDriver.Disconnect()` is `ClearDegraded()` only and `CodesysObjectModel` registers no handlers.

---

## Layering — dependencies pointing the wrong way, or skipping a layer

_6 findings._


### The final bytes of every NON-SOURCE workspace file are decided below the driver seam with a silent fallback, so most reference kinds materialize as a constant that can never change version

`wire` · **certain** · `packages/volt-cli/src/Volt.Engine/Workspace/Materializer.cs:24` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.Code.cs:44` · `packages/volt-cli/src/Volt.Engine/Ide/ICodeStore.cs:39` · `packages/volt-cli/src/Volt.Engine/Workspace/ItemKind.cs:220`

**Evidence**

```
Materializer — the type whose stated job is turning an item into canonical workspace text — produces zero bytes for non-source kinds:
  Materializer.cs:24 `return new WorkspaceItem(ide.ReadManifest(item, kind), FullWireName(name, ItemKind.ExtFor(kind)));`
CodesysDriver.Code.cs:44-52 handles six of them and then:
  `: kind == ItemKind.Kinds.Task ? _om.TaskDescriptor(item.Native)\n        : $"{kind}\n";`
ItemKind.cs:220-228 `ReferenceKindExtensions` declares SEVENTEEN reference kinds, including `(Kinds.ImagePool, "image_pool"), (Kinds.TextList, "text_list"), (Kinds.Visualization, "visualization"), (Kinds.ClassDiagram, "class_diagram"), (Kinds.ExternalTypes, "external_types"), (Kinds.TmcFile, "tmc"), (Kinds.ParameterList, "parameter_list")`. CodesysTypeMap.cs classifies three of those live — `if (Has(ifaces, "IVisualObject")) return ItemKind.PlcVisObj;`, `IImagePoolObject → PlcImagePool`, `IGlobalTextListObject|ITextListObject → PlcTextList` — and ItemKind.Map turns each into a tracked wire kind. None has a descriptor reader.
ICodeStore.cs:33-37 states the contract this breaks: "Materializer writes it verbatim as the item's workspace file, and Hasher takes the item's content version from it. So it is PARITY-CRITICAL". Its own ponytail note at :42-43 already flags the fallback: "CODESYS additionally falls through to it for a kind whose descriptor reader was never written, which hides a missing implementation instead of failing."
```

**Why it costs.** An engineer opens a CODESYS project with 40 visualizations. `volt pull` writes 40 files whose entire content is the seven-byte string `visualization\n`, plus one `.text_list` and one `.image_pool` of the same shape. Hasher.ComputeItemVersion hashes `folder + content`, so each of those versions is a CONSTANT: the engineer edits MainVisu in the IDE, runs `volt pull`, and fetch reports no change — forever. `volt status` says clean, `projectVersion` does not move, and git holds a file per visualization that looks tracked and records nothing. The user is told these items are under version control; they are not, and nothing anywhere logs that fact.

**Smallest fix.** `ReadManifest` gets no fallback arm — an unhandled kind throws a coded BridgeException naming the kind, exactly as `ItemKind.ExtFor` already does.


### The one durable logger sits one layer ABOVE the only project that cannot afford to be silent, so a dead bridge reports "ready" with nothing in the log

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Engine/Diagnostics/VoltLog.cs:19` · `packages/volt-cli/src/Volt.Cli.Transport/PipeServer.cs:62` · `packages/volt-cli/src/Volt.Cli.Transport/PipeServer.cs:65` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/PipeHost.cs:72` · `packages/volt-cli/src/Volt.Cli.Connector.Core/Log.cs:11`

**Evidence**

```
VoltLog lives in `Volt.Engine.Diagnostics`; `Volt.Engine.csproj:23` references `Volt.Cli.Transport`, never the reverse — so Transport structurally cannot log. The result, in the accept loop:
  PipeServer.cs:57-62 `try { server = new NamedPipeServerStream(...); } catch { break; }`
  PipeServer.cs:64-65 `try { server.WaitForConnection(); } catch { server.Dispose(); if (!_running) break; continue; }`
No log line at either site. VoltLog itself needs nothing that forbids the move — VoltLog.cs:1-2 imports only `System` and `System.IO`, and its own docstring says "netstandard2.0 with NO framework dependency".
The same non-reference forces a second logger: Volt.Cli.Connector.Core/Log.cs:6-10 — "the same location and line format the bridges write via Core's VoltLog, but its own tiny writer" — reimplementing `%LOCALAPPDATA%\Volt\logs`, the timestamp format and the `<source>-yyyy-MM-dd.log` filename by hand, with no level gate, no `Init` opt-in and no retention prune.
```

**Why it costs.** PipeServer.Start() only spawns the accept thread and returns, so a failed `new NamedPipeServerStream` happens AFTER PipeHost.Start() has already succeeded. Concretely: an engineer clicks "Activate in CODESYS", the pipe name collides or an ACL denies it, the accept loop hits :62 and `break`s. PipeHost.cs:81-83 has already returned "Volt bridge started on pipe volt.bridge.codesys.7412 (connected to IDE)" into the CODESYS message window and written `CODESYS bridge ready` to VoltLog; `PipeHost.IsRunning` is still true. The tray shows no CODESYS project, `volt pull` refuses with "no CODESYS bridge is running", and `%LOCALAPPDATA%\Volt\logs` — the one place docs/debugging-a-bridge-session.md tells you to look — contains a line saying the bridge is ready and nothing else. The failure is unobservable by construction.

**Smallest fix.** VoltLog moves down into `Volt.Cli.Transport` (it has no dependency that prevents it), which un-silences the accept loop and deletes Connector.Core/Log.cs.


### `BridgeErrorCodes` lives in the sink project, so the CLI mints wire refusal codes for conditions that never crossed a wire

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli.Transport/BridgeErrorCodes.cs:8` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:44` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:55` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:21` · `packages/volt-cli/src/Volt.Engine/BridgeException.cs:19`

**Evidence**

```
BridgeErrorCodes.cs holds ten codes; nine are Engine-domain (`NO_SIDECAR`, `DUPLICATE_CHILD`, `INVALID_ST`, `INVALID_CODE_HEADER`, `UNSUPPORTED`, …) and exactly one has a consumer inside Transport — PipeServer.cs:90 `BridgeErrorCodes.InternalError`. A repo grep for `BridgeErrorCodes` under `src/Volt.Cli.Connector.Core` returns zero hits, so the other sibling branch does not need the table down there either.
Because it is in the sink, a pure CLIENT that has not contacted any bridge can spend the wire's vocabulary:
  BridgeResolver.cs:43-45 `if (pipes.Count == 0) throw new BridgeError(BridgeErrorCodes.PlcDisconnected, $"no {vendorLabel} bridge is running — …");`
  BridgeResolver.cs:54-56 `if (matches.Count == 0) throw new BridgeError(BridgeErrorCodes.PlcDisconnected, $"the bound project '{boundName}' isn't open in any of the {pipes.Count} running {vendorLabel} — …");`
  BridgeResolver.cs:21 `public const string AmbiguousBridge = "AMBIGUOUS_BRIDGE";` — a code that is NOT in the table, carried in the same `BridgeError.Code` field.
BridgeException.cs:19-24 already records the code being overloaded once: "NB the code has a SECOND meaning today: Wire/BridgePipeHost also raises it for the tray's deliberate pause gate, where nothing is 'waiting for an IDE project'".
```

**Why it costs.** PLC_DISCONNECTED is the one code every client branches on — Commands.cs:13-14 `IsPreconditionRefusal`, test/e2e/lifecycle/resilience.test.ts:11 and ide-restart.test.ts:21 both `const DISCONNECTED = "PLC_DISCONNECTED"`, and volt-control renders it as the disconnected state whose remedy is Reconnect. It now has FIVE origins with four different remedies: the bridge has no project (Reconnect helps), the tray paused the bridge (un-pause helps), no bridge process exists at all (open the IDE and activate — Reconnect cannot help, the CLI never reached a pipe), and the bound project is open in none of three running IDEs (open the right project — Reconnect cannot help). An agent branching on the code, which is exactly what the code exists for, tells the user to Reconnect in two cases where nothing is there to reconnect to.

**Smallest fix.** `BridgeErrorCodes` moves up into `Volt.Engine` beside `BridgeException` (leaving only `InternalError` in Transport), so a pre-wire client refusal cannot be spelled as a wire code.


### `Volt.Cli.Connector.Core` — the project whose csproj says its only dependency is the pipe wire — reaches the TwinCAT IDE host by process CLI, past `IProjectSource` and past the compiler

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli.Connector.Core/TwincatXaeProbe.cs:28` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Program.cs:19` · `packages/volt-cli/src/Volt.Cli.Connector.Core/Volt.Cli.Connector.Core.csproj:8` · `packages/volt-cli/src/Volt.Cli.Connector/ConnectorSetup.cs:33`

**Evidence**

```
Volt.Cli.Connector.Core.csproj declares one ProjectReference — `Volt.Cli.Transport` — and its comment says "net8.0 (no -windows): pure logic + the pipe wire, no WinForms." But:
  TwincatXaeProbe.cs:28-42 `FileName = workerExe, Arguments = "--list-xae-pids", … RedirectStandardOutput = true … if (proc.ExitCode != 0) return null;`
served by, in a different project with no reference between them:
  Volt.Cli.Ide.Twincat/Program.cs:19 `if (a == "--list-xae-pids")` … `foreach (var id in RotInstances.EnumeratePids()) Console.WriteLine(id);` … `catch { … rc = 1; }`
IProjectSource.cs:6-12 claims to be "the ONLY place a vendor's attach mechanism lives"; this probe is a second attach mechanism sitting beside it in the same assembly. The shell compounds it: ConnectorSetup.cs:33 hard-codes `Path.Combine("..", "volt-cli", "src", "Volt.Cli.Ide.Twincat")` and :43-44 probes that sibling's `bin/Release|Debug/net8.0-windows` by filesystem path.
```

**Why it costs.** Rename `--list-xae-pids` to `--xae-pids` in Program.cs:19 — a one-word edit in the file that owns the flag. `dotnet build Volt.Cli.sln` succeeds, `dotnet test test/Volt.Cli.Connector.Tests/` (including TwincatSupervisorTests, which drives a fake probe) stays green, `bun run check` passes. At runtime the child exits non-zero, `ListPids` returns null, and TwincatSupervisor reads that as "probe failed — leave the fleet alone": an engineer who opens a new XAE window never gets a worker spawned, the project never appears in the tray, and `volt pull` refuses with "no TwinCAT bridge is running" — permanently, with a green build and a green test suite.

**Smallest fix.** The four strings of that contract (`--list-xae-pids`, `--xae-pid`, the exit-code meanings, one-pid-per-line) live in one const table both projects reference, the way `Ops` already does for the pipe wire.


### netstandard2.0 on Engine+Transport ships nine BCL shims into CODESYS and forces a process-wide AssemblyResolve hook that can rebind assemblies for the whole IDE

`cross-project` · **likely** · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/PipeHost.cs:41` · `packages/volt-cli/src/Volt.Engine/Volt.Engine.csproj:18` · `packages/volt-cli/src/Volt.Cli.Transport/Volt.Cli.Transport.csproj:11` · `packages/volt-cli/src/Volt.Engine/Polyfills.cs:8` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:184`

**Evidence**

```
Dependencies that exist ONLY because of the netstandard2.0 target: `<PackageReference Include="System.Text.Json" Version="8.0.5" />` in BOTH csprojs plus `System.ValueTuple 4.5.0` (in-box on net8); `Polyfills.cs` IsExternalInit (so `record`/`init` compile); and DriverBase.cs:184 `// unchecked int subtraction is correct across TickCount wraparound; TickCount64 is not on netstandard2.0` — while BeckhoffDriver.cs:57, one layer up on net8, answers the same freshness question with `Environment.TickCount64`.
The staged net48 output (`src/Volt.Cli.Ide.Codesys/bin/*/net48/`) is: `Microsoft.Bcl.AsyncInterfaces.dll, System.Buffers.dll, System.Memory.dll, System.Numerics.Vectors.dll, System.Runtime.CompilerServices.Unsafe.dll, System.Text.Encodings.Web.dll, System.Text.Json.dll, System.Threading.Tasks.Extensions.dll, System.ValueTuple.dll` beside the three Volt DLLs.
The compromise that forces:
  PipeHost.cs:41-48 `AppDomain.CurrentDomain.AssemblyResolve += (_, e) => { var path = Path.Combine(dir, new AssemblyName(e.Name).Name + ".dll"); if (!File.Exists(path)) return null; … return Assembly.LoadFrom(path); };`
The handler's own doc (:30-35) scopes it to "This bit only: health serializes HealthResponse … force an exact System.Text.Json 8.0.0.0 bind" — but the handler matches by bare simple name with no version or requesting-assembly check, and it is installed on the whole CODESYS AppDomain the moment the user activates the bridge.
```

**Why it costs.** `System.Memory` and `System.Runtime.CompilerServices.Unsafe` are the two classic net48 binding-conflict assemblies. Once an engineer activates Volt in CODESYS, any CODESYS component or third-party plugin whose own bind of one of those nine names fails (a missing or wrong binding redirect — the normal net48 failure) gets Volt's copy handed to it by `Assembly.LoadFrom`, silently and at Volt's version, in a process that is driving a live PLC. Volt's own charter is that it writes into no other vendor's environment; this is that intrusion one level lower, at the CLR loader, and it exists solely because netstandard2.0 requires shipping BCL packages that net48 cannot probe for from a `LoadFile`'d assembly's directory.

**Smallest fix.** The handler returns null unless `e.RequestingAssembly` is one of Volt's own three assemblies.


### Volt.Engine's "strict layer stack" is a five-node dependency CYCLE, so no layer can be reasoned about, moved, or compiled alone

`project` · **certain** · `packages/volt-cli/src/Volt.Engine/Ide/IIdeSession.cs:3` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:1` · `packages/volt-cli/src/Volt.Engine/Workspace/Materializer.cs:4` · `packages/volt-cli/src/Volt.Engine/Graphical/GraphicalCode.cs:3` · `packages/volt-cli/ARCHITECTURE.md:78`

**Evidence**

```
ARCHITECTURE.md:78 — "A strict layer stack; each layer depends only on the ones above it. Read top-down: contract first, leaves last." The actual `using` graph closes a loop:
  Ide/IIdeSession.cs:3  `using Volt.Engine.Wire;`  → `HealthResponse BuildHealthResponse();` (:41), `IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics();` (:69), `void SelectProject(ConnectRequest sel);` (:62), `IReadOnlyList<Library.LibSignature> ExtractLibrarySignatures();` (:75)
  Wire/BridgePipeHost.cs  `using Volt.Engine.Sync;`  (dispatch → FetchService/PushService/BuildService/RefsService)
  Sync/PushService.cs     `using Volt.Engine.Workspace;`
  Workspace/Materializer.cs:4 `using Volt.Engine.Graphical;`
  Graphical/GraphicalCode.cs:3 `using Volt.Engine.Ide;` → `public static void Write(ICodeStore code, ItemRef item, string vgText, string declaration)` (:128) and `public static GraphicalBody? Read(ICodeStore code, ItemRef item)` (:27)
So Ide → Wire → Sync → Workspace → Graphical → Ide. Per-folder `using` census confirms it: Ide reaches Wire+Diagnostics+Transport; Graphical reaches Workspace+Ide; Library and Diagnostics reach nothing.
DriverBase.cs:18-20 already records the consequence in its own header: "ARCH FOLLOW-UP: because BuildHealthResponse is abstract, the wire-visible health shape is composed TWICE (once per vendor) — against 'parity-critical decisions live in Core, once'."
```

**Why it costs.** The cycle is why `BuildHealthResponse` had to be abstract: the contract layer returns a Wire DTO, so composing the ambient-poll answer became a vendor job below the parity seam, and the two vendors already answer differently. CodesysDriver.cs:91-99 calls `TriggerAsyncProbe()` on EVERY health poll; BeckhoffDriver.cs:60 calls it only `if (ageMs is null || ageMs > 5000)`. Health is polled by the tray (~4s) AND every control-plane /status AND every volt-control `refreshHealth()` — so with a VS Code window, the desktop app and the tray all attached, a CODESYS engineer's primary thread takes one marshalled probe per poll per client while the TwinCAT worker is bounded to one per 5s. No place in Core can ever notice or fix that, because the type that returns the answer belongs to the vendor. Separately, the cycle means the netstandard2.0 constraint (see the AssemblyResolve finding) is inherited by ~1,500 LOC of pure XML/text transform (PlcOpenReader/Writer, VgParser/VgWriter) that touches no IDE and has no reason to carry it.

**Smallest fix.** `IIdeSession` returns vendor primitives (a row snapshot + a diagnostic tuple), and `Wire`/`DriverBase` compose `HealthResponse`; `GraphicalCode.Write` takes and returns XML strings instead of `ICodeStore`/`ItemRef`.


> **Coverage of this lens.** "Read in full: ARCHITECTURE.md; map.md's seam-analyst section (lines 1-142) and the whole Volt.Cli.Transport, Volt.Engine and Volt.Cli.Ide.Codesys per-project tables plus their diagnosis notes. Then read the code the layering question points at, first-hand: Volt.Engine/Ide/{IIdeSession,ICodeStore,DriverBase}.cs, Volt.Engine/{BridgeException,Diagnostics/VoltLog}.cs, Volt.Engine/Wire (via the using census), Volt.Engine/Workspace/{Materializer,ItemKind}.cs, Volt.Engine/Graphical/GraphicalCode.cs, Volt.Engine/Library/LibraryManifest.cs, Volt.Cli.Transport/{PipeServer,BridgeErrorCodes,HealthStatus,Ops}.cs, both drivers' session + Code facets (CodesysDriver.cs, CodesysDriver.Code.cs, BeckhoffDriver.cs health/BuildProjects, BeckhoffDriver.Code.cs), CodesysTypeMap.cs's classification table, Volt.Cli.Ide.Codesys/PipeHost.cs, Volt.Cli.Ide.Twincat/Program.cs, Volt.Cli/Sync/BridgeResolver.cs, Volt.Cli.Connector.Core/{Log,TwincatXaeProbe}.cs, Volt.Cli.Connector/ConnectorSetup.cs, all six csprojs, and the staged net48 bin output. Ran a per-namespace `using Volt.*` census across Volt.Engine to establish the layer graph mechanically rather than from prose, and greps for BridgeErrorCodes consumers and for how `dirty` is consumed downstream in volt-control.\n\nDeliberately NOT covered, and left to the other lenses: PushService.cs (592 LOC) beyond its layer reach; the whole Graphical VG/PlcOpen transform pipeline internals (reader/writer/parser correctness, the five NetworkStride declarations, the VG diagnostic-code vocabulary); the connector's session/interest/reconcile model and ControlServer; test structure and FakeIde's fidelity; and the PARKED e2e conflict-resolve failure — I looked for a layering explanation and did not find one I could state with evidence, so I am not offering a guess.\n\nOne finding I built and then DELETED after checking the consumer: CodesysDriver reports `ProjectEntry.Dirty` for its row unconditionally while BeckhoffDriver.cs:139 reports `serving && (servedDirty ?? false)`, so a non-serving TwinCAT project always reads clean. volt-control/src/bridge/connector.ts:170-185 only reads `proj.dirty` for a row whose status is healthy/degraded (i.e. the serving one), so the divergence has no user-visible consequence today and does not meet the concrete-cost bar."


**Corrections to `map.md`**

- map.md records the three Engine layer inversions as separate observations (notes at lines 213, 214, 215: 'the stack depends bottom-up at its top', 'Workspace and Graphical are mutually dependent', 'Graphical depends on the Ide contract') but never states that together they close a CYCLE. They do: Ide → Wire → Sync → Workspace → Graphical → Ide, verified by the per-folder `using` census. Note 214 says the Workspace↔Graphical cycle 'is currently harmless only because PouToXml has zero callers' — that is wrong twice over: the cycle is Workspace→Graphical (Materializer.cs:4, a live production edge), and deleting PouToXml would not break it.
- ARCHITECTURE.md:78 ('A strict layer stack; each layer depends only on the ones above it') is false in BOTH directions, not just one. Ide depends DOWN on Wire and Library; Wire depends DOWN on Sync (BridgePipeHost dispatches to all four services); Graphical depends UP on Ide. Six of the eight Ide/ files are clean; the two that are not are the two that carry health.
- The brief's known-defect list says '`DriverBase.SingleFlight` swallows the health-probe failure'. That is stale as written. DriverBase.cs:124 routes the probe through `_healthProbe.Run(probe, OnProbeFailed)`, and OnProbeFailed (:131-135) does `VoltLog.Warn(...)` + `MarkDegraded(...)`. The bare `catch` at :154 wraps only the failure REPORTER, with the comment 'reporting must never fault the probe'. map.md's own DriverBase row states this correctly ('wraps the failure reporter in a bare catch'); the brief's one-line summary over-states it. Phase 5 should not re-fix this.
- The map's seam row for `IProjectSource` says the vendor asymmetry now lives above the seam 'in the connector shell + Core's supervisor'. Worth sharpening: the single most load-bearing instance is `Volt.Cli.Connector.Core/TwincatXaeProbe.cs`, which spawns the TwinCAT IDE host's exe and parses its stdout — inside the project whose csproj comment (line 8) says 'pure logic + the pipe wire'. There is no ProjectReference and no shared const table.
- The map's Transport notes say `Ops`, `Vendors` and `HealthStatus` have zero readers inside Volt.Cli.Transport and BridgeErrorCodes has exactly one. Confirmed, and one thing can be added: a grep of `src/Volt.Cli.Connector.Core` for `BridgeErrorCodes` returns ZERO hits, so nothing outside the Engine branch consumes that table at all — the only reason nine Engine-domain codes sit in the sink is the single `PipeServer.cs:90` fallback to `InternalError`.
- The map's CodesysDriver row lists `ReadManifest` as a 'Kind-string dispatch … falls through to a hand-written `$"{kind}\n"` literal'. It does not record the coverage gap that makes this consequential: CodesysTypeMap classifies `visualization` (IVisualObject), `image_pool` (IImagePoolObject) and `text_list` (IGlobalTextListObject/ITextListObject) as tracked items, and none of the three has a descriptor reader, so every one of them materializes as the literal kind word.

---

## Placement — decisions made outside the layer that owns them

_4 findings._


### The vendor seam declares "a method here must not decide a wire-visible outcome" and then declares the method that composes the entire `health` response — so the wire shape is built twice and the two copies already disagree

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Engine/Ide/IIdeSession.cs:9` · `packages/volt-cli/src/Volt.Engine/Ide/IIdeSession.cs:41` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:73` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.cs:79` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.cs:91` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.cs:51` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.cs:139` · `packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs:328`

**Evidence**

```
The contract states the rule and breaks it in the same file. IIdeSession.cs:9-12 — "This is the vendor SEAM: it exposes PRIMITIVES (attach, state reads, marshalling), never wire POLICY. A method here must not decide a wire-visible outcome — those are enforced ONCE in `Wire/BridgePipeHost`" — and IIdeSession.cs:41 `HealthResponse BuildHealthResponse();`, whose return type IS the `health` response. DriverBase.cs:73 `public abstract HealthResponse BuildHealthResponse();`, with its own note at :18-20: "ARCH FOLLOW-UP: because `BuildHealthResponse` is abstract, the wire-visible health shape is composed TWICE (once per vendor) — against 'parity-critical decisions live in Core, once'."

Three things the two copies decide separately, read side by side:

(1) REFRESH POLICY. CodesysDriver.cs:95 `TriggerAsyncProbe();` — unconditional, every poll. BeckhoffDriver.cs:57-60 `ageMs = _cachedAtMs == 0 ? null : Environment.TickCount64 - _cachedAtMs; ... if (ageMs is null || ageMs > 5000) TriggerAsyncProbe();` — a 5s throttle that exists on one vendor only. Nothing above the driver knows which it got.

(2) THE `Dirty` RULE FOR NON-SERVING ROWS. CODESYS, CodesysDriver.cs:79: `new ProjectEntry(Vendors.Codesys, IdeVersion, name!, RowStatus(serving), _om.ProjectDirty)` — dirty is reported regardless of `serving`. TwinCAT, BeckhoffDriver.cs:138-139: `new ProjectEntry(Vendors.Twincat, rows[i].IdeVersion, rows[i].Project, RowStatus(serving), serving && (servedDirty ?? false))` — dirty is forced false on every non-serving row. `BridgePipeHost.cs:68` forces `Status = Idle` while paused but never touches `Dirty`, so a paused CODESYS bridge emits `{status:"idle", dirty:true}` — a combination the TwinCAT driver cannot produce.

(3) WHETHER THE LIVE OVERLAY IS APPLIED AT ALL. `OverlayLiveHealth` (DriverBase.cs:182) is what keeps a cached row from reporting a stale "healthy"; both drivers call it by convention (CodesysDriver.cs:98, BeckhoffDriver.cs:63) and nothing in Core requires it. A driver returning `new HealthResponse { Projects = _cached }` compiles. Nothing offline would catch it: `test/shared/FakeIde.cs:233` implements `BuildHealthResponse` itself and does not derive from `DriverBase`, and the only unit test on this machinery is the pure static — `test/Volt.Engine.Tests/HonestHealthTests.cs:31 Assert.Equal(expected, DriverBase.DeriveServedStatus(degraded, opInFlight, ageMs))`.
```

**Why it costs.** An engineer has one XAE window holding two projects: the bound one is serving, the other has unsaved edits. The tray renders `p.Dirty` for every row unconditionally (TrayContext.cs:328 `$"...{p.DisplayName}{(p.Dirty ? " *" : "")}{tag}"`, inside the loop over all `_conn.Projects`), so the second project shows no `*`. The same engineer on CODESYS, having clicked tray Disconnect on a project with unsaved edits, sees the row go idle but KEEP its `*`. Identical IDE state, same field, same UI widget, two vendor answers — the class ARCHITECTURE.md:186 calls a bug outright ("any per-vendor difference that Volt can OBSERVE is a bug"). The structural half is worse than the symptom: the invariant that stops `health` reporting "healthy" over a channel that dropped is three lines copy-pasted into two vendor files, and no test in the repo exercises either copy — the first sign of a broken one is a UI showing a green connection to a CODESYS that was closed minutes ago.

**Smallest fix.** `DriverBase.BuildHealthResponse` becomes concrete (cache read + throttle + `OverlayLiveHealth`) over a new `protected abstract List<ProjectEntry> SnapshotRows()`, so the vendor supplies rows and Core composes the response.


### The connector gets the health VOCABULARY from Transport but not the DTO that carries it, so the health row is declared twice — and the connector's copy turns any parse drift into a silent "no project detected" while the CLI on the same pipe keeps working

`cross-project` · **likely** · `packages/volt-cli/src/Volt.Cli.Transport/HealthStatus.cs:3` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:85` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:93` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:100` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:29` · `packages/volt-cli/src/Volt.Cli.Connector.Core/ConnectionManager.cs:383`

**Evidence**

```
`HealthStatus` sits in the bottom project and its own docstring names both of its producers, which live above it: HealthStatus.cs:3-4 — "The per-row `status` word, defined once. Produced by the drivers (`DriverBase.RowStatus`) and forced to `Idle` on pause by `BridgePipeHost`." It has zero readers inside `Volt.Cli.Transport` (same for `Ops` and `Vendors`; `PipeNames.PrefixForVendor` at PipeNames.cs:26 does not even consult `Vendors`, it lowercases a raw string).

Because the words are in Transport and the DTO is in Engine, and `Volt.Cli.Connector.Core.csproj` references only Transport, the connector re-declares the row: PerPipeProjectSource.cs:100-102 `private sealed record WireHealth(List<WireProjectRow>? Projects); private sealed record WireProjectRow(string? Version, string? Project, string? Status, bool Dirty);` and parses it with a default at :93 `... p.Version, p.Status ?? HealthStatus.Idle)`. A failed parse is swallowed whole at :85-86 `try { parsed = JsonSerializer.Deserialize<WireHealth>(...); } catch { return new List<DetectedProject>(); }` — no log line.

The other pipe client does the opposite: BridgeClient.cs:29 `public HealthResponse GetHealth() => De<HealthResponse>(_pipe.Call(Ops.Health));` — it deserializes `Volt.Engine.Wire.HealthResponse` itself. Same wire, same process family, two DTO policies. The only pin between the declarations is `test/Volt.Cli.Connector.Tests/WireContractParityTests.cs`, in a test project whose csproj says it references `Volt.Engine` for that reason alone: "ONLY so a contract test can prove the bridge's `instances` shape and the connector's parser agree (the production connector deliberately does NOT reference Core)."
```

**Why it costs.** Take the supported mixed-version path: `ConnectorSetup.ResolveWorker` (ConnectorSetup.cs:39-45) resolves the TwinCAT worker from `VOLT_TWINCAT_BRIDGE` or a `bin/Release|Debug` dev tree, so an older connector routinely meets a newer worker. The moment the wire row's shape moves under the connector's private mirror, `Flatten` returns an empty list per pipe, `SourceScan(..., Reachable: pipes.Count > 0)` still reports reachable, and `ConnectionManager.Aggregate` (ConnectionManager.cs:383-385) falls to `BridgeStatus.Unavailable` — documented as "bridge up, but no IDE/project". The user sees an orange tray, "no project detected", and nothing to connect to, while `volt status` and `volt push` against the very same pipe succeed, because the CLI parses the authoritative DTO. There is no log line anywhere to point at the parse. The CLI is structurally incapable of landing in that state; the connector is the only client that can, and only because it holds a second declaration of the row.

**Smallest fix.** One declaration: move `HealthResponse`/`ProjectEntry` down into `Volt.Cli.Transport` beside `HealthStatus` (which already describes them) and delete the connector's private mirror.


### The TwinCAT worker-fleet decision lives in a WinForms `ApplicationContext`, and the pure decision Core computes for it is discarded — so the tested policy is not the one that runs, and the one that runs cannot be tested

`project` · **certain** · `packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs:149` · `packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs:155` · `packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs:162` · `packages/volt-cli/src/Volt.Cli.Connector/BridgeSupervisor.cs:37` · `packages/volt-cli/src/Volt.Cli.Connector.Core/TwincatSupervisor.cs:29` · `packages/volt-cli/test/Volt.Cli.Connector.Tests/Volt.Cli.Connector.Tests.csproj:3`

**Evidence**

```
Every remaining decision in the TwinCAT lifecycle is inline in a WinForms class. TrayContext.cs:149-160:

``
private async Task ReconcileTwincatWorkers()
{
    if (string.IsNullOrEmpty(_twincatExe)) return;
    if (_reconcileTick++ % 3 != 0) return;                         // probe cadence
    var pids = await Task.Run(() => TwincatXaeProbe.ListPids(_twincatExe, TimeSpan.FromSeconds(6)));
    if (pids == null) return;                                      // "probe FAILED ⇒ leave the fleet as-is"
    var (_, reap) = _twincatSupervisor.Reconcile(pids);
    foreach (var pid in pids)
        _supervisor.EnsureWorker(new WorkerSpec(TwincatWorkerId(pid), _twincatExe, $"--xae-pid {pid}"));
    foreach (var pid in reap)
        _supervisor.StopWorker(TwincatWorkerId(pid));
}
``

Note `var (_, reap) = ...` — the `Spawn` half of Core's decision is thrown away, and the tray re-decides spawning by calling `EnsureWorker` for every live pid every cycle. The real respawn rule is then BridgeSupervisor.cs:37-43, in the shell: `if (_workers.TryGetValue(w.Id, out var existing)) { if (!existing.HasExited) return; Log.Warn($"worker {w.Id} crashed ..."); ... }`.

Grep repo-wide confirms the discard is total: `Reconcile(...).Spawn` and `SpawnedPids` have consumers only in `test/Volt.Cli.Connector.Tests/TwincatSupervisorTests.cs` (lines 17,22,31,33,48,60,72,83,94,95,98); `BridgeSupervisor.IsWorkerRunning` (BridgeSupervisor.cs:74) has none anywhere. TwincatSupervisorTests.cs:94-95 asserts a policy production deliberately does not run: `Assert.Equal(new[]{100}, s.Reconcile(Pids(100)).Spawn); Assert.Empty(s.Reconcile(Pids(100)).Spawn); // still present → not respawned`.

And the code that DOES run cannot be reached by any test: `Volt.Cli.Connector.Tests.csproj` is `<TargetFramework>net8.0</TargetFramework>` referencing only `Volt.Cli.Connector.Core` and `Volt.Engine`; `Volt.Cli.Connector.csproj` is `net8.0-windows` + `UseWindowsForms`. The Core/shell line is not "logic vs UI" either — `TwincatXaeProbe.ListPids` (Core, TwincatXaeProbe.cs:34) is `Process.Start` code with no WinForms dependency, sitting on the opposite side of the line from `BridgeSupervisor`, which is also pure Process/Job-object code.
```

**Why it costs.** A user's XAE hiccups and the worker process dies. Whether it comes back is decided entirely by `EnsureWorker`'s `if (!existing.HasExited) return;` and by the worker id staying exactly `twincat.<pid>` across `EnsureWorker`/`StopWorker`/`RestartWorker` (which parses the pid back out of the string at TrayContext.cs:168). Break either — an early return, an id-scheme drift, a `_workers` key change — and TwinCAT silently stops syncing for that window until the user restarts the tray, with no reproduction path short of a live XAE. Every test in the repo stays green, because the 161 lines that decide it live in an assembly the test project's target framework forbids it from referencing, while the suite happily asserts a spawn list nothing consumes.

**Smallest fix.** `BridgeSupervisor` moves into `Volt.Cli.Connector.Core` and the probe→reconcile→spawn/reap composition becomes one method there; `TrayContext` only ticks it.


### `Git.Run` owns "a non-zero git exit is an error", and the two byte-returning paths route around it — so a genuine git failure reaches the user as "this file isn't at that ref"

`project` · **likely** · `packages/volt-cli/src/Volt.Cli/Sync/Git.cs:50` · `packages/volt-cli/src/Volt.Cli/Sync/Git.cs:350` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:448` · `packages/volt-cli/src/Volt.Cli/Program.cs:183`

**Evidence**

```
`Git.cs` is genuinely the only place the CLI shells out to git — grep for `ProcessStartInfo("git")`/`Process.Start` across `src/Volt.Cli` returns Git.cs:52/64, 352/354, 372/375 and nothing else — so the ownership claim in its docstring holds. But the error-classification decision lives in one of those three paths only. Git.cs:73 `if (!allowFail && code != 0) throw new GitError(string.Join(" ", args), code, stderr);` — that is `Run`, and `allowFail` is how a caller opts out deliberately (`ResolveRef`, `MergeHead`, `CommitAll`).

`GitShowBytes` builds its own process and never goes through `Run`: Git.cs:350-361 ends `return p.ExitCode != 0 ? null : ms.ToArray();` — every non-zero exit collapses to one value, `null`, with stderr piped to `Stream.Null` (:356). The caller then reads that single value as one specific meaning: Commands.cs:448-449 `var bytes = Git.GitShowBytes(root, gitRef, $"{Files.SrcDir}/{rel}"); return bytes is not null ? (bytes, null, false) : (null, $"{rel} not found at {@ref}", true);` — `Absent: true`. Program.cs:183-185 documents what `Absent` means downstream: "Absent (item not present at this ref — e.g. an added/removed item in a diff) → exit 2, which the diff content-provider renders as an empty pane." (`ReadBlobsBatch`, the other bypass at Git.cs:367-386, at least re-raises: `if (p.ExitCode != 0) throw new GitError("cat-file --batch", p.ExitCode, "");`.)
```

**Why it costs.** A workspace whose object store is damaged — an aborted `git gc`, a partially-synced repo on a network share, a bad `refs/remotes/volt/ide` — makes `git show VOLTIDE:src/POUs/FB_Motor.fb` exit non-zero for a reason that is not absence. `volt show` reports it as "FB_Motor.fb not found at VOLTIDE" and exits 2, so the VS Code / desktop diff view renders the IDE side as an EMPTY pane. The engineer reads that as "the IDE doesn't have this item" and reasons about a sync that never happened, when the truth is a corrupt repository that nothing surfaced — stderr was discarded on the way out.

**Smallest fix.** `GitShowBytes` routes through `Run`-style classification: distinguish git's "path does not exist in this tree" from any other non-zero exit, and let only the former return null.


> **Coverage of this lens.** Read in full: ARCHITECTURE.md; map.md's seam-analyst section (lines 1-143) and the Volt.Cli.Transport per-project table; Volt.Engine/Ide/{IIdeDriver,IIdeSession,DriverBase}.cs; Volt.Engine/Wire/{BridgePipeHost,HealthResponse,ProjectEntry}.cs; Volt.Engine/Sync/OpGuard.cs; Volt.Engine/Diagnostics/VoltLog.cs; both drivers' session files (CodesysDriver.cs, BeckhoffDriver.cs); Volt.Cli.Transport/{Ops,Vendors,BridgeErrorCodes,HealthStatus,PipeNames}.cs; every file in Volt.Cli/Sync/ plus Volt.Cli/Program.cs; Volt.Cli.Connector.Core/{PerPipeProjectSource,TwincatSupervisor,TwincatXaeProbe,DetectedProject,BridgeStatus,Log}.cs and ConnectionManager.Aggregate; Volt.Cli.Connector/{TrayContext,BridgeSupervisor,ConnectorSetup,Pruner}.cs; Volt.Cli.Ide.Twincat/Program.cs; all four connector/engine csproj files; test/Volt.Cli.Connector.Tests/WireContractParityTests.cs and its csproj. Grepped repo-wide for `BuildHealthResponse`/`new HealthResponse`, `OverlayLiveHealth|DeriveServedStatus|RowStatus|DriverBase` in test/, `SpawnedPids|.Reconcile(|IsWorkerRunning`, `Process.Start` in Volt.Cli, and `dirty` in packages/volt-control to trace the wire field to its consumers.\n\nDeliberately NOT opened, so this lens does not cover them: the Sync services (FetchService/PushService/BuildService/RefsService/Hasher/Versioning), all of Workspace/ and Graphical/ and Library/, the `.Tree`/`.Code` driver partials, the vendor gateways (CodesysObjectModel, TcObjectModel, TcPlcOpen, TcPouReader), ControlServer/Reconciler/Session, and the WinForms windows (StatusWindow, LogWindow, Updater, VoltEnv, LoginItem). I ran no build and no tests. I could not explain the parked `conflict-resolve.test.ts` suite-order failure — nothing in the placement of the health/lifecycle code I read accounts for state surviving between e2e files; that is a state/lifetime question and I left it to that lens.\n\nTwo things I looked for and did NOT find a defect in, reported so nobody re-derives them: (a) `Git.cs`'s claim to be \"the only place we shell out to git\" HOLDS — grep for `Process.Start` in src/Volt.Cli returns only Git.cs:64/354/375; my finding there is narrower, about `Run`'s error policy being bypassed twice, not about ownership. (b) The apparent double answer to \"is this item pushable\" (CLI-side `Extensions.IsReadOnly`/`IsPushable` vs the bridge's live CFC/SFC refusal) is a DELIBERATE placement, stated at Extensions.cs:12-14 — the CLI does not pre-filter by language, the bridge decides on live IDE state. Not a defect. Likewise `Sync/` splits cleanly on inspection: `IdeTree`, `StatusModel`, `Materialize`/`Extensions`, `Sidecar` are the CLI's own engine over a workspace the bridge knows nothing about (correctly local, not misplaced Engine code); the only presentation in the folder is `Reporter.cs` and the human refusal strings inside `Commands.cs`, with all rendering otherwise in `Program.cs`."


**Corrections to `map.md`**

- Seam table, `Volt.Cli.Connector ↔ Volt.Cli.Connector.Core` (map.md:78) understates the split: it says "the DECISION is in Core (TwincatSupervisor.Reconcile, TwincatXaeProbe.ListPids) while the SPAWN is in the shell". In fact the shell DISCARDS half the decision — TrayContext.cs:155 is `var (_, reap) = _twincatSupervisor.Reconcile(pids);` and then spawns for every live pid — so `Reconcile`'s `Spawn` result and `TwincatSupervisor.SpawnedPids` have NO production consumer at all (grep: only TwincatSupervisorTests). The spawn decision that actually runs is `BridgeSupervisor.EnsureWorker`'s `existing.HasExited` check, in the shell.
- Same row says the split "is invisible in source" because both assemblies share the namespace. It is stronger than invisible: `test/Volt.Cli.Connector.Tests/Volt.Cli.Connector.Tests.csproj` targets `net8.0` and references only Connector.Core + Volt.Engine, while `Volt.Cli.Connector` is `net8.0-windows`/`UseWindowsForms` — so `BridgeSupervisor`, `TrayContext.ReconcileTwincatWorkers`, `ConnectorSetup` and `Updater` are structurally unreachable from the test assembly, not merely untested.
- Seam table, `DriverBase` (map.md:69) records that `BuildHealthResponse` is abstract and cites the file's own ARCH FOLLOW-UP, but does not name any divergence the two implementations actually contain. There are two, present today: the probe refresh policy (CodesysDriver.cs:95 unconditional vs BeckhoffDriver.cs:60 throttled to 5s) and the `Dirty` rule for non-serving rows (CodesysDriver.cs:79 reports live dirty regardless of `serving`; BeckhoffDriver.cs:139 forces `serving && ...`), the latter observable in the tray label at TrayContext.cs:328.
- The `Volt.Cli.Connector` per-project table should record `BridgeSupervisor.IsWorkerRunning` (BridgeSupervisor.cs:74) as having zero consumers repo-wide — the map lists dead-ish vocabulary for Volt.Cli.Transport but not this one. (Static search only; no reflection/COM path reaches it, it is a plain public method on a type only TrayContext constructs.)
- map.md:23 flags `using Volt.Engine;` at Sync/Commands.cs:2 as "appears dead" — confirmed: Commands.cs matches on `PipeCallException.Code` (Commands.cs:13-14) and never names `BridgeException`; its live usings are `Volt.Engine.Wire` (:3) and `Volt.Cli.Transport` (:4).

---

## Duplication — two ways to do one thing

_8 findings._


### The health row is declared four times in C# plus once in TypeScript; the test that pins the connector's mirror does not cover the one field the CLI depends on

`wire` · **certain** · `packages/volt-cli/src/Volt.Engine/Wire/ProjectEntry.cs:27` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:100` · `packages/volt-cli/src/Volt.Cli.Connector.Core/DetectedProject.cs:18` · `packages/volt-cli/src/Volt.Cli.Connector.Core/ControlServer.cs:21` · `packages/volt-cli/test/Volt.Cli.Connector.Tests/WireContractParityTests.cs:28`

**Evidence**

```
Authoritative: `public sealed record ProjectEntry(string Vendor, string? Version, string Project, string Status, bool Dirty);`
Mirror: `private sealed record WireProjectRow(string? Version, string? Project, string? Status, bool Dirty);` — note there is NO `Vendor`; PerPipeProjectSource.cs:99 says "Vendor is stamped from the caller's own `vendor` param, not the wire, so it is not read back here."
Re-spelling 3: `public sealed record DetectedProject(string Id, string DisplayName, string Vendor, bool Dirty, ProjectRef Attach, string? Pipe = null, string? IdeVersion = null, string Status = HealthStatus.Idle)`
Re-spelling 4: `public sealed record ProjectView(string Id, string DisplayName, string Vendor, bool Dirty, string Status, string ProjectName, string? Pipe = null, string? IdeVersion = null);`
The pin, WireContractParityTests.cs:29-46, asserts DisplayName/Serving/Status/Dirty/Attach.Project — and never `Vendor`, because the mirror has no such field.
Meanwhile the CLI does NOT mirror at all: BridgeClient.cs:29-56 deserializes `Volt.Engine.Wire.HealthResponse` directly, and HealthResponse.cs:42 reads `Projects[0].Vendor` — `public string Platform => Projects.Count > 0 ? Projects[0].Vendor : "";`
```

**Why it costs.** Two clients of one wire, two opposite DTO policies, and the seam between them has a hole. `Commands.Init` writes `health.Platform` — i.e. `ProjectEntry.Vendor` off the wire — into `.git/volt/config.json` as the workspace's bound vendor, and `BridgeResolver.Resolve` turns that vendor into the pipe prefix it discovers on. If a bridge-side change renamed or re-cased that JSON field, `WireContractParityTests` stays green (the connector never reads it, so it cannot notice) and the tray keeps working perfectly, while `volt init` silently binds a workspace to vendor "" and every subsequent `pull`/`push` resolves against the wrong pipe prefix and refuses. The test file's own doc claims it is the pin that goes "red the moment the shapes drift" — it is red for four of five fields.

**Smallest fix.** Either drop the mirror (the CLI already proves the engine DTO is safe to consume) or give `WireProjectRow` a `Vendor` field so the pin covers the whole row.


### "Is the bridge on the project this workspace is bound to?" is answered in three places from two different sources with two different case policies

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Engine/Sync/OpGuard.cs:24` · `packages/volt-cli/src/Volt.Cli/Sync/Config.cs:66` · `packages/volt-cli/src/Volt.Cli/Sync/Config.cs:78` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:121`

**Evidence**

```
OpGuard.cs:27-32 decides it from LIVE driver state, case-insensitively on vendor — `if (!ide.IsConnected) throw BridgeException.PlcDisconnected(); var served = ide.ServedProjectName; if (!string.IsNullOrEmpty(expectedName) && (!string.Equals(served, expectedName, StringComparison.Ordinal) || !string.Equals(ide.Vendor, expectedPlatform, StringComparison.OrdinalIgnoreCase))) throw BridgeException.WrongProject(...)` — with a doc that says explicitly "It deliberately does NOT read BuildHealthResponse(): that is served from a per-vendor THROTTLED cache".

Config.cs:66-74 answers the same question from exactly that cached health, case-SENSITIVELY — `public static ProjectMismatch? ProjectMismatch(WorkspaceConfig cfg, HealthResponse health) { var bridge = new ProjectId(health.Platform, health.ProjectName ?? ""); ... if (configured.Platform != bridge.Platform) diff.Add("platform"); if (configured.ProjectName != bridge.ProjectName) diff.Add("projectName"); ...}` and Commands.cs:121 calls it on every `volt status`: `var mismatch = cfg is not null ? Config.ProjectMismatch(cfg, health) : null;`

Config.cs:78-83 is a third — `if (cfg.Project.Platform == platform && cfg.Project.ProjectName == projectName) return null;` — over the identity a fetch echoed back.
```

**Why it costs.** ARCHITECTURE.md Conventions rule 3 exists because deciding this from throttled health "refused pushes on stale state while reads of the same bridge succeeded". That defect was fixed inside the bridge and left standing one wire-hop out: right after an IDE close/reopen, or on TwinCAT where the health snapshot lags ~5s, `volt status` reads the stale cached row and prints "project mismatch — open the bound project in the IDE" and refuses to compute Incoming at all (Commands.cs:123 skips `GetRefs()` when mismatch is non-null), while `volt pull` and `volt push` against the same bridge in the same second succeed, because they go through OpGuard's live state. The engineer is told the workspace is bound to the wrong project by the one command whose whole job is to report state. The vendor comparison additionally disagrees (`OrdinalIgnoreCase` in the bridge, `!=` in the CLI), so any casing change to a `Vendors` constant refuses on one side and passes on the other.

**Smallest fix.** `volt status` should get its mismatch verdict from the same in-op guard the other verbs use (an echoed identity), not from `HealthResponse`.


### Volt.Cli.Connector.Core/Log.cs re-implements VoltLog by hand, and the copy has already dropped the level gate and the retention policy the original documents

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli.Connector.Core/Log.cs:11` · `packages/volt-cli/src/Volt.Cli.Connector.Core/Log.cs:42` · `packages/volt-cli/src/Volt.Engine/Diagnostics/VoltLog.cs:19` · `packages/volt-cli/src/Volt.Engine/Diagnostics/VoltLog.cs:97`

**Evidence**

```
Log.cs:17-19,34,40-47 — `public static void Info(string m) => Write("connector", $"[{Ts()}][connector][info] {m}"); ... File.AppendAllText(Path.Combine(Dir, $"{source}-{DateTime.Now:yyyy-MM-dd}.log"), line + Environment.NewLine); ... private static string Ts() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"); ... return Path.Combine(baseDir, "Volt", "logs");`

VoltLog.cs:77,94-95,108-115 — `WriteLine(source, $"[{Timestamp()}][{source}][{level.ToString().ToLowerInvariant()}] {message}"); ... private static string PathFor(string source) => Path.Combine(_dir, $"{source}-{DateTime.Now:yyyy-MM-dd}.log"); private static string Timestamp() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"); ... return Path.Combine(baseDir, "Volt", "logs");` — same directory, same daily filename, same timestamp format, re-typed.

What the copy omits: VoltLog.cs:52-54 `if (string.Equals(Environment.GetEnvironmentVariable("VOLT_LOG_DEBUG"), "1", ...)) _level = VoltLogLevel.Debug; try { Directory.CreateDirectory(_dir); Prune(); }` and VoltLog.cs:97-106 `Prune()` (`RetentionDays = 14`). Log.cs has no level concept and never prunes.
```

**Why it costs.** Two things break, and both are already broken. (1) `VOLT_LOG_DEBUG=1` is the documented troubleshooting switch; it turns on Debug for the bridges and does nothing for the connector, so the half of the system that owns sessions, leases and reconcile has exactly one verbosity forever — when a user reports "it says connected but push is refused", there is no way to get more from the component that decided it. (2) ARCHITECTURE.md describes the store as "daily files pruned after 14 days", but pruning only runs inside `VoltLog.Init`, i.e. when a bridge host starts. The connector is the always-on writer and the only one that never calls Init, so on a machine where the user runs the tray but never activates a CODESYS host and never opens an XAE, `connector-*.log` accumulates in `%LOCALAPPDATA%\Volt\logs` indefinitely with nothing to bound it. Any further divergence (a level added, the timestamp format changed, the directory moved) lands in one writer and not the other, in the same directory, with nothing checking.

**Smallest fix.** Volt.Cli.Transport (which the connector already references) should own the logger, and both sides should call it.


### The control-plane e2e harness re-implements the interest→serving reconcile, and its rule is not the product's rule

`cross-project` · **certain** · `packages/volt-cli/test/Volt.Cli.Connector.ControlHarness/Program.cs:25` · `packages/volt-cli/src/Volt.Cli.Connector.Core/Reconciler.cs:39`

**Evidence**

```
Harness (Program.cs:30-40): `var wanted = sessions.Values.SelectMany(list => list).Select(i => (i.Vendor, i.ProjectName)).ToHashSet(); var rows = Raw().ConvertAll(p => { var name = p.ProjectName ?? p.DisplayName; var serving = wanted.Contains((p.Vendor, name)); return p with { Status = serving ? (p.Status == "degraded" ? "degraded" : "healthy") : "idle" }; });`

Product (Reconciler.cs:66-89): `var lost = new HashSet<string>(previouslyWanted, ...); lost.ExceptWith(wanted); var toUnbind = detected.Where(p => p.Serving && (lost.Contains(p.Id) || forceOffSet.Contains(p.Id))).ToList(); ... foreach (var host in detected.GroupBy(p => p.Pipe ?? p.Id, ...)) { ... if (rows.Any(p => p.Serving && wanted.Contains(p.Id))) continue; var candidate = rows.Where(p => wanted.Contains(p.Id) && !p.Serving).OrderBy(p => p.Id, ...).FirstOrDefault(); if (candidate != null) toBind.Add(candidate); }` — plus `if (s.ExpiresAt <= nowUtc) continue;` at :54.
```

**Why it costs.** Three behaviours the product has and the harness does not: unbind is EDGE-triggered (only a wanted→unwanted transition or a tray force-off gates a row; the harness gates every row nobody currently wants), bind honours ONE serving project per host pipe (the harness serves all of them), and an expired lease contributes nothing (the harness has no clock). So a volt-control e2e that declares interest in two projects living in one TwinCAT XAE sees both rows go healthy and can assert UI behaviour — two connected workspaces on one worker — that the real connector will never produce, since Reconciler binds exactly one per pipe and leaves the sibling idle. Equally, a volt-control test that stops renewing and expects a row to stay serving passes here and fails on a real connector. The harness exists specifically so the TS client is exercised against "no mock"; on the one decision that matters it is a mock with different rules.

**Smallest fix.** The harness should call `Reconciler.Plan` over its scripted rows rather than deriving `serving` inline.


### The e2e harness and the CLI each implement "which bridge pipe do I talk to", with opposite policies — and conflict-resolve.test.ts binds with one and then pulls with the other

`cross-project` · **likely** · `packages/volt-cli/test/e2e/harness.ts:39` · `packages/volt-cli/test/e2e/harness.ts:58` · `packages/volt-cli/test/e2e/harness.ts:64` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:40` · `packages/volt-cli/test/e2e/lifecycle/conflict-resolve.test.ts:58`

**Evidence**

```
harness.ts:39-64 — `function livePipes(): string[] { const matching = readdirSync("\\\\.\\pipe\\").filter((n) => n === PIPE_PREFIX || n.startsWith(PIPE_PREFIX + ".")) ... const alive = matching.filter(ideAlive); return alive.length > 0 ? alive : matching }` … `function resolvePipe(): string { if (cachedPipe && livePipes().includes(cachedPipe)) return cachedPipe; cachedPipe = livePipes()[0] ?? PIPE_PREFIX; return cachedPipe }` … `export const PIPE = resolvePipe() // for labels + one-shot callers; live calls re-resolve`.

BridgeResolver.cs:40-58 — `public static string ChooseBridgePipe(...) { if (pipes.Count == 0) throw new BridgeError(BridgeErrorCodes.PlcDisconnected, ...); if (pipes.Count == 1) return pipes[0]; ... var matches = pipes.Where(p => projectsOf(p).Contains(boundName)).ToList(); if (matches.Count == 1) return matches[0]; if (matches.Count == 0) throw new BridgeError(BridgeErrorCodes.PlcDisconnected, ...); throw new BridgeError(AmbiguousBridge, $"{matches.Count} running {vendorLabel} have '{boundName}' open — close all but one, then retry."); }`

conflict-resolve.test.ts:58 — `const r = await init(parent, VENDOR, { pipe: PIPE })`, and volt-control/src/bridge/actions.ts:169 — `const env = opts.pipe ? { VOLT_PIPE: opts.pipe } : undefined` (only `init` gets it; `pull` gets none, so it goes through BridgeResolver).
```

**Why it costs.** `PIPE` is a FROZEN snapshot taken at harness-module import, and it is the only consumer of `PIPE` as a value in the whole e2e tree — every other harness call re-resolves per call. `volt init` therefore binds the workspace through the harness's rule (prefer-alive, else fall back to a stale pipe, else the bare prefix) while every later `pull`/`push` in that same test re-resolves through BridgeResolver's rule (refuse on 0 matches, refuse on ambiguity, match on the BOUND NAME not liveness). Run alone against a stable XAE there is exactly one pipe and the two rules agree. Run inside the full suite — after `disconnect-cycle`/`ide-restart` have gated a bridge, restarted an IDE under a new pid, or left a TwinCAT worker outliving its XAE (the harness's own comment at :23-27 says such a worker keeps serving for ~15s and answers PLC_DISCONNECTED) — the pipe set has changed under the frozen `PIPE`, and the second resolver refuses where the first one picked. That is exactly the reported parked symptom: init succeeds, `volt pull` errors, 2/2 in-suite and 0/2 alone. Two implementations of one decision is the only structure in this path that behaves differently depending on what ran earlier.

**Smallest fix.** Delete the exported frozen `PIPE`; `init` should be handed `resolvePipe()` at call time, or better, no pipe at all so both sides go through BridgeResolver.


### Two parsers derive a POU's kind from the same declaration text, and only one of them knows that a declaration may start with a pragma or a comment

`project` · **certain** · `packages/volt-cli/src/Volt.Engine/Workspace/SourceText/CodeHelper.cs:16` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Ide/CodesysTypeMap.cs:154` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Ide/CodesysTypeMap.cs:167` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.Code.cs:24`

**Evidence**

```
CodeHelper.cs:22-42 (the shared, Core parser) walks past pragmas and comments before it reads the keyword — `if (trimmed.StartsWith("{")) continue; if (trimmed.StartsWith("//")) continue; if (trimmed.StartsWith("(*")) { if (!trimmed.Contains("*)")) inBlockComment = true; continue; } headerLine = trimmed; break;` — then `if (NameAfter(headerLine, "INTERFACE") is { } iface) return new CodeHeader(ItemKind.Kinds.Interface, iface);`

CodesysTypeMap.cs:154-174 (the driver's own parser of the same string) does not — `private static int RefinePou(string? decl) { var k = LeadingKeyword(decl); if (k.StartsWith("FUNCTION_BLOCK")) return ItemKind.PlcPouFb; if (k.StartsWith("INTERFACE")) return ItemKind.PlcItf; ... return ItemKind.PlcPouFb; // default }` over `private static string LeadingKeyword(string? decl) { ... var s = decl!.TrimStart(); int end = 0; while (end < s.Length && (char.IsLetterOrDigit(s[end]) || s[end] == '_')) end++; return s.Substring(0, end).ToUpperInvariant(); }`
```

**Why it costs.** A CODESYS POU whose declaration opens with `{attribute 'qualified_only'}` or a `(* … *)` doc header makes `LeadingKeyword` return "" (the first char is not letter/digit/underscore), so `RefinePou` falls to its `return ItemKind.PlcPouFb` default. For a real INTERFACE that flips the driver's classification from PlcItf to PlcPouFb, and CodesysDriver.Code.cs:24 re-asks the same classifier to pick the export path — `if (KindCodeOf(item.Native) == ItemKind.PlcItf) return _om.ExportInterfaceXml(item.Native); return _om.ExportXmlWithChildren(item.Native);` — so a commented interface is exported down the non-interface path while `Materializer`, using the Core parser, still names the file `.itf` from the same text. One declaration, two kind verdicts, and the wrong one selects the vendor export primitive. It is also silent: nothing throws, so the item just materializes from the wrong export.

**Smallest fix.** `RefinePou` should call `CodeHelper.ParseCodeHeader(decl).Type` and map that to the ItemKind code, instead of scanning the first token itself.


### A second log channel (`Console.Error.WriteLine("[bridge] …")`) carries exactly the events the log-invariant covers, into a process that has no console

`project` · **certain** · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.Tree.cs:44` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Ide/CodesysTypeMap.cs:124` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs:145` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:51`

**Evidence**

```
CodesysDriver.Tree.cs:43-44 — `try { children = _om.GetChildren(node); } catch (Exception ex) { Console.Error.WriteLine($"[bridge] could not read children of a node (subtree skipped): {ex.Message}"); return; }`
CodesysTypeMap.cs:124 — `Console.Error.WriteLine($"[bridge] unrecognized CODESYS object type (skipped): name='{name}' interfaces=[{sig}]");`
BeckhoffDriver.Tree.cs:145 — `Console.Error.WriteLine($"[bridge] unmapped TwinCAT TREEITEMTYPE {code} (skipped): example item='{name}' ...");`
DriverBase.cs:51 writes the SAME line to both sinks — `if (!_isDegraded) { Console.Error.WriteLine($"[bridge] DEGRADED: {reason}"); VoltLog.Warn($"degraded: {reason}"); }`
Against ARCHITECTURE.md: "Skipped/errored items are logged, never silently dropped (Diagnostics/VoltLog) with name + reason", and Conventions rule 5 "one error channel, one log path".
```

**Why it costs.** The CODESYS host is a net48 library loaded IN-PROCESS by the IDE via IronPython (PipeHost.cs:51), and PipeHost.cs:65 calls `VoltLog.Init(Vendors.Codesys)` in that same process — so VoltLog works there and stderr does not: CODESYS.exe is a GUI process with no console attached. The two CODESYS sites are precisely the ones that report an item being DROPPED from the walk. An engineer whose POUs are missing from `src/` after a pull has nothing in `%LOCALAPPDATA%\Volt\logs` to read, and the invariant that says they would is the one this bypasses. The same event on TwinCAT DOES land in the log — but only because the connector redirects the worker's stderr through its own separate logger (BridgeSupervisor.cs:65 `proc.OutputDataReceived += (_, e) => Log.Raw(w.Id, e.Data);`), so the two vendors have different diagnosability for the same drop by accident of hosting rather than by design. DriverBase meanwhile emits every degrade twice, so a log read shows one transition or two depending on which sink you looked at.

**Smallest fix.** Those three sites should call `VoltLog.Warn`; DriverBase should drop its `Console.Error` half.


### "What did the IDE last have" is recorded in three stores, and one `volt status` answers its two halves from two of them

`project` · **likely** · `packages/volt-cli/src/Volt.Cli/Sync/Sidecar.cs:8` · `packages/volt-cli/src/Volt.Cli/Sync/Sidecar.cs:44` · `packages/volt-cli/src/Volt.Cli/Sync/IdeTree.cs:10` · `packages/volt-cli/src/Volt.Cli/Sync/StatusModel.cs:43` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:229`

**Evidence**

```
Store 1 — `public const string Range = "refs/remotes/volt/ide";` (IdeTree.cs:10), the IDE's content baseline as a git tree.
Store 2 — `public sealed class IdeRefs { public string ProjectVersion ...; public Dictionary<string,string> Items ...; public Dictionary<string,string> Folders ...; }` at `.git/volt/ide-refs.json` (Sidecar.cs:8-13).
Store 3 — `private static string PendingPath(string root) => System.IO.Path.Combine(Config.Paths(root).StateDir, "pending-ide-refs.json");` (Sidecar.cs:44), which exists only because 1 and 2 can be out of step.
One status, two baselines (StatusModel.cs:43-58): `var sidecar = Sidecar.LoadIdeRefs(root); var incoming = snap.Online && snap.ProjectMismatch is null ? ComputeIncoming(snap.Items, sidecar?.Items ?? new Dictionary<string, string>()) : ChangeSet.Empty(); ... foreach (var row in Git.DiffWorktree(root, IdeTree.Range, "src"))` — Incoming from store 2, Outgoing from store 1.
Commands.cs:229-240 advances them separately across a merge: `Git.UpdateRef(gitDir, IdeTree.Range, commit);` … `var outcome = Git.GitMerge(...); if (outcome.Kind == ResultKinds.Conflict) { Sidecar.SavePendingIdeRefs(root, newSidecar); return PullResult.Conflict(...); } Sidecar.SaveIdeRefs(root, newSidecar);`
```

**Why it costs.** After a conflicted pull the two baselines deliberately disagree: `refs/remotes/volt/ide` has already been moved to the new IDE state (Commands.cs:229, before the merge) while the sidecar still holds the pre-pull versions. `volt status` then reports the very same items as INCOMING (sidecar behind the bridge) and as OUTGOING (the conflict-marked worktree differs from the advanced volt/ide ref) — so the engineer, mid-conflict, is shown files that need both a pull and a push. `Commands.Push` also does not check `Git.IsMerging`, so a push from that state diffs the advanced volt/ide ref against the pre-merge HEAD and builds ops that send the OLD text back to the IDE, guarded by the stale sidecar versions — it is rejected on ifVersion, but the message the user gets is "the IDE changed since your last sync — run `volt pull` first", which is precisely what they were doing. The third file, `pending-ide-refs.json`, is the patch for exactly this and is applied only on `merge --continue` (Commands.cs:489), never on the status path.

**Smallest fix.** One baseline advance: the sidecar should be derived from (or committed with) the volt/ide ref move, so no status can read the two at different generations.


> **Coverage of this lens.** "Read in full: map.md's seam-analyst section (the first ~40KB) plus targeted greps of the rest; ARCHITECTURE.md in full. Then, in src/: Log.cs, VoltLog.cs, PerPipeProjectSource.cs, HealthResponse.cs, ProjectEntry.cs, DetectedProject.cs, ControlServer.cs, ConnectionManager.cs, Reconciler.cs, TwincatSupervisor.cs, BridgeSupervisor.cs, ConnectorSetup.cs, TrayContext.cs:100-200, Ops.cs, PipeClient.cs, PipeDiscovery.cs, BridgeResolver.cs, Commands.cs, Config.cs, Sidecar.cs, StatusModel.cs, IdeTree.cs, Materialize.cs, Extensions.cs, Scaffold.cs, Materializer.cs, ItemKind.cs, CodeHelper.cs, OpGuard.cs, RefsService.cs, ProjectSnapshot.cs, PlcOpenTransport.cs, both drivers' Code facets, CodesysTypeMap.cs, CodesysDriver.Tree.cs (walk head), PipeHost.cs, Twincat/Program.cs. In test/: harness.ts in full, conflict-resolve.test.ts, disconnect-cycle.test.ts head, ControlHarness/Program.cs, WireContractParityTests.cs. Repo-wide greps for Console/Trace logging sites, `LastIndexOf('.')` name-splitting, ProjectView construction, and volt-control's use of displayName/projectName.\n\nDeliberately NOT covered, and left to other lenses: the Graphical/ subtree (PlcOpenReader/Writer, VgParser/VgWriter, GraphModel, PouToXml — ~1,500 LOC where a reader/writer pair is a legitimate two-ended design, and judging near-clones there needs the VG spec I did not read); StSplitter/StAssembler internals (593+211 LOC of ST round-trip); the two drivers' Tree walks compared line-by-line (ARCHITECTURE.md marks the shape difference load-bearing and I could not distinguish irreducible from accidental without a live IDE); TcObjectModel/CodesysObjectModel gateway internals; and the C# unit-test tree beyond the two files above.\n\nTwo things I could not verify without running code, and have rated accordingly: whether real CODESYS projects in fact carry pragmas/doc-comments above POU headers (the two-parser divergence itself is verified from source and is certain; the frequency of its trigger is not), and the exact in-suite sequence that breaks conflict-resolve.test.ts — I verified the two-resolver split and that `PIPE` is frozen and is the only value-consumer of that export, which matches the alone-passes/in-suite-fails signature, but I did not reproduce it."


**Corrections to `map.md`**

- map.md seam table (`Volt.Cli.Connector.Core's deliberate NON-reference to Volt.Engine`) and the seam note at the end of that section say Log.cs "duplicates VoltLog's directory and line format by hand". That is incomplete in a way that matters: the copy also omits the LEVEL gate (so `VOLT_LOG_DEBUG=1` is silently a no-op for the connector) and the 14-day `Prune()` (which runs only inside `VoltLog.Init`, i.e. only when a bridge host starts). The drift the map presents as a future risk is already present, and it makes ARCHITECTURE.md's "daily files pruned after 14 days" false for `connector-*.log` on a machine that never activates a bridge.
- map.md notes "one project row is declared three times … with ProjectView as a fourth re-spelling in between" and calls WireContractParityTests "the sole pin between the two declarations of the health row". The pin is weaker than stated: `WireProjectRow` (PerPipeProjectSource.cs:101-102) has NO `Vendor` field at all, so WireContractParityTests never asserts it — yet `HealthResponse.Platform` (HealthResponse.cs:42) reads `Projects[0].Vendor` and `volt init` persists it as the workspace's bound vendor. Four of five fields are pinned; the one the CLI's pipe resolution depends on is not.
- map.md's `CodesysTypeMap` row records that "RefinePou (:154-161) keys on the leading IEC keyword of the DECLARATION TEXT … a text-derived classification" but does not record that it is a SECOND implementation of `CodeHelper.ParseCodeHeader`, nor that its `LeadingKeyword` (:167-174) cannot skip a leading `{attribute …}` pragma or `(* … *)` comment, where the Core parser explicitly does (CodeHelper.cs:33-39). `LeadingKeyword` appears nowhere in map.md.
- map.md has NO entry for `src/Volt.Cli/Sync/Sidecar.cs` (zero occurrences of "Sidecar" or "pending-ide-refs"). The CLI keeps THREE stores of the IDE baseline — `refs/remotes/volt/ide`, `.git/volt/ide-refs.json`, `.git/volt/pending-ide-refs.json` — and `StatusModel.BuildStatusData` computes Incoming from the second and Outgoing from the first. This is a leftover of the `.volt/`-snapshot → git-native migration and belongs in the map.
- map.md's seam-analyst note (c) says of test/e2e/harness.ts only that "a TypeScript client re-spells [the op names] independently". It re-implements three things, not one: the op-name table, PipeClient's frame protocol (harness.ts:82-103), and — the load-bearing one — BridgeResolver's pipe SELECTION (harness.ts:28-62), under a different policy (prefer-alive-else-take-a-stale-pipe vs refuse-on-zero-or-ambiguous). The exported `PIPE` constant is additionally frozen at module import while every other harness call re-resolves.

---

## Abstraction fit — dead flexibility, and seams that should exist and don't

_8 findings._


### `serving` is not a wire field — "which row is this bridge serving" is re-derived at five independent sites, and the e2e harness's version is `projects[0]`, which is what breaks conflict-resolve inside the full suite

`wire` · **likely** · `packages/volt-cli/src/Volt.Engine/Wire/ProjectEntry.cs:74` · `packages/volt-cli/src/Volt.Engine/Wire/HealthResponse.cs:30` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:164` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:93` · `packages/volt-cli/test/e2e/harness.ts:140` · `packages/volt-cli/test/e2e/lifecycle/disconnect-cycle.test.ts:47`

**Evidence**

```
HealthResponse.cs:27-30 — `/// "Serving" is a non-idle row — the status field carries it (there is no separate serving flag).` `public ProjectEntry? ServingProject => Projects.FirstOrDefault(p => p.Status != HealthStatus.Idle);`

harness.ts:139-142 gets it right — `const served = (h?.projects ?? []).find((p: any) => p.status && p.status !== "idle")`

disconnect-cycle.test.ts:46-48 does NOT — `const row = (await bridge.instances())?.[0]` / `bound = { project: row?.project }`, where `instances()` is `get("/health").then((h) => h.projects ?? [])` (harness.ts:124).

And the TwinCAT driver emits EVERY project in the XAE solution as a row, only one non-idle: BeckhoffDriver.cs:130-142 — `var rows = own.Projects.Select(...)` … `int servingIdx = connected && !string.IsNullOrEmpty(served) ? rows.FindIndex(r => r.Project == served) : -1;` … `bool serving = i == servingIdx;`
```

**Why it costs.** On a TwinCAT XAE whose solution lists more than one project and whose served project is not first, `disconnect-cycle.test.ts` captures `bound` = the WRONG project name in beforeAll, and then its `afterEach(resume)` / `afterAll(resume)` call `bridge.connect({project: <wrong name>})`. `Ops.Connect` sets `_paused=false` then `_om.SelectProject(name)` re-resolves by name on the live DTE (BeckhoffDriver.cs:145-148) — so the suite silently re-points the shared live bridge at a different project of the same XAE. Every later suite's `volt pull` then hits `OpGuard.RequireBoundProject`, whose `ServedProjectName` no longer equals the repo's bound `ExpectedProjectName`, and errors. Run alone, disconnect-cycle never executes, the bridge still serves the original project, and conflict-resolve passes 2/2 — exactly the parked symptom. The root cause is not the test: the wire deliberately deleted the explicit flag, so five clients each re-derive `Status != idle` and one of them (the only one with no shared helper to reach for) used position instead.

**Smallest fix.** Give `ProjectEntry` the derivation ONE owner the harness can call — a `servedRow(health)` in harness.ts alongside `healthStatus`, mirroring `HealthResponse.ServingProject`; better, put `serving` back on the row so no client derives anything.


### "Which project the client believes it is bound to" is a concept with no owner — two fields copy-pasted onto three request DTOs and simply absent from the fourth, so `volt status` reads a project `volt pull` refuses

`wire` · **likely** · `packages/volt-cli/src/Volt.Engine/Wire/RefsFetch.cs:39` · `packages/volt-cli/src/Volt.Engine/Wire/PushModels.cs:23` · `packages/volt-cli/src/Volt.Engine/Wire/BuildModels.cs:14` · `packages/volt-cli/src/Volt.Engine/Sync/RefsService.cs:21` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:46`

**Evidence**

```
The identical pair is declared three times with no shared type — RefsFetch.cs:39-43, PushModels.cs:23-27, BuildModels.cs:14-18, each `[JsonPropertyName("expectedPlatform")] public string? ExpectedPlatform` + `[JsonPropertyName("expectedProjectName")] public string? ExpectedProjectName`. Fetch/Push/Build each feed them to `OpGuard.RequireBoundProject(ide, request.ExpectedPlatform, request.ExpectedProjectName)`.

`refs` has no request DTO at all, so `RefsService.Handle(IIdeDriver ide, ...)` can only do half the check: `if (!ide.IsConnected) throw BridgeException.PlcDisconnected();` (RefsService.cs:21). `RefsResponse` also carries no `Platform`/`ProjectName` echo, unlike `FetchResponse`.

Routing does not cover the gap: `BridgeResolver.ChooseBridgePipe` returns early with `if (pipes.Count == 1) return pipes[0];` (BridgeResolver.cs:46) — no name check — and its doc at :36-39 says matching is against `the pipe's FULL project list (not just its serving project)`.
```

**Why it costs.** One TwinCAT XAE window holding two projects serves one pipe listing both rows. A repo bound to `MachineB` while the worker is serving `MachineA`: `volt status` resolves that single pipe, calls `refs`, `IsConnected` is true, and gets MachineA's whole version + folder map. The CLI renders it against MachineB's git tree, so the user sees every tracked file reported as changed or deleted and every one of MachineA's items as new — a full-project phantom diff on a live PLC repo. The very next `volt pull` on the same repo refuses with WRONG_PROJECT, because `fetch` carries the identity that `refs` does not. Two commands, same bridge, same second, opposite answers.

**Smallest fix.** One `BoundProjectRef { Platform, ProjectName }` embedded in all four request shapes — including a `RefsRequest` — so `refs` goes through `OpGuard` like every other project-touching op.


### `DebugService`, `IDebugIntrospect` and three `IIdeSession.Debug*` members are dead flexibility on the ONE vendor seam — ~290 LOC across three projects reachable from no client, and the answer is deletion, not a restored op

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Engine/Sync/DebugService.cs:28` · `packages/volt-cli/src/Volt.Engine/Ide/IDebugIntrospect.cs:12` · `packages/volt-cli/src/Volt.Engine/Ide/IIdeSession.cs:81` · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:112` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Ide/CodesysObjectModel.cs:112` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Ide/CodesysObjectModel.cs:619`

**Evidence**

```
Neither vendor implements more than one of the three: CodesysDriver overrides `DebugLibrarySignatures` (:112) and `DebugReflect` (:116) but NOT `DebugItemXml`; BeckhoffDriver overrides `DebugItemXml` (:167) and neither of the others — both fall back to `DriverBase`'s `=> ""` / `Array.Empty<...>()` (DriverBase.cs:112-119). `IDebugIntrospect` has exactly one implementer (CodesysDriver.Tree.cs:11) and one consumer, a runtime probe inside the unreachable service: DebugService.cs:106 `ide is IDebugIntrospect di ? Safe<object?>(() => di.TypeTags(node), null) : null`.

The vendor glue kept alive behind them is not small: `CodesysObjectModel.ReflectMembers` + `SampleObject`/`Distinct`/`Relevant` (~50 LOC of reflection, :112-158) and `CodesysObjectModel.DebugLibrarySignatures` (~55 LOC, :619+) — the latter runs a FULL `Build(app)` inside a service whose own docstring says `STRICTLY READ-ONLY` (DebugService.cs:11).
```

**Why it costs.** The vendor seam is the one contract a second implementer must satisfy in full. Today 4 of `IIdeSession`'s 20 members are debug-only and each vendor supplies a different, arbitrary subset — so anyone porting a third vendor (or reviewing `FakeIde`, which stubs all three at FakeIde.cs:288-291) spends time deciding how to answer a question nothing asks. Worse, `ARCHITECTURE.md:84` and `IIdeSession.cs:79-90` both tell a live-bridge debugger this dump exists and how to invoke it (`libsig=NAME`, `xmlof=NAME`, `reflect=TARGET`); there is no `debug` const in `Ops.cs` and no `debug` case in `BridgePipeHost.Dispatch`, so following that doc is a dead end during exactly the incident it was written for.

**Smallest fix.** Delete `DebugService`, `IDebugIntrospect`, the three `Debug*` members and their four vendor implementations; the corpus-capture use is already served by committed fixtures (`FbdCorpusRoundTripTests.cs:15`).


### `DriverBase.BuildHealthResponse` is abstract, so the health-poll throttle is a per-vendor decision — CODESYS fires an IDE-thread probe on every single poll, TwinCAT one per 5s

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Engine/Ide/DriverBase.cs:73` · `packages/volt-cli/src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.cs:91` · `packages/volt-cli/src/Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.cs:51`

**Evidence**

```
DriverBase.cs:18-20 flags it against its own rule — `ARCH FOLLOW-UP: because BuildHealthResponse is abstract, the wire-visible health shape is composed TWICE (once per vendor) — against "parity-critical decisions live in Core, once". It belongs here (cache read + throttle + OverlayLiveHealth) with the vendor supplying only the row snapshot.`

The two copies are the same four lines except for the throttle.
CODESYS (CodesysDriver.cs:91-99): `lock (_cacheLock) { projects = _projects; }` / `TriggerAsyncProbe();` / `return new HealthResponse { Projects = OverlayLiveHealth(projects) };` — unconditional.
TwinCAT (BeckhoffDriver.cs:51-64): `ageMs = _cachedAtMs == 0 ? null : Environment.TickCount64 - _cachedAtMs;` / `// Throttle the (heavier) STA refresh to ~5s` / `if (ageMs is null || ageMs > 5000) TriggerAsyncProbe();`

And `OpGuard.cs:20-22` states the throttle as if it were a shared property of the mechanism: `it is served from a per-vendor THROTTLED cache (~5s on TwinCAT)`.
```

**Why it costs.** `health` is polled by the connector every ~4s per pipe PLUS on every control-plane `/status`, so a user with the tray plus a VS Code panel plus the desktop window open produces a continuous poll stream. On CODESYS every one of those polls calls `TriggerAsyncProbe()`, which marshals `SnapshotHealth` (HasPrimaryProject / HasObjectManager / ProjectName / ProjectDirty over the reflection object model) onto the IDE's PRIMARY thread — the thread the engineer's CODESYS UI runs on. `SingleFlight` bounds it to one at a time, so the steady state is back-to-back object-model reads on the user's IDE thread for as long as any Volt frontend is open. The TwinCAT user gets one per 5s for the same UI. Nobody chose that asymmetry; it exists because the throttle lives in the copy rather than in Core.

**Smallest fix.** Make `BuildHealthResponse` non-virtual on `DriverBase` (cache read + one throttle + `OverlayLiveHealth`) and leave the vendor supplying only `SnapshotHealth`'s row list.


### `Graphical/PouToXml` and the `BodyLanguage` fields that exist only to feed it are entirely dead — the ST→PouData→XML direction was never built

`project` · **certain** · `packages/volt-cli/src/Volt.Engine/Graphical/PouToXml.cs:12` · `packages/volt-cli/src/Volt.Engine/Workspace/PouData.cs:10` · `packages/volt-cli/test/Volt.Engine.Tests/WireVocabularyGuardTests.cs:60`

**Evidence**

```
`PouData.cs:8-13` states it outright: `There is no StText→PouData→XML direction — push writes each item through Ide/ICodeStore … so nothing assembles a PouData from ST.` … `BodyLanguage (here and on ChildData) is write-only on that read path … Its only reader is Graphical/PouToXml, which has no production call site.`

Repo-wide grep for `PouToXml` over src+test returns three hits and none is a call: its own declaration (PouToXml.cs:9,12,18) and the guard allowlist `new HashSet<string> { "ItemKind.cs", "PlcOpenPouParser.cs", "PouToXml.cs", "VgParser.cs" }` (WireVocabularyGuardTests.cs:60).
```

**Why it costs.** 92 LOC of PLCopen-emitting code that nobody exercises still fails the same review as live code: it is in the WireVocabularyGuard's allowlist, so the guard that exists to stop kind literals being re-spelled outside `ItemKind.cs` has been widened for a file that ships to nobody — a real re-spelling could be added there and the guard would pass. And `Materializer` pays for it on every pull: it populates `PouData.BodyLanguage` and `ChildData.BodyLanguage` on every item it builds (Materializer.cs:58,75,93) for a consumer that does not exist, so a maintainer changing how body language is derived has to reason about a field with no reader.

**Smallest fix.** Delete `Graphical/PouToXml.cs`, drop `BodyLanguage` from `PouData`/`ChildData`, and remove `PouToXml.cs` from the WireVocabularyGuard allowlist.


### The canonical workspace-ST emit format has two owners — `PouToStText` ships, `StAssembler` is what the round-trip tests certify — and the two have already diverged in failure policy

`project` · **certain** · `packages/volt-cli/src/Volt.Engine/Workspace/PouToStText.cs:53` · `packages/volt-cli/src/Volt.Engine/Workspace/SourceText/StAssembler.cs:91` · `packages/volt-cli/test/Volt.Engine.Tests/ChildDirectiveTests.cs:39` · `packages/volt-cli/test/Volt.Engine.Tests/InterfaceRoundTripTests.cs:29`

**Evidence**

```
Same function, opposite policy on the same input.

PouToStText.cs:49-60 — `// No silent fallback — an invented END_<KIND> would write syntactically wrong ST into the user's repo.` … `_ => throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader, $"No END keyword for kind '{kind}'"),` and AssembleChild:75-81 throws for any child kind that is not Method/Action/Property.

StAssembler.cs:91-97 — `_ => $"END_{kind.ToUpperInvariant()}",` and AssembleChild:175 — `var endKw = child.Kind == ItemKind.Kinds.Method ? "END_METHOD" : "END_ACTION";`

The interface-ordering rule is hand-duplicated verbatim in both (PouToStText.cs:31-40 vs StAssembler.cs:113-129), and the file itself records the deferral: StAssembler.cs:32-35 `ponytail: kept ONLY because the two assemble⇄split round-trip tests … still drive this dict-based copy … then delete this file; the canonical ST emit format must not live in two places.`

The only production caller of the emitter is `Materializer.cs:20` → `PouToStText.Convert(build)`; the only callers of `StAssembler.Assemble` are ChildDirectiveTests.cs:39 and InterfaceRoundTripTests.cs:29.
```

**Why it costs.** `StSplitter` is the inverse of the emitted format and is the sole reader on the push path (PushService `SplitSt`). The two tests that certify "assemble then split round-trips" run split against the copy that ships to nobody, so any change to the shipped emitter — child ordering, the `%FOLDER` placement, the interface members-inside-END_INTERFACE rule — can be made in `PouToStText` alone and both round-trip tests stay green while the real pull→edit→push cycle drops or misparses children. The divergence is not hypothetical: it already exists in the throw-vs-invent branch, which is exactly the case `PouToStText.cs:50-52` says was previously masked.

**Smallest fix.** Repoint ChildDirectiveTests and InterfaceRoundTripTests at `PouToStText.Convert(PouData)` and delete `StAssembler.cs`, as its own ponytail note prescribes.


### "Is this text an editable VG body" is answered by three different predicates that disagree on whitespace and on whether the language token is required

`project` · **likely** · `packages/volt-cli/src/Volt.Engine/Graphical/VgBody.cs:17` · `packages/volt-cli/src/Volt.Engine/Workspace/SourceText/StSplitter.cs:215` · `packages/volt-cli/src/Volt.Engine/Graphical/Vg/VgParser.cs:54`

**Evidence**

```
Three spellings of one test:
`VgBody.cs:17` — `private static readonly Regex NetworkHeader = new(@"^NETWORK\s+\d+\s+([A-Za-z]\w*)", RegexOptions.Compiled);` (any spacing, language REQUIRED)
`StSplitter.cs:215` — `if (t.StartsWith("NETWORK ", StringComparison.Ordinal) && t.Length > 8 && char.IsDigit(t[8]))` (EXACTLY one space, digit at a fixed offset, language not required)
`VgParser.cs:54` — `if (line.StartsWith("NETWORK"))` (no space, no digit, no language)

They are consumed as if they agreed: `PushService.cs:300` `var pouVg = VgBody.Is(impl);` decides the transport, while the `impl` it is testing was produced by `StSplitter`'s marker scan, and `PushService.cs:514` even documents the pair as one rule.
```

**Why it costs.** The VG text lands in the user's git repo and is edited there by a human or an agent. Insert one extra space — `NETWORK  1 FBD` — and `StSplitter.FirstMarkerLine` returns -1 (position 8 holds a space, not a digit), so the whole graphical body is classified as DECLARATION and the implementation comes out empty; `VgBody.Is` then says not-VG and push takes the textual path. On an existing POU the body-format guard (PushService.cs:352-361) catches it and refuses with `'X' is a graphical FBD body in the IDE — a textual push would overwrite it`, blaming the user for a textual push they did not write. On a CREATE the guard does not run at all (PushService.cs:311-338 branches on `pouVg` before any live read), so `volt push` creates a plain ST POU whose declaration is the entire network text and reports success — invalid ST written into the live PLC project.

**Smallest fix.** `StSplitter` and `VgParser` should both call `VgBody.Is` / `VgBody.LanguageOf` instead of carrying their own marker tests.


### `ProjectSnapshot.IsTracked` is declared as "the single gate" but `FetchService` re-spells it inline, so the definition of a tracked item has two implementations kept equal only by a test

`project` · **suspected** · `packages/volt-cli/src/Volt.Engine/Sync/ProjectSnapshot.cs:49` · `packages/volt-cli/src/Volt.Engine/Sync/FetchService.cs:78`

**Evidence**

```
ProjectSnapshot.cs:45-50 — `/// <summary>The single gate that decides whether an item is TRACKED … Used by Walk AND by push's lease baseline so both hash the SAME item set — a divergent gate there would spuriously reject a push with "pull first".` / `public static bool IsTracked(int kindCode) => ItemKind.Map(kindCode) != null && !ItemKind.IsContainerManager(kindCode);`

FetchService.cs:78-84 does not call it — `var kind = ItemKind.Map(it.KindCode); if (kind == null) { unmapped++; …; continue; }` … `if (ItemKind.IsContainerManager(it.KindCode)) continue;`

and ProjectSnapshot.cs:21-23 records the split as documentation rather than code: `fetch keeps its own walk … but is documented to produce the same version map for the same gates.`
```

**Why it costs.** `ARCHITECTURE.md:104-106` scopes exclude-from-build filtering as a future addition and says to `wire it into the tree walk`. Wire it into `IsTracked` — the type that calls itself the single gate — and `refs` plus the push receipt drop excluded items while `fetch` keeps returning their bodies and versions. The client persists `fetch`'s `projectVersion` as its IDE baseline (no follow-up `refs`), so its next `push` fails the project lease against a receipt hashed over a smaller set, and every push is rejected with "pull first" while every pull reproduces the mismatch. `EndpointParityTests` would go red, which is the current backstop — but a test standing in for a shared predicate means the gate is enforced after the fact rather than by construction.

**Smallest fix.** `FetchService`'s walk loop should call `ProjectSnapshot.IsTracked(it.KindCode)` rather than re-spelling its two clauses.


> **Coverage of this lens.** Read map.md's seam-analyst section (lines 1-101) and the full `Volt.Cli.Transport` + `Volt.Engine` per-type tables (lines 102-191); read ARCHITECTURE.md in full.\n\nOpened and read in full: `Ide/IIdeDriver.cs`, `IIdeSession.cs`, `ICodeStore.cs`, `IDebugIntrospect.cs`, `DriverBase.cs`, `PlcOpenTransport.cs`; `Sync/DebugService.cs`, `OpGuard.cs`, `RefsService.cs`, `BuildService.cs`; `Wire/HealthResponse.cs`; `Workspace/PouToStText.cs`, `SourceText/StAssembler.cs`, `Graphical/VgBody.cs`, `Graphical/PouToXml.cs` (head); `Volt.Cli/Sync/BridgeResolver.cs`; `Volt.Cli.Connector.Core/IProjectSource.cs`, `PerPipeProjectSource.cs`, `Log.cs`; `Volt.Engine/Diagnostics/VoltLog.cs`; `test/e2e/lifecycle/disconnect-cycle.test.ts`. Read the relevant slices of `BridgePipeHost.cs` (dispatch + pause gate), `PushService.cs` (280-400), `FetchService.cs` (60-100), `ProjectSnapshot.cs` (15-60), `StSplitter.cs` (195-235), both drivers' session files, `CodesysObjectModel.cs` (105-160, 612-660), `TcObjectModel.cs` (460-495), `Connector/Pruner.cs`, `ChildDirectiveTests.cs`. Grepped src+test repo-wide for every Debug* symbol, `StAssembler`/`PouToXml`/`PouData`, `ICodeStore`/`IProjectTree`/`IIdeSession` as parameter types, `Expected{Platform,ProjectName}`, `NETWORK`, `Severity`, `PlcOpenTransport`, `VoltLog.Init`.\n\nDeliberately NOT covered (other lenses' ground, and I did not want to half-answer them): the whole `Graphical/Vg` parser/writer pair and `PlcOpenReader`/`Writer` internals; `StSplitter`'s scanner beyond the marker test; the connector's `ConnectionManager`/`Reconciler`/`Session` model and `ControlServer`; the `Volt.Cli` command layer and its git plumbing; `Volt.Cli.Transport`'s framing and P/Invoke; the `Library/` namespace. I also did not build or run anything, so the divergence claims are from reading both sides of each pair, not from execution.\n\nDropped before returning, for want of a concrete cost: the two-logger duplication (`VoltLog` vs `Connector.Core/Log`) — the retention policy really does live only in `VoltLog.Prune`, but `Prune` deletes every `*.log` in the shared directory whenever any bridge starts, so the connector's unpruned writer costs nothing observable; and the `IProjectSource` vendor-neutrality claim, whose only cost I could state was misdirected debugging.


**Corrections to `map.md`**

- map.md:141 and :159 label `DriverBase.SingleFlight` as "(probe failure swallowed)" / "KNOWN, ALREADY-DIAGNOSED (probe failure swallowed)". The label is stale as of the current source: `SingleFlight.Run` is `try { work(); } catch (Exception ex) { try { onFailure(ex); } catch { /* reporting must never fault the probe */ } }` (DriverBase.cs:153-154) and `OnProbeFailed` (DriverBase.cs:131-135) both `VoltLog.Warn(...)` and `MarkDegraded(...)`. The bare catch wraps ONLY the failure reporter, not the probe. What IS still live on that path is the `_opInFlight` note at DriverBase.cs:33-38 — a wedged probe pins the counter and `DeriveServedStatus` keeps answering healthy. Three lenses will otherwise re-derive a fixed defect.
- map.md:68 (seam table, `IIdeDriver`) says "The three-way facet split is not load-bearing in production — no production type implements one facet without the others; only a test does (FakeCodeStore)." That is wrong for one of the three: production Core code takes the NARROW facet as its parameter type — `GraphicalCode.Read(ICodeStore code, ItemRef item)` (GraphicalCode.cs:27), `GraphicalCode.Write(ICodeStore code, …)` (:128) and `DeclarationFrom(ICodeStore code, …)` (:160). `ICodeStore` therefore earns its split twice over (a narrowing production consumer plus a truthful fake). It is `IProjectTree` and `IIdeSession` that have no narrowing consumer anywhere in src — every other Core call site takes `IIdeDriver`.
- map.md:74 (seam table, `IProjectSource`) treats the interface's doc comment as the source of the false claim. Worth adding: in the file as written the doc block intended for the interface is syntactically attached to the WRONG type. `IProjectSource.cs:6-12` and `:13-16` are two consecutive `<summary>` blocks with no declaration between them, so both attach to `public sealed record SourceScan` at :17, and `public interface IProjectSource` at :19 carries no documentation at all. Anyone reading the interface in an editor tooltip sees nothing; the stale ExternalAttach/InIdeLoad claim shows up on `SourceScan` instead.
- map.md:171 (`ProjectEntry`) says "'Serving' is not a field: it is derived as `Status != \"idle\"` at three independent sites." There are five. The three C# sites listed, plus `test/e2e/harness.ts:140` (`(h?.projects ?? []).find(p => p.status && p.status !== "idle")`) — a fourth implementation across the language boundary — and `test/e2e/lifecycle/disconnect-cycle.test.ts:47`, which skips the derivation entirely and takes `projects[0]`. That fifth site is load-bearing: see the finding on the parked conflict-resolve failure.
- map.md:181 (`DebugService`) and :96 record the debug surface as "three supporting members on IIdeSession" plus `IDebugIntrospect`. Worth adding for the deletion decision: neither vendor implements more than ONE of the three. CodesysDriver overrides `DebugLibrarySignatures` (:112) and `DebugReflect` (:116) and inherits `DebugItemXml => ""`; BeckhoffDriver overrides only `DebugItemXml` (:167) and inherits the other two. So the seam carries four members that no single driver answers and no client calls.

---

## Contract fit — wire vs domain vs workspace models

_8 findings._


### `refs` is the only project-touching op with no identity on the wire, so `volt status` guards it with a pre-op read of the throttled health cache — the exact pattern OpGuard and ARCHITECTURE.md rule 3 forbid

`wire` · **certain** · `packages/volt-cli/src/Volt.Engine/Sync/RefsService.cs:19` · `packages/volt-cli/src/Volt.Engine/Wire/RefsFetch.cs:6` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:119` · `packages/volt-cli/src/Volt.Cli/Sync/Config.cs:66` · `packages/volt-cli/src/Volt.Engine/Sync/OpGuard.cs:18`

**Evidence**

```
RefsService.cs:19-21 — `public static RefsResponse Handle(IIdeDriver ide, Action<ProgressFrame>? onProgress = null)` / `if (!ide.IsConnected) throw BridgeException.PlcDisconnected();` — that is the WHOLE precondition. RefsFetch.cs:6-19 — `public class RefsResponse { ProjectVersion; StructureVersion; Items; Folders; }` — no platform, no projectName, neither in nor out.

Every OTHER project-touching op carries and echoes identity, and routes through OpGuard: `FetchRequest.ExpectedPlatform/ExpectedProjectName` (RefsFetch.cs:39-43) plus `FetchResponse.Platform/ProjectName` (RefsFetch.cs:89-93); `PushRequest.ExpectedPlatform/ExpectedProjectName` (PushModels.cs:23-27); `BuildRequest` (BuildModels.cs:14-18).

So the CLI compensates client-side. Commands.cs:119-124:
    var health = bridge.GetHealth();
    var mismatch = cfg is not null ? Config.ProjectMismatch(cfg, health) : null;
    snap = online && mismatch is null && !localOnly
        ? BuildSnap(online, detail, mismatch, bridge.GetRefs())
and Config.cs:68 `var bridge = new ProjectId(health.Platform, health.ProjectName ?? "");` — i.e. the verdict comes from `BuildHealthResponse()`. OpGuard.cs:20-23 says exactly why that is wrong: "It deliberately does NOT read BuildHealthResponse(): that is served from a per-vendor THROTTLED cache (~5s on TwinCAT), so deciding a write against it refused pushes with PLC_DISCONNECTED on stale state while reads of the same bridge succeeded... One question, one answer."
```

**Why it costs.** A TwinCAT XAE window holds two projects and the connector rebinds the worker from ProjA to ProjB. For the next few seconds `health` still reports ProjA (throttled cache), so `Config.ProjectMismatch` returns null and `volt status` proceeds to call `refs` — which walks whatever the bridge is serving NOW, ProjB, and echoes nothing to say so. `StatusModel.ComputeIncoming(refs.Items, sidecar.Items)` then diffs ProjB's item map against ProjA's workspace baseline: the panel in volt-vscode/volt-desktop shows every file in the workspace as incoming-removed and every ProjB file as incoming-added. Nothing on the wire could have caught it, because `refs` neither takes an expected project nor echoes the one it walked.

**Smallest fix.** Give `refs` the same expectedPlatform/expectedProjectName request fields and platform/projectName echo as fetch/push/build, and replace RefsService's bare IsConnected check with OpGuard.RequireBoundProject.


### PLC_DISCONNECTED carries three different message texts for three different conditions, and the one the CLI shows for a tray Disconnect tells the user to do something that cannot help

`wire` · **certain** · `packages/volt-cli/src/Volt.Engine/BridgeException.cs:19` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:47` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:93` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:20`

**Evidence**

```
BridgeException.cs:19-26 documents the collision against itself:
    /// <summary>The bridge is up but no IDE project is loaded ...
    /// <para>NB the code has a SECOND meaning today: Wire/BridgePipeHost also raises it for the tray's
    /// deliberate pause gate, where nothing is "waiting for an IDE project" — so this canned message is wrong at
    /// that call site (and a third message is built inline there). ARCH FOLLOW-UP...
    public static BridgeException PlcDisconnected() =>
        new(BridgeErrorCodes.PlcDisconnected, "Bridge is waiting for an IDE project");

The pause gate is BridgePipeHost.cs:47 `if (_paused && !AllowedWhilePaused(req.Op)) throw BridgeException.PlcDisconnected();` — the canned text. The connect post-condition builds a third text inline at BridgePipeHost.cs:93-96.

And the CLI has no way out: `BridgeClient` (BridgeClient.cs:29-56) exposes health/refs/fetch/init/push/build and NO connect — `Ops.Connect`/`Ops.Disconnect` have exactly one C# client, the connector (PerPipeProjectSource.cs:61,69).
```

**Why it costs.** An engineer clicks Disconnect in the tray, then runs `volt push` in a terminal. The bridge refuses with "Bridge is waiting for an IDE project". CODESYS is running with the project open, so the message is false; the engineer reloads the project in the IDE (which changes nothing — the gate is an in-memory flag on the host, BridgePipeHost.cs:28) and pushes again, getting the same line. The only fix is the tray, which the message never mentions, and the CLI cannot issue `connect` itself. The message text IS the wire contract for a human here — the code alone does not distinguish the three cases.

**Smallest fix.** A distinct factory (same code) for the pause gate whose text names the tray Disconnect and how to undo it.


### `structureVersion` is on the wire, hashed over the wrong key space, and has no reader outside tests — while ARCHITECTURE.md cites it as load-bearing identity machinery

`wire` · **certain** · `packages/volt-cli/src/Volt.Engine/Sync/Hasher.cs:48` · `packages/volt-cli/src/Volt.Engine/Sync/ProjectSnapshot.cs:83` · `packages/volt-cli/src/Volt.Engine/Wire/RefsFetch.cs:11` · `packages/volt-cli/src/Volt.Engine/Wire/RefsFetch.cs:69`

**Evidence**

```
It is computed over the BARE-name map, not the wire's full names — ProjectSnapshot.cs:78-83:
    snap.Versions[it.Name] = version;                                  // bare
    if (mat != null) { snap.FullVersions[mat.FullName] = version; ... } // full — the wire Items map
    snap.StructureVersion = Hasher.ComputeStructureVersion(snap.Versions);
and Hasher.cs:47-54 `/// <summary>Structure version: ordinal-sorted names only (changes when items add/remove/rename).</summary>`.

A repo-wide grep for structureVersion/StructureVersion returns 12 files: the four Engine files that PRODUCE it, ARCHITECTURE.md, and seven TEST files (test/e2e/harness.ts, refs.test.ts, fetch.test.ts, slow-project.test.ts, EndpointParityTests.cs, ResilienceTests.cs). Zero readers in src/Volt.Cli, src/Volt.Cli.Connector.Core, packages/volt-control or packages/volt-vscode. `volt pull` decides change from the Items map instead (Commands.cs:182 `StatusModel.ComputeIncoming(fetched.Items, sidecar?.Items ...)`).
```

**Why it costs.** The next client that needs 'did the item set change' (the vscode drift view, an MCP entry) will reach for the field ARCHITECTURE.md advertises for exactly that job. Because it hashes bare names, converting a POU from FUNCTION_BLOCK to PROGRAM — which removes `Foo.fb` and adds `Foo.prg` on the wire — leaves structureVersion byte-identical, so that client concludes the structure is unchanged and skips the refresh. The e2e tests that assert structureVersion stability (slow-project.test.ts:36, fetch.test.ts:77) will keep passing, because they only ever compare it against itself.

**Smallest fix.** Hash structureVersion over the FULL-name map the wire actually carries (FullVersions), or delete the field and say the Items map is the structure signal.


### PushResponse declares its accepted-push fields nullable for wire-skew tolerance; the sole consumer dereferences all three with `!` and writes the nulls into a sidecar its own loader treats as corrupt

`wire` · **likely** · `packages/volt-cli/src/Volt.Engine/Wire/PushModels.cs:92` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:372` · `packages/volt-cli/src/Volt.Cli/Sync/Sidecar.cs:30`

**Evidence**

```
PushModels.cs:92-102 declares them optional, and says why:
    [JsonPropertyName("newProjectVersion")] public string? NewProjectVersion { get; set; }
    [JsonPropertyName("newItems")] public Dictionary<string, string>? NewItems { get; set; }
    /// <summary>...Additive (nullable): an older client ignores it, so this needs no wire-version bump...
    [JsonPropertyName("newFolders")] public Dictionary<string, string>? NewFolders { get; set; }

The consumer denies the optionality (Commands.cs:372, and again at :380-382):
    Sidecar.SaveIdeRefs(root, new IdeRefs { ProjectVersion = resp.NewProjectVersion!, Items = resp.NewItems!, Folders = resp.NewFolders! });

And IdeRefs' own loader treats exactly that state as unrecoverable (Sidecar.cs:30-31):
    if (raw is null || raw.ProjectVersion is null || raw.Items is null || raw.Folders is null)
        throw new InvalidOperationException(".git/volt/ide-refs.json is malformed — delete it and run `volt pull` to rebuild the baseline");

Nothing validates the response before it is persisted; `BridgeClient.De<T>` (BridgeClient.cs:27) is a plain `JsonSerializer.Deserialize<T>(...)!`, which returns a fully-defaulted object for any JSON that lacks the fields — no throw, no signal.
```

**Why it costs.** Version skew across this pipe is real and routine: the CODESYS host is loaded IN-PROCESS and dies only with the IDE (ARCHITECTURE.md, 'CODESYS host = in-proc, dies with the IDE'). An engineer updates Volt while CODESYS stays open; `volt.exe` is new, the in-proc bridge is the previous build. The first `push` is accepted, the old bridge omits `newFolders`, and the CLI writes `"folders": null` into .git/volt/ide-refs.json. From then on every `volt pull` and `volt push` in that workspace throws 'ide-refs.json is malformed — delete it', with no hint that a stale bridge caused it.

**Smallest fix.** Make PushResponse's accepted arm a shape that cannot be partially populated (or validate the three fields at the client boundary and refuse with a coded error naming the skew) instead of `!`.


### `connect` and `disconnect` answer with an anonymous type, so two of the eight ops have no DTO any client, test or guard can name

`wire` · **likely** · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:97` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:106` · `packages/volt-cli/src/Volt.Cli.Transport/PipeServer.cs:13` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:29`

**Evidence**

```
`PipeDispatch` returns `object` (PipeServer.cs:13) and `PipeFrame.Result` is `object?` (PipeMessages.cs:32), so the wire shape of an op is whatever the dispatch arm happens to return, serialized by runtime type. Six arms return a Wire DTO; two return an anonymous type:
    BridgePipeHost.cs:97   return (object)new { ok = true };   // connect
    BridgePipeHost.cs:106  return new { ok = true };            // disconnect

The only thing binding an op name to its response type is a hand-written table with no compiler link (BridgeClient.cs:29-56): `Ops.Health -> De<HealthResponse>`, `Ops.Refs -> De<RefsResponse>`, `Ops.Init -> De<FetchResponse>`, and so on. `De<T>` is `JsonSerializer.Deserialize<T>(e.GetRawText(), Json)!` — a JSON object with no matching members yields a fully-defaulted T, never an error.
```

**Why it costs.** Change what `Ops.Init` returns (say to the RefsResponse shape, since both carry projectVersion/items/folders) and nothing fails to compile: BridgeClient's De<FetchResponse> silently produces an object with Changed=[] and Items={}, `GuardEmptyItems(0)` fires, and `volt init` reports 'bridge reported zero items... refusing to treat an empty project as truth' — pointing the user at the IDE for a defect in the dispatch table. And there is no type to hang the connect/disconnect ok-shape on, so the tray's Disconnect result is asserted nowhere in C# — only in TypeScript, in a harness that re-spells the op names independently (harness.ts:125-126).

**Smallest fix.** Named response DTOs for connect/disconnect, and one op-to-DTO table both BridgePipeHost's switch and BridgeClient are built from.


### PLC_DISCONNECTED reaches the CLI as two different exception types with opposite consequences: one becomes a structured refusal, the other kills the --json contract entirely

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:7` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeResolver.cs:44` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:67` · `packages/volt-cli/src/Volt.Cli/Sync/Commands.cs:13` · `packages/volt-cli/src/Volt.Cli/Program.cs:74` · `packages/volt-control/src/bridge/actions.ts:81`

**Evidence**

```
Two carriers, one code space. Bridge-side: `BridgeException(BridgeErrorCodes.PlcDisconnected, ...)` crosses the pipe and arrives as `PipeCallException` (PipeMessages.cs:43). CLI-side inventions of the SAME code, in a DIFFERENT type:
  BridgeResolver.cs:44 `throw new BridgeError(BridgeErrorCodes.PlcDisconnected, $"no {vendorLabel} bridge is running...")`
  BridgeResolver.cs:55 `throw new BridgeError(BridgeErrorCodes.PlcDisconnected, $"the bound project '{boundName}' isn't open in any of the {pipes.Count} running {vendorLabel}...")`
  BridgeClient.cs:67 `throw new BridgeError(BridgeErrorCodes.PlcDisconnected, "bridge reported zero items and Volt could not confirm an IDE is attached...")`

The refusal handlers only see one of them — Commands.cs:13-14 `private static bool IsPreconditionRefusal(PipeCallException e) => e.Code == BridgeErrorCodes.WrongProject || e.Code == BridgeErrorCodes.PlcDisconnected;` used as `catch (PipeCallException e) when (IsPreconditionRefusal(e))` at Commands.cs:175, 360, 404. A `BridgeError` matches no catch in Commands and falls to Program.cs:74 `catch (BridgeError e) { Console.Error.WriteLine(e.Message); return 1; }`.

And `Bridge()` is evaluated as an ARGUMENT (Program.cs:60-66, `"status" => CmdStatus(root, Bridge(), a)`), so a resolver refusal throws before `Commands.Status` — whose own `catch (Exception ex) { snap = new BridgeSnapshot { Online = false, Detail = ex.Message }; }` (Commands.cs:127-130) would have handled it into a perfectly good offline status.
```

**Why it costs.** Two identical-looking situations produce two different UIs. With CODESYS open but the tray disconnected, `volt status --json` exits 0 with the full StatusData (offline banner, outgoing changes, merge state — all pure git). With CODESYS not running at all, BridgeResolver throws BridgeError before Commands.Status is entered, so the CLI prints one stderr line and exits 1, volt-control's getStatus hits `if (r.code !== 0) return { health, error: r.stderr || r.stdout }` (actions.ts:81), and the panel loses the user's local outgoing-changes list and merge state — information that needs no bridge at all. Same for `volt pull --json` when the project legitimately walks to zero items: GuardEmptyItems throws BridgeError, Commands.Pull's `catch (PipeCallException ...)` misses it, and volt-control renders `{kind:"error"}` instead of `{kind:"refused"}`.

**Smallest fix.** One CLI-visible refusal carrier — make BridgeError and PipeCallException share a coded interface the commands catch on, and resolve the bridge inside each command's try.


### The pipe's serializer options are `internal` and re-declared four more times, so the one test that pins the health row to the connector's private mirror encodes the wire by hand

`cross-project` · **certain** · `packages/volt-cli/src/Volt.Cli.Transport/PipeMessages.cs:9` · `packages/volt-cli/src/Volt.Engine/Wire/BridgePipeHost.cs:19` · `packages/volt-cli/src/Volt.Cli/Sync/BridgeClient.cs:22` · `packages/volt-cli/src/Volt.Cli.Connector.Core/PerPipeProjectSource.cs:80` · `packages/volt-cli/test/Volt.Cli.Connector.Tests/WireContractParityTests.cs:19`

**Evidence**

```
PipeMessages.cs:6-16 claims singularity — "The ONE encoding of the pipe wire... Both directions share it (PipeServer and PipeClient), so the bytes one end writes can't drift from what the other end expects" — on `internal static class PipeJson`.

Only the WRITE side shares it. Every reader declares its own:
  BridgePipeHost.cs:19  private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };   // server reads the request body
  BridgeClient.cs:22    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };   // CLI reads every result
  PerPipeProjectSource.cs:80 private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true }; // connector reads health
and because PipeJson is internal, the parity test copies it by hand (WireContractParityTests.cs:17-23):
    // Mimic the pipe: camelCase + omit nulls (the bridge's server option ...)
    private static readonly JsonSerializerOptions Wire = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

None of the readers applies the camelCase policy; they match on `[JsonPropertyName]` attributes plus case-insensitivity. `ProjectEntry` (ProjectEntry.cs:27-32) and `ConnectRequest` (:37-40) carry NO attributes at all — they survive only because the writer's policy and the readers' case-insensitivity happen to agree.
```

**Why it costs.** WireContractParityTests exists for one job, stated in its own header: 'a bridge-side rename would silently degrade the tray while the CLI keeps working... Red the moment the shapes drift.' Change `PipeJson.Options` — drop the camelCase policy, or add a naming policy for a new field — and the test keeps serializing with its own hand-copied options, stays green, and the tray silently reads zero projects from every bridge while `volt pull` still works (the CLI has its own reader options). The test that guards the encoding cannot see the encoding.

**Smallest fix.** Make PipeJson.Options public and have every reader (and the parity test) use that single instance for both directions.


### Bare-name and full-name identity are the same C# type in the same map shape, and PushService builds them side by side in one loop with different string comparers — so conflict detection and apply disagree about whether an item exists

`project` · **likely** · `packages/volt-cli/src/Volt.Engine/Sync/PushService.cs:39` · `packages/volt-cli/src/Volt.Engine/Sync/PushService.cs:133` · `packages/volt-cli/src/Volt.Engine/Sync/PushService.cs:184` · `packages/volt-cli/src/Volt.Engine/Sync/ProjectSnapshot.cs:31`

**Evidence**

```
There are two identity namespaces and neither is a type. ProjectSnapshot.cs:31-38:
    /// <summary>Bare name -> version...</summary>  public Dictionary<string, string> Versions { get; } = new();
    /// <summary>Full name -> version — the wire Items map.</summary> public Dictionary<string, string> FullVersions { get; } = new();
PushService.cs:31-33 spells the rule out in a comment: "keyed by BARE IDE name ... The WIRE carries FULL names on every endpoint; op.Name is converted to bare at the apply boundary via Materializer.Bare." The conversion is `Materializer.Bare` (Materializer.cs:34), a `string -> string` with no type distinction anywhere.

In the SAME loop, three maps over the SAME key get two different comparers (PushService.cs:39-51):
    var currentVersions = new Dictionary<string, string>();                       // ordinal, CASE-SENSITIVE
    var gatedVersions   = new Dictionary<string, string>();                       // ordinal, CASE-SENSITIVE
    var itemCache       = new Dictionary<string, (ItemRef, string)>(StringComparer.OrdinalIgnoreCase);

Conflict detection reads the case-sensitive one (PushService.cs:133-139) — `var pending = currentVersions.ToDictionary(...); var currentVersion = pending.TryGetValue(bare, out var v) ? v : null;` — while apply reads the case-insensitive one (PushService.cs:185 `itemCache.TryGetValue(name, out var cached)`), and every other name comparison in the file is explicitly case-insensitive (PushService.cs:153, 221, 559-560: "IEC identifiers are case-insensitive, so Core never trusts the IDE's casing").
```

**Why it costs.** An engineer renames a POU in the IDE from `fbMotor` to `FbMotor` (case only). The next `volt pull` writes the new casing; git on Windows keeps the old path casing in the index for the tracked file, so the next push sends op.Name='fbMotor.fb' with the ifVersion the sidecar holds. `pending.TryGetValue("fbMotor")` misses (the walk recorded 'FbMotor'), currentVersion is null, and DetectConflicts emits 'expected item to exist but it doesn't' — the push is rejected with a reason that is factually wrong, while ApplyOp would have found the item via itemCache. Nothing in the types stops this: both spellings are `string` in a `Dictionary<string,string>`.

**Smallest fix.** One comparer for every name-keyed map in the push path (OrdinalIgnoreCase, matching NameIs), and a distinct type for the bare vs full name so the conversion points are compiler-visible.


> **Coverage of this lens.** Read in full: ARCHITECTURE.md; map.md's seam-analyst section (lines 1-90 — the rest of the 265KB per-type table I sampled by grep only, so per-type rows outside my greps are uncovered). Read the whole wire path end to end: Volt.Cli.Transport (PipeMessages, PipeServer, PipeClient, Ops, BridgeErrorCodes), Volt.Engine/Wire (BridgePipeHost, HealthResponse, ProjectEntry, RefsFetch, PushModels, BuildModels, ProgressFrame), Volt.Engine/BridgeException, Volt.Engine/Sync (OpGuard, RefsService, FetchService, PushService, ProjectSnapshot, Hasher, Versioning), Volt.Engine/Ide/DriverBase + ProjectItem, Volt.Engine/Workspace/Materializer (first 70 lines) + WorkspaceItem, Volt.Cli/Sync (BridgeClient, BridgeResolver, Config, Sidecar, Commands lines 1-200 and 240-509), Volt.Cli/Program.cs lines 40-190, Volt.Cli.Connector.Core/PerPipeProjectSource, test/Volt.Cli.Connector.Tests/WireContractParityTests, test/e2e/harness.ts lines 60-210. Grepped repo-wide for structureVersion/ProjectVersion/Platform/Vendor/Ops.* to establish who actually reads each wire field, and checked packages/volt-control/src/bridge/actions.ts for how the CLI's --json contract is consumed.\n\nDeliberately NOT covered (other lenses' ground): the graphical/VG stack (PlcOpen*, Vg/*, GraphicalCode) beyond the PushService call sites; the two drivers' vendor glue (CodesysObjectModel, TcObjectModel, dispatchers) except CodesysDriver.BuildHealthResponse; the connector's session/reconcile model (ConnectionManager, Reconciler, Session, TwincatSupervisor) and ControlServer; the parked conflict-resolve e2e ordering bug — I found nothing in the wire/DTO contracts that explains it, and did not chase it.\n\nOne thing I could not settle without building: whether a bridge older than the `newFolders` field is actually reachable in a shipped install. I rated that finding 'likely' on the strength of the in-proc CODESYS host outliving an update (ARCHITECTURE.md's own lifecycle note), not on an observed occurrence. Also noted but NOT reported, because I could not state a concrete cost: `WorkspaceConfig.Bridge.Vendor` and `WorkspaceConfig.Project.Platform` are two persisted required fields always written to the same value (Commands.cs:40-41, 85-86), one of which names the pipe and the other the WRONG_PROJECT guard."


**Corrections to `map.md`**

- ARCHITECTURE.md:92-93 (and the same paragraph in CLAUDE.md) says 'The whole wire is keyed by bare item name — refs items/kinds/folders, fetch knownItems, every push op'. Two errors: (a) the wire is keyed by the FULL name (bare name + kind extension) — PushService.cs:31-33 states it outright ('The WIRE carries FULL names on every endpoint; op.Name is converted to bare at the apply boundary via Materializer.Bare'), FetchService.cs:19-20 repeats it, and test/e2e/harness.ts:168-170 confirms it ('The wire speaks FULL names everywhere'); (b) `RefsResponse` has NO `kinds` field — it is ProjectVersion/StructureVersion/Items/Folders only (RefsFetch.cs:6-19).
- ARCHITECTURE.md:93 calls structureVersion part of the name-identity invariant. It is hashed over ProjectSnapshot.Versions, the BARE-name map (ProjectSnapshot.cs:83), not the full names the rest of the wire uses, and it has no production reader in any package — only the four Engine files that produce it and seven test files.
- map.md's `PipeCallException` row records the hidden edge 'Volt.Cli/Sync/BridgeClient.cs:67 and BridgeResolver.cs:44,55 throw a DIFFERENT CLI-local exception type (BridgeError) carrying the same BridgeErrorCodes vocabulary — two exception types, one code space.' Incomplete in the part that costs: only PipeCallException is caught by Commands' refusal handlers (Commands.cs:175,360,404), so the two carriers produce different EXIT BEHAVIOUR — one a structured --json refusal, the other a bare stderr line and exit 1 (Program.cs:74).
- map.md's transport section describes PipeMessages.cs's types but not that `PipeJson` (the declared 'ONE encoding of the pipe wire') is `internal`, and that three separate reader-side JsonSerializerOptions exist (BridgePipeHost.cs:19, BridgeClient.cs:22, PerPipeProjectSource.cs:80) plus a fourth hand-copy in WireContractParityTests.cs:19 — which is what makes that test blind to a change in the real encoding.
- map.md's seam row for `IIdeDriver` notes it 'transitively drags Engine.Wire and Engine.Library into the contract layer'. Worth making explicit as a direction, since ARCHITECTURE.md's layer table lists Ide/ ABOVE Wire/: `DriverBase.BuildHealthResponse()` returns a Wire DTO, `SelectProject(ConnectRequest)` TAKES one, and `GetBuildDiagnostics()` returns `IReadOnlyList<BridgeDiagnostic>` (DriverBase.cs:73,99,102) — the contract layer depends on the wire layer, not the other way round.

---

## Deferred — moves phase 4 refuted, with the objection

_Filled in by phase 4. Each entry: the move as proposed, which skeptics refuted it and on what grounds, and what
would have to be true for it to become viable. A deferral without a testable condition is a deletion — say so
and delete it._


---

## What this change does NOT close — and how to close it

The moves close **31 of 49** findings. The rest are recorded here rather than quietly dropped, split by what
should happen to them.

### The cluster — one subsystem, and the next change's whole scope

These three are the same defect wearing three faces, and they are the standing suspect for the two parked
`conflict-resolve` e2e failures:

1. **The wire `disconnect` gate has two owners.** Any pipe client can set `_paused` on the host; the connector's
   reconcile loop un-sets it within ~4 s by re-`connect`ing any project a live session wants.
2. **`ControlHarness` re-implements the interest→serving reconcile inline** instead of driving `Reconciler` —
   with the OPPOSITE trigger semantics — so the volt-control e2e asserts behaviour the product deliberately
   rejects.
3. **Two systems answer "is this project served".** A project serves iff a live client session declares
   interest, but the CLI opens the pipe directly and never consults the connector.

**How to attack it — deliberately NOT the way this change was run.** Start by reproducing the parked failure,
not by mapping. In this change the two highest-value defects (the TwinCAT save that never ran, the e2e harness
targeting the wrong IDE) came from *running the baseline in the first hour*; ~120 analysis agents produced
narrowing and correction. The map and the findings already exist with quoted evidence — what these gaps lack is
a DECISION, not discovery. Go straight to design → refute → execute on the three questions above, ~10 agents,
after moves 13/22/24 have landed (all three touch this subsystem, so analysing it before them means analysing
it twice).

### The ground floor: two fakes that lie

`FakeIde` asserts that `IsConnected` and `BuildHealthResponse().Connected` are the same signal — an invariant
the real TwinCAT driver breaks. `ControlHarness` implements the opposite trigger semantics from `Reconciler`.
**Every unit test in this repo is only as trustworthy as those two files.** Move 12 starts on `FakeIde`; the
harness is untouched by any move in this change. If one thing is fixed from the bottom, it is this — a fake that
has to lie names a seam in the wrong place, and two of them currently do.

### Deliberately left alone, with the argument (do not re-litigate without new evidence)

- **`Volt.Cli.Transport` is two things** — the wire, plus vocabulary (`Ops`, `BridgeErrorCodes`, `HealthStatus`,
  `Vendors`) owned by layers above it. Real gap; moving the file fixes nothing, because `Volt.Cli` references
  BOTH projects and could still spell a wire code for a pre-wire refusal the morning after.
- **The `Volt.Engine` layer cycle** (`Ide → Wire → Sync → Workspace → Graphical → Ide`). A `using` loop inside
  ONE assembly: no compile cost, no build-order cost, no test cost. Note the phase-2 claim that it is why
  `BuildHealthResponse` is abstract is **false** — `DriverBase` already imports `Wire`.
- **The serializer-options "duplication"** — `PipeJson`'s camelCase-write vs case-insensitive-read is a
  deliberate asymmetric pair, not drift. Publishing it invites a swap that silently empties `PushRequest` and
  nulls `BuildRequest.expectedProjectName` through `Body<T>`'s `?? new T()`.

---

## Move 18 (`pou-refinement-uses-the-core-parser`) — DEFERRED, not applied

Five independent grounds, any one sufficient. Recorded in full because the card reads convincingly and someone
will propose it again.

1. **The premise is unverified and may be fiction.** The card's headline is that a pragma- or comment-headed
   INTERFACE is misclassified, sending it down the wrong export primitive. But `CodesysTypeMap.CodeForObject`
   reaches `RefinePou` only via `IPOUObject` (:46), while an interface is classified via `IInterfaceObject`
   (:56). `CodesysObjectModel.cs:677-678` states that CODESYS's `export_xml` "only works for `IPOUObject`, not
   `IInterfaceObject` — callers must use `ExportInterfaceXml` for interfaces", i.e. the two are distinct object
   types. If they are disjoint, a real interface never reaches `RefinePou`, its `INTERFACE` branch is dead, and
   the entire "wrong export primitive" story does not exist.
2. **The live check that would settle it was deleted by our own move 2.** The prescribed verification was the
   `debug` op's `typeTags` against a real INTERFACE object — `DebugService`/`CodesysDriver.TypeTags`, removed as
   unreachable-from-any-client. That deletion was correct, and this is its real cost: a diagnostic surface that
   was unreachable from the WIRE was still reachable by a developer with a live IDE. Worth remembering before
   deleting the next one.
3. **As carded it does not compile.** It deletes `CodesysTypeMap.NeedsDeclaration`, whose only caller is
   `CodesysDriver.Tree.cs:150` — a file absent from the move's `files`. First error: CS0117.
4. **It substitutes a THROWING parser for a TOTAL one.** `RefinePou` returns a code for every input;
   `CodeHelper.ParseCodeHeader` throws `BridgeException(InvalidCodeHeader)` on empty input, on a header line it
   cannot find, and on an unrecognized keyword. Its input is `ReadAspectText(…, "Interface")`, which returns
   `""` whenever the aspect is absent. On the WALK path that throw is unguarded — `Tree.cs`'s `try/catch` wraps
   only `GetChildren` — so it would abort `WalkItems`, i.e. every `fetch`/`refs`/`init`/`push` for the whole
   project. Containing it means either a swallowing `catch` (forbidden by Conventions 1) or a silent default.
5. **Its gate cannot detect its own risk.** No test csproj references `Volt.Cli.Ide.Codesys` (net48; all three
   suites are net8.0), so "build + 3 suites" is structurally incapable of failing for this change. The named
   red-first test targets `ItemKind.CodeForDeclaration`, which does not exist today — it does not compile before
   the fix, so it is green-on-arrival against new code, not a pin on the defect.

### What IS real, and what it would take

Stripped of the interface story, one narrow defect survives: for a **pragma- or doc-comment-headed PROGRAM or
FUNCTION**, `LeadingKeyword` reads `""` from a raw `TrimStart` and `RefinePou` falls to its `PlcPouFb` default,
so **`refs`/`fetch` report `function_block`** for it. The workspace file is unaffected — `Materializer` takes the
extension from `build.Kind` (`CodeHelper`), not from the driver — and the body content is unaffected, since both
kinds take the same export branch. So this is a **wire-`kind` defect only**, not the data-loss-shaped one the
card describes.

Fixing it honestly requires making the classifier reachable from a test first — `InternalsVisibleTo`, or moving
refinement into Core deliberately as its own change. Doing it as a drive-by inside this move is what produced
all five problems above.

### RESOLVED 2026-08-06 — and the residual defect is NOT observable either

The narrow form all three skeptics prescribed landed: the header-line SELECTION is now
`CodeHelper.HeaderLine(string?)`, TOTAL, shared by `ParseCodeHeader` (which keeps its coded throw) and
`CodesysTypeMap.LeadingKeyword` (which keeps `RefinePou` total). +10 unit tests.

**But the wire-`kind` defect described above does not reproduce.** Probed live on CODESYS, pushing a PROGRAM
whose declaration opens with `{attribute 'qualified_only'}`, then fetching — **with and without the fix the item
comes back as `VltE2E_pragma_prog.prg`, identically.** Three reasons, all checkable:

- the item's name/extension comes from `Materializer` via `CodeHelper`'s kind, not from the driver's classifier;
- `refs` carries no kind field at all — `Items` is name → version;
- `program` / `function` / `function_block` are all source POU kinds, routed identically downstream.

So the ENTIRE move-18 finding — headline and residue — is unobservable today. The consolidation was kept only on
the "two answers to one question" ground, and the commit says so. Worth remembering as calibration: a phase-2
finding, quoted evidence and all, described a defect that does not exist at the wire.
