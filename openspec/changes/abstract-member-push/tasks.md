## 1. Measure

- [x] 1.1 The abstract PROPERTY accessor's slot on CODESYS (`vendor-facts` `merged-classes`, `implementation.busyget`)
      and an abstract method's and accessor's slot on TwinCAT (a `vendor-facts` row, never a probe script).
  - CODESYS half measured 2026-10-11 (`vendor-fact-probe` gate 3): the abstract method and the abstract property's
    GET (`InterfacePropertyAccessorObject`) both have NO `Implementation`.
  - **TwinCAT measured 2026-10-11: an abstract member HAS a body slot — the bug is CODESYS-only, no TwinCAT twin
    test (3.1).** New row `abstract-member-slot` (C2n, TwinCAT; `[PROBE: abstract-member-slot]` on DIALECT C2n, which
    now carries the finding), snapshot in `scripts/vendor-facts.twincat.json`, two agreeing runs on Project14
    (`VOLT_E2E_INSTANCE=abstract-member-push bun scripts/vendor-facts.ts twincat --only abstract-member-slot [--write]`;
    11.5 s / 13.8 s; the second "every fact as committed"). The runner now takes its instance from
    `VOLT_VENDOR_FACTS_INSTANCE` (default `vendor-fact-probe`; review fix in the gate, below), so a change runs it on its
    own `ide.ps1` instance. Values, on a `FUNCTION_BLOCK ABSTRACT`:
    - classes: FB `ItemType 604`, method `609` (script-made and push-made alike), property `611`, GET `613`.
    - `item.ImplementationText`: `""` on the script-made `METHOD ABSTRACT Pick` (CreateChild 609 + declaration) after
      the create and after save/close/reopen (`implementation@script-made`, `@saved`; not read after the edits); `""`
      on the push-made one (pushed in the shape Volt's text writer produces: `IMPLEMENTATION ST`, empty body) and on the
      push-made `PROPERTY ABSTRACT Busy`'s GET after the push, after save/close/reopen and after the edits
      (`implementation.pmethod|pget@push-made|saved|property-edited`); `null` on the property itself (as on any
      property).
    - saved `.TcPOU`: `<Implementation>` with an empty `<ST>` under both methods and under the GET (`file.*`).
    - the CODESYS-refused round trip is ACCEPTED on TwinCAT: the owner's pulled text with a line added under
      `METHOD ABSTRACT Pick : INT`, then under `PROPERTY ABSTRACT Busy : BOOL`, pushed back — both accepted, both lines
      landed (`declaration.*@property-edited`).
    - a body written at the abstract method through the vendor API (`ImplementationText = "Pick := 1;"`) is accepted
      and reads back right after the write (`body`) — TwinCAT does not refuse a body on an abstract method at write
      time. Whether it survives a save/reload is NOT measured (no read after the write).
    - found on the way: a property CreateChild (611) makes NO Get/Set child (the first run's `find 'Get'` answered 0
      items); the push creates the GET itself (613), so the row makes its property only through the push.
    - not measured, refused by name in the row (`ide-authored`): an abstract member made by the XAE's own Add Method
      dialog — 0 ABSTRACT texts in Project13, Project14 and `twincat-project14`, and the CODESYS corpora hold no
      `.TcPOU`.
  - NOT recorded: the fetched wire text of a TwinCAT abstract member (no key holds `VltA_PushBase.pou`'s pulled
    text). That today's TwinCAT pull writes `IMPLEMENTATION ST` + empty body under one is inferred — the slot reads
    `""` (not null) and `StWriter` writes the line under every non-null body — not measured; the edits above were
    pushed in that writer shape, so "the pulled text" there means the shape Volt writes, not a recorded pull.
  - Consequence for 2.1: a TwinCAT abstract member has the slot (measured) and accepts `IMPLEMENTATION ST` + empty
    body on push (measured), so the text form must be able to carry that for it; "no body slot" is a CODESYS-object
    fact, not one the `ABSTRACT` keyword decides — so the declaration's `ABSTRACT` alone cannot pick the form on both
    vendors. 2.1 records the fetched TwinCAT text (a `vendor-facts` read) before relying on what today's pull writes.
  - **Gate 1 (2026-10-11): two review findings, both fixed.**
    - `vendor-facts.ts` read `VOLT_E2E_INSTANCE` for the instance it `up`s and `down`s, so a vendor-facts run would
      restart and then close a live e2e IDE that variable names. Now its own `VOLT_VENDOR_FACTS_INSTANCE` (unset =
      `vendor-fact-probe`; set but empty refused by name) via `instanceOf(env)`; red first in
      `test/unit/vendor-facts.test.ts` ("runs on its own instance"), then green. README + header updated.
    - The 1.1 TwinCAT bullets and DIALECT C2n said more than the snapshot measured: narrowed to the keys that exist
      (script-made method not read after the edits; `body` read only right after the write; the fetched TwinCAT wire
      text not recorded, so "today's pull writes `IMPLEMENTATION ST`" is marked inferred and 2.1 records it first).
    - Numbers: volt-cli `tsc` clean; `bun test test/unit` 75 pass / 0 fail (was 74 + the new test); `dotnet test
      Volt.sln` all green — Repo.Gates 160, Contracts 34, Twincat 450, Relay 62, Connector 115, Engine 2307 (+1 skip),
      Codesys 309 (+1 skip: `CodesysAbstractMemberPushTests`, red until 3.1), Cli 264; `openspec validate` valid. No
      LSP, fixture or transpiler change (fixture map not regenerated).

## 2. Design

- [x] 2.1 Decide the text form that tells "no body slot" from "empty body" on both vendors (proposal, What Changes),
      and whether the LSP parser changes with it.
  - **Decided (design.md): `IMPLEMENTATION NONE`, stated by the driver where it read no slot; the LSP parser changes.**
    Checked against the code 2026-10-11, which changed three points of the first draft (design.md says why):
    - in memory the no-slot body IS its line (as an UNSUPPORTED body is), not null — null is today's EMPTY body on
      both vendors (CODESYS `BodyText`; `BeckhoffDriver.ReadBody` blank/empty → null), so "null = no slot" would write
      NONE under every empty TwinCAT body. Only `CodesysDriver.ReadBody`'s `impl is null` arm changes; `BodyText` stays.
    - NONE only at a site whose kind's row has a body: `ReadBody` also runs for interfaces, interface members and a
      property's own object, which have no `Implementation` aspect and are written with no line.
    - NONE over a member that HAS a slot is REFUSED by `BodyFormatGuard` (as UNSUPPORTED over ST), not sent as null; NONE
      on a created member is refused (`Authorable`).
    - TwinCAT is untouched (its abstract members have a slot), so the fetched TwinCAT text is no longer relied on; 3.2
      records it as the check that it stays `IMPLEMENTATION ST`.
    - LSP: `implementation-line.ts` `statementOf` reads `IMPLEMENTATION NONE` as no boundary today, so a re-pulled
      pro2193 owner would be reported "states no language" — the parser must change in 3.2.
  - Numbers (six corpora, counted 2026-10-11): 12 ABSTRACT member texts, all pro2193 — 11 METHOD + 1 PROPERTY (`Busy`,
    its GET) in 7 owner files, every one `IMPLEMENTATION ST` with no code under it; 0 in the other five corpora; 0
    `IMPLEMENTATION NONE` lines anywhere. No code, test or fixture changed in this step.
  - **Gate 2 (2026-10-11): five review findings, all fixed in design.md / spec.md** (design-only, so no failing test
    first — there is no code to make red; each becomes a test in 3.x):
    - (medium) the `impl is null` arm folds a read failure (`iobj is null`), "type declares no `Implementation`" and
      "declared, holds null". Design now: `iobj` null at a body site is refused by name; NONE only for
      `!NwlInterop.Has(iobj, "Implementation")`; "declared, null" refused by name until 3.2 FIRST measures which case the
      slotless classes are (new `vendor-facts` key — the 1.1 `implementation` key cannot tell them apart). Spec scenario
      added.
    - (low) the "12" is a TEXT count: a `POUMethodObject` with ABSTRACT text has a slot. 3.2 now classifies the 12
      pro2193 objects before the re-pull and the oracle is two-sided per site (exactly the listed slotless sites change —
      fewer or more is a finding).
    - (low) NONE is NOT reserved as a vendor language: `VendorLanguage` is on the read path and a throw drops the whole
      POU from fetch. A vendor language spelled NONE keeps `IMPLEMENTATION NONE UNSUPPORTED`, read apart from
      `IMPLEMENTATION NONE` by its UNSUPPORTED word. Spec scenario added.
    - (low) design and spec now agree: both NONE refusals (ST over live NONE, NONE over a slot) name the member and
      `volt pull`; NONE-over-slot gets its own message, not the UNSUPPORTED one.
    - (low) a rename/retype of a pulled abstract member (delete + create) is now refused where today it is accepted;
      listed among the refusals, with the remedy the message names (change the line to `IMPLEMENTATION ST`). Spec
      scenario added.
    - Numbers: `bun run typecheck` clean (all 5 packages); volt-cli `bun test test/unit` 75 pass / 0 fail; `dotnet test
      Volt.sln -c Release` (VOLT_REQUIRE_FULL=1) all green — Repo.Gates 160, Contracts 34, Twincat 450, Relay 62,
      Connector 115, Engine 2307 (+1 skip), Codesys 309 (+1 skip: `CodesysAbstractMemberPushTests`, red until 3.1), Cli
      264 — unchanged from gate 1; `openspec validate` valid. No code, LSP, fixture or transpiler change (fixture map
      not regenerated).

## 3. Fix

- [x] 3.1 Un-skip `CodesysAbstractMemberPushTests` (red: the refusal above); the TwinCAT twin if 1.1 finds the same.
  - Un-skipped; red first against HEAD's producer (`Failed: 1`, the D26 refusal), green with the fix, assertion as
    committed. Its `Method(decl, null!)` double is exactly the measured class (below: case (c)), so only the Skip went.
  - No TwinCAT twin (1.1 measured a slot). Stand-in: `TcAbstractMemberSlotTests` — a TwinCAT abstract method and
    abstract property GET (`ImplementationText` `""`) pull as `IMPLEMENTATION ST`, never NONE.
- [x] 3.2 The fix at the producer; DIALECT C2n updated; a live e2e round trip of an abstract member on CODESYS.
  - **Measured first** (`vendor-facts` `merged-classes`, new keys `implementation-declared.*` = `object.$methods("get_Implementation")`,
    `implementation.*` and `class.*` over all 12 ABSTRACT texts; run 1 compare + run 2 `--write` + run 3 "every fact as
    committed", 145/144/148 s): **every slotless object DECLARES `Implementation` and holds null — case (c), not (b).**
    So the design's "(c) is refused" was revisited with that number (as it said): NONE = declared-and-null at a body
    site; (b) "declares no `Implementation`" (measured on no object) and (a) "no object" are refused by name.
  - **The expected set** (classified before the re-pull): 11 slotless sites — `AbstractPOUMethodObject` ×10
    (`TakePicture`, `GetProducts`, `Alarms` ×2, `ManualControl`, `Reset`, `EStop`, `Execute`, `Execute_Sequence1`,
    `Stop`) + the `Busy` GET (`InterfacePropertyAccessorObject`); `ModuleWithStateFB.Cyclic` is a `POUMethodObject`
    with ABSTRACT text and an `STImplementationObject` (has a slot → stays ST).
  - **Producer**: `CodesysDriver.ReadBody(iobj, scope, bodySite)` — body site per `ItemKind.ShapeOf` (POU; method/
    action; accessor of a POU property); interface, interface members, a property's own object untouched; ST arm and
    `BodyText` untouched. `ImplementationMarker`: `NoneWord`/`NoneLine`, `IsNone`, `Parse`/`Canonical`/`Split`/`Join`,
    `Written` → null; `IMPLEMENTATION NONE UNSUPPORTED` stays a hidden vendor language (`VendorLanguage` does not
    reserve NONE). `StatedLanguage.None` (`NoSlot`), distinct from `HiddenIn("NONE")`. `StReader`: NONE line → body
    `IMPLEMENTATION NONE`, code under it `INVALID_ST` by name. `BodyFormatGuard`: NONE over NONE no-op; body over NONE,
    NONE over a slot, NONE on a create/rename/retype refused before any write naming the member and remedy.
  - **LSP**: `implementation-line.ts` statement `{ kind: "none" }` (boundary, read by neither parser, code under it
    reported); `routines.ts` names an abstract member's refusal ("is abstract: it has no body slot"). VS Code grammar
    colours the line.
  - **Migration**: pro2193 re-pulled live (`refresh:corpus`, 8106 files): exactly the 11 listed sites flip
    `IMPLEMENTATION ST` → `IMPLEMENTATION NONE` in the 7 owner files, `Cyclic` stays ST, nothing else in those files.
    FINDING, not this change's: the pulling IDE resolved pro2193's library placeholders, moving 595 `(unresolved)`
    library files into named library folders (577 byte-identical, 18 differ, 1 new) — reverted, only the 7 owners kept.
    Corpus gate: `REACH` 54 → 53 and `ROUTINES` 14 → 13, attributed per POU (`probe-lowering-refusals.ts` before/after):
    `ActuatorWithAlarm_BaseFB` "lowered" only by running its own abstract `Alarms` as an empty body — the same
    correction as 2026-09-28. `corpus-migration.ts` counts a NONE owner as unauthorable (a create refuses NONE).
  - **Live**: `merged-classes` `pushed` step (a line after `TakePicture`'s signature in `VisionSystem_BaseFB`'s pulled
    text, through the shipped push): accepted, `decl@pushed` landed, `guid|class.abstract@pushed` unchanged (run 4
    `--write` 187 s, run 5 "every fact as committed" 208 s). e2e `test/e2e/items/abstract-member.test.ts` on the
    pro2193 copy (`-Instance abstract-member-push`): 3 pass — pulls NONE ×2, the edit lands and still pulls NONE, ST
    there refused naming `'TakePicture'` and `volt pull`, version unchanged.
  - Tests added: `AbstractMemberNoSlotTests` (9, Engine on `FakeIde`, which now models `NoSlot` + D26's backstop),
    `ImplementationKeywordTests` +6, `CodesysAbstractMemberPushTests` +3, `TcAbstractMemberSlotTests` 1, LSP
    `implementation-line.test.ts` +3, `implementation-keyword-diagnostics.test.ts` +1, `routines.test.ts` +1, VS Code
    grammar +2 rows. Census: `WireVocabularyTests` INVALID_ST StReader 19→20, UNSUPPORTED BodyFormatGuard 5→8,
    UNSUPPORTED/UNREADABLE CodesysDriver.Content 1→2 each.
  - **Gate 3 (2026-10-11): five review findings — three fixed, one fixed in docs with an open owner sign-off, one skipped
    as wrong.**
    - (medium, FIXED) NONE over NONE with `ABSTRACT` removed from the declaration was accepted: the guard returned at the
      no-op and the driver wrote plain `METHOD` text into an `AbstractPOUMethodObject`, which stays abstract (C2l).
      Red first (`AbstractMemberNoSlotTests` +2: the method, and the abstract property whose GET has no slot — 2 failed
      on the tree), then green: `BodyFormatGuard.Check` now takes the live and pushed declaration (the member's, or its
      property's for an accessor) and refuses a REMOVAL of ABSTRACT over a live NONE as a re-type, naming the member and
      the routes, before any write (`StReader.MemberHeaderIsAbstract`, the modifiers between keyword and name; a slotless
      member already held without ABSTRACT, pushed back unchanged, stays a no-op). design.md's "removing ABSTRACT is a
      re-type (C2q)" — which no code path did — replaced by this rule; spec scenario added; DIALECT C2n lists it. 0
      occurrences in the corpora (it needs a user edit).
    - (low, DOCUMENTED, owner sign-off open) the vendors' wire text differs for the same `METHOD ABSTRACT` declaration
      (CODESYS NONE, TwinCAT ST), so a cross-vendor or blank-project migration refuses pro2193's 7 NONE owners (each by
      name with the `IMPLEMENTATION ST` remedy) that it used to create. design.md now records the divergence, the two
      measured-and-rejected alternatives (ABSTRACT decides; drop `""` in the driver), the cost in both directions and the
      7 owners; DIALECT C2n names it. Not changed in code: the line states the vendor OBJECT, which differs (measured).
      Default shipped: the divergence; the owner's sign-off is asked at the close.
    - (low, SKIPPED — wrong) "an `IMPLEMENTATION NONE` line inside a `(* *)` comment of an ST body is now refused on
      read": it is not — `StatedLinesIn` skips every line inside a comment, exactly as for `IMPLEMENTATION CFC`. Pinned:
      `ImplementationKeywordTests.An_ST_body_without_a_keyword_line_is_handed_up_unchanged` + the row
      `(*
IMPLEMENTATION NONE
*)
x := 1;` (green on the tree). The line OUTSIDE a comment is refused, as every other
      boundary line is (`An_ST_body_holding_the_NONE_line_is_refused_on_the_read`), and such ST does not compile in the
      IDE; 0 such ST lines in the six corpora (the 7 `IMPLEMENTATION NONE` lines there are the owners' boundaries).
    - (low, FIXED) `ReadBody`'s UNREADABLE refusal of a null object could not be reached from the IDE: the site's kind is
      classified from the same object (`KindCodeOf`), and every non-action site reads its declaration through it first
      (`TryReadAspectText` refuses a missing object). Now a driver invariant (`InvalidOperationException`, counted in the
      uncoded-throw census) instead of a wire code; census UNREADABLE CodesysDriver.Content back 2→1, uncoded 1→2;
      UNSUPPORTED BodyFormatGuard 8→9 (the re-type refusal). Spec scenario reworded to the read that refuses it.
    - (low, FIXED) design.md "Design: the fix" still described the replaced producer: steps 2 and 4, the Rejected item
      and "Stays refused" now state (c) → NONE as measured, (b) refused, (a) an invariant; the 2.1 Producer paragraph is
      marked as the pre-measurement plan superseded by "Measured in 3.2".
    - Numbers: `bun run typecheck` clean (5 packages); `bun run lint` exit 0; `openspec validate` valid; `dotnet test
      Volt.sln -c Release` (VOLT_REQUIRE_FULL=1) all green — Repo.Gates 160, Contracts 34, Twincat 451, Relay 62,
      Connector 115, Engine 2325 (+1 skip), Codesys 313, Cli 264; volt-cli `bun test test/unit` 75 pass / 0 fail;
      volt-vscode `bun test` 40 pass / 0 fail; volt-lsp-iec full `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset)
      9525 pass / 35 skip / 421 todo / 0 fail (9981 tests, 327 files, 769 s); `rate:fixtures` (3m28s) left `map.generated.ts` unchanged (edge agree 3261 / disagree 0 / not-run 219).
