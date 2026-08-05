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

- [ ] 2.1 Live TwinCAT e2e (`bun run test:e2e:twincat`) — Core is shared so the guard is vendor-neutral, but the
      `BodyLanguage` read goes through `TcPouReader`, so prove it on a real XAE. **Point the connector at a freshly
      built worker via `VOLT_TWINCAT_BRIDGE`** or you will be testing the stale installed one.
- [ ] 2.2 Ideally an e2e case with a real CFC method child in a fixture — the unit tests use `FakeIde`'s
      `BodyLang`, which is a model of the vendors' behaviour, not the behaviour itself.

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
evidence in `openspec/changes/optimize-volt-cli-architecture/ledger.md`). Build + all three C# suites green.

Still open below: this is the BROAD save (§4/§5 scoping still applies — it commits the engineer's unrelated
dirty tabs), and `ide-restart`'s durability assertion has NOT been re-checked against it. Do that before
calling bug 2 closed.

- [ ] 3.0 Narrow it: from `_dte`, resolve the PLC project we are bound to and call `Save()` on it (TwinCAT nests
      the PLC project inside the TwinCAT project, so `Solution.Projects` likely needs a walk into `ProjectItems` —
      confirm against the live model, do not infer it). Keep the failure loud.
- [ ] 3.0b Red-first is possible WITHOUT an IDE for the ordering/選択 part only; the real proof is live, below.
- [ ] 3.0c Delete the orphan `Untitled2/POUs/VltE2E_restart_survives.TcPOU` (and any siblings) from the fixture, and
      confirm a clean `git status` after a passing run — a green run must leave no stray files.

- [x] 3.1 DONE — that one observation is what cracked it: the file was on disk, so "never saved" was wrong and the
      registration was the missing piece.
- [ ] 3.2 Check the push path's `FlushPendingWrites` call: is it invoked at all, and is it invoked AFTER the child
      writes rather than before? (`IIdeSession` documents "after applying a push".)
- [ ] 3.3 Read `%LOCALAPPDATA%\Volt\logs\twincat-*.log` across a push + kill + reopen. With the health probe no
      longer swallowing failures (`fix-connected-precondition`), a failing save should now be visible.
- [ ] 3.4 Candidate causes, in order: SaveAll not invoked / invoked too early; SaveAll saves the PLC project but not
      the item's containing artifact; the reopened XAE loads a cached copy; the kill races the save.
- [ ] 3.5 Fix, with a red-first test. Prefer a unit-level test on the call ORDER if the cause is ordering — that is
      cheap and does not need an IDE.
- [ ] 3.6 **`ide-restart` to 2 pass / 0 fail**, assertions intact. It is currently 1 pass / 1 fail and stays red
      until this is fixed — do NOT weaken it.

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

- [ ] 4.1b Isolate the hang: run only the property/accessor e2e cases, save vs no-save, and confirm which one
      actually changes the outcome. Do NOT delete the property cases to make the suite pass — the instability is a
      finding in its own right and hiding it loses it.
- [ ] 4.1c Then re-run the ORIGINAL experiment: make TwinCAT's `FlushPendingWrites` a no-op,
      rebuild the worker, and run the full live TC e2e suite — it contains the create/rename/delete/move cases that
      would trip the stale-file collision. Compare against the 90 pass / 0 fail baseline.
      - all 90 still pass ⇒ the sequencing claim is stale; **delete the save**, and `ide-restart`'s durability
        assertion must be retired as a deliberate decision (push means "the IDE has it"; the engineer saves).
      - some fail ⇒ the claim is real; keep a save but make it the CORRECT and NARROW one: save the containing PLC
        project (the `.plcproj`), which is what fixes the orphan AND never touches the engineer's other tabs.
- [x] 4.2 **DONE (2026-08-05)** — `Solution.Save()` + `Documents.SaveAll()` is gone, replaced by
      `ExecuteCommand("File.SaveAll")`. See 3.0-RESULT: the old pair never executed at all, so it missed the
      `.plcproj` by never running rather than by saving the wrong things.
- [ ] 4.3 Whatever survives must keep failing LOUD, and a green run must leave the fixture clean (no orphan files).

## 5. (superseded) Scope the TwinCAT save to what Volt wrote

**Decision:** `push` stays durable — a push that reports success must be on disk — but it must NOT commit the
engineer's unrelated work. `Solution.Save()` + `Documents.SaveAll()` saves every open editor, which is a side effect
on data Volt does not own.

Why it isn't done yet: a TwinCAT write targets a **system-manager tree node** (`n.DeclarationText` /
`n.ImplementationText`), and that node exposes no DTE document or file path — so the mapping from touched node to
the document/project to save has to be established against the live COM model. Guessing it would be worse than the
current broad save, which at least keeps push durable (CODESYS commits on write, so dropping the save entirely
would make `push` durable on one vendor and not the other — an observable per-vendor difference).

- [ ] 4.1 Live probe: for a POU tree node, find what identifies its file — walk `_dte.Solution.Projects` /
      `ProjectItems` and correlate with the node's path (`_plcProjectPath` + the node name), or check whether the
      node exposes a path-ish property. Record what actually works; do not infer it from the VS DTE docs alone.
- [ ] 4.2 Have `TcObjectModel` record what it touched since the last flush — content writes (`WriteText`) separately
      from STRUCTURAL changes (`CreateChild`/`DeleteChild`/`Rename`), since structure is what the existing comment
      says must be persisted to avoid a later rename colliding with stale files.
- [ ] 4.3 `FlushPendingWrites` saves only those: each touched item's document, plus the containing PLC project when
      structure changed. No seam change needed — the object model mediates every write, so it can track its own
      dirty set.
- [ ] 4.4 A failed scoped save must stay LOUD (already true): durability is this method's whole purpose, so
      reporting success over a failed save is how committed work gets lost.
- [ ] 4.5 Verify: an engineer's unrelated dirty editor is still dirty after a `volt push`, and the pushed item IS on
      disk. Then remove the `ponytail:` marker in `TcObjectModel.FlushPendingWrites`.
