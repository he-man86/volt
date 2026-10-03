# push-keeps-what-landed — design

## Step 0 — Design gate: every item against volt's push design

### The design it is checked against

What volt already decides about a refused push, in the code, the tests that pin it, and the docs:

- **A push that cannot land in full lands nothing** (`docs/index.html`, "two rules from that run"). The pre-flight
  exists for exactly that: "VALIDATE EVERY OP BEFORE APPLYING ANY OF THEM" (`PushService.Handle`), every refusal
  decidable from the text, the gate and the driver's pure `ValidateSource`, before the first write
  (`docs/driver.html#preflight`). The gate's codes are documented as "Nothing was applied" (`docs/wire.html`).
  **Oracle tests** pin it: `PushServiceTests.A_batch_refused_on_a_LATER_op_writes_NONE_of_the_earlier_ones`,
  `UnopenedItemTests.Without_force_an_op_on_it_refuses_the_whole_push_before_an_earlier_op_is_written`,
  e2e `endpoints/push.test.ts` "rejects the WHOLE batch if any op conflicts — nothing applied", e2e
  `graphical/preflight.test.ts` "a create refused … leaves the item before it unwritten".
- **No rollback of earlier ops** (`PushService.Reject`): "a delete cannot be undone, and a half-undone push is
  worse than a half-done one". What remains possible is the class only the LIVE IDE decides (a member name, a body
  the importer rejects); the rule there is to NAME what landed, not to undo it.
- **A refused CREATE leaves nothing behind; a refused UPDATE is not undone** (`Rollback` in `WriteItemFromSource`
  and `ApplySetTask`; `CreateRollbackTests`: "An UPDATE is deliberately not rolled back"). Since 2026-10-02
  (`f7eb383f47`, push-without-header-check 5.Qa O2) the rollback spans the member creates too
  (`DeclarationBeforeMembersTests.A_create_whose_text_refuses_its_member_is_refused_by_name_and_leaves_nothing`);
  an update's refusal says what of it landed (`MemberRefusal`: "the declaration … stays", "its method 'A' was
  deleted before it and stays deleted").
- **One op per item** (`RequireOneOpPerItem`, wire.html): no two ops of one batch name the same wire identity (or
  one bare name in two kinds), refused BAD_REQUEST before anything is applied.
- **The CLI's push model** (`Commands.Push`): the ops are the diff `volt/ide..HEAD`; on `accepted: true` the CLI
  points `refs/remotes/volt/ide` at HEAD (or a commit on top of it), adopts the receipt's versions for the names it
  pushed, and on `accepted: false` changes nothing. `accepted` therefore means, to the one client volt ships,
  "the IDE now holds HEAD".

### Measured — today's answer to the two shapes the proposal names

Prototyped against the engine with the shared `FakeIde` (scratch test, deleted after the run; 2026-10-03, tree at
`d06657970d`):

| shape | today |
|---|---|
| `[create E_A.dut, create ST_B.dut, create F.pou (FUNCTION text + METHOD M)]`, IDE refuses M (C2k double) | `accepted:false`, ONE conflict `F.pou [UNSUPPORTED]` "… 'F' is not created (the create is rolled back) … — NOTE: 2 of 3 item(s) were already written … Run \`volt pull\` …, then push again."; recorded `create:E_A … create:F writecontent:F refused:M delete:F`; refs after = `E_A.dut, ST_B.dut`; **no `newItems`** |
| `[Good1, Bad (INVALID_ST), Bad2 (INVALID_ST), Good2]` | `accepted:false`, ONE conflict `Bad.pou [INVALID_ST]` — **`Bad2` is not named**; nothing recorded |

Two findings the proposal did not have:

1. **The empty shell is already gone.** The PLCAssist repro (2026-10-01) predates `f7eb383f47` (2026-10-02 22:56),
   which put the member creates inside the create's rollback. The count "2 of 3" is now also right, because the
   refused create is rolled back. Task 1.1 must re-measure this live rather than assume the shell.
2. **What actually makes a client redo everything** is twofold: an apply-time refusal publishes what landed only
   as a count in prose with `accepted:false` and no receipt; and the pre-flight stops at its FIRST refusal, so a
   batch with two malformed items costs two round trips.

`dotnet test` of `DeclarationBeforeMembersTests`, `CreateRollbackTests`, `UnopenedItemTests` and
`PushServiceTests.A_batch_refused…` on the current tree: 24/24 green — the design above is what ships.

### Per item: FITS / CONFLICTS

| # | item | verdict |
|---|---|---|
| 1a | pre-flight refuses per item, the rest applied (INVALID_ST, NETWORK_*, UNREADABLE, UNSUPPORTED, DUPLICATE_CHILD) | **CONFLICTS** |
| 1b | gate refuses per item (STALE_ITEM_VERSION, ITEM_EXISTS, ITEM_MISSING, ITEM_UNVERIFIED) | **CONFLICTS** |
| 1c | apply loop continues past an IDE refusal | **CONFLICTS** |
| 2a | a refused create leaves nothing behind | **FITS — already built** |
| 2b | a refused update restores the item's previous text | **CONFLICTS** |
| 3 | response says exactly what landed: something landed → `accepted:true` + `conflicts` + receipt; nothing → `accepted:false` | **FITS** |
| 4 | an op depending on a refused op is refused with it | **FITS — already true, nothing to build** |
| 5 | client-neutral `conflicts[].reason` | **FITS for the apply NOTE; CONFLICTS for the pinned remedies** |
| 6 | IDE-only member-name refusal (`Log`) caught in pre-flight | **FITS if measured** (task 3.1) |

**1a — CONFLICTS.** "A push that cannot land in full lands nothing" is a stated rule, the pre-flight is its
mechanism, and four oracle tests pin it (above). It is not an accident of implementation: the batch is one
commit (`volt/ide..HEAD`), and items in it reference each other — a pushed FB using a pushed DUT is the normal
case, which is why the push carries its own declarations (`DeclarationsIn`: "two items may legitimately reference
each other"). Applying the FB and refusing the DUT lands a project that does not build, in a live PLC IDE, and no
op-level dependency check can see a TYPE reference. Per the oracle rule these tests do not change on this change's
say-so.
*Volt-native alternative (FITS, built here):* the pre-flight **collects every refusal** instead of returning at
the first, and still writes nothing. The response then names exactly which ops are refused (each with code,
reason, line) and — by `accepted:false` — that nothing was written, so a client regenerates ONLY the refused items
and re-sends the rest unchanged, in one round trip. The CLI already re-sends exactly the diff.
*Left for the owner:* an opt-in per-request mode that applies the rest (git's `push` is per-ref non-atomic by
default with `--atomic` opt-in; volt's batch is one tree, so the analogy argues for opt-in, not default).

**1b — CONFLICTS**, for the same reason, and pinned by e2e `push.test.ts` (a wrong `ifVersion` on a delete keeps
the valid create out). The gate already collects every conflict of its own; what is built (gate review R5) is that
its PER-ITEM conflicts no longer return before the pre-flight — the pre-flight runs over the ops the gate did not
name and the answer is the union, so `[stale A, malformed B]` names both in one round trip. The lease
(`STALE_PROJECT_VERSION`) is still answered alone, and so is a request-shape `BAD_REQUEST` (first offending op). Note the CLI always quotes the
project lease, so for it any stale item is also `STALE_PROJECT_VERSION` — whole-batch by item 4 of the proposal
itself.

**1c — CONFLICTS.** Once an apply refusal is known the push has already failed to land in full; applying more
after it moves the project further from both the workspace's baseline and its HEAD, which is the opposite of the
rule's intent ("lands as little as possible"). The no-rollback rule forbids undoing what came before, not stopping.
*Alternative (built here):* stop at the refused op, as today, and NAME every op that was not reached (item 3).

**2a — FITS, already built** (`f7eb383f47`; measured above: `delete:F` after `refused:M`). One gap stays: when the
rollback's own delete fails, the shell survives and only a log line says so (`Rollback` → `VoltLog.Warn`). The
conflict must say it (fail loud) — built here.

**2b — CONFLICTS.** `CreateRollbackTests` states it ("An UPDATE is deliberately not rolled back"), and
`DeclarationBeforeMembersTests` pins the reasons that say what of an update landed. Restoring is not an undo the
IDE offers: the reconcile DELETES dropped members first, and a re-created member is a new object (what the IDE
stores beside it is gone — the class `RequireOneOpPerItem` exists to protect). A half-undone item is exactly the
"half-undone push" the rule names.
*Alternative (built here):* the item is reported as touched — its conflict keeps the exact `MemberRefusal` text;
the push is `accepted:true` with the receipt only if another op applied in full (item 3); the CLI keeps the item's
OLD baseline version, so the next pull sees the IDE's version differ and brings the real state in as an IDE change.
Until that pull the next push is refused for the item (`STALE_ITEM_VERSION`, or `ITEM_EXISTS` for a create whose
removal failed) — whole batch, by 1b — and the spec says so (gate review R4).

**3 — FITS.** It makes `accepted:false` mean "no op landed" — today an apply-time refusal is `accepted:false` while
items have landed (measured: `E_A`, `ST_B`). The line is drawn at an op APPLIED IN FULL (gate review R1): a single
refused update whose declaration (or a member deletion) landed stays `accepted:false`, its conflict reason stating
what of it the IDE kept, because the `MemberRefusal` oracles
(`DeclarationBeforeMembersTests.An_update_whose_new_text_refuses_its_new_member_says_the_declaration_landed`,
`An_update_that_drops_a_member_and_is_refused_a_new_one_says_the_drop_landed`) assert `Accepted == false` for exactly
that shape, and an oracle does not change on this change's say-so. *Left for the owner:* `accepted:true` for a
partly landed single op (strict "nothing written" reading), which flips those two assertions. The CLI outcome is the
same either way — the conflicted item keeps its old baseline. It is also what the
no-rollback rule asks for ("NAME WHAT ALREADY LANDED"), in structure instead of prose; the receipt walk already
exists on the accepted path. Options measured:

| option | an un-updated reader | what volt must build | verdict |
|---|---|---|---|
| A. `accepted:true` + `conflicts` + receipt | a client that ignores `conflicts` on an accepted push would adopt HEAD; the CLI and bridge ship in one installer, PLCAssist already reads this as partial | CLI: adopt only applied ops | **chosen** |
| B. `accepted:false` + receipt + an `applied` list | fail-safe for old readers | a new field; `accepted:false` keeps meaning two things (nothing written / something written) | rejected — keeps the lie the docs contradict |
| C. today (prose count) | — | — | rejected — the proposal's defect |

Every op the push did not land gets a conflict, so "each op landed unless a conflict names it" holds: the refused
op (its own code), and each op after it in apply order with a new code **`NOT_ATTEMPTED`** ("not applied: the push
stopped at '<op>'"). `NOT_ATTEMPTED` appears only on an accepted push (on a rejected one nothing was applied, and
the not-reached ops need no row).

**4 — FITS, already true.** One op per item means no op in a batch can name what another produces or removes; the
gate's forward simulation (`PushConflicts`, `pending`) covers in-batch creates; and with 1c stopping at the refusal,
every later op is `NOT_ATTEMPTED`. Nothing to build.

**5 — split.** The apply NOTE (`Run \`volt pull\` … then push again`) goes with item 3: the receipt and conflicts
replace it, and the CLI renders its own advice from the codes. So does the CLI advice of every OTHER reason raised
inside the apply loop, because those can now arrive on an accepted push (gate review R2; none is pinned by a test):
`RequireUnchanged` / `RequireUnchangedBeforeDelete` "Pull first, then push again.", `BodyFormatGuard.RequireWritable`
"Pull first, or change it in the IDE.", and the TwinCAT unparsed-POU reason "with --force" where an apply-time read
raises it. **CONFLICTS** for the remedies pinned by oracle
tests, all raised before the first write (so only on `accepted:false`): `StReader`'s stale-workspace refusal "Run
\`volt pull\` once to rewrite the workspace" (asserted `Contains("volt pull")` six times in
`ImplementationLanguagePushTests`, once in `ReadOnlyBodyTests`). Left as is, with the gate's `PushConflicts` "push
with --force", for the owner: re-phrasing them is a wire-wide policy, not this change's.

**6 — FITS if measured.** `docs/driver.html`: "A pre-flight that guesses is worse than one that declines to."
Task 3.1 measures on a live CODESYS whether the member-name refusal is decidable from the text; otherwise item 3
already reports it exactly. (Lead, not a fact: the LSP's keyword table holds the standard function names CODESYS
reserves — LIMIT/MIN/MAX/SEL/MUX measured as unusable variable names; `LOG` may sit in the same measured list.)

### The choice

**Keep the batch all-or-nothing for every refusal decidable before the first write; when the live IDE refuses
part-way, stop, and REPORT what landed in structure — `accepted:true` + a conflict per op not landed
(`<code>` for the refused one, `NOT_ATTEMPTED` after it) + the receipt — so `accepted:false` means "no op landed"
(the refused op's own partial effect stated in its reason), and the CLI adopts only the applied ops.**

### What stays refused, by name

- Whole batch, nothing written: `BAD_REQUEST` (op shape, `RequireWireNames`, `RequireOneOpPerItem`),
  `STALE_PROJECT_VERSION`, every gate code (`STALE_ITEM_VERSION`, `ITEM_EXISTS`, `ITEM_MISSING`, `ITEM_UNVERIFIED`,
  `UNREADABLE`), every pre-flight code (`INVALID_ST`, `NETWORK_*`, `UNSUPPORTED`, `DUPLICATE_CHILD`, the driver's
  `ValidateSource`) — every gate per-item and pre-flight refusal now in one response; the lease and a request-shape
  `BAD_REQUEST` are answered alone (the latter at its first offending op).
- Per op, after earlier ops landed: whatever the live IDE refuses (`UNSUPPORTED` from `ChildRefusedException`, an
  import refusal, `INTERNAL_ERROR`), the push stopping there.
- Not built (owner decides): per-item application of pre-flight/gate refusals (1a/1b), continuing past an apply
  refusal (1c), restoring an update (2b), re-phrasing the pinned CLI remedies (5).

### Migration of existing code

- `PushService.Handle` pre-flight: collect `Reject`s into one list; gate per-item conflicts no longer return
  early — the pre-flight runs over the ops they do not name, and `RejectedResult(gate ∪ pre-flight)` if any. The
  lease conflict and request-shape `BAD_REQUEST` return as today.
- `PushService` apply loop: on a refusal with `applied.Count == 0` → `RejectedResult` as today (no NOTE); what of
  the refused op landed (an update's declaration / deleted member — `MemberRefusal`'s facts — or a create whose
  rollback failed) is in its reason, reported by the write path, not guessed by the push. Otherwise → flush, prune,
  receipt walk, and `AcceptedResult(...) { Conflicts = [refused op, NOT_ATTEMPTED × rest] }`.
- `Rollback`: a failed delete makes the refused item's conflict say the shell remains (not only a log line).
- Delete the NOTE text in `Reject`, and the CLI advice in the apply-time reasons (item 5).
- `Volt.Contracts`: `ConflictCodes.NotAttempted = "NOT_ATTEMPTED"`; `PushResponse` doc: an accepted push may carry
  conflicts, each naming an op that did not land. `docs/wire.html` (codes table, "A rejected push … Nothing was
  applied" stays true), `docs/logs.html` (receipt line for a partial push), `docs/index.html` diagram
  ("accepted, or conflicts with nothing written" + "accepted with the ops that did not land").
- `Commands.Push` (CLI): on `accepted` with conflicts, build `volt/ide` = previous `volt/ide` tree + the APPLIED
  ops' rows only (the files from HEAD for an applied set, removal for an applied delete/rename origin), adopt receipt
  versions for (names the sidecar knows ∪ names the applied ops produce) minus every conflicted name — today's
  "known or pushed" rule restricted to applied ops, so the items a native rename rewrote outside the op set still
  enter the baseline (gate review R3) — keep the old sidecar entry for every conflicted name, `retiredByPush` from
  applied ops only; `Rematerialized` over the applied ops only. The refused edits then stay outgoing in `volt
  status`, and the next `volt push` re-sends exactly them — except a partly landed one, which needs a pull first
  (item 2b). Print the conflicts with the CLI's own advice by code. This lands in ONE commit with the engine's
  `accepted:true` (gate review R6): either alone marks refused edits as synced.
- Tests: new red-first tests for the collected pre-flight, the partial receipt, `NOT_ATTEMPTED`, the failed
  rollback, and the CLI baseline; the four atomicity oracles and the `MemberRefusal` reason tests (including their
  `Accepted == false`) stay as they are.
- `tasks.md`: 1.2 / 2.1 change from "per item applied" to "every refusal named, nothing written"; 2.2 becomes
  "stop, report, receipt"; 2.3 is already true (record, no code); 2.5 is the NOTE only.

## Step 2 — Per-item outcome: the mechanism

Step 0 settled WHAT is built (1a/1b/1c/2b are not; 2a, 3, 4 and the apply-time half of 5 are). This section settles
HOW, one decision at a time, each option measured against what step 1 recorded.

### The measurements every option is held against

- **Offline, tree at `21ea20cfce`** (`dotnet test` of `PushKeepsWhatLandedTests`, `DeclarationBeforeMembersTests`,
  `CreateRollbackTests`, `UnopenedItemTests`, `PushServiceTests`, `PushConflictCodeTests`): 67 pass, 5 red — exactly
  the five step-1 tests, each failing on the change's assertion. The 67 are the oracles every option must keep green.
- **Live, CODESYS SP21 and TwinCAT XAE** (step 1.1 / 1.G F3, own instances, fixture copies):
  `[enum VltE2E_pk_E, struct VltE2E_pk_ST, FB VltE2E_pk_FB + METHOD Log]` → `accepted:false`, one conflict
  `VltE2E_pk_FB.pou [INTERNAL_ERROR]` + NOTE, no receipt, refs after = the two DUTs, **no FB shell on either vendor**.
  The vendor words: CODESYS "The name 'Log' is not valid for this object."; TwinCAT "… Creating the child named 'Log'
  is not possible on node (Name mismatch) …". Neither matches today's `ChildRefusal` patterns ("is not accepted by
  parent object" / "(SubType mismatch)"), which is why both arrive unclassified.
- **Pre-flight** (1.2, offline and both vendors): `[Good1, Bad, Bad2, Good2]` → one conflict `Bad`, nothing written.
- **Read from the code** (the control flow is unconditional, so no fixture is needed): `PushService.Handle` returns
  the gate's `RejectedResult` (line 118) before the pre-flight loop runs, so `[stale A, malformed B]` names only `A`;
  the pre-flight loop returns at its first `Reject`; on any apply-time refusal `Reject` returns before
  `FlushPendingWrites` (TwinCAT `SaveAll`), the prune and the receipt walk.

### D1 — the pre-flight collects every refusal (task 2.1)

| option | `[Good1,Bad,Bad2,Good2]` | `[stale A, malformed B]` | oracles | verdict |
|---|---|---|---|---|
| A. gate per-item ∪ pre-flight over the ops the gate did NOT name; one conflict per op | `Bad`, `Bad2` | `A`, `B` | 67 green (they assert "nothing written" and the first op's code, both kept) | **chosen** |
| B. pre-flight over EVERY op, gate-refused ones too | `Bad`, `Bad2` | `A` can appear twice (gate + text) | green | rejected — two rows for one op breaks "one conflict per op", and a gate-refused op's text is about to be replaced by the pull its code asks for, so validating it reports on text the client will not send |
| C. today (first refusal) | `Bad` | `A` | green | rejected — the proposal's two-round-trip defect |

Details of A:
- **Order:** conflicts in REQUEST order, each op at most once (the gate's and the pre-flight's merged by op index), so
  a client reading the list top-down meets its ops in the order it sent them.
- **The lease:** when the gate holds `STALE_PROJECT_VERSION` the gate's list is returned as today (`DetectConflicts`
  already puts the lease and any per-item conflicts in one list) and the pre-flight does NOT run — the client must
  pull before any item's verdict means anything. "Answered alone" in the spec means "without the pre-flight".
- **`BAD_REQUEST`** for the request's own shape (`RequireWireNames`, `RequireOneOpPerItem`) stays first-offender and
  runs before the gate: with two ops on one item there is no per-op verdict to collect.
- **The unopened-item refusal** (`UNREADABLE`, DIALECT C2i, inside the pre-flight loop) is collected like any other.
- `Reject(op, ex)` splits into `ConflictFor(op, ex) → PushConflict` (the code mapping, unchanged) and the response
  builders; the pre-flight appends, and builds one `RejectedResult` after the loop.

### D2 — the apply loop: stop, and say exactly what of the refused op the IDE kept (task 2.2)

**Stop** at the refused op, as today (step 0, 1c). The open question is how the rollback's OUTCOME reaches the
reason. Three red tests need it (`An_unclassified_member_create_failure_…` wants "'F' is not created (the create is
rolled back)" on an INTERNAL_ERROR; the two `…rollback_delete_…fails…` tests want "'F' remains" and NOT "rolled
back)"), and today `MemberRefusal` words the rollback inside the member-refusal message, before `Rollback` has run.

| option | the 3 red tests | `DeclarationBeforeMembersTests` (Contains "'F' is not created", "refused to create its method 'M'", "is not accepted by parent object") | keeps the original exception (type, code, `Line`, stack) | verdict |
|---|---|---|---|---|
| A. catch-and-wrap at each create site: run the rollback, throw a new exception = original message + outcome | green | green | **no** — a `NetworkTextException` loses its own `Code`/`Line` unless rebuilt per type; the `Rollback` filter exists precisely so a stray `throw ex;` cannot lose the reason | rejected |
| B. the rollback RECORDS its outcome on a per-op holder; `ConflictFor` appends one sentence; `MemberRefusal` stops wording the create | green | green (the sentence is still in the reason; only its position moves after the hint) | yes — the filter still returns false | **chosen** |
| C. `Rollback` throws an `AggregateException(original, deleteFault)` when the delete fails | green | green | no — every consumer must unwrap; the code mapping sees the aggregate | rejected |

Details of B:
- `ApplyOp` takes an `OpOutcome` (a small mutable holder: `Created` = the create began, `RollbackFault` = the
  delete's exception or null). `Rollback(ide, parent, name, outcome)` sets it and still returns false. Every create
  path uses it: the item create (`WriteItemFromSource`) and the task create (`ApplySetTask`).
- `ConflictFor` appends, only when `outcome.Created`: either "'F' is not created (the create is rolled back)" or
  "'F' was created and could not be removed (<delete fault>) — 'F' remains in the project, empty". ONE place words
  it, for a classified and an unclassified refusal alike (the measured live `Log` refusal was unclassified and WAS
  rolled back — today its reason says nothing of it).
- `MemberRefusal` keeps its UPDATE wording (declaration landed / members deleted — pinned) and returns nothing for a
  create; the `ChildRefusedException` wrapper then omits its " — {landed}" fragment.
- `VoltLog.Warn` on a failed rollback stays (the log is not the client's channel, but it stays a log fact).

**Classifying the measured name refusals (gate F1).**

| option | live `Log` → code | the hint "Which members a POU accepts follows its declaration (a FUNCTION takes none)" | verdict |
|---|---|---|---|
| A. extend each driver's `ChildRefusal` pattern; same `ChildRefusedException` | `UNSUPPORTED` | printed — and FALSE for a name refusal (the FB's declaration accepts methods; it is the NAME that is refused) | rejected as is |
| B. as A, plus `ChildRefusedException.Cause` = `Kind` or `Name`, set by the classifier; the declaration hint only for `Kind` | `UNSUPPORTED` | only where true | **chosen** |
| C. a new code (`NAME_REFUSED`) | new code | — | rejected — a vendor refusing a child is one class (DIALECT C2k) and the CLI chooses advice by code; a code per vendor reason grows the vocabulary for no client branch |

Patterns, measured wording only (no guessed reserved-word list): CODESYS `is not valid for this object`, TwinCAT
`(Name mismatch)`. The driver tests (`CodesysChildRefusalTests` / `TcChildRefusalTests` name tests) go green.
**A top-level create** reaches the same `CreateChild`, so an item NAMED like a refused identifier would now raise
`ChildRefusedException` in `WriteItemFromSource` before `createdParent` is set, so no rollback sentence. Whether a
top-level `LOG` is refused at all is UNMEASURED; 2.2 measures it on one CODESYS (own instance) and, if refused,
wraps it there as "the IDE refused to create '<name>': <vendor words>" (the item's refusal, not a member's).
Unmeasured, no wrapper is added — the vendor's words still arrive as `UNSUPPORTED`, which is correct.

### D3 — the response (task 2.4)

Shape A of step 0 (`accepted:true` + receipt + conflicts). What this step fixes:

- **When:** `accepted:true` iff `applied.Count > 0` at the refusal. With 0, `RejectedResult` as today minus the
  NOTE — the single partly-landed update stays `accepted:false` (the `MemberRefusal` oracles, step 0 R1).
- **Which rows:** the refused op with its code, then `NOT_ATTEMPTED` for each op after it in APPLY order
  (`InFolderDepthOrder` — not request order: an op earlier in the request can come later in the apply), reason
  "not applied: the push stopped at '<refused op name>'". Every conflict is keyed by the op's `Name` (the source name
  of a rename), the key the client sent.
- **Before the receipt** the partial path runs what the full path runs: `FlushPendingWrites` (on TwinCAT the applied
  ops are otherwise not saved — today's rejection skips it), `PruneEmptied` over the APPLIED ops only (a refused or
  unattempted delete empties nothing), then the receipt walk.
- **`ConflictCodes.NotAttempted = "NOT_ATTEMPTED"`** in `Volt.Contracts` (an op-level push outcome; NOT in
  `ConflictCodes.Gate`, NOT a `BridgeErrorCodes` value — it is never an error frame).

| option for "which ops landed" | an old reader | verdict |
|---|---|---|
| A. `ops − conflicts[].name` (every op not landed has a row) | PLCAssist reads exactly this today | **chosen** |
| B. an explicit `applied: [names]` field | ignored | rejected — two statements of one fact that can disagree; A already makes it exact |

### D4 — the CLI adopts what landed (task 2.4b)

| option for `volt/ide` on a partial push | next `volt status` | next `volt pull` | verdict |
|---|---|---|---|
| A. commit = previous `volt/ide` tree + the APPLIED ops' rows from HEAD; parent = previous `volt/ide` only | refused edits outgoing | 3-way merge; applied rows identical on both sides → clean | **chosen** |
| B. as A but with HEAD as a second parent | refused edits outgoing | merge-base = HEAD, so merging a later IDE change fast-forwards the workspace to a tree WITHOUT the refused edits — silently reverted | rejected |
| C. leave `volt/ide` unchanged | applied edits ALSO outgoing; the next push re-creates them → `ITEM_EXISTS` | — | rejected — the defect the proposal names, moved into the CLI |

Details of A: built with `IdeTree.BuildVoltIdeTree` from the previous `volt/ide` with the applied items and removals,
committed by `CommitVoltIde(…, parent: previous volt/ide, …)`; `Rematerialized` and `HeldUnderAnotherName` over the
applied ops only; baseline = receipt versions for (sidecar-known ∪ produced by applied ops) − every conflicted name
(step 0 R3); `retiredByPush` from applied ops; every conflicted name keeps its old sidecar entry and folder. No
working-tree merge: HEAD already holds every pushed file.
**The CLI result** gets a new kind **`partial`** (`ResultKinds.Partial`, `PushResult.Partial(landed, status,
reason)`): `rejected` is wrong (volt-control's outcome for it offers "pull first or force", and `--force` would
re-send landed items over themselves), `ok` is wrong (exit 0 on a push that did not land in full). Non-zero exit;
the reason lists each conflict with the CLI's OWN advice by code (`NOT_ATTEMPTED` → push again; `UNSUPPORTED` →
change the text; a partly landed op → pull first). volt-control's push outcome union (`bridge/actions.ts`) and
`view/outcomes.ts` gain the case.

### D5 — reasons carry no CLI instruction (task 2.5)

One option only — delete the words; the CLI renders advice by code (D4). Removed: the NOTE in `Reject`; "Pull
first, then push again." (`RequireUnchanged`, `RequireUnchangedBeforeDelete`); "Pull first," in
`BodyFormatGuard.RequireWritable` ("change it in the IDE" stays — it names no client command); "Push the fixed text
with --force" in `ExplorerSnapshot.Reason` (TcSolutionExplorer.cs) when raised inside the apply loop.
Kept (raised before the first write, pinned, owner): `StReader` "Run `volt pull`", `PushConflicts` "--force".

### What stays refused, by name

- Whole batch, nothing written, ONE answer naming every refused op: gate per-item (`STALE_ITEM_VERSION`,
  `ITEM_EXISTS`, `ITEM_MISSING`, `ITEM_UNVERIFIED`, `UNREADABLE`) ∪ pre-flight (`INVALID_ST`, `NETWORK_*`,
  `UNSUPPORTED`, `DUPLICATE_CHILD`, `UNREADABLE` for an unopened item, the driver's `ValidateSource`).
- Whole batch, answered without the pre-flight: `STALE_PROJECT_VERSION` (with the gate's own list).
- Whole batch, first offender: `BAD_REQUEST` for the request's shape.
- After earlier ops landed: the live IDE's refusal of one op — the push stops, `accepted:true`, the op named with its
  code, every later op `NOT_ATTEMPTED`. Nothing landed → `accepted:false`, including a single update whose
  declaration landed (stated in its reason).
- Not built (owner): per-item application (1a/1b), continuing past a refusal (1c), restoring an update (2b), the
  pinned pre-write remedies (5), `accepted:true` for a single partly-landed op.

### Migration

| file | change |
|---|---|
| `Volt.Engine/Sync/PushService.cs` | `Reject` → `ConflictFor` + builders; no early return for gate per-item conflicts unless the lease is stale; the pre-flight collects; the apply loop builds the partial result (flush, prune applied, receipt, conflicts + `NOT_ATTEMPTED`); `OpOutcome` through `ApplyOp`; `Rollback` records; `MemberRefusal`'s create branch removed; the NOTE and the apply-time CLI advice deleted |
| `Volt.Engine/Ide/ChildRefusedException.cs` | `Cause` (`Kind` or `Name`) |
| `Volt.Ide.Codesys/Driver/CodesysDriver.Tree.cs`, `Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs` | `ChildRefusal` also matches the measured name wording and returns the cause |
| `BodyFormatGuard.cs`, `TcSolutionExplorer.cs` | advice words removed (D5) |
| `Volt.Contracts` | `ConflictCodes.NotAttempted`; `PushResponse` doc: an accepted push may carry conflicts, one per op not landed |
| `Volt.Cli/Sync/Commands.cs`, `Types.cs` | D4: partial `volt/ide`, filtered adoption, `ResultKinds.Partial` — ONE commit with the engine's `accepted:true`, CLI test red first (R6) |
| volt-control `bridge/actions.ts`, `view/outcomes.ts` | the `partial` outcome |
| `docs/wire.html`, `logs.html`, `index.html`; the `DocDataTests` fact "The reason says how many" | the partial push and `NOT_ATTEMPTED`; the NOTE fact rewritten to the receipt (regenerated with `VOLT_WRITE_DOCS=1`) |
| tests | the five step-1 reds go green (plus the two driver reds); new reds first: `[stale A, malformed B]` (2.1), a `NOT_ATTEMPTED` row after a mid-batch refusal in apply order (2.4), the CLI baseline / rename / partly-landed cases (2.4b), the race reason (2.5); the 67 oracles unchanged |
