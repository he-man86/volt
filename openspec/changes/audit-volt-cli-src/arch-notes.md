# Architectural notes — observed during the audit, deliberately NOT implemented

Everything here is behavior-changing or structural, and therefore out of scope for this change by construction
(see `design.md`). Each note carries enough evidence to start its own proposal: what was seen, where, why it
matters, and what it would cost.

Nothing in this file is a commitment. A note that stays unwritten-up is a note that wasn't worth it.

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
