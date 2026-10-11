## 1. Measure (vendor-facts rows, never a probe script)

- [x] 1.1 Both compilers on an ABSTRACT METHOD / abstract PROPERTY accessor that HOLDS code (CODESYS SP21 via a
      `POUMethodObject` with ABSTRACT text; TwinCAT via its slot): does the build refuse it? Record the message.
  - **Both compilers refuse it at BUILD, with the same words; neither refuses the WRITE.** New `vendor-facts` row
    `abstract-member-code` (C2n, both vendors; `[PROBE: abstract-member-code]` on DIALECT C2n), snapshots in
    `scripts/vendor-facts.{codesys,twincat}.json`. Runs (`VOLT_VENDOR_FACTS_INSTANCE=abstract-member-parity bun
    scripts/vendor-facts.ts <vendor> --only abstract-member-code [--write]`): CODESYS 22.7 / 23.7 s `--write`, 24.3 s
    "every fact as committed"; TwinCAT 19.8 / 19.7 / 19.6 s `--write`, 19.6 s "every fact as committed". Shape: an
    `ABSTRACT` FB with `METHOD ABSTRACT Pick : INT` and `PROPERTY ABSTRACT Busy : INT`, a non-abstract
    `VltA_CodeImpl EXTENDS` it overriding both, used from the task's `PLC_PRG`; code written at each slot through the
    vendor API (`Pick := 1;`, then `Busy := 1;` in the GET), a build after each.
    - CODESYS: `C0433 Error` "The ABSTRACT method VltA_CodeBase.Pick must not contain any statements"; for the GET
      `C0433 Error` "The ABSTRACT method VltA_CodeBase.__getBusy must not contain any statements".
    - TwinCAT: `success: false`, error (no code) on `VltA_CodeBase.pou` member `Pick` / `Busy`, the SAME two texts.
    - The SET (gate-1 review): code in the abstract property's SET (`Busy := 1;`), built — CODESYS `C0433 Error`
      "The ABSTRACT method VltA_CodeBase.__setBusy must not contain any statements"; TwinCAT `success: false`, error
      on member `Busy`, the same text. The TwinCAT property is now push-made with a GET AND a SET (the derived FB's
      too), so its SET is the push's own (`class.set` `ItemType 614`); the CODESYS SET is `create_property`'s
      (`PropertyAccessorObject`, `STImplementationObject`). The write is accepted and reads back on both
      (`body.set@set-code`), an empty body written after it persists across save/reopen (`body.set@saved` = `""`,
      TwinCAT `file.set-st` = `""`), and the earlier facts are unchanged on CODESYS; on TwinCAT only the `fetched*`
      texts changed, by the added `SET` / `IMPLEMENTATION ST` / `END_SET` lines.
    - Controls: the same members with EMPTY bodies build clean on both (CODESYS `[]`; TwinCAT `success: true`, only
      "generate boot information..."); an unknown name in the derived method's body is reported on both (CODESYS
      `C0032` + `C0046` ×2, TwinCAT the same two texts) — the build compiles these POUs.
    - The write is accepted on both and the code reads back (`body.*@method-code|get-code`), and the fetched text
      carries it under `IMPLEMENTATION ST` (`fetched@method-code|get-code`).
    - FOUND on the way: TwinCAT's build compiles only what a task reaches. The first TwinCAT run used a program of its
      own that no task called — it reported NOTHING, not the abstract-member code and not the unknown-name control.
      The row now calls the derived FB from `PLC_PRG` (restored at cleanup); CODESYS answered with the caller in
      `PLC_PRG` from the first run.
  - Consequence for 2.1: the expected case — both refuse, for the method, the GET and the SET. A body under an `ABSTRACT` declaration can be refused by
    name before any write on both vendors; no vendor-only `IMPLEMENTATION ST` with code remains to unify.
- [x] 1.2 TwinCAT: the fetched wire text of an abstract member today (the inferred `IMPLEMENTATION ST`, now recorded),
      and persistence of an empty body written at its slot across save/reopen.
  - **Recorded (no longer inferred): today's TwinCAT pull writes `IMPLEMENTATION ST` with an empty body.** New read
    op `fetched` in the vendor-facts runner (the item text as the SHIPPED bridge's `fetch` answers it — what `volt pull`
    writes; read over the pipe by the runner, never a core; test-first in `test/unit/vendor-facts.test.ts`, 3 tests red
    then green). `abstract-member-code` `fetched*`:
    - script-made (`CreateChild 609` + ABSTRACT declaration), after create and after save/reopen:
      `METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\nEND_METHOD\n`.
    - push-made (Volt's writer shape): `METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\nEND_METHOD\n` and
      `PROPERTY ABSTRACT Busy : INT\nGET\nIMPLEMENTATION ST\nEND_GET\nEND_PROPERTY\n`.
  - **An empty body written at the slot persists.** After code at each slot, `ImplementationText = ""` through COM:
    reads `""` right after (`body.*@emptied`) and after save/close/reopen (`body.*@saved`); the saved `.TcPOU` holds an
    empty `<ST>` under the method and under the GET (`file.method-st`, `file.get-st` = `""`); the fetched owner text
    after the reload is byte-identical to the one before any code (`fetched@saved` = `fetched@property-made`). Classes
    as in `abstract-member-push` (FB 604, method 609, property 611, GET 613).
- [x] 1.3 CODESYS: a script-made ABSTRACT method (`create_method` + ABSTRACT text) — its class and slot, and what the
      pull writes today.
  - **A `POUMethodObject` with an `STImplementationObject` (a slot), and the pull writes `IMPLEMENTATION ST`** —
    the same text TwinCAT pulls for the same method. **The CLASS and its slot decide the text, not who made the
    object** (gate-1 review): pro2193's `ModuleWithStateFB.Cyclic` is user-made (the IDE, not scripting), and it is a
    `POUMethodObject` with an `STImplementationObject` too (`merged-classes` `class.cyclic`,
    `implementation.cyclic`, measured live on a Pro2193 copy in `abstract-member-push` 3.2 and unchanged since); it
    pulls `METHOD PROTECTED ABSTRACT Cyclic` / `IMPLEMENTATION ST` / `END_METHOD` today — 1 of pro2193's 12 abstract
    member texts, the other 11 slotless (`IMPLEMENTATION NONE`). So the rule 2.1 states keys on the declaration, and
    3.3's re-pull of pro2193 expects exactly ONE CODESYS line to change, `Cyclic`'s `IMPLEMENTATION ST` → `NONE`.
    `abstract-member-code`, on a `CodesysTestProject` copy:
    - `create_method` + `METHOD ABSTRACT Pick : INT`: class `_3S.CoDeSys.MethodObject.POUMethodObject`,
      `object.Implementation` `_3S.CoDeSys.STObject.STImplementationObject`, both unchanged after save/close/reopen.
    - `create_property` + `PROPERTY ABSTRACT Busy : INT`: `PropertyObject` (no `Implementation`), its GET (and SET) a
      `_3S.CoDeSys.PropertyObject.PropertyAccessorObject` with an `STImplementationObject` — NOT pro2193's slotless
      `InterfacePropertyAccessorObject`; unchanged after save/reopen.
    - Fetched today: `METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\nEND_METHOD\n` (byte-identical to TwinCAT's
      script-made and push-made method) and `PROPERTY ABSTRACT Busy : INT\nGET\nVAR\nEND_VAR\nIMPLEMENTATION ST\n
      END_GET\nSET\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_SET\nEND_PROPERTY\n` (the create's default accessors; the
      TwinCAT property here was push-made with a GET only, so the property texts are not a parity pair).
    - An empty body written back after code (`textual_implementation.replace("")`) persists across save/reopen
      (`body.*@saved` = `""`), and the fetched text after the reload equals the one before any code.
  - So today one `ABSTRACT` declaration pulls THREE ways: CODESYS slotless (`AbstractPOUMethodObject`,
    `InterfacePropertyAccessorObject`) → `IMPLEMENTATION NONE`; CODESYS slotted (`POUMethodObject`,
    `PropertyAccessorObject` — script-made, or IDE-made like pro2193's `Cyclic`) → `IMPLEMENTATION ST`, empty;
    TwinCAT (609 / 613 / 614) → `IMPLEMENTATION ST`, empty.
  - Step 1 numbers: no product code changed. Changed: `scripts/vendor-facts.ts` (read op `fetched`, `WireSide.fetched`,
    `fetch` now under `TIMEOUT_MS`), `scripts/vendor-facts.table.ts` (the op + row `abstract-member-code`), both
    snapshots (only the new row's key), DIALECT C2n (the `[PROBE]` marker + the re-measured facts), `scripts/README.md`.
    volt-cli `bun test test/unit/vendor-facts.test.ts` 54 pass / 0 fail (51 + 3 new); `bun run typecheck` clean;
    Repo.Gates `VendorFact*` 15 pass. No LSP, fixture or transpiler change (fixture map not regenerated).
  - Gate 1 (review findings, both fixed): (1) the "script-made" framing corrected to "the class/slot decides" in 1.3,
    proposal Why/Impact and DIALECT C2n — pro2193's IDE-made `Cyclic` is a slotted `POUMethodObject` (already
    measured, `merged-classes`), so 3.3 expects its one CODESYS line to flip ST → NONE; (2) the SET measured
    (1.1 above): row `abstract-member-code` +3 steps per vendor (`find set`, code + build, empty), +`set` reads.
    Runs: CODESYS 27.0 s `--write` (14 new keys, no committed value changed), 27.7 s "every fact as committed";
    TwinCAT 23.4 s `--write` (17: 11 new keys + the 5 `fetched*` owner texts and `steps` grown by the SET), 25.0 s
    "every fact as committed". Gate: `bun run typecheck` clean (5 packages); volt-cli `bun test test/unit` 78 pass /
    0 fail; `Volt.Repo.Gates` 160 pass; `Volt.Engine.Tests` 2325 pass / 1 skip / 0 fail; `bun run lint` no errors.
    No product, LSP, fixture or transpiler change — the LSP suite and the fixture map are not affected (not run).

## 2. Design

- [x] 2.1 design.md: the declaration rule (ABSTRACT + no code ⇒ NONE), the push per slot, the creates/renames/retypes it
      now accepts, the code-under-ABSTRACT outcome from 1.1, and the refusals that stay; reviewed against the wire-parity
      rule (identical text for the same declaration on both vendors).
  - **One engine fold, three call sites, no driver and no `StReader` change of rule.** (ABSTRACT member site, null or
    whitespace-only ST body) → NONE, applied to both `ICodeStore.ReadContent` callers (`Materializer.BuildSource`,
    `PushService.ReadLive` — so the fetched text, the refs walk, the version gate, the guard and `OnlyChanged` all see
    it) and to the pushed source after `StReader.Read`. Member sites only (METHOD body; GET/SET by the PROPERTY's
    declaration) — `MemberHeaderIsAbstract` is true for `FUNCTION_BLOCK ABSTRACT` too, so the site is picked by
    `ItemKind.ShapeOf` first. Comment-only, graphical and hidden bodies are not folded.
  - **Push per slot, decided once in the engine:** `OnlyChanged` drops an unchanged body at every site (members and
    accessors, not only the item's own), so NONE reaches a driver only over live code or on a create — both slotted;
    `ImplementationMarker.Written(NONE)` = `""`; `RequireSlot` stays the backstop. Drivers gain no slot check
    (null member/accessor bodies are already "leave alone" in both drivers' writes).
  - Guard table in design.md. Accepted now: NONE+ABSTRACT over any live ST body or NONE, and NONE+ABSTRACT on a
    create/rename/retype (the pro2193 migration refusal goes). Refused by name: NONE without ABSTRACT (except the IDE
    already holding exactly that, C2l), code under ABSTRACT unless it is the live body unchanged (1.1, the IDE's own
    "must not contain any statements"), dropping ABSTRACT over a live NONE — **on both vendors, a change from the first
    draft**: after the fold the slot is invisible, so answering by slot would give one text two outcomes.
  - Corrected on review of the first draft: "stale files still push" was false — the item version hashes the folded
    text, so the first push after the upgrade answers `STALE_ITEM_VERSION` for the changed owners until a `volt pull`.
  - Numbers (six corpora, counted): 12 `ABSTRACT` member texts (11 METHOD, 1 PROPERTY) in 7 owner files, all pro2193 —
    11 `IMPLEMENTATION NONE`, 1 `IMPLEMENTATION ST` (`Cyclic`); 0 in the other five. 0 abstract members with code,
    0 comment-only, 0 graphical/hidden — ~~the comment-only refusal recorded as "niche: accepted loss (0 occurrences in
    the corpora)"~~ (withdrawn at gate 2, below: measured instead). No code, test or fixture changed in this step.
  - Gate 2 (review findings, all 7 fixed in design.md; none skipped):
    1. NONE at an item's own body or an action's stays REFUSED whatever the declaration says (`FUNCTION_BLOCK
       ABSTRACT` is not a member site): the guard table is for member sites only, `Check` branches on the site before
       it reads D, so `Written(NONE)` = `""` is never reached for an item body. Red test named in 3.1.
    2. `PushedLanguage` answers `St` for a NONE body, so the CODESYS write swaps an LD/FBD aspect to ST before writing
       `""` (it would have written `""` into the NWL implementation). Red test named in 3.1.
    3. Comment-only abstract body MEASURED (not refused as a guess): `vendor-facts` `abstract-member-code` +6 steps per
       vendor (comment under the method `// to be overridden` and the GET `(* to be overridden *)`, one build, emptied).
       Both build clean (CODESYS `[]`, TwinCAT `success: true`) and both fetch `IMPLEMENTATION ST` with the comment,
       member texts byte-identical. Design: "statements" = text left after whitespace and comments; comment-only
       stays `IMPLEMENTATION ST`, accepted and written; refused only over a live NONE (both vendors — the slot is
       invisible after the fold). A pragma-only body counts as statements, unmeasured: "niche: accepted loss
       (0 occurrences in the corpora)" — all 12 corpus abstract member bodies are empty or missing. DIALECT C2n
       gains the fact. Runs (`VOLT_VENDOR_FACTS_INSTANCE=abstract-member-parity`): CODESYS 30.4 s `--write` (6 new
       keys/`steps`, no committed value changed), TwinCAT 24.9 s `--write` (the same 6); confirming runs below.
    4. The fold gets a fourth site, `PushedText.SameExceptLayout` (the CLI post-push check), so a pushed
       `IMPLEMENTATION ST` empty under ABSTRACT that comes back NONE is adopted as the IDE's layout, not "held
       otherwise". Test named in 3.1.
    5. `NONE, not D` over a live `NONE, L` gets the drop-ABSTRACT remedy, not "state `IMPLEMENTATION ST`".
    6. 3.1 now names a red test for every guard row the design changes or adds (below).
    7. `StatedLanguage.NoSlot` → `IsNone` (`None` is the existing static value).
    - Gate 2 numbers: confirming runs "every fact as committed" — CODESYS 33.8 s, TwinCAT 27.0 s. `bun run
      typecheck` clean (5 packages); `bun run lint` exit 0 (warnings only); volt-cli `bun test test/unit` 78 pass /
      0 fail; `Volt.Repo.Gates` 160 pass; `Volt.Engine.Tests` 2325 pass / 1 skip / 0 fail. Changed: design.md,
      tasks.md, `scripts/vendor-facts.table.ts` (+6 steps, +`comment-*` reads), both snapshots (only the new keys and
      `steps`), DIALECT C2n (the comment-only fact). No product, LSP, fixture or transpiler change — the LSP suite and
      the fixture map are not affected (not run).

## 3. Fix

- [x] 3.1 Red tests first: the vendor-parity suite (an abstract method and an abstract property on both bridges pull
      byte-identical text), a CODESYS and a TwinCAT driver test each, the migration case (pro2193-shaped NONE owner
      created into a blank TwinCAT and CODESYS project). Offline, one red test per guard row of design.md (FakeIde,
      `test/Volt.Engine.Tests/sync/`, beside `AbstractMemberNoSlotTests`), each for a METHOD and an accessor:
      - statements under ABSTRACT refused, naming the member and "must not contain any statements"; the same body
        pushed back unchanged over the live body accepted with nothing written;
      - comment-only under ABSTRACT accepted and written over a live ST body and on a create; refused over a live NONE;
      - dropping ABSTRACT over a live NONE refused on a slotted member too (a behaviour change: accepted today on
        TwinCAT and on slotted CODESYS members), and `NONE, not D` over `NONE, L` refused with the drop-ABSTRACT remedy;
      - NONE+ABSTRACT accepted over live ST code (`""` written) and over live LD/FBD (CODESYS driver test: the aspect
        becomes ST, `PushedLanguage` = `St`);
      - NONE+ABSTRACT on a create / rename / retype accepted;
      - `OnlyChanged` drops an unchanged member and accessor body when only the declaration changed;
      - NONE at the item site (`FB_Base`, `FUNCTION_BLOCK ABSTRACT`, body `x := x + 1;`) and at an action refused, the
        body unchanged;
      - the pushed-side fold: a pre-upgrade `IMPLEMENTATION ST` empty under ABSTRACT is the same content as NONE (no
        write over a live NONE), and `PushedText.SameExceptLayout` calls it the same as the IDE's NONE text.
  - **Added, each confirmed red before 3.2:** `test/Volt.Engine.Tests/sync/AbstractMemberParityTests.cs` (37 cases:
    the slotted read, slotted = slotless text, every guard row above for a METHOD and a GET; 30 red),
    `UnchangedBodyIsNotWrittenTests` +1 (member + accessor body dropped; red), `CodesysAbstractMemberPushTests` +4
    (slotted method/GET pull NONE through the fold; NONE over a slotted method with code writes `""`; NONE over LD
    swaps the aspect to ST and writes `""`; a null accessor body leaves the GET's code — 3 red against the old source,
    the fold test is new code), `TcAbstractMemberSlotTests` rewritten as the TwinCAT twin (3 cases; NONE written as
    `""` red). Live: `vendor-parity.test.ts` +3 (an abstract FB with an abstract METHOD, with an abstract PROPERTY, and
    NONE vs pre-fold `IMPLEMENTATION ST` byte-identical four ways), `items/abstract-member.test.ts` + the migration
    describe (a pro2193-shaped NONE owner created into the served fixture and pulled back unchanged; code under its
    abstract method refused by name) on both vendors.
  - **Tests whose premise step 2 measured wrong, changed (named for the commit):** `AbstractMemberNoSlotTests` — an
    empty `IMPLEMENTATION ST` under ABSTRACT over a slotless member is NONE (accepted; the old refusal test now uses
    code → "must not contain any statements"), the GET case likewise, NONE on an added and on a renamed abstract member
    accepted, NONE over a concrete member's message no longer says "body slot"; `ImplementationKeywordTests` —
    `Written(NONE)` is `""` (was null); `FakeAccessorWriteTests` — a null accessor body is "leave it alone" on both
    drivers (CODESYS wrote `Accessor.Code`), an empty one empties; `CodesysAbstractMemberPushTests`
    `A_pulled_owner…` — the driver is handed what the push sends (the unchanged body dropped), and NONE reaching a
    slotless object is the `RequireSlot` backstop; `TcAbstractMemberSlotTests` — asserted the divergence (TwinCAT
    "never NONE"); `items/abstract-member.test.ts` — an empty `IMPLEMENTATION ST` under pro2193's abstract method is
    accepted as NONE (was refused). The double: `FakeIde.Delete` removes an item's own children (a property's GET/SET)
    as an IDE does; a null member/accessor body is left alone; NONE is stored as `""`.
- [x] 3.2 The fix: the read rule in both drivers, NONE's push per slot, `BodyFormatGuard` (creates/renames/retypes
      accepted; a body under ABSTRACT handled per 1.1), DIALECT C2n rewritten (no divergence left), vendor-facts rows.
  - **Built as design step 3 says: ONE engine fold, not a driver read.** New `Volt.Engine/Format/St/AbstractMemberFold`
    (member sites only — METHOD body, PROPERTY GET/SET by the property's declaration; null/whitespace ST → NONE),
    called at `Materializer.BuildSource`, `PushService.ReadLive`, the pushed source after `StReader.Read`, and both
    reads of `PushedText.SameExceptLayout`. `StatedLanguage.NoSlot` → `IsNone`; `StReader`'s NONE-with-code wording →
    "an abstract member holds no code". `ImplementationMarker.Written(NONE)` = `""`; `BodyFormatGuard.PushedLanguage`
    answers ST for NONE; `PushService.OnlyChanged` drops an unchanged body at every member and accessor site
    (`WithoutUnchangedBodies`). `BodyFormatGuard`: `Check` branches on the site first (`AbstractMemberFold.IsMemberSite`)
    and implements the step-2 table; `RequireAuthorable` accepts NONE+ABSTRACT on a create, refuses NONE without it,
    statements under it and NONE off a member site; `StTrivia.HasStatements` (text left after whitespace, comments,
    BOM — a pragma counts). CODESYS driver: an accessor's null body is "leave it alone" (`Accessor.Body`, was
    `Accessor.Code`) — the one driver line, needed by `OnlyChanged`'s accessor drop; TwinCAT driver unchanged.
    `scripts/corpus-migration.ts` no longer excludes NONE owners. Wire vocabulary census: `BodyFormatGuard.cs`
    UNSUPPORTED raise sites 9 → 12 (the same situation). DIALECT C2n: the headline and the "differs by vendor"
    sentence rewritten, a "Unified" paragraph appended (no divergence left; the class stays below the wire).
  - **vendor-facts:** no new row. `abstract-member-code`'s `fetched*` reads are the shipped bridge's fetch, so they
    changed with it — exactly every empty abstract slot `IMPLEMENTATION ST` → `NONE`, code and comment bodies and
    everything else unchanged: CODESYS 7 facts, TwinCAT 9 (`--write`: 30.0 s / 24.8 s; confirming runs "every fact
    as committed": CODESYS 30.4 s, TwinCAT 24.9 s; `VOLT_VENDOR_FACTS_INSTANCE=abstract-member-parity`).
- [x] 3.3 Live: e2e on CODESYS SP21 and TwinCAT (both up, so the vendor-parity suite runs), re-pull pro2193 and check
      exactly its abstract members change; full e2e on both vendors green.
  - Both up (`ide.ps1 up -Instance abstract-member-parity`; CODESYS SP21 `CodesysTestProject` copy, TwinCAT
    `-Fixture 14`): `vendor-parity.test.ts` 14 pass / 0 fail (33.5 s); `items/abstract-member.test.ts` 2 pass on each
    vendor (the migration: created, pulled back byte-identical; members come back in the same order on both).
  - **pro2193 re-pulled live** (CODESYS serving `Pro2193-94-95-96_COdesys.project`, `bun run refresh:corpus pro2193
    codesys`, 8106 files): exactly ONE line changes — `ModuleWithStateFB.pou` `Cyclic`'s `IMPLEMENTATION ST` →
    `IMPLEMENTATION NONE` (kept in the corpus); the 11 slotless lines unchanged. The pull also moved 595 library files
    out of `Library Manager/(unresolved)/` (the pulling IDE's placeholder resolution, as in `abstract-member-push`
    3.2 — not this change's) — reverted. `items/abstract-member.test.ts` on pro2193: 5 pass / 0 fail (38.5 s).
    LSP `bun test test/corpus` 19 pass / 1 skip / 0 fail.
  - **Full e2e:** CODESYS 352 pass / 17 skip / 0 fail (369 tests, 354 s); TwinCAT 351 pass / 18 skip / 0 fail (369
    tests, 1249 s).
  - Offline: `Volt.Engine.Tests` 2362 pass / 1 skip / 0 fail; `Volt.Ide.Codesys.Tests` 317 pass; `Volt.Ide.Twincat.Tests`
    453 pass; `Volt.Cli.Tests` 264 pass; `Volt.Repo.Gates` 160 pass; volt-cli `bun test test/unit` 78 pass;
    `bun run typecheck` (volt-cli) clean; `bun run lint` exit 0. No LSP source, conformance fixture or transpiler
    change — the fixture map is not affected (not regenerated); no known-divergence mark exists for this rule.
  - **Gate 3 (review findings, 4 handled; none skipped as wrong):**
    1. *vendor-facts `fetched*` vs DIALECT C2n.* Right: `abstract-member-code`'s `fetched*` reads are the shipped
       bridge's fetch (Volt's answer), so 3.2's re-record flipped them ST → NONE while C2n's "Re-measured" paragraph
       still cited them for `IMPLEMENTATION ST`. C2n's paragraph is marked SUPERSEDED in part and points at the pre-fold
       snapshot (`git show c104d83c94:packages/volt-cli/scripts/vendor-facts.twincat.json` / `.codesys.json`); the
       vendor's storage fact stays in the current `file.*` / `implementation.*` / `body.*` rows. design.md step 3
       point 4 corrected: "every fact as committed" holds for every row EXCEPT `fetched*`, which never recorded the
       vendor. Snapshots unchanged (their values came from the recorder).
    2. *Three guard rows untested.* Added to `AbstractMemberParityTests` (+8 cases), each shown red by deleting its
       branch in `BodyFormatGuard.Check` (then restored, byte-identical): C2l "NONE, not D over a live NONE, not L →
       accepted" (`ConcreteSlotlessIde`: a slotless `METHOD Pick` and a slotless GET under `PROPERTY PUBLIC Busy`, no
       ABSTRACT; a declaration edit lands, no body written — deleting `if (live.IsNone) return;` turns it red, 2
       cases); "ST (any), not D over a live NONE, not L → refused" (code and empty, METHOD and GET, "no body slot" +
       `volt pull`, nothing mutated — deleting the refusal turns 4 red); "NONE, D over a live LD → language rules
       (N24)" at engine level (`BodyFormatGuard.RequireWritable`: the vendor asked exactly once, `(method|property_get,
       LD, ST)`; accepted where it writes, refused with its reason where not — skipping the NONE → ST conversion turns
       2 red).
    3. *LSP wording.* `implementation-line.ts`'s NONE-with-code diagnostic now says what `StReader` says ("That line
       states an abstract member, and an abstract member holds no code (both compilers refuse it: \"must not contain
       any statements\")"), and its two doc comments no longer say "no body slot". Its two tests
       (`implementation-line.test.ts`, `server/implementation-keyword-diagnostics.test.ts`) asserted the old words —
       premise changed by 3.2's StReader wording (one file, one message, both readers), not adapted to the code;
       updated to "an abstract member holds no code", red against the old message. The three editor-silent push
       refusals: NONE under a non-ABSTRACT member is NOT a gap — the push accepts it where the IDE holds it so (C2l),
       which the editor cannot see, so a diagnostic would be a false positive; NONE at an item/action body and
       statements under ABSTRACT (C0433) are recorded as "niche: accepted loss (0 occurrences in the corpora)" — the
       six corpora hold 12 `IMPLEMENTATION NONE` lines in 7 pro2193 files, every one under an ABSTRACT METHOD or
       PROPERTY, and 0 abstract members with code; the first needs the body-owner split the parser does not carry
       (`BodyOwner` is `member | pou-or-accessor`), the second a C0433 conformance fixture + recording.
    4. *Migration not shown live; e2e never red against the old bridge.* Offline: `AbstractMemberParityTests
       .A_pre_upgrade_version_is_stale_until_a_pull_which_changes_only_the_abstract_lines` (the version is the hash of
       the folded text; the pre-upgrade text's hash → `STALE_ITEM_VERSION`, nothing written; the pull differs in
       exactly the 3 abstract lines ST → NONE; the same edit at the new version lands; red against the old source by
       construction — the old pull IS the pre-upgrade text). Live, against the PRE-CHANGE bridge (a detached worktree
       of `c104d83c94` built and served with `ide.ps1 up -Instance abstract-member-parity`, the new e2e files copied
       in; worktree deleted after): `items/abstract-member.test.ts` 0 pass / 2 fail on TwinCAT (`-Fixture 14`) and
       0 / 2 on CODESYS SP21 (the create refused "a created member has a body slot"); `vendor-parity.test.ts` 11 pass /
       3 fail — exactly the 3 new abstract cases. STALE live on TwinCAT: the old worker created `VltE2E_AbsStale.pou`
       (abstract method + abstract property GET/SET) and fetched it — `IMPLEMENTATION ST` ×3, version
       `e2e954481e1d14e8`; the worker swapped for the NEW build on the same XAE: a declaration edit at the old version
       → `STALE_ITEM_VERSION` ("item changed since you fetched its version"), current `edb645e04531a0c5`; the re-fetch
       differs in exactly lines 10/15/18 `IMPLEMENTATION ST` → `IMPLEMENTATION NONE`; the pre-upgrade edit (ST lines
       kept) pushed at the new version → accepted, and pulls back NONE ×3 with the edit (the pushed-side fold); item
       removed. The new e2e on the new worker: `abstract-member.test.ts` 2 pass / 0 fail. CODESYS STALE not run live
       (its bridge is in-proc, a swap reopens the fixture); the gate is engine code shared by both vendors.
  - Gate 3 numbers: `Volt.Engine.Tests` 2371 pass / 1 skip / 0 fail (2362 + 9); `Volt.Ide.Codesys.Tests` 317;
    `Volt.Ide.Twincat.Tests` 453; `Volt.Cli.Tests` 264; `Volt.Repo.Gates` 160; `Volt.Contracts.Tests` 34;
    `Volt.Connector.Tests` 115 (all 0 fail); volt-cli `bun test test/unit` 78 pass / 0 fail; `bun run typecheck` clean
    (5 packages); `bun run lint` exit 0 (warnings only); LSP full suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset)
    9525 pass / 35 skip / 421 todo / 0 fail (9981 tests, 327 files, 851 s). No conformance fixture or transpiler change — the fixture map is not affected (not regenerated).
