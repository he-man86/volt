## 1. Bug 1 — a read-only graphical child was flattened on push (DONE)

- [x] 1.1 Red first: `test/Volt.Engine.Tests/sync/GraphicalChildGuardTests.cs` — 7 tests covering the marker
      round-trip, real text over a CFC/SFC child, text over an FBD/LD child, and a control that an ordinary textual
      child still pushes. **6 of 7 failed before the fix, with "no exception was thrown"** — i.e. the push silently
      succeeded and overwrote the body. That is the data loss, captured offline.
- [x] 1.2 `Materializer.IsGraphicalBodyMarker`, derived from the same literal `GraphicalBodyMarker` writes so reader
      and writer cannot drift.
- [x] 1.3 `PushService.RequireChildFormatWritable` — the child-level counterpart of the root guard, deciding from the
      live `BodyLanguage` and mirroring its three cases. Scoped to method/action children: an interface member has no
      body of its own (reading one crashes TwinCAT) and a PROPERTY node's body lives in its GET/SET accessors.
- [x] 1.4 Run it as a **pre-pass over all children before any write**, so a refusal is atomic. (Found while fixing:
      validating inside the apply loop left the root body already written when a child was refused.)
- [x] 1.5 Gate: build 0 errors · **324**/324 (317 + 7) · 116/116 · 76/76 · live CODESYS e2e **92 pass / 0 fail**.

> Two test-authoring facts worth keeping, both cost a cycle: a `SetItemOp` with `IfVersion == null` means **create**,
> so pushing an existing item that way yields a conflict and never applies — read the real version from
> `RefsService` first. And `FakeIde` items carry **bare** names; the extension comes from the kind during
> materialization, and ops are bare-keyed internally.

## 2. Verify bug 1 on the other vendor

- [x] 2.1 **DONE 2026-08-06 — and the answer is that it does NOT prove the child guard.** The full TwinCAT e2e
      was run against a freshly built worker (`VOLT_TWINCAT_BRIDGE`): **90 pass / 11 skip / 0 fail**. But
      `graphical/roundtrip.test.ts`'s two guard cases (`refuses to overwrite a graphical body with textual ST`,
      `refuses a malformed graphical body`) both provision a **ROOT** body — `fid(name, "prg")`, a top-level
      PROGRAM with an FBD body. Bug 1 was the **CHILD** guard (`PushService.RequireChildFormatWritable`). No e2e
      case pushes textual ST at a graphical METHOD/ACTION child, so the live suite is silent on it.
      **Bug 1's child guard remains proven only against `FakeIde.BodyLang` — a model of the vendors' behaviour,
      not the behaviour.**
- [~] 2.2 **BLOCKED ON A HUMAN-AUTHORED FIXTURE — CARRIED FORWARD, see the close-out at the end, and here is exactly why.** The e2e provisions POU children as
      TEXT inside the parent's ST body (`fixtures.ts`'s `METHOD(...)`/`ACTION(...)` blocks). A CFC/SFC child
      cannot be authored that way — that it has no textual form is the entire premise of the guard. So the case
      needs a committed fixture containing a real CFC (or SFC) method child, created by hand in the IDE once.
      Until that exists the guard cannot be exercised live on either vendor.
      Suggested shape once the fixture lands: fetch the child, confirm its body carries the graphical marker,
      push textual ST at it, assert `accepted == false` with "graphical" in the conflict, then re-fetch and
      assert the body is byte-identical.

## 3. Bug 2 — a pushed item does not survive the IDE being killed — ROOT CAUSE FOUND 2026-07-30

**It is not a save failure. The content IS saved; the project REGISTRATION is not.** Evidence, straight off disk
after the failing `ide-restart` run:

- `test/TwinCAT Project14/TwinCAT Project14/Untitled2/POUs/VltE2E_restart_survives.TcPOU` — **exists**, 520 bytes.
- `Untitled2/Untitled2.plcproj` — **does not reference it**. The only file mentioning the item is the POU file itself.

So the pushed POU is an **orphan on disk**: its content was written, but the project that lists it never recorded it.
A reopened XAE therefore does not contain the item (`item '…' not in fetch`), and the stray file pollutes the
fixture — which is exactly the untracked `Untitled2/POUs/` directory that kept appearing in `git status`.

**Mechanism:** `FlushPendingWrites` calls `_dte.Solution.Save()` then `_dte.Documents.SaveAll()`.
In the VS DTE model `Solution.Save()` saves the **solution** file — that is the `TwinCAT Project14.tsproj` git keeps
showing as modified — and NOT the projects inside it. `Documents.SaveAll()` wrote the `.TcPOU`. **Nothing ever saved
the `.plcproj`.** The current code saves the two artifacts that don't matter for durability and misses the one that
does.

**This makes the fix and the §4 scoping the SAME change:** save the containing PLC **project**, instead of the whole
solution plus every open editor. It is both narrower (never touches the engineer's unrelated tabs) and *more*
correct (it persists the registration that was being lost).

### 3.0-VERIFIED (2026-08-06) — BUG 2 IS FIXED. `ide-restart` is 2 pass / 0 fail.

The `File.SaveAll` fix closed it. Run live against a single XAE (Project14), `VOLT_E2E_IDE_CHAOS=1`, **twice**:

```
bun test test/e2e/lifecycle/ide-restart.test.ts   ->   2 pass / 0 fail
```

That is task **3.6** ("`ide-restart` to 2 pass / 0 fail, assertions intact") — met, with the assertions
untouched. The test had been the standing known-red of this change and of
`openspec/changes/archive/2026-08-06-optimize-volt-cli-architecture`'s runbook.

**Task 3.0c is also met**: `git status --porcelain --untracked=all` shows **no `POUs/` directory** after a green
run. The orphan signature — a `.TcPOU` on disk that no `.plcproj` references, which used to appear as an
untracked dir after every run — is gone. The three modified files under `test/TwinCAT Project14/` are the IDE's
own saves of `.tsproj`/`.TcPOU`/`.tmc`, which is the expected fixture churn, not an orphan.

**Why it works, restated against §3's mechanism:** the orphan existed because nothing saved the `.plcproj` that
REGISTERS the item. `DTE.ExecuteCommand("File.SaveAll")` persists every dirty PROJECT as well as the documents
and the solution, so the registration lands and a reopened XAE contains the item.

**What is still open, and it is NOT durability:** §3.0's narrow form (save only the containing PLC project) and
§5's scoping. `File.SaveAll` is BROAD — it also commits the engineer's unrelated dirty tabs, which is a side
effect on data Volt does not own. That is the remaining task here, and it is now an ergonomics/scope refinement
rather than a data-loss fix. The `ponytail:` note in `TcObjectModel.FlushPendingWrites` still records it.

**§4 is answered.** "Does push need to save at all?" — yes. With a save that actually executes, the durability
assertion passes; the earlier "removing the save HANGS" experiment (§4.1) was run against a method that was
already a silent no-op, so it changed nothing observable and its hang had another cause. Do not re-run §4.1c on
that premise.

### 3.0-RESULT (2026-08-05) — the mechanism above is HALF right: `Solution.Save()` never ran at all

Live evidence, two XAEs, worker built from this tree. Every push failed with:

```
INTERNAL_ERROR: the IDE could not save the applied changes, so they are NOT committed to disk:
'System.__ComObject' does not contain a definition for 'Save'
```

**`EnvDTE`'s solution interface exposes `SaveAs`, not `Save`.** So `_dte.Solution.Save()` threw on every push
since it was written — and because it threw FIRST, `_dte.Documents.SaveAll()` **never ran either**.
`FlushPendingWrites` was a complete no-op under the old bare `catch { }`. Two things follow:

- The recorded "90 pass / 0 fail" TwinCAT baseline was achieved with **no save happening at all**, so it is not
  evidence that the save is needed. It is evidence the suite passes without one.
- §3's "`Documents.SaveAll()` wrote the `.TcPOU`" is wrong: SaveAll never executed. The `.TcPOU` on disk was
  written by the system manager itself. The orphan is therefore *not* a "saved the wrong artifacts" bug — it is
  "nothing was ever saved, and the system manager writes content but not registration".
- `838c4140e1` (fail loud) did exactly what its message promised: it turned the silent no-op into 63 red e2e
  tests. That commit is what made this findable.

**Fix applied:** `TcObjectModel.FlushPendingWrites` now calls `_dte.ExecuteCommand("File.SaveAll")` — the shell
command behind File > Save All. It exists, and it persists open documents, every dirty PROJECT (including the
`.plcproj`) and the solution, in one call. Failure stays loud.

**Result:** TwinCAT e2e **24 pass / 63 fail → 88 pass / 2 fail** (the 2 are unrelated suite-ordering coupling,
evidence in `openspec/changes/archive/2026-08-06-optimize-volt-cli-architecture/ledger.md`). Build + all three C# suites green.

Still open below: this is the BROAD save (§4/§5 scoping still applies — it commits the engineer's unrelated
dirty tabs), and `ide-restart`'s durability assertion has NOT been re-checked against it. Do that before
calling bug 2 closed.

- [~] 3.0 Narrow it: from `_dte`, resolve the PLC project we are bound to and call `Save()` on it (TwinCAT nests
      the PLC project inside the TwinCAT project, so `Solution.Projects` likely needs a walk into `ProjectItems` —
      confirm against the live model, do not infer it). Keep the failure loud.
- [~] 3.0b Red-first is possible WITHOUT an IDE for the ordering/選択 part only; the real proof is live, below.
- [x] 3.0c **DONE 2026-08-06** — no `POUs/` directory remains after a green run; the orphan signature is gone.

- [x] 3.1 DONE — that one observation is what cracked it: the file was on disk, so "never saved" was wrong and the
      registration was the missing piece.

### BUG 2 CLOSED — 2026-08-07

`ide-restart` is **2 pass / 0 fail**, confirmed on two consecutive runs (the TwinCAT notes require re-verifying
anything conclusive twice). It had been red for the whole programme and is still labelled "Known-failing, do not
treat as a regression" in `audit-volt-cli-src/RUNBOOK.md` — that line is now stale and is corrected there.

**No new code was needed.** The `File.SaveAll` fix recorded under 3.0-RESULT already fixed the durability gap;
it had simply never been re-checked against `ide-restart`, which is what §3's remaining items were for. So 3.2-3.5
are closed by the result rather than by separate work:

- 3.2 **Answered by inspection**: `PushService` calls `ide.FlushPendingWrites()` TWICE — once before the apply
  (so the pre-apply snapshot is accurate) and once after every op, before the receipt walk. Invoked, and after the
  child writes, exactly as `IIdeSession` documents.
- 3.3-3.5 **Moot**: the candidate causes in 3.4 were all downstream of "SaveAll never executed at all", which
  3.0-RESULT established and fixed. There is no residual failure left to diagnose.

**The first two attempts at this run FAILED, and neither failure was the product** — recording it because it cost
the most time in this change:

1. A `TcXaeShell` that has been open for hours stops answering the COM ROT enumeration. The connector's
   `--list-xae-pids` probe then hangs, exits non-zero, and — correctly, per its documented partial-probe policy —
   spawns NO worker at all. Symptom: no `volt.bridge.twincat.*` pipe and a growing pile of hung probe processes
   that look like stale workers but are not. Fix: restart the XAE.
2. Running the test against a bridge that has attached but not yet BOUND a project fails instantly on
   `expect(await serving()).toBe(true)`. The log line to look for is `attached to TwinCAT … — no project selected`.

Both are environment. The duplicate workers I chased were caused by my own manual `--xae-pid` spawns racing the
supervisor; left alone, the connector reaps and respawns correctly across the test's kill/reopen (verified: the
fleet self-healed to exactly one XAE / one worker / one pipe between the two runs).

- [x] 3.2 Check the push path's `FlushPendingWrites` call: is it invoked at all, and is it invoked AFTER the child
      writes rather than before? (`IIdeSession` documents "after applying a push".)
- [x] 3.3 Read `%LOCALAPPDATA%\Volt\logs\twincat-*.log` across a push + kill + reopen. With the health probe no
      longer swallowing failures (`fix-connected-precondition`), a failing save should now be visible.
- [x] 3.4 Candidate causes, in order: SaveAll not invoked / invoked too early; SaveAll saves the PLC project but not
      the item's containing artifact; the reopened XAE loads a cached copy; the kill races the save.
- [x] 3.5 Fix, with a red-first test. Prefer a unit-level test on the call ORDER if the cause is ordering — that is
      cheap and does not need an IDE.
- [x] 3.6 **DONE 2026-08-06 — `ide-restart` is 2 pass / 0 fail**, assertions untouched, verified twice. See
      3.0-VERIFIED above.

## 4. Does push need to save AT ALL? (decision REOPENED 2026-07-30 on new evidence)

The §3 finding changes the premise of the earlier "scope the save" decision, so it is reopened deliberately rather
than carried forward.

**What the save actually achieves today: inconsistency, not durability.** With no save, killing the IDE discards
both the tree change and the file — the item never existed. Consistent (work lost, nothing corrupted). With the
current save we get a `.TcPOU` on disk that no `.plcproj` references: an orphan, and a name-shadowing hazard in a
product whose identity IS the item name. So the save is not buying durability; it is manufacturing a broken state.

**The only surviving argument for saving** is the sequencing claim in `FlushPendingWrites`'s own comment: tree ops
(create/delete/rename) change structure on disk, so persisting avoids "a later rename colliding with stale files
from async tree deletions". That is an empirical claim about TwinCAT, and it is the whole decision. Note the
`ide-restart` durability assertion CANNOT be used as evidence for it — that test encodes the same unproven
assumption.

### 4.1 RESULT (2026-07-30): removing the save is NOT free — it HANGS

Ran it: TwinCAT `FlushPendingWrites` made a no-op, worker rebuilt, live TC e2e suite. The suite **hung** (>580 s
against a 191 s baseline) and had to be killed. Observed live: it gets stuck on a **property GET** operation.

So the sequencing claim is NOT stale — something in the property-accessor path depends on the save having happened.
That kills the "delete it, zero logic" option, which was the preferred one. The narrow save (save the containing
PLC project, which is also what fixes the orphan) is now the leading candidate, but it must be re-tested against
this hang, not just against the durability assertion.

> **§4.1's premise is now suspect (2026-08-05).** That experiment made `FlushPendingWrites` a no-op and saw a
> hang — but per 3.0-RESULT the method was *already* a no-op, because `Solution.Save()` threw before
> `Documents.SaveAll()` could run. If §4.1 predates `838c4140e1`, it changed nothing observable and the hang had
> another cause (TcXaeShell instability is a live candidate — a fixture's shell closed and reopened by itself
> during the 2026-08-05 session). Re-run it before treating "the sequencing claim is real" as established.
> For the first time there is now a save that actually executes, so the comparison is finally meaningful: with
> `File.SaveAll` in place the full TC suite ran 209-217 s, no hang.

Caveat worth respecting: property accessors are independently flaky here (noted by the user), so before concluding
"the save fixes the hang", isolate — run the property cases alone with and without the save. A hang that is really
about accessor instability would otherwise be misattributed to the save policy and freeze the wrong design.

- [x] 4.1b **Resolved — the hang does not reproduce.** The full live TwinCAT e2e ran **90 pass / 11 skip / 0 fail
      in 210.9 s** on 2026-08-07 with `File.SaveAll` in place, matching the 209-217 s note above. Combined with the
      §4.1-premise correction (the method was ALREADY a no-op when the hang was observed, so that experiment
      changed nothing observable), the evidence points at TcXaeShell instability, not the save policy — the same
      instability that cost two failed `ide-restart` attempts today. Original text:
- [~] 4.1b Isolate the hang: run only the property/accessor e2e cases, save vs no-save, and confirm which one
      actually changes the outcome. Do NOT delete the property cases to make the suite pass — the instability is a
      finding in its own right and hiding it loses it.
- [x] 4.1c **Moot — its decision is already answered.** This existed to choose between DELETING the save and
      NARROWING it, by checking whether the suite still passes without one. `ide-restart` going 1/1 → **2 pass /
      0 fail** with the save in place settles the delete branch: the save is load-bearing for durability, so it
      stays. The narrow branch is then decided by §4b (below), not by this experiment. Original text:
- [~] 4.1c Then re-run the ORIGINAL experiment: make TwinCAT's `FlushPendingWrites` a no-op,
      rebuild the worker, and run the full live TC e2e suite — it contains the create/rename/delete/move cases that
      would trip the stale-file collision. Compare against the 90 pass / 0 fail baseline.
      - all 90 still pass ⇒ the sequencing claim is stale; **delete the save**, and `ide-restart`'s durability
        assertion must be retired as a deliberate decision (push means "the IDE has it"; the engineer saves).
      - some fail ⇒ the claim is real; keep a save but make it the CORRECT and NARROW one: save the containing PLC
        project (the `.plcproj`), which is what fixes the orphan AND never touches the engineer's other tabs.
- [x] 4.2 **DONE (2026-08-05)** — `Solution.Save()` + `Documents.SaveAll()` is gone, replaced by
      `ExecuteCommand("File.SaveAll")`. See 3.0-RESULT: the old pair never executed at all, so it missed the
      `.plcproj` by never running rather than by saving the wrong things.
- [x] 4.3 **Verified 2026-08-07.** Failure stays loud (`FlushPendingWrites` throws a coded `InternalError` on a
      failed `File.SaveAll` — that loudness is what made bug 2 findable in the first place). Fixture is clean after
      a green run: **no orphan `.TcPOU`**, `git status` shows only the 3 pre-existing modified files. The former
      orphan signature (`Untitled2/POUs/VltE2E_*.TcPOU` unreferenced by the `.plcproj`) is gone; what remains under
      `POUs/` is empty folder scaffolding from the e2e's folder cases, which git cannot track and which is
      harmless.

## 4b. ASSESSMENT 2026-08-06 — the narrow save is LOW value and HIGH risk. Do not take it casually.

Now that `File.SaveAll` has closed bug 2 (see 3.0-VERIFIED), the remaining §3.0/§5 work is narrowing the save to
the containing PLC project. Weighed honestly:

**What it buys:** `push` stops committing the engineer's unrelated dirty editors. That is a real courtesy — it is
a side effect on data Volt does not own — but saving a file is not losing one. The cost is surprise, not damage.

**What it risks:** re-opening the data-loss bug that was just closed. Durability now depends on the `.plcproj`
registration reaching disk, and a narrower save that misses it puts the orphan straight back. The bug was open
for weeks and took a live diagnostic run to find.

**What it requires first, and this is the blocker:** §3.0 already says "confirm against the live model, do not
infer it". That warning is now backed by evidence — `Solution.Save()` was written by inference, does not exist on
EnvDTE's interface, and threw on every push for the life of the code without anyone noticing. The same inference
risk applies to `_plcNode.NestedProject`: `PlcRoot()` uses it as a system-manager TREE NODE (it is passed to
`CreateChild`), so assuming it is also an `EnvDTE.Project` with a `Save()` is exactly the guess that failed last
time. Confirming it means a build-probe-read cycle against a live XAE — and **the surface that would have made
that cheap, the `debug` op's `typeTags`, was deleted by `optimize-volt-cli-architecture` move 2.**

**Recommendation: leave the broad save.** Take the narrowing only when someone (a) has a live XAE in front of
them, (b) confirms the type of `_plcNode.NestedProject` by observation rather than reading, and (c) re-runs
`ide-restart` (2 pass / 0 fail) as the acceptance gate — the same test that proved the broad save works. The
`ponytail:` note in `FlushPendingWrites` already records the debt; it does not need to be paid now.

## 5. (superseded) Scope the TwinCAT save to what Volt wrote

**Decision:** `push` stays durable — a push that reports success must be on disk — but it must NOT commit the
engineer's unrelated work. `Solution.Save()` + `Documents.SaveAll()` saves every open editor, which is a side effect
on data Volt does not own.

Why it isn't done yet: a TwinCAT write targets a **system-manager tree node** (`n.DeclarationText` /
`n.ImplementationText`), and that node exposes no DTE document or file path — so the mapping from touched node to
the document/project to save has to be established against the live COM model. Guessing it would be worse than the
current broad save, which at least keeps push durable (CODESYS commits on write, so dropping the save entirely
would make `push` durable on one vendor and not the other — an observable per-vendor difference).

- [~] 4.1 (SUPERSEDED by §4b — do not take casually) Live probe: for a POU tree node, find what identifies its file — walk `_dte.Solution.Projects` /
      `ProjectItems` and correlate with the node's path (`_plcProjectPath` + the node name), or check whether the
      node exposes a path-ish property. Record what actually works; do not infer it from the VS DTE docs alone.
- [~] 4.2 Have `TcObjectModel` record what it touched since the last flush — content writes (`WriteText`) separately
      from STRUCTURAL changes (`CreateChild`/`DeleteChild`/`Rename`), since structure is what the existing comment
      says must be persisted to avoid a later rename colliding with stale files.
- [~] 4.3 `FlushPendingWrites` saves only those: each touched item's document, plus the containing PLC project when
      structure changed. No seam change needed — the object model mediates every write, so it can track its own
      dirty set.
- [~] 4.4 A failed scoped save must stay LOUD (already true): durability is this method's whole purpose, so
      reporting success over a failed save is how committed work gets lost.
- [~] 4.5 Verify: an engineer's unrelated dirty editor is still dirty after a `volt push`, and the pushed item IS on
      disk. Then remove the `ponytail:` marker in `TcObjectModel.FlushPendingWrites`.


---

## CLOSE-OUT — 2026-08-07

**Both bugs are fixed. One test-coverage gap is carried forward, and one improvement is deliberately not taken.**

| | state |
|---|---|
| **Bug 1** — a read-only graphical CHILD body was flattened by a textual push | **FIXED.** Guard decides from live `BodyLanguage`, runs as a pre-pass so a refusal is atomic, and refuses the round-tripped marker outright. Covered by unit tests against `FakeIde`. |
| **Bug 2** — a pushed item did not survive the IDE being killed | **FIXED and VERIFIED LIVE.** `ide-restart` = **2 pass / 0 fail**, confirmed on two consecutive runs. |

**Carried forward — a coverage gap, not a defect (task 2.2).** Bug 1's guard is proven against `FakeIde`, which is
a MODEL of the vendors, not the vendors. Exercising it live needs a committed fixture containing a real CFC or SFC
method child, and that cannot be generated by the e2e: children are provisioned as TEXT inside the parent's ST
body, and having no textual form is the guard's whole premise. **Someone must author one by hand in an IDE once.**
Until then the guard's live behaviour is unverified on both vendors. This is the single honest gap in this change.

**Deliberately not taken — narrowing the TwinCAT save (§4b).** `push` currently saves via `File.SaveAll`, which
also commits the engineer's unrelated dirty editors. That is a real discourtesy, but saving a file is not losing
one: the cost is surprise, not damage. Narrowing it risks re-opening the data-loss bug that was just closed, and
requires confirming `_plcNode.NestedProject`'s type against a live XAE — precisely the inference that produced
`Solution.Save()`, a method that does not exist and threw on every push for the life of the code. The `ponytail:`
note in `FlushPendingWrites` records the debt. Take it only with a live XAE in hand and `ide-restart` as the gate.
