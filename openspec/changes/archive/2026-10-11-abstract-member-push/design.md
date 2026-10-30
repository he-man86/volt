> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

## Design: no body slot vs empty body (2.1)

**Target.** A member's text says which of three things the IDE holds, on both vendors: a body (`IMPLEMENTATION ST` +
code), an EMPTY body (`IMPLEMENTATION ST`, nothing under it), or NO body slot. The push sends `""` for the second and
null ("leave the IDE alone", as for an UNSUPPORTED body) for the third, so `RequireSlot` (D26) never sees a body at a
slot the object lacks.

**Choice: a stated line, `IMPLEMENTATION NONE`** — "this member has no implementation", alone on the line, nothing
under it. It is written only where the driver read NO slot (CODESYS: `Implementation` aspect missing —
`AbstractPOUMethodObject`, and the abstract property's `InterfacePropertyAccessorObject` GET). Absence of the slot is a
vendor-OBJECT fact, so the driver states it and the text carries it; no keyword in the declaration decides it.

Rejected, one line each:
- **ABSTRACT decides** — measured wrong on TwinCAT: an abstract method and GET HAVE a slot (`""`) and accept a pushed
  body (1.1, `abstract-member-slot`); on CODESYS a `POUMethodObject` with ABSTRACT text is abstract too (C2n) and has one.
- **No line under a slotless member** — absence would carry meaning: a member that LOST its line (a stale or hand-edited
  file) would read as "no slot" instead of being refused (`StReader.Unmarked`, the LSP's same report); "the line decides".
- **Bare `IMPLEMENTATION`** — today that is the named lookalike "states no language"; giving it a meaning drops that hint.
- **Driver drops `""` at a missing slot** — D26 refused exactly this ("the producer is fixed, not a driver table"); it
  would also swallow code an engineer writes under an abstract member.
- **A null body means "no slot"** (and an empty body becomes `""` everywhere) — checked against the code 2026-10-11 and
  rejected: null is today's word for an EMPTY body on BOTH vendors — CODESYS `BodyText` maps a blank ST body to null,
  `BeckhoffDriver.ReadBody` returns null for a blank `ImplementationText` (`IsNullOrWhiteSpace`) and for an empty ST body,
  and `BodyFormatGuard.StatedOf` documents "TwinCAT stores an empty ST body as no text at all". Giving null the new
  meaning would write `IMPLEMENTATION NONE` under every empty TwinCAT body (which HAS a slot), and any producer that
  missed the switch would turn a missing fact into a stated one. The first draft of this design had this shape
  (`ReadBody` stops folding, `StWriter` writes NONE for null); it is replaced by the representation below.

**Representation.** The no-slot body IS its line, `IMPLEMENTATION NONE` — exactly as a hidden body IS its UNSUPPORTED
line (`ImplementationMarker.IsUnsupportedBody`, `Split`/`Join`): `StWriter` and `StReader` carry it with no new field,
the driver's read and the file's read give the SAME in-memory body (so `OnlyChanged`/reconcile see no difference on an
unedited owner), and `Written` maps it to null. Its `Stated` (D6) is a value of its own (`IMPLEMENTATION NONE`, not a
language), which the guard reads as a hidden body (below). Null and `""` keep meaning what they mean today.

**Producer.** Only the `impl is null` arm of `CodesysDriver.ReadBody` changes, and only for the ONE fact it means to
state. Today that arm folds three facts into one null (gate 2 review): (a) `iobj is null` — `ReadObject` answers null
whenever the object manager is missing, a READ failure, not a vendor fact; (b) the object's type does not declare
`Implementation` — the real "no slot"; (c) the type declares it and it holds null. `NwlInterop.Get` answers null for both
(b) and (c); `NwlInterop.Has` is the split. At a site whose kind's row has a body (below), the PLAN before the
measurement — superseded by the next paragraph, kept as the decision record:
- (a) is refused by name (the object the site names could not be read) — never stated as NONE, which would make a
  missing fact a stated one and have the guard refuse every push of that POU as "NONE over a member with a slot";
- (b), `!NwlInterop.Has(iobj, "Implementation")`, is the NONE body;
- (c) is refused by name until it is measured. The 1.1 key `implementation` (`object.Implementation.$type`, "null = no
  such aspect") does not tell (b) from (c), so 3.2 FIRST adds a `vendor-facts` key that does (whether the type declares
  the member, on `abstract` and `busyget` in `merged-classes`) and states NONE only for the case that key measures; if
  the measured classes are (c), the design's "(c) is refused" is revisited with that number, not assumed.

**Measured in 3.2, and the producer revisited with it** (`merged-classes` `implementation-declared.*`, two agreeing
runs): every slotless object — the 10 `AbstractPOUMethodObject`s and the `Busy` GET — DECLARES `Implementation` and
holds null; every object with a slot holds an aspect, an empty ST body included. So the measured "no slot" is (c), and
the producer states NONE for (c); (b), a type without the member, is the one measured on no object and is refused by
name (another or unpinned assembly); (a) is never stated NONE — and, found by the gate 3 review, it cannot reach the body
read from the IDE at all (the site's kind is classified from the same object, and the declaration read refuses a
missing object first), so `ReadBody` checks it as a driver invariant (`InvalidOperationException`), not a wire refusal.

The ST arm and `BodyText` are untouched (a blank ST body stays null → `IMPLEMENTATION ST`, as written today), so
no empty body's text changes. NONE is stated only at a site whose kind's row HAS a body (`ItemKind.ShapeOf`): the POU's
own body, a method's or action's in a POU (not `MembersInside`), a property accessor in a POU (`WithBodies`).
`ReadBody` is also called for an interface, an interface's members and a property's own object — none has an
`Implementation` aspect and none is written with a line (`StWriter.AssembleChild`/`AssembleProperty`), so those stay
null; stating NONE there would put a body in memory the file reader never produces. TwinCAT is not touched: its
abstract members have a slot (1.1), it never states NONE, and it keeps writing `IMPLEMENTATION ST` under them. So the
fetched TwinCAT text 1.1 asked for is no longer RELIED on by this design; 3.2 records it (a `vendor-facts` key or the
e2e) as the check that it stays `IMPLEMENTATION ST`. `ImplementationMarker` owns the spelling (`Parse`, `Written` →
null, `Canonical`, `Split`/`Join`).

**LSP: yes, the parser changes** — `frontend/syntax/format/implementation-line.ts` mirrors the grammar: `NONE` is a
boundary line whose body neither parser reads (as UNSUPPORTED), and code under it is reported as the push refuses it.
Today `IMPLEMENTATION NONE` is no boundary there (`statementOf`: an unknown word without UNSUPPORTED), so a re-pulled
pro2193 file would be reported "states no language" — the parser MUST change with the bridge.

**Push, by the guard (`BodyFormatGuard`), before any write** — NONE is treated as a hidden body:
- NONE over a live NONE (the unedited abstract member): the ordinary no-op; the declaration edit beside it lands.
- `IMPLEMENTATION ST` (empty or with code) over a live NONE: refused, naming the missing slot and `volt pull` — a
  workspace pulled before this change holds exactly that, so it keeps today's refusal with a better message.
  `RequireSlot` (D26) stays the driver's backstop.
- NONE over a live NONE with `ABSTRACT` REMOVED from the declaration (the member's own, or its property's for an
  accessor): refused as a re-type (gate 3 review). The reconciler does not see it — same name, same kind — and NONE
  writes no body, so without this the push wrote plain `METHOD` text into the `AbstractPOUMethodObject`, which stays
  abstract whatever its text (C2l), and reported success over a member the file calls concrete. Only a REMOVAL is
  refused (`StReader.MemberHeaderIsAbstract` on live vs pushed): a slotless member the IDE already holds without
  ABSTRACT, pushed back unchanged, changes nothing. The message names the member and the routes (make it concrete in
  the IDE and `volt pull`, or delete and re-add it with `IMPLEMENTATION ST` over two pushes).
- NONE over a live member that HAS a slot (any live body that is not NONE): REFUSED, as an UNSUPPORTED line over an ST
  body is (the guard's rule: a hidden line over a body it is not would silently do nothing). The first draft let it
  travel as null; that is the silent no-op the guard exists to stop. Its message is NONE's own, not the UNSUPPORTED
  one (which names no remedy): it names the member, says the IDE holds a body slot there, and names `volt pull` (the
  stale-file case: the member was made concrete in the IDE) and `IMPLEMENTATION ST` (the hand-edit case). Both NONE
  refusals — this one and ST over a live NONE — name the member and `volt pull`, as the spec's scenario states.
- NONE on a member the push CREATES: refused (`Authorable`) — CODESYS's create makes a `POUMethodObject`, which has a
  slot (C2n), so the next pull would contradict the file; an abstract member is created with `IMPLEMENTATION ST`.
  **This refuses an edit accepted today:** the reconciler turns a member RENAME or RETYPE into delete + create
  (`RequireWritable`: "not in the IDE under this name and kind … is a CREATE"), so renaming a pulled abstract method
  (its file says `IMPLEMENTATION NONE`) is refused, where today the renamed member is created as a `POUMethodObject`
  with an empty ST body. Nothing is lost silently; the refusal names the member and the remedy — change its line to
  `IMPLEMENTATION ST` and push again (the created member then has a slot, and the next pull writes
  `IMPLEMENTATION ST`, matching the file) — not the generic "can only be created in the IDE".

**Stays refused by name:** code under `IMPLEMENTATION NONE` (no slot to write it to — the reader, like code under an
UNSUPPORTED line). **NONE is NOT reserved as a vendor language.** `ImplementationMarker.VendorLanguage` is on the READ
path (`NetworkText.ViewLanguage` for an unknown view mode, `CodesysDriver.UnreadLanguage` / `TcArchive.UnreadLanguage`
for an unknown aspect or archive root), and a throw there makes `Versioning.SafeVersion` mark the item UNREADABLE and
`FetchService` drop it from `changed`, `items` and `folders` — the whole POU lost for a name (gate 2 review). So a body
in a vendor language spelled NONE keeps today's answer, `IMPLEMENTATION NONE UNSUPPORTED`: a hidden body of that
language, told apart from `IMPLEMENTATION NONE` by its UNSUPPORTED word exactly as `IMPLEMENTATION LD` is from
`IMPLEMENTATION LD UNSUPPORTED` — the line decides, both readers (C# and LSP) parse the two apart, and its `Stated` is
`HiddenIn("NONE")`, a different value from the no-slot one. 0 of either in the six corpora (no view mode, aspect or
archive root spelled NONE), so nothing in the corpora exercises it; a src test pins that the two lines read apart.

**Migration.** A re-pull rewrites, from `IMPLEMENTATION ST` to `IMPLEMENTATION NONE`, exactly the members of pro2193
whose OBJECTS have no slot — which is at most the 12 ABSTRACT member texts (11 METHOD bodies and 1 PROPERTY GET, 7 owner
files; counted 2026-10-11 from TEXT, every one `IMPLEMENTATION ST` with no code under it; 0 ABSTRACT member texts in the
other five corpora; 0 `IMPLEMENTATION NONE` lines anywhere). The 12 is a text count, not an object count (gate 2
review): on CODESYS a `POUMethodObject` with ABSTRACT text is abstract too and HAS a slot (C2n), and only a script-made
abstract method and the `Busy` GET were measured slotless, so a member behind those 12 texts may legitimately stay
`IMPLEMENTATION ST`. The pro2193 objects behind the 12 were never classified. So 3.2's oracle is two-sided and named
per site: BEFORE the re-pull, the class of each of the 12 members (`AbstractPOUMethodObject`, `POUMethodObject`,
`InterfacePropertyAccessorObject`, …) and whether it declares `Implementation` are read from the opened pro2193 and
listed under 3.2 — that list is the expected set; the re-pull must rewrite EXACTLY the listed slotless sites (fewer is a
finding, as is more) and no other line of any file. Versions hash the written text (`Versioning` →
`Materializer`), so only the owners of the listed sites (at most those 7) see their versions move. Docs: `ImplementationMarker` summary, DIALECT C2n,
`docs/network-text.html` (the line list), the LSP's format notes.

## Design: the fix (3.1–3.2)

**Target.** `CodesysAbstractMemberPushTests` un-skipped and green, with its assertion as committed. A pulled pro2193
owner holding an abstract member pushes back live on CODESYS, keeping the member's GUID and class. No TwinCAT twin:
1.1 measured a slot there. Its stand-in is a TwinCAT test that pins its abstract member staying `IMPLEMENTATION ST`.

**Choice: measure first, then build the fix inside out in one red→green chain.**
1. The `vendor-facts` key `implementation-declared` on `merged-classes`, for `abstract` and `busyget`. It reads
   `NwlInterop.Has(obj, "Implementation")`, i.e. case (b) vs (c). It also classifies the 12 pro2193 ABSTRACT sites
   (class + declared), and that list becomes the migration's expected set. Two agreeing runs, on
   `-Instance abstract-member-push` with `-Fixture` = the pro2193 copy.
2. Red, un-skipped: the test's `Method(decl, null!)` double declares `Implementation` holding null — case (c), which
   step 1 measured on every slotless object, so the double already models the vendor class and only the Skip goes. The
   assertion stays as committed.
3. `ImplementationMarker`: the `None` stated value, `Parse`/`Canonical`/`Split`/`Join`, `Written` → null. It is told
   apart from `IMPLEMENTATION NONE UNSUPPORTED`. Src tests are added next to it.
4. `CodesysDriver.ReadBody` `impl is null` arm, only at body sites (`ShapeOf`): (c) → NONE (measured, step 1), (b)
   refused by name (measured on no object), (a) a driver invariant — unreachable from the IDE, because the site's kind
   is classified from the same object and every non-action site reads its declaration through it first, which refuses
   a missing object (`TryReadAspectText`); so it throws `InvalidOperationException`, not a wire code (gate 3 review).
   The ST arm and `BodyText` are untouched.
5. `BodyFormatGuard`: ST over a live NONE, NONE over a slot, and NONE on a create, each refused before any write with
   the member and its remedy (`volt pull` / `IMPLEMENTATION ST`). Engine tests run on `FakeIde`.
6. LSP `implementation-line.ts`: NONE is a boundary with no body. Code under it is reported, and a src test is added.
7. DIALECT C2n, `network-text.html`, and the LSP format notes are updated. Then the live e2e on the pro2193 copy:
   pull `VisionSystem_BaseFB` (NONE under `TakePicture`), add a declaration line, push → accepted. The line lands, and
   GUID and class are unchanged. A second push with `IMPLEMENTATION ST` there → refused by name.

Rejected, one line each:
- **Model case (b) in the double**: step 1 measured (c) on every slotless object, so a (b) double would model a class
  no project holds.
- **Infer (b) from the 1.1 `implementation` key**: that key reads null for both (b) and (c). Step 1 is the one
  measurement that decides between them.
- **A TwinCAT twin test**: 1.1 measured a slot, so the twin would assert a refusal that cannot happen.
- **Fix only C# and leave the LSP for later**: the re-pulled corpus would report "states no language" on 7 files the
  moment the migration lands.

**Stays refused by name:** code under `IMPLEMENTATION NONE`; NONE on a create, a rename or a retype (with the
`IMPLEMENTATION ST` remedy); ABSTRACT dropped over a live NONE (a re-type, C2l); case (b). Case (a) never reaches the
body read (step 4). `RequireSlot` (D26) stays the driver's backstop.

**Migration.** Re-pull `packages/volt-lsp-iec/test-corpus/pro2193` and diff it against the step-1 list. Exactly the
listed slotless sites flip `ST`→`NONE`, nothing else changes, and the owners' versions move. Then `rate:fixtures` and
the LSP corpus tests run on the new text. `corpus-migration.ts pro2193` creates into a blank project, so it now
refuses the owners that hold NONE. It counts them as unauthorable, as it counts CFC/SFC.

**The wire divergence this makes, and what it costs (gate 3 review).** The same `METHOD ABSTRACT` declaration now pulls
as `IMPLEMENTATION NONE` from CODESYS and `IMPLEMENTATION ST` from TwinCAT (`TcAbstractMemberSlotTests`). The text states
the vendor OBJECT, and the objects differ (measured: CODESYS `AbstractPOUMethodObject` / `InterfacePropertyAccessorObject`
declare `Implementation` and hold null; TwinCAT 609/613 hold `""` and a saved `<Implementation><ST/>`). The memory rule
"wire divergence is a defect" asks for two measured alternatives and the owner's sign-off before a divergence is called
irreducible. The two alternatives, both measured and rejected above: **ABSTRACT decides** (1.1: TwinCAT's abstract
members HAVE a slot and accept a body; CODESYS's `ModuleWithStateFB.Cyclic` is ABSTRACT text on a `POUMethodObject`
with a slot) and **drop `""` at a missing slot in the driver** (D26: "the producer is fixed, not a driver table"; it also
swallows code an engineer writes there). **The cost, both directions:** a cross-vendor or blank-project migration of
pro2193 (`corpus-migration.ts`, CODESYS→TwinCAT or CODESYS→blank CODESYS) refuses the 7 owner files that hold NONE
(`VisionSystem_BaseFB`, `RejectStation_BaseFB`, `ActuatorWithAlarm_BaseFB`, `ActuatorWithManualControlAndAlarm_BaseFB`,
`ActuatorWithManualControl_BaseFB`, `ModuleResettableFB`, `ModuleWithStateFB`), which used to be created as members with
a slot and an empty body — on TwinCAT exactly the measured shape of its abstract members. Nothing is lost silently: each
refusal names the member and the remedy (change the line to `IMPLEMENTATION ST`), after which the create lands as
before. No cross-vendor parity fixture holds an abstract member (0 ABSTRACT texts in Project13/14), so no parity test
pins this. **Owner sign-off is open**; the default this change ships with is the divergence above (the line states
the object), asked for at the close.
