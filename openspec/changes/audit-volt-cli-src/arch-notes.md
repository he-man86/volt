# Architectural notes — observed during the audit, deliberately NOT implemented

Everything here is behavior-changing or structural, and therefore out of scope for this change by construction
(see `design.md`). Each note carries enough evidence to start its own proposal: what was seen, where, why it
matters, and what it would cost.

Nothing in this file is a commitment. A note that stays unwritten-up is a note that wasn't worth it.

---

# ⚠ STATUS SWEEP 2026-08-06 — most of the OPEN entries below are now CLOSED

This file was written during batches 1-4. `optimize-volt-cli-architecture` (23 moves) and `fix-push-data-loss`
have since landed. **Read this table before acting on any entry below** — several notes describe defects that no
longer exist, and one describes a defect that never existed.

| entry | status now | evidence |
|---|---|---|
| the not-connected precondition has TWO answers | **CLOSED** | `1082190f0b` decided it from live driver state, not the cached snapshot |
| `ide-restart` recovery fails | **CLOSED** | **2 pass / 0 fail**, twice, on a single XAE. The `File.SaveAll` fix closed it — `fix-push-data-loss` §3.0-VERIFIED |
| a CFC/SFC POU **child** body flattened on push | **FIXED, NOT COVERED LIVE** | guard shipped (bug 1); the live e2e guards a ROOT body, so it is proven only against `FakeIde`. Needs a hand-authored CFC-child fixture — `fix-push-data-loss` §2.2 |
| a pushed item does not survive the IDE being killed | **CLOSED** | the orphan is gone; no `POUs/` dir remains after a green run |
| `DebugService` unreachable while ARCHITECTURE.md says otherwise | **CLOSED by deletion** | move 2 deleted the whole surface and corrected the doc. **Cost worth knowing: its `typeTags` was the cheap way to introspect the live COM model, and two later investigations wanted it** |
| health's cache+throttle moving into Core — "the throttle asymmetry must survive" | **HONOURED** | move 13 moved composition into `DriverBase` and kept `ProbeThrottleMs` virtual; move 14 set CODESYS to 1000 ms, below the fastest client poll. The asymmetry survived exactly as this note demanded |
| `Volt.Cli.Connector.Tests` not in the documented gate | **CLOSED** | it is in every gate now, and at 77 tests |
| e2e harness resolves the per-pid pipe once, then falls back to the bare prefix | **CLOSED** | `334b568a66` made `VOLT_PIPE` exclusive. That fix later proved load-bearing: without it the crashing-XAE diagnosis was impossible |
| the TwinCAT supervisor reaps correctly (evidence, not a defect) | still true | — |
| `Hasher`'s "required inputs" is documentation, not enforcement | **STILL OPEN** | untouched by either change |
| stale pre-rename assemblies in `bin/` | **STILL OPEN** | untouched |
| a failed restore-after-failed-import tells the log, not the user | **STILL OPEN** | untouched, and still on the data-loss path |

**One correction that is not in the table**, because it is about method rather than a defect: the two parked
`conflict-resolve` e2e failures were filed here and elsewhere as a session/gate-model problem. They were a
fixture XAE crashing and respawning mid-run. Pinned to a stable XAE the TwinCAT suite is **90 / 11 / 0**. Twice
in this programme, analysis confidently located a defect that measurement could not find.

---

## ROOT CAUSE (bridge defect) — the not-connected precondition has TWO answers: live for reads, cached for writes
**Where:** `Volt.Engine/Sync/OpGuard.cs:20-21` vs `Volt.Engine/Sync/RefsService.cs:17`; cache in
`Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.cs:46-59` + `BuildProjects()`; masked by `DriverBase.cs:117-122`;
invariant stated in `Volt.Engine/Ide/IIdeSession.cs:11-12`.

**Observed (by reading, corroborated live):**
- `IIdeSession` documents the design: *"the select post-condition and **the not-connected precondition** are
  checked there against `IsConnected`, not in each driver."*
- `RefsService` (the READ) obeys it: `if (!ide.IsConnected) throw PlcDisconnected()` — a **live** state read.
- `OpGuard.RequireBoundProject` — which **every fetch/push/build** goes through as its first act — instead does
  `var h = ide.BuildHealthResponse(); if (!h.Connected) …`. `h.Connected` is `ServingProject != null`, i.e. "is any
  row non-idle" in a list that `BeckhoffDriver.BuildHealthResponse` serves **from a ≤5 s-throttled cached
  snapshot** (`OverlayLiveHealth` refreshes the served row's *verdict*, but cannot resurrect a serving row the
  cache doesn't have).
- So a WRITE's precondition can be evaluated against a stale snapshot while a READ's is live. Same question, two
  answers, and the write path is the one reading stale data.

**Why the tests never caught it:** `test/shared/FakeIde.cs:217-218` says in as many words —
*"Mirror a real driver: IsConnected and BuildHealthResponse().Connected (derived from Status) are the SAME
signal."* The fake makes them the same, so all 505 green unit tests assert a world where the divergence cannot
exist. The real TwinCAT driver violates it. **A fake that encodes an invariant the implementation breaks is worse
than no fake** — this is the single most valuable finding of the session and the reason to distrust
"the unit suites are green" for the connector/driver layer.

**Compounded by a swallowed failure (the no-fallbacks violation):** `DriverBase.SingleFlight` runs the health
probe with `catch { /* best-effort — the cache keeps its last snapshot */ }`. When `EnsureAttached()` /
`SnapshotHealth()` fails after an IDE returns, nothing throws, nothing logs, nothing marks degraded — health just
keeps serving the stale "1 idle" snapshot indefinitely. That is precisely a defensive fallback masking a real
failure, and it is why diagnosing this took three live IDE cycles with **no log line to read**.

**Live corroboration:** with no re-select after a reopen, `health` reported `NONE (1 idle)` and both `refs` and
`push` refused `PLC_DISCONNECTED` for 190 s with nothing logged. (That run also disproved a narrower first
hypothesis — the probe omitted the `connect` the test's loop performs, so it measured no-recovery-at-all rather
than the read/write window. Recorded so nobody re-runs it as-is.)

**Fix (behavior-CHANGING, so NOT part of the behavior-preserving refactor — its own change):**
1. `OpGuard` takes the connected precondition from **`ide.IsConnected`** (live), per the documented invariant.
2. The identity comparison needs a live served-project name too, or it trades PLC_DISCONNECTED for a bogus
   WRONG_PROJECT when the cache has no serving row. Add a live `string? ServedProjectName { get; }` state read to
   the `IIdeSession` seam — both drivers already have it (`_om.ProjectName`: `CodesysObjectModel.cs:56`,
   `BeckhoffDriver.BuildProjects():120`) — and read identity from that, not from the cached rows.
3. `SingleFlight` must **not** swallow: log at Warn and `MarkDegraded` on probe failure.
4. Then fix `FakeIde` so the two signals can be driven APART, and add a regression test that pins the live
   precondition — otherwise the suites keep asserting the bug away.
5. Re-check whether `RunRead`'s Recover-on-transient is even reachable for the IDE-restart case: the guard throws
   `PLC_DISCONNECTED` *before* any COM call, so no `ShouldMarkDegraded` transient is ever classified — the
   "recovery is deferred to the content ops" doctrine may have no live path for a restarted IDE. Unverified.

**Cost / risk:** touches shared Core, so it is a parity-critical change — CODESYS's `Recover()` is a no-op and its
host dies with the IDE, so the live-signal change should be a no-op there; prove that. Needs the full C# suites
plus live e2e on BOTH vendors.
**Batch:** 3 (OpGuard/RefsService) with 8 (Beckhoff) and 11 (connector) — **but as a deliberate follow-up change,
not as a refactor edit.**

## OPEN — `ide-restart` recovery fails on a verified single-XAE environment (the symptom of the above)
**Where:** `test/e2e/lifecycle/ide-restart.test.ts:79` (the `createItem` right after recovery is confirmed);
product side is `Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver*` + `Volt.Cli.Connector.Core` (batches 8 / 11).
**Observed:** of the two chaos tests, test 1 **passes** — killing the IDE yields a clean `PLC_DISCONNECTED`, no
crash, no stale wrong-project read. Test 2 **fails**: after `reopenIde`, the poll loop confirms recovery
(`connect` returns no error AND `refs` succeeds, so the bridge reports itself serving), and then the very next
call — `createItem`, the first WRITE — fails with `PLC_DISCONNECTED: Bridge is waiting for an IDE project`.
Reproduced 3×: with 2 XAEs open, with 3 XAEs open, and with a **verified single XAE and a single pipe**. Fails
~20-30 s in, so it is not a timeout.
**Why it matters:** this is the only live test of IDE-death recovery, it sits exactly on the newest connector /
TwinCAT-worker code, and it says a bridge can report "serving" (`connect` ok + `refs` ok) while a write still
finds no project. Either the readiness signal is satisfied too early (read path works before the write path
does) or the selection is lost between the two calls. Both are real; the second is worse.
**Sketch:** instrument which pipe each call resolved to and log the worker's project-selection state
(`%LOCALAPPDATA%\Volt\logs\twincat-*.log`) across the reopen; determine whether `refs`-succeeds is a valid
readiness gate for a write, and if not, what is.
**Cost / risk:** needs a live TwinCAT loop; TcXaeShell is best-effort and closed itself unprompted once during
this session, so budget for environment flakiness and re-verify anything conclusive twice.
**Batch:** found at baseline; investigate in 8 (Beckhoff driver) and 11 (connector core)

## OPEN, DATA-LOSS SHAPED — a CFC/SFC POU **child** body is flattened on push
**Where:** `Volt.Engine/Sync/PushService.cs:372` (the child guard) vs `:350-363` (the root guard);
`Workspace/Materializer.cs:40` + `:93-94`; `Graphical/VgBody.cs:20`
**Observed (found by the batch-3 auditor, independently verified by its verifier, and escalated rather than
fixed):** the read-only-graphical guard for POU CHILDREN is
`if (VgBody.Is(cimpl) && !VgBody.IsEditable(VgBody.LanguageOf(cimpl))) continue;`. But `VgBody.Is` matches ONLY a
`NETWORK <n> <LANG>` header, while a CFC/SFC body materializes as
`Materializer.GraphicalBodyMarker` = `(* @volt-graphical: CFC *)` — which `Is` **rejects**. So a CFC/SFC
method/action child falls through to the TEXTUAL path and its marker comment is handed to `ide.WriteText`
(`:399`), **flattening a graphical child body in the live IDE**. The ROOT-POU guard is safe because it reads the
live `BodyLanguage` instead of sniffing content; the child guard sniffs content, and that is the whole bug.
**Why it matters:** CFC/SFC are documented READ-ONLY precisely because Volt cannot round-trip them. This silently
replaces an engineer's CFC method body with a comment — destroying work in the IDE, on the push path, with no
error. Same severity class as the save-on-push finding below.
**Sketch:** make the child guard ask the IDE for the child's language (as the root guard does) rather than sniffing
the materialized text; or make the read-only detection recognize the `@volt-graphical` marker. The root/child
asymmetry is the defect — one rule, one place.
**Cost / risk:** push path, both vendors. Needs a red-first regression test (a CFC/SFC method child pushed
unchanged must remain untouched) plus live two-vendor verification.
**Batch:** 3 (found + escalated, NOT fixed)

## DECISION NEEDED — `Hasher`'s "required inputs" is documentation, not enforcement
**Where:** `Volt.Engine/Sync/Hasher.cs` (`ComputeItemVersion`, `ComputeSha1Short`), `Sync/Versioning.cs`,
`Sync/FetchService.cs`, `test/Volt.Engine.Tests/HasherTests.cs:51`
**Observed:** batch 3 removed `?? ""` from `ComputeItemVersion` and made both parameters non-nullable, with a
sound rationale: defaulting a MISSING folder to `""` hashes identically to a legitimately EMPTY one, silently
drifting the item version instead of surfacing the bug. Correct reasoning — **but nullable annotations are
compile-time only, so at runtime a null folder still hashes exactly as `""` did.** Nothing is surfaced. What the
change actually produced is a compile-time contract plus a cascade of CS8604s up the call chain, and 4 CS8625
warnings in `HasherTests.Null_text_is_stable`, which passes null deliberately and still passes.
**Resolved so far:** the one call site where a null could enter (`FetchService`'s walk loop) now **fails loud** with
a coded `BridgeException` naming the item — that is the real enforcement, and `src/Volt.Engine` is warning-free.
`ProjectSnapshot`'s identical call does not warn, which is itself unexplained and worth a look.
**Still open (needs a human decision, deliberately NOT taken):** either add a runtime guard in `Hasher` itself
(**behavior-changing** — a malformed item would start throwing where it previously hashed) and retire
`Null_text_is_stable` as testing an invalid state, or accept annotation-only intent and leave the test's 4
warnings. **Do not quietly edit `HasherTests` to match the new signature** — that would be adapting a test to a
code change, and the null-stability premise was legitimate under the old contract.
**Batch:** 3

## CLEANUP — stale pre-rename assemblies still sit in `bin/`
**Where:** `src/Volt.Engine/bin/{Debug,Release}/netstandard2.0/Volt.Bridge.Core.dll`, `Volt.Cli.Core.dll` (and
copies in the test output dirs)
**Observed:** leftovers from the `Volt.Bridge.Core`/`Volt.Cli.Core` → `Volt.Engine` rename. No csproj references
them (verified), so they do not affect compilation — but they are copied into test output and could be loaded by
anything probing a bin directory by name.
**Sketch:** `git clean -xdf` the bin/obj trees, or a clean rebuild; then check nothing regenerates them.
**Batch:** 3 (noticed while chasing a nullability warning)

## OPEN, DATA-LOSS SHAPED — a pushed item does not survive the TwinCAT IDE being killed
**Where:** `IIdeSession.FlushPendingWrites()` (TwinCAT SaveAll) → `Volt.Cli.Ide.Twincat/Driver/BeckhoffDriver.Code.cs`
/ `TcObjectModel`; asserted by `test/e2e/lifecycle/ide-restart.test.ts` (second test, final assertion).
**Observed (live, with `fix-connected-precondition` applied and the freshly built worker):** the test pushes
`VltE2E_restart_survives.fb`, kills the XAE, reopens it, confirms recovery (`connect` ok + `refs` ok +
`expect(recovered).toBe(true)` all pass), then fetches the item — and it is **not in the project**:
`item 'VltE2E_restart_survives.fb' not in fetch`. So a successful `push` did not persist to disk.
**Why this is now isolated:** before the precondition fix, this test failed EARLIER, at the `createItem` write, with
`PLC_DISCONNECTED`. It now reaches the final assertion, which means the write, the kill, the reopen and the
recovery all succeeded. Two distinct defects were stacked; the first is fixed and this is what was underneath.
**Why it matters:** `IIdeSession.FlushPendingWrites` documents "TwinCAT SaveAll ... called after applying a push",
and the test's premise is "a pushed item is SaveAll'd to disk, so it must survive the IDE dying". If a push can
report success while the work is only in the IDE's memory, an IDE crash silently loses an engineer's committed
work — the worst class of bug in this product.
**Candidate causes (untested, in order):** (1) `FlushPendingWrites`/SaveAll is not actually invoked on the push
path, or is invoked before the create rather than after; (2) SaveAll saves the PLC project but not the item's
containing artifact; (3) it IS saved and the reopened XAE loads a cached/stale copy; (4) the kill races the save.
**How to investigate:** push, then WITHOUT killing anything check whether the file exists on disk under
`test/TwinCAT Project14/`; that alone separates "never saved" from "saved but not reloaded". Then check the push
path for the `FlushPendingWrites` call order. TwinCAT log: `%LOCALAPPDATA%\Volt\logs\twincat-*.log`.
**Do NOT weaken the test** — its premise comes from the documented `FlushPendingWrites` contract, not from
observed behavior.
**Batch:** found at the `fix-connected-precondition` acceptance gate; investigate with 8 (Beckhoff driver)

## A failed restore-after-failed-import tells the log, not the user — on the data-loss path
**Where:** `Volt.Engine/Ide/PlcOpenTransport.cs:11-16`, and the drivers' `catch { import(original); throw; }`
**Observed:** a failed PlcOpen import restores the original and rethrows the primary exception. If the **restore
also fails**, the POU is permanently gone from the project, but the error the CLI shows still says only that the
import failed. That the original was NOT restored reaches the log only.
**Why it matters:** this is the worst outcome on the one path that can destroy a user's POU. The person who needs
to know is the operator at the CLI, not a log reader after the fact. (Also: `catch { import(original); throw; }`
loses the restore's own exception entirely.)
**Sketch:** on the restore-failed branch, surface an error that STATES the original was not restored — primary
message plus annotation, or an `AggregateException` — so the wire error is self-describing.
**Cost / risk:** changes an error message and possibly an error shape on a failure path; both drivers, so it is a
parity change. Needs a fault-injection test (both vendors) since the branch is not otherwise reachable.
**Batch:** 2 (found), fix with 7/8 (the drivers own the catch)

## `DebugService` is unreachable from any client, and ARCHITECTURE.md says otherwise
**Where:** `Volt.Engine/Sync/DebugService.cs` (117 LOC), `Ide/IIdeSession.cs`'s three `Debug*` members,
`Volt.Engine/Ide/IDebugIntrospect.cs`, vs `Ops.cs` / `Wire/BridgePipeHost.Dispatch` / `ARCHITECTURE.md:84`
**Observed:** there is **no `debug` pipe op**. `Ops.cs` lists only health/connect/disconnect/refs/fetch/init/push/
build; `Dispatch` has no `debug` case; nothing in the repo calls `DebugService.Handle`. The three driver-side debug
members (`DebugLibrarySignatures`, `DebugItemXml`, `DebugReflect`) are implemented on both vendors and reachable
from nothing. `ARCHITECTURE.md:84` still lists `DebugService` (`debug`) as a served op — so the docs claim a wire
surface that does not exist.
**Why it matters:** ~117 LOC plus three seam members and their per-vendor implementations are carried, compiled and
maintained for a client that was deleted with the HTTP wire (they were `GET /debug?libsig=…`). Every future seam
change pays for them. And the doc drift means the next contributor believes the op exists.
**Sketch:** decide it deliberately — either restore a `debug` op (it was genuinely useful for library-signature and
item-XML introspection, per the memory of debugging those bugs) or delete `DebugService` + the three members +
`IDebugIntrospect` and fix `ARCHITECTURE.md`. Do NOT leave it half-wired.
**Cost / risk:** deleting touches the seam and both drivers; restoring adds a wire op (parity: both vendors must
answer identically, and CODESYS-only surfaces must degrade cleanly). Either way it is behavior-changing.
**Batch:** 2 (found), decide in 3 (`Sync/DebugService.cs`)

## If health's cache+throttle moves into Core, the throttle asymmetry must survive
**Where:** `Ide/DriverBase.cs:18-20` (the proposed follow-up), `BeckhoffDriver.cs:49-56`, `CodesysDriver.cs`
**Observed:** an arch note proposes hoisting `BuildHealthResponse`'s "cache read + throttle + `OverlayLiveHealth`"
into Core. But the ~5 s throttle exists **only on TwinCAT**, because its refresh is out-of-process COM; CODESYS
probes in-proc on every call. That cost difference is NOT in `ARCHITECTURE.md`'s load-bearing-asymmetry list.
**Why it matters:** hoisting it naively would impose TwinCAT's throttle on CODESYS (staler health for no reason) or
drop it on TwinCAT (a poll marshalling onto the IDE thread — the exact stall that made a busy IDE read as a lost
connection). The shared part is real, but the throttle is not shared.
**Sketch:** if hoisted, Core owns cache-read + overlay; the refresh **policy** stays per-driver. And add the
throttle asymmetry to `ARCHITECTURE.md`'s list so the next person doesn't "unify" it.
**Batch:** 2 (found), relevant to any Core health refactor

## `Volt.Cli.Connector.Tests` is in the solution but not in the documented gate
**Where:** `CLAUDE.md` ("The C# toolchain" commands) vs `Volt.Cli.sln:28`
**Observed:** the documented test commands are `Volt.Cli.Tests` and `Volt.Engine.Tests` only. A third suite,
`Volt.Cli.Connector.Tests` (**76 tests** across 9 files — `ConnectionManagerSessionTests`, `ReconcilerTests`,
`TwincatSupervisorTests`, `WireContractParityTests`, …) plus a `Volt.Cli.Connector.ControlHarness` are in the
`.sln` and unmentioned. Run manually: 76/76 green.
**Why it matters:** the connector's session model is the newest code in the package, and the suite that covers it
isn't in the documented loop — so it can go red without anyone noticing. It is also the answer to "is the
connector shaky": the unit layer is real and green; what's missing is *live* coverage, since e2e bypasses the
connector entirely (CODESYS's host is in-proc; the TwinCAT harness talks to the worker pipe directly).
**Sketch:** add it to CLAUDE.md's command list and to whatever CI runs the C# suites; consider one live
connector smoke (tray up → two XAEs → session bind/unbind → reap).
**Cost / risk:** trivial for the doc + gate; the live smoke is real work.
**Batch:** 11 (do the doc/gate fix immediately — it is a one-line omission)

## Live-verified: the TwinCAT supervisor reaps correctly (evidence, not a defect)
**Where:** `Volt.Cli.Connector.Core/TwincatSupervisor.cs`, `Reconciler.cs`
**Observed:** with 3 XAEs killed at once, the state went 4 workers / 4 pipes → **1 worker / 1 pipe within 15 s**,
matching the single surviving XAE, then held stable for 135 s with no respawn churn. Separately, when an XAE was
replaced (pid 27824 → 28704) the connector spawned a worker for the new pid unprompted.
**Why it matters:** recorded so the audit doesn't "fix" a supervisor that demonstrably converges. Also fixes the
cadence claim in the docs to something observed rather than asserted.
**Batch:** 11 (as a protected behavior, not a change)

## e2e harness resolves the per-pid pipe once, then falls back to the bare prefix
**Where:** `packages/volt-cli/test/e2e/harness.ts` (pipe discovery / `requireHealthy`)
**Observed:** discovery runs once at suite start. If the live `volt.bridge.<vendor>.<pid>` pipe does not exist
yet (CODESYS still loading the fixture), the harness connects to the **prefix** `volt.bridge.codesys` as if it
were a pipe name, and every test fails with `connect ENOENT \\.\pipe\volt.bridge.codesys` plus a 5 s hook
timeout. Reproduced on the baseline run, then green on a warm re-run.
**Why it matters:** it is exactly the fallback pattern this repo rejects — a guess that masks the real condition
("the IDE is not serving yet") behind a misleading error, on the suite that is the acceptance gate for every
refactor. It cost one full 87 s run and a false "3 pre-existing failures" reading of the baseline.
**Sketch:** fail loud with "no `volt.bridge.<vendor>.*` pipe found — is the IDE running?", or poll discovery for
a bounded wait before giving up. Never connect to a prefix.
**Cost / risk:** test-harness only, no product code, no vendor parity implications.
**Batch:** baseline (found before batch 1; out of the src edit scope)

<!-- Format:

## <short title>
**Where:** `path/file.cs:123` (+ related sites)
**Observed:** what the code does today, quoted or precisely described.
**Why it matters:** the concrete cost — a bug class it enables, a duplication it forces, a limit it imposes.
**Sketch:** the change, in two or three sentences.
**Cost / risk:** what it touches, what would have to be re-proven (wire parity? live e2e? both vendors?).
**Batch:** N

-->

---

## BATCH 5 ESCALATIONS (2026-08-06) — behaviour-CHANGING findings, NOT applied

The audit is behaviour-preserving by construction, so these were found and deliberately left in place.
Each is quoted from the auditor's own evidence. **27 of the batch's 51 findings were behaviour-changing**;
these are the ones classified `bug` or `defensive-fallback`.

### `PlcOpenWriter.cs:226` — bug (group 5.2)

**Claim.** WriteLadderBody's per-node switch has no default case, so any Block (including an EXECUTE box) or OpaqueNode that is not reachable from a coil's spine is SILENTLY DROPPED from the generated <LD> body — the push succeeds and the logic disappears from the PLC.

**Fix.** Add a default arm that throws (loud, with the node kind + network index) for anything not emitted, and explicitly emit Blocks that no coil pulled — `_emitted` in LdCtx already records which blocks were drawn, so after the loop any Block whose LocalId is not in `_emitted` is a drop and must either be emitted or refused.

### `PlcOpenWriter.cs:220` — bug (group 5.2)

**Claim.** WriteLadderBody never emits net.Comment. WriteFbdBody does. An LD network's comment is read back by PlcOpenReader, carried through VG as `// …`, and then silently deleted on push — and PlcOpenDocument.SafeToDrop lists "comment", so the splice removes the existing one first.

**Fix.** Emit the same `<comment>` element WriteFbdBody builds (xhtml content, in-network localId) before the networktitle marker — PlcOpenReader.SplitNetworks already expects `a vendorElement(networktitle), optionally preceded by a comment`, so the marker-preceding position is the one it parses back.

### `PlcOpenWriter.cs:348` — bug (group 5.2)

**Claim.** EmitPower discards its `extraMods` argument on the AND, OR and Block branches — only the InVar branch merges it. A negation on an intermediate result (`(NOT g1 AND c)` where g1 is an operator/FB) is silently dropped from the generated ladder, inverting the rung's logic. The same three branches also discard `source.FormalParameter`, so a spine fed from a non-primary block output is rewired to the primary one by ConnTo's `outPin(r)`.

**Fix.** Merge extraMods into each recursion (`MergeMods(pin.Mods, extraMods)` on the AND/OR arms) and, for the Block arm, refuse or represent a non-none extraMods rather than dropping it — a negated block result has no contact to carry it, so it must become an explicit NOT node or a loud refusal. Neither GraphicalCode.Validate check sees this: `once` and `twice` both lose the mod, and VG_NOT_CANONICAL compares VG to VG, never touching the ladder writer's output.

### `PlcOpenWriter.cs:116` — defensive-fallback (group 5.2)

**Claim.** An unresolvable FB instance type falls back to the empty string, emitting `<block typeName="">` instead of failing loud and naming the item — exactly the `?? ""` pattern Conventions 1 exists to forbid.

**Fix.** Throw when the resolver returns null for an instance that has no TypeName, naming the instance and the POU — the caller (GraphicalCode.Write) builds the resolver from PlcOpenDocument.InstanceTypes(declaration), so a miss means the instance is not declared and the push must be refused, not shipped as a typeless block.

### `PlcOpenWriter.cs:141` — bug (group 5.2)

**Claim.** The STCode addData is nested inside the `if (!string.IsNullOrEmpty(b.CallType))` guard, so an Execute box read from XML that carries `stcode` without an `fbdcalltype` loses its inline ST on write-back — violating the ARCHITECTURE invariant that Execute boxes hold their ST verbatim and are 'never a bare call that drops the ST'. PlcOpenReader.ReadStCode reads the two independently.

**Fix.** Emit the addData when `b.CallType` is non-empty OR `b.StCode != null`, mirroring the reader's independence of the two.

### `PlcOpenWriter.cs:220` — bug (group 5.2)

**Claim.** Neither writer emits GraphNetwork.Label or GraphNetwork.Disabled, so a VG header `NETWORK 0 FBD "Title" DISABLED` — which VgParser parses and VgWriter re-emits — is silently discarded on push. No gate catches it: VG_NOT_CANONICAL compares VG against VG (both keep it) and the PLCopen convergence check compares two post-writer forms (both lost it).

**Fix.** Either emit label/disabled into the body (and read them back in PlcOpenReader so the round-trip closes) or refuse them in GraphicalCode.Validate with a coded diagnostic — silently accepting and dropping is the one option Conventions 1 rules out. Whichever is chosen, add a `ponytail:` note on GraphNetwork.Label/Disabled recording that the PLCopen leg does not carry them.

### `VgParser.cs:83` — bug (group 5.1)

**Claim.** An EXECUTE whose END_EXECUTE is missing or misspelled does not stop at the network boundary — the scan runs over END_NETWORK and every following NETWORK header, swallowing the rest of the body into one Execute box's verbatim ST. This shape survives GraphicalCode.Validate's canonical gate (the ST is re-emitted verbatim), so a typo silently collapses N networks into 1 and pushes VG structure into the IDE as ST.

**Fix.** Bound the scan: stop and throw the existing "EXECUTE without a closing END_EXECUTE" (VG_PARSE, Line = the EXECUTE line) as soon as a scanned line Trim()s to END_NETWORK or matches the NETWORK header — an Execute box's ST can never legally contain a network delimiter.

### `VgParser.cs:38` — bug (group 5.1)

**Claim.** pendingEn is a body-wide latch that is never cleared at a network boundary: a multi-line `IF <en> THEN` not followed by an EXECUTE is silently discarded when the network closes, and its enable name leaks into the NEXT network, where it can bind that network's EXECUTE to a guard the author wrote elsewhere.

**Fix.** Make the latch network-scoped: in the END_NETWORK and NETWORK branches, throw the existing dangling-guard VG_PARSE if pendingEn != null (a guard must be closed inside its own network), and reset it to null when a new NetworkBuilder is opened.

### `VgParser.cs:63` — bug (group 5.1)

**Claim.** The NETWORK index is parsed with an unguarded int.Parse and then multiplied by the stride with no range check: a large index throws OverflowException (not a coded VgParseException, so the push conflict carries Code=null/Line=null), and an index above ~9.2e8 silently overflows the long localId base into negative ids.

**Fix.** Use int.TryParse and range-check the index (0 .. long.MaxValue / NetworkStride), throwing VgParseException("network index …", "VG_PARSE") with the header's line so every format failure keeps a stable code + line like the rest of the parser.

### `VgParser.cs:66` — bug (group 5.1)

**Claim.** The NETWORK header's language token is neither validated nor per-network: `DISABLED` in the language position is captured AS the language and consumed out of the header, so the network's disabled flag is silently lost; and `lang` is one body-wide variable, so the LAST network's token becomes the whole GraphBody's language.

**Fix.** Reject an unknown language token in the parser (accept FBD/LD, per VgBody.IsEditable) and treat DISABLED as the flag it is, so the disabled bit is never eaten; refuse a second network whose language token differs from the first rather than letting the last write win on the single body-wide `lang`.

### `VgParser.cs:162` — bug (group 5.1)

**Claim.** AddExecute accepts a `line` argument and throws it away, so an Execute box has no recorded source line — the pass-3 execute diagnostics escape Build with Line unset and get stamped with the END_NETWORK line by the outer catch, pointing the author at the wrong line.

**Fix.** Store the line in _executes (make it (string? En, string StCode, int Line)) and wrap the pass-3 loop the same way pass 2 is wrapped: catch (VgParseException ex) { ex.Line ??= _executes[e].Line; throw; }.

### `VgParser.cs:111` — bug (group 5.1)

**Claim.** The unclosed-network diagnostic reports rawLines.Length as its line, which is one past the last real line for the normal case of a body ending in a newline (Split leaves a trailing empty element).

**Fix.** Point at the NETWORK header that was left open (record its line in NetworkBuilder) — that is the line the author must fix — or, minimally, use the index of the last non-empty line.

### `PlcOpenReader.cs:176` — bug (group 5.3)

**Claim.** The reader models an Execute box inside an LD body, but PlcOpenWriter.WriteLadderBody only emits blocks that a coil's power spine pulls in — so a terminal Execute box (nothing consumes its ENO) is emitted by nothing and its inline ST is SILENTLY dropped on push, violating the ARCHITECTURE invariant "Execute boxes round-trip as VG EXECUTE … END_EXECUTE holding their ST verbatim … never a bare call that drops the ST".

**Fix.** In PlcOpenWriter.WriteLadderBody's node switch, add `case Block b when b.StCode != null: ctx.EmitStandalone(b); break;` (a thin wrapper over the existing private EmitBlock) so an Execute box with no downstream consumer is still emitted into the <LD> root. Cover it with an LD analogue of GraphicalCodeTests' FBD Execute round-trip — no test in test/Volt.Engine.Tests exercises EXECUTE in an LD network today (grep for EXECUTE hits only GraphicalCodeTests' FBD fixtures and the e2e roundtrip).

### `PlcOpenReader.cs:147` — bug (group 5.3)

**Claim.** LowerLadder treats a coil as an absolute sink, so anything wired from a coil's connectionPointOut resolves to the rail identity and silently loses everything upstream of the coil — an IDE-authored rung with a mid-rung coil comes back as unconditional logic.

**Fix.** Make a coil pass power through: keep emitting the OutVar, but return the coil's INPUT value rather than the identity — `r = (inp.Conn, inp.Mods);` — so a contact downstream of a coil keeps the series AND. If instead a mid-rung coil is deliberately out of scope, it must be REFUSED, not silently reshaped: add "coil" to the PlcOpenDocument.ValidateExisting blind list when any coil's localId is referenced by another element's connection. Either way this needs a fixture — LadderRoundTripTests only ever generates coils from VG (never chains off one), so no existing test can see it.

### `PlcOpenReader.cs:118` — defensive-fallback (group 5.3)

**Claim.** A missing `localId` is silently defaulted to 0 when building the ladder lookup — but 0 is a REAL id in the writer's own shared-rail LD form, so an id-less element overwrites the left power rail in `byId`, and two id-less elements collapse onto each other. Conventions 1 ("No fallbacks. Fail loud with a coded error").

**Fix.** Read the attribute once and skip/raise instead of defaulting: `var idAttr = (long?)e.Attribute("localId"); if (idAttr is null) continue;` — an element with no localId cannot be the target of a connection, so it has no business in the lookup at all. (The same `?? 0` appears at lines 54, 82, 222, 247 and 269; the dictionary at 118 is the one where the default actually collides with a live id, so fix that one first rather than churning all six.)

### `VgWriter.cs:100` — bug (group 5.4)

**Claim.** The `reserved` set that `Mint` avoids contains ONLY FB instance names, so a synthetic `i*`/`g*`/`en*` wire can be minted with the same name as a real PLC variable read in the same network — and every read of that real variable is then silently rewired to the synthetic wire. This corrupts the graph on PULL, before push or any validation gate runs.

**Fix.** Seed `reserved` with every identifier the network already uses, not just FB instance names: the base identifier of each `InVar.Expression` and `OutVar.Expression`, plus `Label.Name` and `Jump.Target` (the parser's `Declare` puts labels in the same namespace). One extra pass over `net.Nodes` before the three `Mint` call sites; the doc comment on `Mint` ("so a temp can never shadow an FB instance of the same name") must widen with it.

### `VgWriter.cs:155` — bug (group 5.4)

**Claim.** `Definition` renders a stateless FUNCTION box positionally and throws its pin names away, so every function box in an FBD/LD body is pushed back with its formal parameters renamed to IN1..INn. The Pin name is even captured on line 151 and then used only in the FB-instance branch.

**Fix.** Render a function call with named pins exactly like an FB instance call (`LIMIT(MN := lo, IN := v, MX := hi)`) and teach `VgParser.ParseFunctionExpr` to bind `pin := value` args by name (it already does this in `ParseFbCall`), falling back to IN1..INn only when the args are bare. That fixes both the rename and the unconnected-gap shift with one change.

### `VgWriter.cs:153` — bug (group 5.4)

**Claim.** An operator box with fewer than two CONNECTED inputs renders as `(x)` (or `()` with none), which `VgParser` refuses — so `volt pull` writes a body file that `volt push` can never accept, even unmodified.

**Fix.** In `Definition`, when an operator box has fewer than two connected operands, emit the call form `b.TypeName + "(" + args + ")"` (which `VgParser` accepts and `PlcOpenWriter` re-emits as the same typeName) instead of a degenerate `(x)`. Note the residual: the parser will label it fbdcalltype=function rather than operator, so if that matters, the alternative is to throw a coded VG error at write time rather than emit text the parser rejects — silently emitting unparseable VG is the one option that is wrong either way.

### `VgWriter.cs:41` — bug (group 5.4)

**Claim.** The network label and `DISABLED` flag are written into the VG header and parsed back, but `PlcOpenWriter` never emits either — so a network label or DISABLED marker an author writes is accepted by push and silently gone on the next pull. Neither gate in `GraphicalCode.Validate` can see it, because the loss happens in the first PLCopen hop and the convergence check compares hop 1 against hop 2.

**Fix.** Pick one end and make it honest: either carry Label/Disabled through `PlcOpenWriter`/`PlcOpenReader` (a `<comment>`/vendorElement attribute round-trip), or have `VgParser` refuse a label/DISABLED header with a coded error so the author is told instead of silently losing it. Leaving a writer that emits a field nothing downstream stores is the current defect.

### `VgWriter.cs:133` — defensive-fallback (group 5.4)

**Claim.** `Render` has three silent `return ""` paths — a null wire, a dangling `refLocalId`, and a source node kind VG doesn't model — each producing `out := ;`, which re-parses into a PHANTOM empty `inVariable` node that is then imported into the IDE. Convention 1: a silent default that manufactures a node out of missing data.

**Fix.** Make the unconnected sink explicit rather than empty: skip emitting a sink whose `Source` is null (an unconnected outVariable carries no logic), and throw a coded VG error for the dangling-ref and unmodelled-source cases instead of returning "". If a sink with no source must survive, give it a syntax the parser maps back to `Source = null` rather than to a fabricated leaf.

### `VgWriter.cs:165` — bug (group 5.4)

**Claim.** The Execute-box branch `continue`s past the naming logic the very same loop just applied to that block, so an Execute box with no EN pin whose ENO is consumed emits either a reference to a `g*` name that is never defined (2+ consumers) or an operand like `EXECUTE()`/`()` (1 consumer). An EN-guarded Execute box also burns a `g*` mint it never uses.

**Fix.** Exclude `StCode` blocks from the naming loop (they have no value output — only ENO), and make `Render` resolve an `ENO` connection to an Execute box that has no EN wire explicitly rather than falling through to `names`/`Definition`. If a no-EN Execute box's ENO genuinely cannot be expressed in VG, refuse it with a coded error instead of emitting a dangling name.


---

## BATCH 6 ESCALATIONS (2026-08-06) — behaviour-CHANGING, NOT applied

42 findings across 3 groups; 15 behaviour-changing. The `bug`/`defensive-fallback` ones follow.

**The headline, and it is data loss on the push path:** three members of `PlcOpenDocument` scope to the
WHOLE document instead of the root POU's own `<body>` — `FindFbdLd`, `InlineInsert` and `GraphicalBodyLang`.
`ReadXml` returns a children-bearing export on BOTH vendors, so for a POU whose own body is LD with an FBD
method, `SpliceFbdLdBody` writes the root's new body into the METHOD's body element: the edit lands on the
wrong object and the method's graphical body is destroyed. The surgeon FIXED `GraphicalBodyLang` and the
verifier correctly forced it reverted — this pass is behaviour-preserving. The reverted site now carries an
inline NB naming the defect and pointing here, so it is not re-discovered from scratch.

**Note the coverage shape:** this is exactly the class of defect the e2e cannot reach, because it needs a
graphical CHILD — the same fixture gap `fix-push-data-loss` §2.2 is blocked on.

### `PlcOpenDocument.cs:200` — bug (group 6.1)

**Claim.** FindFbdLd locates "the POU's graphical body" by scanning the WHOLE document and preferring any <FBD> over any <LD>, but the XML it is handed contains child method/action bodies too — so for a POU whose own body is LD and which has an FBD method, SpliceFbdLdBody replaces the METHOD's body with the root's new LD body: the edit is written to the wrong object and the method's graphical body is destroyed.

**Fix.** Resolve the root <pou> the same way PlcOpenPouParser.Parse does and take its DIRECT body child: `rootPou.Element(ns+"body")` then `body.Element(ns+"FBD") ?? body.Element(ns+"LD")`. Never `doc.Descendants`, and never an FBD-before-LD priority that ignores document position.

### `PlcOpenDocument.cs:208` — bug (group 6.1)

**Claim.** InstanceTypes silently loses FB instances that the writer then imports with an EMPTY typeName: the regex captures only the LAST name of a multi-name declaration (`t1, t2 : TON;` yields only `t2`), matches nothing when the declaration has an initializer (`tmr : TON := (PT := T#1S);`), and the map uses StringComparer.Ordinal although IEC identifiers are case-insensitive.

**Fix.** Capture the whole name list (`([\w\s,]+?)\s*:\s*([\w\.]+)` then split on ',') and stop at `:=`/`;` rather than requiring `;` immediately after the type; build the map with StringComparer.OrdinalIgnoreCase. Separately, a resolveType miss should raise a coded BridgeException naming the instance instead of `?? ""` (Conventions 1).

### `PlcOpenDocument.cs:165` — bug (group 6.1)

**Claim.** InlineInsert picks the first <body> ANYWHERE in the document rather than the root POU's own body, so on the first-write path against a children-bearing export it can wipe and replace a child method's body instead of the POU's — the same document-scoping defect as FindFbdLd, in the other branch of the same method.

**Fix.** Resolve the root <pou> once (shared with the FindFbdLd fix) and use `rootPou.Element(ns + "body")`, throwing the same coded error when the ROOT has no body element.

### `PlcOpenDocument.cs:148` — defensive-fallback (group 6.1)

**Claim.** The EN/ENO carve-out in the multi-output guard is wider than the comment that justifies it: the comment describes a box with "an EN input and two outputs", but the code exempts ANY EN-bearing block from the multi-output check regardless of output count — so a stateless function with an EN pin and three or more real outputs, which VG cannot represent, is accepted for overwrite instead of refused.

**Fix.** Keep keying off the EN input (that part is correct) but bound the exemption to what the comment claims: exempt only when the output count is exactly 2, i.e. change the EN clause to also require `outputs == 2` so a 3-output EN box still refuses. Otherwise fix the comment to state that any EN box is exempt and why that is safe.

### `FetchService.cs:159` — bug (group 6.3)

**Claim.** An item whose body momentarily fails to materialize is reported to the client as REMOVED, so `volt pull` deletes the still-existing file from src/. `versions` records the item with the UNREADABLE sentinel (so the aggregate hash is right, as the comment promises), but `fullVersions` never gets it — and `removed` is derived from `fullVersions`, not from `versions`.

**Fix.** Record the unreadable item in `fullVersions`/`folders` under a name derived from `it.Name + "." + ItemKind.ExtFor(kind)` with the `Versioning.Unreadable` sentinel, so it stays in `Items` (unchanged versus the client's baseline) and out of `removed`. Alternatively compute `removed` against the union of readable and unreadable full names. Note `Versioning.SafeVersion` swallows ANY exception including a transient COM drop, and `BridgePipeHost.RunRead`'s retry-once never sees it — so a one-off RPC hiccup on a single item currently reads as a deletion.

### `FetchService.cs:100` — bug (group 6.3)

**Claim.** `Items`, `Folders` and `Removed` are all computed from `fullVersions`, which the onlyItems filter excludes items from — so an onlyItems fetch that also carries knownItems reports every unselected known item as removed, and returns an `Items` map that disagrees with the `projectVersion` hashed from the full `versions` map in the same response.

**Fix.** Move `fullVersions[fullName] = version; folders[fullName] = folder;` ABOVE the onlyItems `continue` (the same reasoning the comment already gives for `versions`: onlyItems restricts which BODIES ship, not which items exist). Only the `changed.Add` below should be gated by onlyItems. Live callers escape today only by accident — Commands.Show sends a one-key knownItems and the e2e harness always sends `knownItems: {}` — so nothing catches this.

### `FetchService.cs:39` — bug (group 6.3)

**Claim.** The no-baseline guard asks a different question than the rest of the method: it tests the RAW `request.OnlyItems` for null, while everything below uses the normalized `onlyItems`, which is null when the list is present-but-EMPTY. A request of `{"onlyItems": []}` with no knownItems therefore slips past the guard and runs a full fetch — every item marked changed — plus the full library precompile the guard's own comment says a directed preview must never pay.

**Fix.** Compute `onlyItems` first and guard on it: `if (!isInit && request.KnownItems == null && onlyItems == null) throw …`. One question, one answer.

### `FetchService.cs:103` — bug (group 6.3)

**Claim.** For a `.library` item the SAME response answers "which folder does this file live in" two different ways: `Changed[].Folder` is the nested library folder (`Library Manager/<lib>`) while `Folders[fullName]` is the raw walk folder (`Library Manager`). The CLI writes the file from `Changed[].Folder` but persists `Folders` into the sidecar and builds `volt status`'s PathByName from it, so a library shows up in the UI at a path that does not exist on disk.

**Fix.** Compute the effective folder once (`var effFolder = kind == ItemKind.Kinds.Library ? LibraryFolder(folder, it.Name) : folder;`) and use it for BOTH `folders[fullName]` and `FetchedItem.Folder`. Consumer proof: StatusModel.cs:69 `var folder = snap.Folders.TryGetValue(name, out var fo) ? fo : "";` then `pathByName[name] = $"{folder}/{name}"`, versus FetchExclusionTests asserting `Assert.Equal("Library Manager/Standard", stub.Folder)`. Note this changes nothing about the item VERSION (still hashed from the walk folder), so the library-change optimization is unaffected.

### `IdeTree.cs:50` — bug (group 6.3)

**Claim.** `BuildVoltIdeTree` matches the fetch's `Removed` entries — which are bare full NAMES (`FB_Motor.fb`) — against src-relative PATHS (`POUs/FB_Motor.fb`). A deleted item that lives in any folder therefore never matches, is carried forward from the parent volt/ide tree as "unchanged", and is never dropped. Only root-folder deletions actually propagate.

**Fix.** Compare on the NAME, not the path: `!removed.Contains(Extensions.FullNameFromPath(rel) ?? rel)`. The producer is FetchService.cs:159 (`knownItems.Keys` are `WorkspaceItem.FullName` = `name.ext`, no folder — see WorkspaceItem.cs). Also document the units on `FetchResponse.Removed` in RefsFetch.cs, which currently carries no doc at all. FetchIncrementalTests.Removed_reports_a_known_name_that_no_longer_exists deletes a POU in folder "POUs" and asserts only on the wire field, so it passes while the client-side drop silently does nothing.

### `OpGuard.cs:29` — bug (group 6.3)

**Claim.** `expectedPlatform` is only ever compared when `expectedName` is non-empty — it is nested inside that condition. A caller that supplies the platform alone gets no vendor check at all and the op proceeds silently, even though `RefsRequest` documents both fields as independently optional.

**Fix.** Check each supplied field on its own: refuse when `!string.IsNullOrEmpty(expectedPlatform) && !string.Equals(ide.Vendor, expectedPlatform, OrdinalIgnoreCase)`, and separately when `!string.IsNullOrEmpty(expectedName) && !string.Equals(served, expectedName, Ordinal)`. OpGuardTests only covers both-set and both-null; no test sends platform alone.

### `FetchService.cs:220` — defensive-fallback (group 6.3)

**Claim.** When `sig.LibraryPath` is empty (or is just a comma), `Split(',')[0].Trim()` sanitizes to "" and `LibraryFolder` appends an empty segment, producing a folder ending in "/" — which the CLI's JoinPath then turns into a workspace path with an empty component (`Library Manager/(unresolved)//SOMEFB.fb`). The `(unresolved)` branch is explicitly the "fail loud" path, but this sub-case fails silently into a malformed path.

**Fix.** Guard the leaf segment: fall back to a named marker (e.g. `(no-resolution)`) when the sanitized head is empty, or have `LibraryFolder` return `folder` unchanged when `name` sanitizes to empty rather than emitting a trailing separator.

### `GraphModel.cs:21` — bug (group 6.2)

**Claim.** `GraphNetwork.Label` and `GraphNetwork.Disabled` survive the VG text leg but are silently dropped by the PLCopen leg, so a pushed `NETWORK 0 FBD "title" DISABLED` loses both — and BOTH of GraphicalCode.Validate's gates are structurally blind to it, violating ARCHITECTURE's "Round-trips are lossless — push→fetch returns byte-identical sourceText".

**Fix.** Either make the PLCopen leg carry them (network title / disabled state) so the round-trip is genuinely lossless, or — the smaller, fail-loud change consistent with Conventions 1 — refuse them in `GraphicalCode.Validate` with a coded `VgParseException` (`VG_UNSUPPORTED_NETWORK_ATTRIBUTE`) so the author is told the attribute cannot be pushed rather than having it vanish. Do not leave the model fields writable-but-unwritten.


---

## BATCH 7 ESCALATIONS — `Volt.Cli.Ide.Codesys` (2026-08-06)

50 findings, 20 behaviour-changing. **Nothing here has unit coverage**: no test csproj can reference this net48
assembly, so the three suites execute zero lines of it. These were found by reading only.

### `CodesysDispatcher.cs:49` — bug (group 7.2)

**Claim.** The reflection invoke is never unwrapped, so a failure of the IDE's own marshalling surfaces to the client as INTERNAL_ERROR with the useless message "Exception has been thrown by the target of an invocation" — a reflection-specific exception type leaking as an expected condition, which ARCHITECTURE forbids.

**Fix.** Wrap the invoke: `try { _invoke.Invoke(...); } catch (TargetInvocationException tie) when (tie.InnerException != null) { throw tie.InnerException; }` (or ExceptionDispatchInfo on the inner), so the real reason — not the reflection wrapper's boilerplate — reaches the error frame.

### `CodesysObjectModel.cs:647` — bug (group 7.1)

**Claim.** CreateChild has no case for the four property-accessor kind codes (PlcPropGet 613 / PlcPropSet 614 / PlcItfPropGet 654 / PlcItfPropSet 655), so a push that must (re)create a Get or Set accessor silently falls into the `default:` arm and creates a FUNCTION BLOCK named "Get"/"Set" instead. TwinCAT passes the same kindCode straight through to its native CreateChild and creates the real accessor — a vendor divergence a pipe client can observe, which ARCHITECTURE calls a bug by construction.

**Fix.** Add explicit `case ItemKind.PlcPropGet: case ItemKind.PlcItfPropGet: return Create(MemberContainer(parent), "create_accessor_get"/the correct scripting factory, name);` (likewise for Set), and replace `default:` with a throw naming the unhandled itemType — mirroring PushService.PouKindToCode's stated policy ("No fallback: an unrecognized top-level kind is a bug ... not a Program").

### `CodesysObjectModel.cs:939` — defensive-fallback (group 7.1)

**Claim.** InvokeMethod returns null instead of throwing when no overload of that name/arity exists. Every mutating call in this file routes through it, so a CODESYS version that renames or re-arities a method turns a WRITE into a silent no-op: `SetObject(meta, true, null)` never commits (push reports success, edit lost), `ExecuteCommand` never builds (Build() then sees no errors and returns true), `rename`/`remove` silently do nothing. Everywhere else in this same file a missing member throws with an explicit 'object-model version mismatch' message.

**Fix.** Make the no-match path throw `MissingMethodException`/`InvalidOperationException($"CODESYS: no '{name}' overload taking {args.Length} args on {o.GetType().FullName}")`, matching InvokeWithOptionals/CreateNamed which already do exactly that. If any call site genuinely wants best-effort, add a separate `TryInvokeMethod` and use it there explicitly.

### `CodesysObjectModel.cs:140` — defensive-fallback (group 7.1)

**Claim.** GetLibraryRefs drops library references on three bare `catch` arms with no log line, violating the stated invariant 'Skipped/errored items are logged, never silently dropped (Volt.Cli.Transport/VoltLog) with name + reason'. A dropped .library ref removes its whole signature set from the fetch, and the workspace just shows fewer files with nothing to read.

**Fix.** Replace each bare `catch` with `catch (Exception ex) { VoltLog.Warn($"library ref '{nm}' skipped: {ex.Message}"); ... }` (Volt.Cli.Transport is already referenced by this assembly — CodesysDriver.Tree.cs uses VoltLog).

### `CodesysObjectModel.cs:708` — bug (group 7.1)

**Claim.** ExportInterfaceXml skips folders instead of recursing into them, so an interface method/property that the engineer filed inside a folder under the interface is silently omitted from the synthesized PLCopen document — and therefore from the materialized interface source. The sibling POU path (CollectPouChildren) recurses folders, and Materializer.BuildFolderMap also recurses folders for the same parent, so it expects foldered children to exist.

**Fix.** Extract the per-child emission into a local function and recurse on folders instead of `continue`, exactly as CollectPouChildren does.

### `CodesysObjectModel.cs:96` — defensive-fallback (group 7.1)

**Claim.** ReadObject falls back to returning the IMetaObject itself when `.Object` resolves to null. That silently substitutes the wrong object for every downstream consumer: ObjectInterfaceNames then enumerates IMetaObject's interfaces (misclassification → the item is dropped as unknown by CodesysTypeMap.IsSkipped) and ReadAspectText finds no "Interface"/"Implementation" aspect and returns "" (an item materializes with empty source). The comment on the very same line asserts `.Object` is always there.

**Fix.** `return GetMember(meta, "Object") ?? throw new InvalidOperationException("CODESYS: IMetaObject.Object was null — object-model version mismatch");`

### `CodesysObjectModel.cs:450` — bug (group 7.1)

**Claim.** Build() decides success by scanning the ENTIRE persistent MessageStorage — every category, never cleared, no timestamp/generation filter — so it reports errors it did not produce. ExtractLibrarySignatures deliberately runs a build it EXPECTS to fail immediately beforehand ('even a FAILING app build ... still precompiles'), which seeds that store with error messages; the next `volt build` then returns success:false plus those stale diagnostics.

**Fix.** Clear the message store (or snapshot its message count per category) immediately before `ExecuteCommand` and report only messages added after that point; alternatively restrict the enumeration to the build/compile category rather than `Categories` wholesale.

### `CodesysObjectModel.cs:75` — defensive-fallback (group 7.1)

**Claim.** The three identity accessors all default silently on a failed read: GetName returns "", GuidOf returns Guid.Empty, HandleOf returns 0. Since 'the item NAME is the identity', a ""-named item enters the walk, the version map and the workspace layout; and (0, Guid.Empty) is then handed to GetObjectToRead/GetObjectToModify, i.e. a read or a WRITE aimed at an unresolved object. ARCHITECTURE Convention 1: 'If data is required, say so and guard it.'

**Fix.** Throw on the miss: `?? throw new InvalidOperationException("CODESYS: node exposes no get_name")`, and likewise for guid/handle. At minimum guard WriteSourceText: refuse to open a modify transaction when HandleOf(node)==0 && GuidOf(node)==Guid.Empty.

### `CodesysObjectModel.cs:237` — defensive-fallback (group 7.1)

**Claim.** SetAspectText has TWO silent returns but the comment justifies only the first. A missing ASPECT (`aspect == null`) is the documented, contract-sanctioned no-op (ICodeStore: 'CODESYS silently no-ops it'). A missing TextDocument on an aspect that DOES exist is an unexplained silent drop of a real write — WriteSourceText then commits an empty transaction via SetObject and the push reports success, contradicting ICodeStore's 'Every method throws on real IDE failure; there is no silent fallback.'

**Fix.** Keep the `aspect == null` no-op (it is the documented contract) and make the second case loud: `var doc = GetMember(aspect, "TextDocument") ?? throw new InvalidOperationException($"CODESYS: {aspectName} aspect has no TextDocument");`

### `CodesysObjectModel.cs:496` — defensive-fallback (group 7.1)

**Claim.** The best-effort precompile swallows its exception with no log at all. A build that throws (rather than merely failing) means the subsequent AllPrecompiledSignatures call returns near-nothing, and the engineer sees a fetch with silently missing library signatures and no line to read. ARCHITECTURE Convention 4: 'Never swallow a background failure' — best-effort for the request, but log it.

**Fix.** `catch (Exception ex) { VoltLog.Debug($"library precompile build threw (signatures may be incomplete): {ex.Message}"); }` — keeps the best-effort semantics, ends the silence.

### `CodesysDriver.Code.cs:40` — bug (group 7.3)

**Claim.** WriteXml's restore copy is captured with ExportXmlString (the node ALONE) while the XML being written was built from ExportXmlWithChildren (node + methods/actions/properties). If the import fails, PlcOpenTransport restores a POU stripped of every child — silent data loss on exactly the data-safety path that exists to prevent it. The Beckhoff driver uses the SAME primitive (ExportPouXml) for both legs, so this is also a vendor divergence in a load-bearing policy.

**Fix.** Capture the restore copy with the same primitive the write leg reads with: `exportOriginal: () => _om.ExportXmlWithChildren(node)`.

### `CodesysDriver.Code.cs:41` — defensive-fallback (group 7.3)

**Claim.** The `if (par != null)` guard silently turns a missing parent into a SKIPPED delete, after which the import runs with `into: null` — which CodesysObjectModel resolves to the project root. The POU is then relocated out of its folder and collides by name with the copy that was never deleted. It also falsifies the recorded assumption ImportXmlString relies on ("the only caller DELETES the existing object before importing, so there is no name conflict"), which is what makes its 2-arg fall-through safe.

**Fix.** Drop the guard and fail loud: `var par = _om.ParentOf(node) ?? throw new InvalidOperationException($"CODESYS: '{nm}' has no parent — cannot re-import in place");` (PLCopenXML carries no folder membership, so there is no correct root-import behaviour to fall back to).

### `CodesysDriver.cs:71` — defensive-fallback (group 7.3)

**Claim.** When the dispatcher could not be created, MarshalToIdeThread runs the closure on the CALLING thread instead of the CODESYS primary thread. Every op is already refused in that state (IsConnected is false), so the only thing this fallback enables is the ambient health probe executing SnapshotHealth's object-model reflection on a ThreadPool thread against thread-affine scripting objects — the one thing this file says everywhere must never happen. Worse, the fallback returns normally, so DriverBase.RunOnStaThread stamps _lastOkTick ("the IDE responded") when no IDE thread was ever reached.

**Fix.** Throw instead of running off-thread: `=> _dispatcher?.Run(fn) ?? throw new BridgeException(BridgeErrorCodes.PlcDisconnected, "CODESYS primary-thread dispatcher unavailable")` (a coded error keeps the one-error-channel rule; the probe's failure then reaches OnProbeFailed and is logged instead of silently corrupting IDE state).

### `CodesysDriver.Tree.cs:108` — defensive-fallback (group 7.3)

**Claim.** HasChildren swallows every exception and reports "leaf", 70 lines below a sibling guard on the SAME call that explicitly invokes the no-fallback policy and logs to both sinks. The swallow is not cosmetic: it decides whether the device descriptor is emitted at `Dev/Dev.device` or `Dev.device`, i.e. a wire-visible `folder` change and a file rename in the user's git repo, with nothing in the log to explain it.

**Fix.** Log the same two sinks as the Walk guard before returning false (`catch (Exception ex) { VoltLog.Warn($"device '{name}': child probe failed, treating as a leaf: {ex.Message}"); return false; }`), or better, hoist the single GetChildren call the walk already needs and derive both `hasChildren` and the recursion from it under the existing logged guard.


---

## BATCH 8 ESCALATIONS — `Volt.Cli.Ide.Twincat` (2026-08-06)

51 findings. Same coverage hole as batch 7: **no test csproj references this project**, so only the live TS e2e
against a running XAE touches any of it.

### `TcPouReader.cs:37` — defensive-fallback (group 8.2)

**Claim.** A body whose DefaultViewMode cannot be found, and any unrecognised view-mode value, are both silently reported as FBD -- the literal `?? "FBD"` defensive default ARCHITECTURE Conventions 1 names as banned. The consequence is not cosmetic: FBD is an EDITABLE VG language, so a body Volt failed to understand gets materialized as editable VG and is written back to the IDE as FBD on push.

**Fix.** Split the two cases. Keep the FBD default ONLY for a present-but-absent-scalar NWL (that is a real TwinCAT default) and mark it with a `ponytail:` comment recording why. For the other two -- no NWLImplementationObject found at all, and a view-mode string that is neither FBD nor LD -- throw a coded BridgeException naming the item and the value read, so an unparsed archive fails loud rather than round-tripping as editable FBD.

### `ComMessageFilter.cs:61` — bug (group 8.2)

**Claim.** RetryRejectedCall retries SERVERCALL_RETRYLATER forever -- dwTickCount (elapsed ms, the parameter KB201600's pattern uses to give up) is ignored. So the class doc's claim that the HRESULT check 'is the backstop for when retrying ultimately gives up' is unreachable for the dominant reject type: retrying never gives up. Combined with StaDispatcher.Run's deliberate no-cap, one wedged XAE blocks the STA thread and therefore every pipe caller of that worker indefinitely, with no coded error and no degraded flag.

**Fix.** Bound the retry: `=> dwRejectType == ServerCallRetryLater && dwTickCount < RetryBudgetMs ? RetryAfterMs : CancelCall;` with `RetryBudgetMs` set to the longest wait a caller should absorb before the HRESULT backstop is allowed to see the rejection. Then the doc's stated backstop is actually reachable.

### `StaDispatcher.cs:54` — bug (group 8.2)

**Claim.** There is no completion path: once RunMessageLoop returns on cancellation, _queue is never CompleteAdding'd, so any work already queued -- or added afterwards by a pipe connection still in flight -- blocks its caller on evt.Wait() forever. Latent today only because both cancel sites in Program.cs are immediately followed by process exit.

**Fix.** On loop exit, drain to failure instead of abandoning: `_queue.CompleteAdding(); while (_queue.TryTake(out var a)) { try { a(); } catch { } }` after the while loop, and have Run<T> catch the InvalidOperationException from Add on a completed collection and throw a coded BridgeException (the bridge is shutting down) so a caller gets an error frame rather than a hang.

### `StaDispatcher.cs:55` — bug (group 8.2)

**Claim.** `throw error;` rethrows the captured exception object, which RESETS its StackTrace to this line. Every COM failure marshalled off the STA thread therefore loses the frames that identify which TcObjectModel call actually faulted -- on the one bridge that has no C# test coverage and whose only diagnostic is the log.

**Fix.** `if (error != null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();` -- BCL only, no new dependency, and it preserves the original stack while still surfacing on the calling thread.

### `TcPlcOpen.cs:32` — bug (group 8.2)

**Claim.** When PlcOpenExport produces no file -- the exact failure the class doc says is unverified (a non-default COM interface reached by late-bound dispatch, and an unconfirmed selection grammar) -- the caller does not see 'export failed'. It sees a raw FileNotFoundException naming a random GUID temp path, mapped by BridgePipeHost to an opaque INTERNAL_ERROR that names neither the POU nor the selection string.

**Fix.** Guard the post-condition before reading: `if (!File.Exists(tmp)) throw new BridgeException(BridgeErrorCodes.InternalError, $"TwinCAT PlcOpenExport produced no file for selection '{selection}'");` -- one coded error that names the selection, per Conventions 1 and 5.

### `TcPouReader.cs:20` — defensive-fallback (group 8.2)

**Claim.** A malformed or truncated graphical archive is indistinguishable here from a textual ST body: both return null, which BodyLanguage reports as 'textual', so the raw NWL/CFC XML would be materialized into the workspace as the item's ST source text. The silent catch is load-bearing for real ST bodies, but it currently also absorbs the corruption case.

**Fix.** Only swallow the parse failure when the text is not claiming to be XML: `var t = bodyXml.TrimStart(); if (t.Length == 0 || t[0] != '<') return null;` before the Parse, and let a body that DOES start with '<' but fails to parse raise a coded BridgeException naming the item rather than being written out as ST.

### `TcObjectModel.cs:336` — defensive-fallback (group 8.1)

**Claim.** ReadImplementation swallows a failed COM read into "", which BodyLanguage turns into "textual ST" — so a transient read failure disarms the push body-format guard and a textual push overwrites a live CFC/SFC/FBD body with a comment marker. This is the exact data-loss PushService's own comments say the guard exists to prevent.

**Fix.** Delete the catch and let the COM failure propagate (RunOp/RunRead already map it), or return null and make BodyLanguage refuse on an unread body. A body Volt could not read must never be classified as textual — "unknown" has to fail closed, not open.

### `TcObjectModel.cs:109` — bug (group 8.1)

**Claim.** BindAndResolve's not-bound check tests the FIELD `_dte`, not the freshly obtained `dte`. When BindByPid returns null while an older handle is still held, the requested project is never resolved, yet the method falls through, finds the PREVIOUS project's `_sysManager` still set, and logs "bound '<old project>'" — leaving IsConnected true against the wrong project. That is verbatim the regression FindTwinCatProject records in its own DO-NOT comment; only Core's served-name post-condition still saves the wire outcome.

**Fix.** Test the local: `if (dte == null) { VoltLog.Warn(...); DropProject(); return; }` before touching anything else — a bind miss must leave the model NOT connected, exactly as FindTwinCatProject's reset-first comment requires.

### `TcObjectModel.cs:448` — defensive-fallback (group 8.1)

**Claim.** A failed `LastBuildInfo` read defaults to 0, i.e. "zero failed projects", so Build() reports SUCCESS when it could not read the build result at all. The one defensive default in the method points at the answer that hides the failure.

**Fix.** Let the read throw (BuildService already catches and returns success:false plus a diagnostic naming the reason), or default to a non-zero sentinel so an unreadable result is a failed build.

### `TcObjectModel.cs:451` — bug (group 8.1)

**Claim.** The outer bare `catch { return false; }` turns any COM failure into `success:false` with NO log line and NO diagnostic, while the CODESYS driver throws (`"CODESYS: no Application to build"`) and BuildService converts that into success:false PLUS an error diagnostic carrying the reason. Same wire op, vendor-observably different payload — and a silently swallowed background failure.

**Fix.** Drop the catch (and the `_dte == null` early return — replace it with the coded PLC_DISCONNECTED FlushPendingWrites already raises) so BuildService's catch produces the same success:false + diagnostic on both vendors.

### `TcObjectModel.cs:282` — bug (group 8.1)

**Claim.** ProjectDirty reads `Solution.Saved` — the .sln file's own dirty bit — and publishes it as the health row's per-project `dirty`. It does not see dirty documents or a dirty .plcproj, which is precisely the distinction this same file draws two hundred lines later; CODESYS reports the PROJECT's dirty flag, so the wire field means different things per vendor.

**Fix.** OR the solution bit with the bound project's own Saved flag and any dirty Document under it (needs a live check of which EnvDTE surface answers for a .plcproj), so `dirty` means "the IDE holds unsaved changes" on both vendors.

### `TcObjectModel.cs:75` — bug (group 8.1)

**Claim.** EnsureAttached returns early whenever a project was ever selected, so after a DTE re-registration the health project list goes EMPTY and stays empty — the connector's list is the only way a user re-selects, so the UI has nothing to click and only a content op (which the UI cannot start without a row) can recover. The doc's own justification covers only the project BINDING, not the LIST that the same poll publishes.

**Fix.** Drop the `if (HasSelection) return;` guard — the bare re-bind is already resolution-free (it never touches `_sysManager` or the PLC tree), so it is safe with a selection held and it is what keeps the row list alive for the way back.

### `TcObjectModel.cs:204` — bug (group 8.1)

**Claim.** `_plcProjectPath` is assigned the PLC node's bare NAME, but every consumer feeds it to `LookupTreeItem`, whose argument is a '^'-separated tree path (this file's own other calls are the roots "TIPC"/"TIID"). Both re-lookups and PlcRoot's fallback therefore cannot resolve; the field name documents an intent the value does not satisfy.

**Fix.** Store `(string)plc.PathName` (the real tree path), or read the name and prefix it: `"TIPC^" + plc.Name`. Needs one live check of which member TwinCAT exposes on the TIPC child before committing.

### `TcObjectModel.cs:209` — bug (group 8.1)

**Claim.** The PLC-project resolution swallows the real COM error in two bare catches and then throws a raw InvalidOperationException, so the cause is gone and the wire sees the catch-all INTERNAL_ERROR instead of a coded error — the same for EnsurePlc's "no TwinCAT project bound", which is a textbook PLC_DISCONNECTED. ARCHITECTURE Conventions 5: only BridgeException/BridgeErrorCodes cross the wire.

**Fix.** Capture the swallowed exception and rethrow as `new BridgeException(BridgeErrorCodes.PlcDisconnected, "...", ex)`; make EnsurePlc's guard PLC_DISCONNECTED too. FlushPendingWrites in this same file already models it.

### `TcObjectModel.cs:467` — bug (group 8.1)

**Claim.** Build diagnostics are harvested only from output panes whose NAME contains "Build" or "TwinCAT". Pane names are localized by the VS/TcXaeShell UI language, so on a non-English XAE (e.g. "Erstellen") the loop matches nothing and `build` returns success:false with an empty diagnostics list. The surrounding bare catch means that failure is also silent.

**Fix.** Select the pane by its stable GUID (vsBuildOutput) instead of its display name, and log at Debug when no pane matched or the walk faulted, so an empty diagnostic list is diagnosable.

### `TcObjectModel.cs:300` — defensive-fallback (group 8.1)

**Claim.** GetName coalesces a null name to "" on the field that IS the protocol identity. The tree walk guards against a THROWN name read (it catches and skips) but not against an empty one, so a null name is emitted as an item named "" rather than skipped.

**Fix.** Drop the `?? ""` and let the null surface (or throw a coded error naming the node) so the walk's existing skip-and-log path handles it — an item with no name must never reach the wire.

### `BeckhoffDriver.Tree.cs:85` — bug (group 8.3)

**Claim.** The whole I/O-device walk is dead weight: it emits each device with TwinCAT's RAW native ItemType instead of promoting it to ItemKind.PlcDevice, and no raw TIID item-type is in ItemKind's 601-699 PLC range — so ItemKind.Map() returns null and Core drops every one of them as "unmapped-kind". TwinCAT therefore materializes NO `.device` descriptors while CODESYS does, and each distinct device type additionally trips the once-per-code "unmapped TREEITEMTYPE" warning on every real project.

**Fix.** Emit ItemKind.PlcDevice, exactly as the CODESYS walk does: `new ProjectItem(name, new ItemRef(device), ItemKind.PlcDevice, FolderPath.Encode("I/O Devices"))`. Note that alone is not parity: BeckhoffDriver.ReadManifest has no `Kinds.Device` arm, so the descriptor would come out as the generic `Name=…` line rather than CODESYS's DeviceDescriptor bytes — either add the arm or record the gap. If neither is wanted, delete WalkIoDevices outright rather than keep a walk whose output Core always discards.

### `BeckhoffDriver.Tree.cs:63` — defensive-fallback (group 8.3)

**Claim.** Three silent catches in the tree facet swallow COM failures and substitute a fabricated answer, in direct contradiction of the file's own logging policy comment and of the ARCHITECTURE invariant "Skipped/errored items are logged, never silently dropped". ChildCount→0 is the worst: it silently flips the hybrid-folder decision (a wire-visible folder/version change) on the walk, and in Materializer it makes a POU's properties and property accessors vanish from the materialized ST with no trace. Name→"" fabricates an identity in a protocol where the NAME *is* the identity.

**Fix.** Give all three the same treatment WalkInner already gives its other faults — log the failure with the node's folder/name and the reason. For `Name`, do not invent "": let it throw (name is identity; a nameless item must not reach the wire). Also raise the walk's skip logging from Debug to Warn to match CODESYS's identical event (CodesysDriver.Tree.cs:36 logs to VoltLog.Warn + stderr): Debug is suppressed by default (VoltLog.Level = Info unless VOLT_LOG_DEBUG=1), and TwinCAT is the vendor where cross-process COM faults actually happen.

### `BeckhoffDriver.cs:80` — bug (group 8.3)

**Claim.** The doc-comment contract "NEVER THROWS, and the rows + the throttle clock are published UNCONDITIONALLY" is asserted but not enforced: `_om.EnsureAttached()` runs bare, outside any try, and reaches RotInstances' raw ROT interop (EnumRunning/Next/GetObject on IRunningObjectTable), which can throw COMException. If it does, PublishRows is skipped — so the throttle clock is NOT stamped (defeating stated reason (b): a struggling XAE then gets a fresh STA round-trip on every poll) — and because Connect/SelectProject call this on the request path, it escapes BridgePipeHost.RunOp as an opaque INTERNAL_ERROR instead of the clean PLC_DISCONNECTED, which is the exact regression stated reason (a) says this design prevents.

**Fix.** Wrap the EnsureAttached call so the promise is enforced rather than documented (Conventions #2): `try { _om.EnsureAttached(); } catch (Exception ex) { VoltLog.Warn($"health: re-attach to xae pid failed: {ex.Message}"); }` — the method then genuinely always reaches PublishRows and always returns a verdict, and TriggerAsyncProbe's ProbeIdeAlive=false path raises the coded PLC_DISCONNECTED it is already written to raise.

### `BeckhoffDriver.Code.cs:83` — bug (group 8.3)

**Claim.** `root.Descendants("Dependency")` is an unbounded recursive search, so it collects TRANSITIVE dependencies as well as direct ones — contradicting both the comment on the line and the parenthetical two lines above, which shows the author knew this XML nests dependency records. The DEPENDENCIES line is manifest bytes, so it is both wire-visible and the library's version basis.

**Fix.** Scope the query to the reference's own dependency container instead of the whole document — e.g. `root.Elements("Dependencies").Elements("Dependency")` (or `.Descendants("Dependencies").FirstOrDefault()?.Elements("Dependency") ?? Enumerable.Empty<XElement>()`), mirroring the "first one is ours" reasoning already applied to EffectiveResolution. Same latent issue on `Descendants("Namespace")`/`Descendants(tag)` above: a missing field on the reference silently borrows a nested dependency's value.

### `BeckhoffDriver.Code.cs:55` — defensive-fallback (group 8.3)

**Claim.** ReadManifest and LibraryManifestFromXml fabricate manifest bytes out of missing data instead of failing loud (Conventions #1). `?? "?"` makes every item whose metadata has no readable name materialize as `Name=?` — so they all hash identically and an edit to any of them cannot show up in `volt status`, which is precisely the gap CODESYS's ReadManifest now NAMES in the log. The library path is worse: `?? ""` / `?? name` chains emit a LIBRARY/NAMESPACE/RESOLUTION line built from absent fields, and the RESOLUTION fallback bypasses LibraryManifest.Resolution, producing a differently-SHAPED line than the `name, version (distributor)` form FetchService re-parses.

**Fix.** Drop the invented values and name the gap: when ItemName/LibItemName are both absent, return ItemKind.EmptyManifest(kind) after a VoltLog.Warn naming the kind (the same shape CODESYS uses), rather than `Name=?`. In LibraryManifestFromXml, log-and-fail the reference when ItemName or a resolution source is missing instead of emitting `LIBRARY \n` / a bare-name RESOLUTION; if the DefaultResolution fallback must stay, route it through LibraryManifest.Resolution so the line shape can't diverge.

### `Program.cs:58` — bug (group 8.3)

**Claim.** A malformed --xae-pid is indistinguishable from a missing one, and a repeated flag silently takes the LAST value. `--xae-pid abc` leaves xaePid at 0 and prints "requires --xae-pid <pid>", which sends a supervisor operator hunting for an argument that WAS passed; `--xae-pid -5` parses happily and the worker then tries to bind a negative pid and serves the pipe name `volt.bridge.twincat.-5`.

**Fix.** Split the two failures and reject a non-positive pid: find the flag first, then parse it, erroring with the offending value when the parse fails or `p <= 0`. Fail loud on the value you were actually given (Conventions #1) instead of collapsing it into the missing-argument message.


---

## BATCH 9 ESCALATIONS — `Volt.Cli` core (2026-08-06)

47 findings, 28 behaviour-changing. This is the git-native CLI: `Git.cs` is where every git object SHA in a
user's repo comes from, and `Volt.Cli.Tests` exercises the command surface, not the blob-writing path.

### `Program.cs:197` — bug (group 9.3)

**Claim.** `--project-name` is missing from `ValueFlags`, so the space-separated form `--project-name <name>` — the ONLY form the usage text documents and the ONLY form @volt/control emits — is parsed as a bare flag and its value falls into the positionals. `volt rebind` is therefore broken for every real caller: it always answers "rebind needs --project-name" and exits 1. Only `--project-name=<name>` works, and nothing in the repo uses that form.

**Fix.** Add "--project-name" and "--pipe" to `ValueFlags`, and add a BlackBoxTests case that spawns the real binary with `rebind --project-name X` and asserts the config was rewritten.

### `Program.cs:73` — bug (group 9.3)

**Claim.** `catch (IOException) { return Unreachable(); }` blanket-maps every file-system failure to "bridge is not reachable". Combined with `Bridge()` being evaluated as a switch ARGUMENT (before the command body runs), running any bridge verb in a git repo that isn't a Volt workspace makes `BridgeResolver.Resolve` → `Config.LoadConfig` → `File.ReadAllText` throw `FileNotFoundException` (an IOException) and the user is told the IDE bridge is down. The friendly `"not a Volt workspace — run `volt init` first"` refusals in Commands.Pull/Push/Build are dead for this path.

**Fix.** Narrow the catch to the transport's own failure (or wrap PipeClient's IO in PipeCallException), and check `Config.ConfigExists(root)` in Main before evaluating `Bridge()` so the workspace refusal wins over the bridge refusal.

### `Program.cs:53` — bug (group 9.3)

**Claim.** `--pipe` is read with `a.Value("--pipe")` but is not in `ValueFlags`, so `volt --pipe <name> <verb>` silently swallows the verb: the pipe name becomes positional[0] and IS the verb. The comment on line 50 ("an explicit --pipe / VOLT_PIPE wins (dev + tests)") and BridgeResolver's doc both describe an option that only works in the `--pipe=` form.

**Fix.** Add "--pipe" to `ValueFlags`.

### `Types.cs:47` — defensive-fallback (group 9.3)

**Claim.** `Conflict.Kind` and `Conflict.Reason` are never anything but the hardcoded literals "text" and "both-modified" — the sole construction site stamps them on EVERY unmerged path. That is a lie for structural conflicts (modify/delete, add/add), which the CLI itself knows are different: `Commands.Merge` refuses `--continue` on `Git.StructuralConflictFiles` precisely because they carry no markers. So `status --json` tells volt-control every conflict is a text both-modified one, including the ones that must be resolved explicitly.

**Fix.** Derive Kind/Reason from the unmerged stage bits git already reports (`Git.StructuralConflictFiles` vs `Git.ConflictMarkerFiles`), or delete the two fields from `Conflict` and `StatusJson` if no consumer needs them — but do not keep constants that assert a fact the code elsewhere contradicts.

### `Program.cs:246` — bug (group 9.3)

**Claim.** `Console.OutputEncoding` is never set, so every non-ASCII character the CLI prints (— → “ ” …) is best-fit-mangled or DROPPED on a default Windows console (codepage 850/437). The em dash becomes '-', the arrow vanishes entirely, leaving a double space. This hits the usage text, every refusal reason on stderr (which volt-control surfaces to the user via `firstLine(r.stderr)`), and `status --porcelain` paths containing non-ASCII characters.

**Fix.** Set `Console.OutputEncoding = System.Text.Encoding.UTF8;` at the top of `Main` (guarded for a redirected handle), or restrict the CLI's own strings to ASCII.

### `Program.cs:54` — defensive-fallback (group 9.3)

**Claim.** `?? Vendors.Codesys` silently guesses the vendor when neither `--vendor` nor a config vendor is present — and `Config.ConfiguredVendor` itself swallows every exception to null, so a MALFORMED config also lands on CODESYS rather than on `LoadConfig`'s explicit "config.json is malformed — re-run `volt init`". On a TwinCAT-only machine a bare `volt init` therefore fails with "no CODESYS bridge is running", naming a vendor the user never chose (Conventions §1).

**Fix.** For `init` with no `--vendor` and no binding, refuse with a message naming the choice ("pass --vendor codesys|twincat") instead of defaulting; and let `ConfiguredVendor` propagate the malformed-config error rather than catching it into the same silent default.

### `Git.cs:132` — bug (group 9.2)

**Claim.** Every path-emitting git invocation in this file runs with git's DEFAULT core.quotePath=true, so any path containing a non-ASCII byte comes back C-quoted and octal-escaped — and all four parsers here (ListTree, ParseDiffRows, UnmergedPaths, DirtySrc) treat that quoted token as a literal path. Verified in this environment; it corrupts the volt/ide tree on pull and silently EMPTIES the item on push.

**Fix.** One place: prepend `"-c", "core.quotePath=false"` to psi.ArgumentList in Run() (Git.cs:61) so every git child emits raw UTF-8 paths. That covers ls-tree, diff --name-status, diff --name-only and status --porcelain at once, and leaves StreamPath's leading-quote branch for the genuinely-quoted (embedded quote/newline) case it was written for.

### `Commands.cs:354` — defensive-fallback (group 9.2)

**Claim.** HeadSrc turns "the blob I asked for was not in the batch" into an EMPTY source body and pushes it. This is the Convention-1 defensive default in its most expensive form: the masked upstream bug (a missing spec) is converted into deleting the engineer's code in the live PLC, with no error and no log line.

**Fix.** Drop the `: ""`. Throw a coded failure naming the spec — `blobs.TryGetValue(k, out var b) ? Encoding.UTF8.GetString(b) : throw new InvalidOperationException($"{k} missing at HEAD")` — so the push fails loud instead of clearing the item. (ReadBlobsBatch may keep omitting misses; the caller is what must refuse.)

### `Git.cs:228` — bug (group 9.2)

**Claim.** AutoCommitSrc is documented and named as src-only, but `git commit` is run with NO pathspec, so it commits the entire index — sweeping the engineer's already-staged files from anywhere in the workspace into a commit titled "volt: N working change(s)", where N counted only src/. This is the same over-broad-save shape as the known TwinCAT File.SaveAll issue, but on the git side and not yet recorded anywhere.

**Fix.** Add the pathspec to the commit: `Run(new[] { "-C", root, "commit", "-q", "-m", msg, "--", "src" })`. `git commit -- <paths>` commits HEAD plus those paths only and leaves the rest of the index staged, which is exactly the documented contract.

### `Git.cs:116` — bug (group 9.2)

**Claim.** The fast-import throwaway ref is a FIXED name deleted only in a `finally` that sits after the import. If the process dies between the import and the cleanup (Ctrl-C, crash, reboot), the stale ref permanently breaks every later `volt pull` and `volt init` in that repo — fast-import refuses the non-fast-forward ref update and exits 1, so Run throws, so the finally that would have cleaned it up is never reached again. Nothing in Volt recovers; the user must run `git update-ref -d` by hand.

**Fix.** Delete the ref before the import instead of only after: insert `Run(new[]{"--git-dir", gitDir, "update-ref", "-d", tmpRef}, allowFail: true);` immediately before Git.cs:116 (keeping the finally). Passing `--force` to fast-import also clears the symptom but hides a leftover rather than removing it.

### `Git.cs:417` — bug (group 9.2)

**Claim.** MergeContinue and GitMerge stamp the ENGINEER's own merge commits — on the engineer's own branch — with the synthetic IDE identity and a 1970 epoch. The class doc's justification for DetEnv ("IDE commits use a FIXED author/committer + epoch so the same IDE state yields the same SHA") does not apply to a merge commit whose first parent is the user's non-deterministic HEAD, and it directly contradicts AutoCommitSrc's stated rule for the same class of commit. No test asserts this identity, so nothing is protecting it.

**Fix.** Drop `env: DetEnv` from both Git.cs:417 and Git.cs:429 so the merge the engineer resolved is authored by the engineer, at the real time. DetEnv stays where its rationale holds: CommitTree (Git.cs:176), which builds refs/remotes/volt/ide.

### `Git.cs:243` — defensive-fallback (group 9.2)

**Claim.** DiscardSrc swallows the failure of the one step that actually restores tracked files, then still returns dirty.Count as "how many paths were discarded". A locked/failed checkout therefore reports "discarded N local change(s); workspace now matches the IDE" while the changes are still there — precisely the silent-no-op failure the method's own doc says it was added to fix.

**Fix.** allowFail is there only for the "src/ has no tracked files at HEAD" pathspec error. Make that case explicit and let every other failure throw: `if (Run(new[]{"-C",root,"ls-files","--","src"}).StdOut.Trim().Length > 0) Run(new[]{"-C",root,"checkout","--","src"});` — no allowFail.

### `Git.cs:253` — defensive-fallback (group 9.2)

**Claim.** CommitAll conflates "nothing to commit" with "the commit failed" behind one allowFail, and its single production caller then discards the boolean entirely — so a commit that failed for a real reason (no user.identity configured, a rejecting pre-commit hook) leaves `volt init` continuing against a repo with no HEAD, silently producing a volt/ide tree with no scaffold in it.

**Fix.** Distinguish the two: keep allowFail but treat only git's "nothing to commit" exit (1 with an empty `git status --porcelain`) as false, and rethrow the GitError otherwise. Then have Commands.Init check the result — `if (gitCreated && !Git.CommitAll(...)) return InitResult.Error(...)` — instead of discarding it.

### `Git.cs:341` — defensive-fallback (group 9.2)

**Claim.** DiffWorktree — a pure read used by `volt status`, `volt push`'s pre-check and UnpushedCount — CREATES a directory inside the user's workspace as a side effect, and never removes it. The write exists only to stop `git add -- src` from erroring on a pathspec that matches nothing; it fixes a git-invocation problem by mutating the engineer's tree.

**Fix.** Drop the CreateDirectory and let git handle the empty case: `Run(new[] { "-C", root, "add", "-A", "--", pathspec }, env: env, allowFail: true)` — an add whose pathspec matches nothing is exactly the no-op the comment wants, without writing to the workspace.

### `Commands.cs:283` — bug (group 9.1)

**Claim.** Pull feeds the fetch's `Removed` list (item NAMES) into a parameter that is matched against src-relative PATHS, so an item the engineer deletes in the IDE is never dropped from volt/ide unless it sits in the project ROOT folder — the workspace file survives the pull forever.

**Fix.** Map names→paths at the call site before passing them: resolve each removed name through the sidecar's Folders map (`sidecar.Folders`) to `folder.Length > 0 ? folder + "/" + name : name`, or change BuildVoltIdeTree to compare `Extensions.FullNameFromPath(rel)` against the name set. Either way, add an IdeTreeTests case with the removed item in a SUBFOLDER — the existing `Removed_items_are_dropped_from_the_new_tree` uses "B.fb" at the root, which is exactly the one case that passes today.

### `Commands.cs:333` — bug (group 9.1)

**Claim.** `volt push --dry-run` mutates the user's git history: it auto-commits the whole working tree before the dry-run branch returns, so a command advertised as a preview leaves a `volt: N working change(s)` commit behind. Pull's dry-run deliberately returns BEFORE its auto-commit.

**Fix.** Hoist the dry-run preview above the commit: compute `rows` for the dry-run from `Git.DiffWorktree(root, IdeTree.Range, "src")` (which already backs the `foreign` guard and StatusModel's outgoing set) and return before `AutoCommitSrc`. If the commit is genuinely required to preview accurately, say so in the docstring and in the returned message instead of leaving it silent.

### `Commands.cs:389` — bug (group 9.1)

**Claim.** A renamed item whose old name has no baseline version throws a raw `InvalidOperationException` out of `Push` instead of returning `PushResult.Rejected` — under `--json` that produces an empty stdout and exit 1, which is precisely the two-carriers-one-refusal split the file's own header comment claims was unified.

**Fix.** Replace the throw with `return PushResult.Rejected($"renamed item '{o.Value.Name}' has no known IDE version — run `volt pull` first");`. The surrounding `foreach` is a plain loop in the method body, so an early return is legal there.

### `Commands.cs:432` — defensive-fallback (group 9.1)

**Claim.** An accepted push writes the sidecar through three null-forgiving `!` operators on wire fields the DTO explicitly documents as nullable/additive; a bridge that accepts without `newFolders` writes `"folders": null` into ide-refs.json, and every later command then throws "malformed" until the file is deleted by hand.

**Fix.** Guard before persisting (Conventions 1/2 — an annotation is not enforcement): if any of NewProjectVersion/NewItems/NewFolders is null on an accepted response, return `PushResult.Rejected("the bridge accepted the push but returned no post-apply state — run `volt pull`")` instead of `!`-suppressing and writing a sidecar that can never be loaded again.

### `Commands.cs:146` — bug (group 9.1)

**Claim.** `Status` computes the project mismatch from a health response even when nothing is being served, so a reachable-but-idle bridge (no project attached, or paused by `disconnect`) reports `projectMismatch { bridgeReports: { projectName: "" } }` and the summary "project mismatch — open the bound project in the IDE" instead of an offline/idle state.

**Fix.** Only compute the mismatch when the bridge is serving: `var mismatch = online && cfg is not null ? Config.ProjectMismatch(cfg, health) : null;`. An unattached bridge is an offline/idle state, not a mismatch — and "bridgeReports.projectName = ''" is not a fact worth putting on the --json contract.

### `Commands.cs:525` — bug (group 9.1)

**Claim.** `volt merge --resolve <path>` with NEITHER side flag silently resolves the file by taking OURS, and the `useOurs` parameter is never read — a defensive default that discards one side of a conflict without being asked (Conventions 1), plus a dead parameter the compiler cannot warn about.

**Fix.** Read the parameter and refuse when neither is given: `if (!useOurs && !useTheirs) return (1, "merge --resolve needs --use-ours or --use-theirs");` then `var side = useTheirs ? "theirs" : "ours";`. Also refuse when BOTH are set rather than silently preferring theirs.

### `Commands.cs:478` — defensive-fallback (group 9.1)

**Claim.** `UnpushedCount` swallows every exception and answers 0, so a real git failure is reported to the user as "you have nothing unpushed" — the note that exists to stop them building the wrong code just disappears (Conventions 1/4).

**Fix.** Narrow the catch to the one expected condition — not a repo / no baseline — which the two lines above already handle explicitly, and let a GitError propagate to Program's handler. At minimum log it through VoltLog rather than returning a number the caller cannot distinguish from the truth.

### `Commands.cs:377` — bug (group 9.1)

**Claim.** Push silently skips tracked-but-unpushable paths (the `.gitkeep` folder markers it materializes itself), so a locally deleted or added folder marker leaves the workspace permanently "1 outgoing" while every push answers "nothing to push" — a stuck state with no way out from the CLI.

**Fix.** Make the skip visible: collect the skipped-but-tracked paths and, when `ops.Count == 0` while such paths exist, return `PushResult.Rejected` naming them ("folder-only changes can't be pushed — <paths>") instead of asserting the IDE already matches. Alternatively exclude folder markers from StatusModel's outgoing set so the two verbs agree.

### `Commands.cs:371` — bug (group 9.1)

**Claim.** When git reports a move as delete+add rather than a rename (content changed past the 50% similarity threshold), Push emits a `DeleteItemOp` and a `SetItemOp` for the SAME item name in one batch, ordered by git's path sort — if the new path sorts first the delete runs last and the item ends up deleted in the IDE.

**Fix.** Reconcile per name before sending: if a batch contains a DeleteItemOp and a SetItemOp for the same `Name`, collapse them into the single SetItemOp (with `ToFolder` set from the new path) — that is exactly the rename/move op the wire already models. Failing that, sort deletes before sets so the surviving state is the added file, never the deleted one.


---

## BATCH 11 ESCALATIONS — `Volt.Cli.Connector.Core` (2026-08-06)

47 findings, 12 behaviour-changing. **Two of them were then MEASURED**, because unlike the drivers this project
IS reachable from a test and `wantedFile` is injectable. A new `ConnectionManagerRestoreTests` pins the path the
auditor found had zero coverage:

| traced finding | measurement |
|---|---|
| an EMPTY sync disarms the startup grace hold | **CONFIRMED — test fails** |
| the first reconcile DESTROYS the restored edge (truncates `wanted.json`) | **NOT reproduced — test passes**; the id survives on disk in this scenario |

That is the third time in this programme an audit trace over-reached where measurement did not follow. The
confirmed half is fixed red-first in its own commit; the unreproduced half stays here as a claim, not a defect.

### `ConnectionManager.cs:280` — bug (group 11.1)

**Claim.** The restored desired-set is destroyed by the very first reconcile, so a HELD disconnect can never fire afterwards and the on-disk `wanted.json` is truncated before any client re-declares — reinstating the exact 2026-07-28 stranded-bridge incident the restore exists to prevent. The comment claiming otherwise is false.

**Fix.** When a disconnect is held, keep the held ids in the plan's desired set so the leave-edge survives to the next pass: `plan = plan with { ToUnbind = …, Wanted = plan.Wanted.Concat(held.Select(p => p.Id)).ToHashSet(StringComparer.Ordinal) }`. That also stops the persisted file being rewritten to `[]` during the grace window (SaveWanted then sees an unchanged set). Trace of the current code: ctor sets `Wanted = {A}` (restored) and `_restored = {A}`; the first tray tick calls Plan with `previouslyWanted={A}`, no sessions → `wanted={}`, `toUnbind=[A]`; the hold strips A from ToUnbind, then line 280 writes `[]` to disk and line 281 sets `Wanted={}`. On every later pass `previouslyWanted` is `{}`, so `lost` is empty and A is never in `toUnbind` again — A serves forever with no client, and a second restart inside the window has no edge to restore either.

### `ConnectionManager.cs:136` — bug (group 11.1)

**Claim.** The startup grace hold is disarmed by ANY sync, including a sync that declares NOTHING — so the first client to poll (which in practice declares an empty interest set) cancels the protection for every other client that has not re-declared yet.

**Fix.** Only treat a NON-EMPTY declaration as "the clients are back", and remove only what that client declared: `if (interests.Count > 0) foreach (var i in interests) _restored.Remove(...)` (or simply `if (interests.Count > 0) _restored = new HashSet<string>(...)`). Live path that breaks it today: `volt-desktop/src/main.ts:127 void startConnectorFeed()` and `volt-vscode/src/extension.ts:60 void startConnectorFeed()` both start the feed BEFORE any workspace has declared (`restoreWorkspace()` / `addWorkspace` race it), and `volt-control/src/bridge/session.ts` syncs unconditionally — `body: JSON.stringify({ interests: uniqueInterests() })` with an empty array. The connector sees "a client spoke", clears `_restored`, and the next reconcile gates the restored project immediately, which is precisely what the 20s window was added to prevent.

### `ConnectionManagerTests.cs:62` — bug (group 11.1)

**Claim.** This suite's helper still constructs a ConnectionManager with the DEFAULT wanted file, so the unit tests read AND overwrite the developer's real `%LOCALAPPDATA%\Volt\wanted.json` with `[]` — destroying the live connector's restore edge on every test run. The sibling file was fixed for exactly this hazard; this one was missed.

**Fix.** Give this helper the same temp path the sibling suite uses: `new(sources, wantedFile: TempWanted())` (hoist `TempWanted()` out of `ConnectionManagerSessionTests` into a shared helper). Every `RefreshAsync()` in this file runs `CycleCoreAsync`, and with no sessions `plan.Wanted` is empty while `_state.Wanted` is whatever the machine's real file held, so line 280 fires `SaveWanted(<real file>, [])`. The recorded intent is explicit: `openspec/changes/archive/2026-08-06-fix-connector-session-gate/tasks.md:2.2` — "`wantedFile` at a temp path — load-bearing, not hygiene".

### `ControlServer.cs:148` — defensive-fallback (group 11.2)

**Claim.** An unparseable or malformed `/session/{id}/sync` body is silently downgraded to "this client declares nothing", which makes the reconciler GATE every project that client was holding. A parse failure must not be indistinguishable from a deliberate empty declaration.

**Fix.** Distinguish the three cases: no/blank body → empty set (a legitimate "I want nothing"); malformed JSON → `WriteJson(ctx, 400, …)` and do not call `_sync`; an interest missing vendor/projectName → 400 rather than a silent `.Where` drop. The empty-set path is already pinned by `Sync_with_an_empty_set_declares_no_interests`, so only the failure path changes.

### `ControlServer.cs:106` — bug (group 11.2)

**Claim.** If `EndGetContext` throws while the server is still running, the accept loop is never re-armed — the control plane stops accepting connections permanently, with no log line. Every client then renders "Volt Connector not running" until the tray is restarted.

**Fix.** In the `EndGetContext` catch, when `_running` is still true, log the exception and re-arm (`try { _listener.BeginGetContext(OnContext, null); } catch { }`) before returning. The `!_running` early-return already covers the Dispose path, so this catch is by construction the still-running case.

### `BridgeSupervisor.cs:42` — bug (group 11.3)

**Claim.** BridgeSupervisor has no disposed guard, so a spawn that lands after Dispose() creates exactly the un-jobbed orphan worker the KILL_ON_JOB_CLOSE guard exists to prevent — and the tray's mitigating comment ("Stop the timer FIRST so it can't respawn a worker we're about to kill") does not cover an already-in-flight async tick.

**Fix.** Add `private bool _disposed;` set under `_gate` in Dispose(), and make EnsureWorker `if (_disposed) return;` as its first statement inside the lock. Then a tick that resumes after ApplyUpdate's Dispose() spawns nothing, and Environment.Exit(0) cannot strand a worker outside the job.

### `BridgeSupervisor.cs:76` — bug (group 11.3)

**Claim.** The worker's captured stdout/stderr is logged under the worker ID (`twincat.<pid>`), but VoltLog treats its `source` argument as the log FILENAME key while pruning only the calling process's own source prefix — so every XAE pid mints a permanent `twincat.<pid>-<date>.log` series that nothing ever prunes, and the worker's story is split across two files.

**Fix.** Pass the vendor tag as the log source and keep the worker id in the line text: `VoltLog.Raw(Vendors.Twincat, ...)` is wrong here too (BridgeSupervisor is vendor-neutral), so give WorkerSpec a `LogSource` (the vendor) alongside `Id` and call `VoltLog.Raw(w.LogSource, $"[{w.Id}] {e.Data}")`. The worker's own `twincat-<date>.log` then absorbs the capture and the existing 14-day prune covers it.

### `DetectedProject.cs:24` — defensive-fallback (group 11.3)

**Claim.** `Pipe` is required by every production path yet declared optional with a null default purely so unit fixtures can omit it — and both consumers respond to null by silently doing nothing, which is the Conventions #1 shape: a bind that reports success without binding, and a reconcile that invents a fake host key.

**Fix.** Make `Pipe` a required positional `string Pipe` (no default) and have the one test helper pass a synthetic pipe name. The `?? p.Id` in Reconciler and the silent-return in PerPipeProjectSource.BindAsync then go away; a genuinely absent pipe becomes a coded failure instead of a bind that quietly no-ops. Same argument applies to `Status = HealthStatus.Idle` (line 27), which no caller ever takes.

### `TwincatFleet.cs:31` — bug (group 11.3)

**Claim.** `Tick` keeps mutable reconcile state (`TwincatSupervisor._workers` miss counters, `BridgeSupervisor._workers`) but has no re-entrancy guard, while its caller is a WinForms timer that does not serialize overlapping async handlers — two overlapping Ticks double-count misses and can reap a healthy worker after ~2 intervals instead of 3.

**Fix.** Guard Tick with a single in-flight flag: `if (Interlocked.Exchange(ref _ticking, 1) == 1) return;` with a `try/finally { Volatile.Write(ref _ticking, 0); }`. The clock stays the tray's; the fleet enforces that only one pass is ever in flight — which is what "every decision about which workers exist is here" already implies.

### `BridgeSupervisor.cs:44` — defensive-fallback (group 11.3)

**Claim.** A missing worker binary returns silently with no log line, so "TwinCAT never gets a bridge because the exe isn't where the connector looked" is invisible in the durable log — while the two other failure modes in the same method both log. The test that pins this behaviour only asserts it does not throw, which a log line does not violate.

**Fix.** Log once per id before returning (a `HashSet<string> _warnedMissing` under `_gate` keeps the 12s reconcile from spamming): `VoltLog.Warn($"worker {w.Id}: binary not found at {w.Exe} — no bridge for this IDE");`. The test keeps passing.


---

## BATCH 10 ESCALATIONS — `Volt.Cli` support (2026-08-06)

30 findings, **21 behaviour-changing** — the highest ratio of any batch. This slice is mostly real defects
rather than cleanups, which is why only 5 were applied.

**`IdeTree`'s name-vs-path bug is now CONFIRMED TWICE, independently.** Batch 9's auditor found it reading the
CALLER (`Commands.Pull` passes `fetched.Removed`); batch 10's found it reading the CALLEE (`BuildVoltIdeTree`
compares against `rel`). Neither saw the other's report. Two auditors, different evidence, same defect — an item
deleted in the IDE never leaves `volt/ide` unless it sits in the project ROOT.

### `IdeTree.cs:50` — bug (group 10.2)

**Claim.** BuildVoltIdeTree matches the IDE's REMOVED set (item NAMES) against src-relative PATHS, so an item deleted (or moved) inside a folder is never dropped from the volt/ide tree — the protocol identity is the name, but this comparison is path-keyed.

**Fix.** Compare by item name, not path, for the parent-tree carry: `var name = Extensions.FullNameFromPath(rel); if (rel is not null && Extensions.IsTrackedPath(rel) && !replaced.Contains(rel) && name is not null && !removed.Contains(name) && !replacedNames.Contains(name))`, where `replacedNames` is `ideFiles.Select(f => Extensions.FullNameFromPath(f.Path))`. Add an IdeTreeTests case with a NESTED removed item and a moved item — the existing test `Removed_items_are_dropped_from_the_new_tree` only uses root-level `"B.fb"`, which is why this is green.

### `Materialize.cs:16` — defensive-fallback (group 10.2)

**Claim.** `item.Folder ?? ""` silently materializes an item with a missing folder at the src root — indistinguishable from a legitimately root-level item. This is exactly the defect ARCHITECTURE Conventions §1 records being fixed in Hasher.ComputeItemVersion ("no longer defaults a missing folder to \"\", because that hashed identically to a legitimately empty folder").

**Fix.** Fail loud like FetchService does: `var folder = item.Folder ?? throw new InvalidOperationException($"bridge returned item \"{item.Name}\" with no folder");`. A null folder is a bridge bug; writing the file at the root buries it and strands the item at a path the IDE will never match.

### `Sidecar.cs:28` — bug (group 10.2)

**Claim.** The comment claims the guard catches "missing fields", but every property has an initializer, so System.Text.Json leaves the default when a field is ABSENT — the guard only ever fires on an explicit JSON `null`. A sidecar missing `items` loads as an EMPTY baseline and pull then reports the whole project as incoming while push loses every ifVersion guard.

**Fix.** Make absence detectable instead of documenting a guard that can't fire: drop the initializers (`public Dictionary<string,string> Items { get; set; } = null!;` or make them `required`) so a missing field deserializes to null and the existing guard actually catches it — or annotate with `[JsonRequired]`. Either way the comment and the code must agree.

### `Sidecar.cs:58` — defensive-fallback (group 10.2)

**Claim.** LoadPendingIdeRefs' comment says a corrupt/partial stash is treated as "no stash", but unparseable JSON throws out of Deserialize (never reaching the return) and a partial one passes the same non-firing guard as above. What the null-return actually buys is a SILENT failure: `volt merge --continue` reports "merge completed" and leaves the IDE baseline stale.

**Fix.** Share one validated load with LoadIdeRefs and let it throw (Conventions §1: fail loud with a message naming the file), or — if the stash really is optional — keep returning null but log the reason through VoltLog and say so in the `merge --continue` message, so "baseline not advanced" is visible rather than inferred from a missing suffix.

### `Files.cs:12` — bug (group 10.2)

**Claim.** StripSrcPrefix silently returns a non-src path unchanged, and StatusModel feeds it `Git.UnmergedPaths`, which is NOT pathspec-scoped to src — so a conflict outside src/ is reported as if it were a src item, and `volt merge --resolve` then targets the wrong path.

**Fix.** Scope the query: `Run(new[] { "-C", root, "diff", "--name-only", "--diff-filter=U", "--", "src" })`, matching DirtySrc/StageSrc/StructuralConflictFiles. (ConflictMarkerFiles and StructuralConflictFiles are already src-scoped, so this is also the odd one out.)

### `Scaffold.cs:32` — legacy (group 10.2)

**Claim.** The scaffolded `.vscode/settings.json` is inert in both worlds: with volt-vscode installed the six source extensions are already bound to the `structured-text` language by the manifest, and without it `structured-text` is not a registered language id at all, so the association resolves to nothing.

**Fix.** Drop the file from the scaffold (and the `files` tuple array collapses to just the README). If the intent is really "colour ST without the extension", the association must point at a language id that exists without volt-vscode — which is the extension's job, not init's.

### `IdeTree.cs:38` — bug (group 10.1)

**Claim.** `removedNames` are bare wire item NAMES but are matched against src-relative PATHS, so an item deleted in the IDE inside any folder is never dropped from the volt/ide tree — `volt pull` silently leaves it in the workspace forever.

**Fix.** Compare on the file-name segment, not the whole path: hoist `var baseName = rel.Substring(rel.LastIndexOf('/') + 1);` and test `!removed.Contains(baseName)`. (Equivalently, resolve each removed name to its path via the sidecar's Folders map before building the set.) Rename the parameter or the local so the name/path distinction is visible at the comparison site.

### `BridgeResolver.cs:28` — bug (group 10.1)

**Claim.** `Resolve` reads the workspace config eagerly, and `Program` evaluates `Bridge()` as a call ARGUMENT — so in an uninitialized workspace every command dies with a raw `FileNotFoundException`/`GitError` before its own "not a Volt workspace" refusal can run. All four of those refusals are unreachable in production (they only fire under VOLT_PIPE, which is how every test drives the CLI).

**Fix.** Guard in `Resolve` before touching the config: `if (!isInit && !Config.ConfigExists(root)) throw new BridgeError(BridgeErrorCodes.PlcDisconnected, "not a Volt workspace — run `volt init` first");` so the one refusal message reaches the user on every path, and add a black-box test that runs a verb WITHOUT VOLT_PIPE in a bare repo.

### `BridgeClient.cs:65` — legacy (group 10.1)

**Claim.** `GuardEmptyItems` re-answers "is an IDE attached" from the THROTTLED health cache after the op already answered it from LIVE driver state — the exact pattern Conventions #3 forbids. Since refs/fetch/init all run `OpGuard.RequireBoundProject` first, an empty body can only come back from a genuinely connected bridge, so the only state this guard can now fire in is a false positive: a live bridge with a legitimately empty project and a stale health row.

**Fix.** Delete `GuardEmptyItems` and its three call sites; the in-op OpGuard is the single live answer. This changes a pinned test (`Pull_refuses_when_the_bridge_walks_zero_items_it_cannot_confirm`), so escalate rather than edit it — the test's premise, not the code, is what Conventions #3 contradicts. If the refusal is still wanted, it must be decided by the bridge inside the op, not by the client off the cache.

### `StatusModel.cs:40` — bug (group 10.1)

**Claim.** `Git.ResolveGitDir` is called before the `initialized` check, so `volt status` in a directory that is not a git repo throws a raw git error instead of reporting `initialized:false` / "not initialized" — the summary branch that exists for exactly this case is unreachable there. `Config.ConfigExists` guards the same situation two lines later.

**Fix.** Compute `initialized` first and return the not-initialized StatusData before resolving the git dir (or resolve it lazily inside the `IdeTree.VoltIdeHead` / merging blocks, which are the only consumers).

### `StatusModel.cs:44` — bug (group 10.1)

**Claim.** When the bridge is offline, `Incoming` is substituted with an empty set and nothing records that it was never computed — so `status --json` is byte-indistinguishable from "in sync", and volt-control replaces its cached incoming list with the empty one. That is the precise failure `IncomingStale` was introduced to prevent, but the flag is only set for `--local`.

**Fix.** Set `IncomingStale = true` inside `BuildStatusData` on the same condition that skips the computation (`!(snap.Online && snap.ProjectMismatch is null)`), and have `CountSummary` not return "in sync with the IDE" when incoming was never computed. Then `Commands.Status`'s separate `data.IncomingStale = localOnly && ...` line becomes a second answer to the same question and should OR into it rather than overwrite it.

### `StatusModel.cs:69` — bug (group 10.1)

**Claim.** The path for an incoming-REMOVED item is looked up in the LIVE folder map, which by definition no longer contains it — so every deleted item falls back to a bare name and volt-control gets `"B.fb"` instead of `"POUs/B.fb"`. The baseline folder map that does hold it is already loaded five lines above.

**Fix.** Fall back to the baseline before defaulting to empty: `var folder = snap.Folders.TryGetValue(name, out var fo) ? fo : (sidecar?.Folders.TryGetValue(name, out var bo) == true ? bo : "");`

### `Config.cs:87` — defensive-fallback (group 10.1)

**Claim.** `ConfiguredVendor` swallows every exception, so a malformed `config.json` — the case `LoadConfig` deliberately fails loud on — is turned into `null` and `Program` silently defaults to CODESYS. A TwinCAT workspace with a corrupt binding then reports "no CODESYS bridge is running" instead of "config.json is malformed".

**Fix.** Narrow the catch to "no workspace yet" — return null only when `!Config.ConfigExists(root)` and let a malformed config propagate: `if (!ConfigExists(root)) return null; return LoadConfig(root).Bridge.Vendor;`

### `BridgeResolver.cs:68` — defensive-fallback (group 10.1)

**Claim.** `DisplayOf` maps every vendor that is not exactly "twincat" to "CODESYS", so a typo'd or unknown `--vendor`/binding produces a refusal naming the wrong IDE ("no CODESYS bridge is running — open the project in CODESYS") while discovery actually searched `volt.bridge.<typo>.` and could never match.

**Fix.** Make it a total map over the two known ids and fail loud otherwise: `codesys => CodesysDisplay, twincat => TwincatDisplay, _ => throw new BridgeError(BridgeErrorCodes.BadRequest, $"unknown vendor '{vendor}' — expected {Vendors.Codesys} or {Vendors.Twincat}")`.

### `StatusModel.cs:54` — bug (group 10.1)

**Claim.** `Place` keys `pathByName` by item name, so a rename that only moves an item between folders (same name) overwrites the removed side's path with the added side's — `volt status --porcelain` then prints the NEW path for both the `oD` and the `oA` row.

**Fix.** Don't overwrite an existing entry for the removed side: `if (!pathByName.ContainsKey(name)) pathByName[name] = path;` when placing into `Removed`, or key the removed row by its old path. (A folder move genuinely produces one name in two buckets; the map can only hold one path for it.)

