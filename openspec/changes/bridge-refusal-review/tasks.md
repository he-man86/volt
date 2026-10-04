## Re-baseline (2026-10-03)

Re-run against dev HEAD (`7e36c323ad`) after `push-without-header-check`, `push-keeps-what-landed`,
`codesys-refs-guid-int32`, `codesys-diagnostic-child-names`, `twincat-project-settings` and `ide-identity-report`.
The census is now a script: `bun packages/volt-cli/scripts/refusal-census.ts [--rev <commit>]` lists every refusal
site (throw, network-text diagnostic, coded conflict row) with code and message; the proposal's tables were written at
`0d1ae8aff0` and were mapped to HEAD by message.

**Tasks (92):** 6 gone · 7 changed · 79 still hold · 3 new → **89 left.**
**Census sites (193):** 7 gone · 3 changed · 183 still hold · 47 new (38 keep, 9 change; proposal "New since
2026-09-29"). The other changes rewrote the DUT/POU kind story and the push's outcome reporting; they removed none of
the five code checks and none of the CHANGE rows except 2.26. Line numbers below are HEAD's.

The five that matter most (data loss / valid code refused first):

1. **4.3 (D3)** — network scope still decides "FB instance or FUNCTION call" by regex-reading the callee's header
   (`StDeclaration.IsCallableHeader`/`IsFunctionBlockType`): the wrong NWL body is WRITTEN when the header is
   unreadable. Since 5Qa every POU is `.pou`, so the fix must take the POU type from the IDE, not the wire name.
2. **4.26 (D26)** — a body pushed at an item with no body slot is dropped and the push reports success
   (`CodesysObjectModel.cs:229` returns; `BeckhoffDriver.Content.cs:583` kind table).
3. **4.31** — a move into a non-folder node is reported "moved" while the IDE leaves the object; the next pull moves
   the file back. No check exists yet.
4. **2.23/2.24/2.29/2.34 (D27)** — an unknown view mode or body language thrown outside `NetworkText.Pulled` drops the
   whole POU (declaration and members) from refs and fetch.
5. **1.2, 1.3, 2.1** — valid code refused: `implementation : INT;` (`StReader.cs:659`), a real variable named like a
   wire `g5 AT %IX0.0 : BOOL;` (`NetworkTextReader.cs:1003`), a `(* @volt-x *)` comment in a current ST body
   (`StReader.cs:124`).

Gone: `ec0152fe0f` (5B, the driver states a DUT's subtype), `b6822e9751` (5.P, one `.dut`: `DutSubtypeChanges`,
`CodeHelper.DutSubtype`, the sibling-subtype ITEM_EXISTS and the unreadable-DUT delete gate deleted), `f7eb383f47`
(5Qa, one `.pou`, kind from the class), `15d421e57a` (5Qb, Globals by wire kind, TC member kind by name),
`f18af69c54` (push-keeps-what-landed 2, accessor-create refusal is a `NotSupportedException`).

> The 2026-10-02 note ("re-baseline DUT items after §5 lands") is done by this pass: every DUT item is either gone
> (2.19, 4.1, 4.18) or restated below.

## 0. Order and method

- [x] 0.1 Start after `push-without-header-check` — gone: archived 2026-10-03 (`0b1e85f4eb`). Its 4.1 fixtures
      (unclosed `(*` in DUT/FB/GVL) remain the pattern for §5.
- [x] 0.2 Every REMOVE/CHANGE task is test-first: a C# test that is red on today's refusal and asserts the new
      behaviour (the write happens / the code is the right one). Where a code check goes, the IDE's recorded compile
      error replaces it: record the build live (CODESYS SP21; TwinCAT where the construct exists) as a conformance
      fixture, and add the LSP parity case (§5). A test whose premise was a removed code check is rewritten, not
      deleted: its premise (the bridge judges the code) is wrong on grounds independent of behaviour.
      **Baseline (2026-10-03, `2d4a1a46f2`; `packages/volt-cli/src` unchanged since the re-baseline's `7e36c323ad`):**
      - Census: 577 sites in all of `src` (555 throw, 11 conflict, 7 diag, 4 coded); 239 in `Volt.Engine/Format`, 56
        `Volt.Engine/Sync`, 7 `Volt.Engine/Ide`, 3 `Volt.Engine/Item`, 95 CODESYS (9 Driver + 86 Ide), 127 TwinCAT
        (19 + 108). Against `0d1ae8aff0`: 531 then, 19 gone, 65 new (by site, not line).
      - C# suites green: Engine 1916 (+1 skipped), Cli 259, Codesys 229, Twincat 331, Connector 115, Contracts 39,
        Repo.Gates 101. After the step-0 review fixes: Repo.Gates 107 (+6 teeth), the rest unchanged; volt-cli
        `bun test test/unit` 9 (+5).
      - Tools: `refusal-census.ts --against <commit>` lists the sites gone, new and moved since a commit, keyed by
        file, form, exception, code, message and the refusing expression with its whitespace removed. A refusal moved
        or re-wrapped within its file is neither gone nor new; one moved unchanged to another file (or a renamed file)
        is listed as `moved`, not as gone plus new; identical expressions in one file count as a multiset. Every step
        reports against `2d4a1a46f2`, and 6.3 classifies each new row. `Volt.Repo.Gates/NoCodeCheckLeftTests` is
        6.2's grep gate as a RATCHET: each retired name holds its exact baseline count of MATCHES in code (comments
        stripped by a scanner that reads string/char literals and interpolation holes, so a `//` in a string is no
        comment) — OpensNetwork 2, RefuseReservedNames 2, RefuseRetiredComment 2, NETWORK_NOT_CANONICAL 4 (the const
        line names it twice), IsCallableHeader 2, IsFunctionBlockType 2, FunctionBlockHeader 2, NonBlockTypeWords 2,
        HeaderLine callers outside CodeHelper 2; the five already-gone names 0. The step that deletes one sets its
        count to 0 in the same commit; 6.2 closes it at all zeros.
      - Review fixes (step 0 gate): (a) `--against` keyed a site without its expression, so 47 rows shared a key with
        another (e.g. 5× `NetworkScope.cs throw ArgumentNullException`, 2× `NetworkTextReader.cs throw Err` with
        variable code and message) and swapping one for a different one read "0 gone, 0 new" — the expression is now
        in the key; 26 rows in 12 keys still share one, each a textually identical expression (`tie.InnerException ??
        tie`, `new ArgumentNullException(nameof(sourceText))`), which the multiset counts. (b) the "moved code is
        neither" note held only within a file — cross-file moves are now paired as `moved`. (c) the ratchet counted
        matching LINES and cut a line at a `//` inside a string literal — it now counts matches over a literal-aware
        strip. Tests first: `test/unit/refusal-census.test.ts` (5; 3 red before), `NoCodeCheckLeftTests` teeth (+6;
        4 red before, and the real count of NETWORK_NOT_CANONICAL rose 3 → 4).

## 1. Remove — code checks

- [x] 1.1 `StReader.cs:630` (was 460) — drop the "IMPLEMENTATION ST whose body is network text" refusal. Test: an ST
      body holding `NETWORK … END_NETWORK` under `IMPLEMENTATION ST` is written as sent; record the CODESYS build error.
      Done: the ST arm of the sniff is gone (`ImplementationLanguagePushTests`: member, POU body and getter written as
      sent; `PullCommandTests` no longer calls such a file unpushable). The build recording is 5.1's row.
- [x] 1.2 `StReader.cs:659` (was 489; called at :131) — delete `RefuseReservedNames`. Test: `implementation : INT;`,
      `x := implementation;` and an enum value `Implementation` push; the boundary-shaped lines stay refused by 556/695.
      Record: compiles clean.
      Done: `RefuseReservedNames` and its regex deleted (ratchet 2 → 0); a variable, an assignment, a member and the POU
      named `implementation` are written; a keyword-SHAPED line in a declaration stays refused. Recording: 5.1.
- [x] 1.3 `NetworkTextReader.cs:1003` — drop "shaped like a wire and undeclared". A bare `gN` is a Leaf. Test with
      `g5 AT %IX0.0 : BOOL;` (a real variable) and with an undeclared `g7`; record the build's undeclared-identifier
      error for the latter.
      Done: `RefuseUndeclaredWire` deleted; `out := g7;` reads a Leaf, and so does `g5 AT %IX0.0 : BOOL;`
      (`NetworkTextGateTests`). The writer still backticks such a name (its spelling choice). Recording: 5.1.
- [x] 1.4 `Materializer.cs:41` (was 37) — delete `RefuseRetiredComment` on pull. Test: a DUT, a GVL and a POU holding
      `(* @volt-note *)` in the IDE pull and are readable. The pull's other refusals added by 5E/5Q
      (`Materializer.cs:62/70/77` read-back, `:100` member of another class) stay: they guard the round trip.
      Done: `RefuseRetiredComment` deleted (ratchet 2 → 0); `PullDoesNotJudgeCommentsTests` (DUT, GVL, POU pulled
      and published), `ReadOnlyBodyTests` rewritten (its premise was the removed check, 0.2). e2e: the `retired` GVL row
      of `push-without-header-check.test.ts` now expects `fetched` — from the code, not yet run live (6.1).
- [x] 1.5 `CodesysNetworkWriter.cs:163` — drop the `.ENO`-without-EN arm; keep :155 and :159. Test: the push writes
      the box; record CODESYS "Missing EN pin".
      Done: the arm is gone (`CodesysNetworkWriterGateTests`); TwinCAT's `TcEnoRefusal` stays (D22). Recording: 5.1.
      **Step 1 numbers (commit state):** Engine 1921 (+1 skipped; baseline 1916), Codesys 229, Repo.Gates 107,
      Cli `PullCommandTests` 36/36.

## 2. Change

- [x] 2.1 `StReader.cs:124` — retired-comment scan only when no boundary line exists, as a hint inside Unmarked
      (`:921`). Test: current-format POU with `(* @volt-x *)` in an ST body pushes.
      Done: the scan is gone; `Unmarked(what, region)` names the comment as its hint. A pulled POU holding one reads
      back (`PullDoesNotJudgeCommentsTests`); `ReadOnlyBodyTests`/`ImplementationKeywordTests` rewritten (0.2).
- [x] 2.2 `StReader.cs:495` — unexpected composite kind → `ArgumentException` / INTERNAL_ERROR. (Read-only descriptors
      no longer reach it: `PushService.cs:192` refuses them in the pre-flight, so it is a pure invariant now.)
      Done: `ArgumentException` (`StReaderKindInvariantTests`).
- [x] 2.3 `StReader.cs:634` — delete the sniffed LD/FBD "not network text" copy; `NetworkTextReader:189` answers with
      NETWORK_PARSE and a line. Delete `NetworkText.OpensNetwork` (`NetworkText.cs:66`) with 1.1.
      Done: sniff and `OpensNetwork` deleted (ratchet 2 → 0); ST under LD/FBD answers NETWORK_PARSE with its line.
- [x] 2.4 `StReader.cs:982` — "nothing after ':'" no longer refused in the reader; the TwinCAT driver refuses an
      interface-member create whose seed type is null, by name. Record the build error for a METHOD with `:` and no type.
      Done: `METHOD Run :` reads an empty type. TwinCAT refuses an untyped interface member by one predicate
      (`BeckhoffDriver.UntypedInterfaceMember`) asked twice: by `CreateChild`, and — review 1+2d (medium) — by the push
      PRE-FLIGHT through the new `ICodeStore.RefusedMemberCreate`, for every member the push would create (all of a new
      item's; on an update only one the IDE does not hold under that name and kind), so nothing lands before the
      refusal (`TcInterfaceMemberSeedTests` +6; engine tests in 2.6). Recording: 5.1.
- [x] 2.5 `StReader.cs:992` — no modifier vocabulary: the name is the last word before `:`, the line passes through
      (after 3.1). Record the build error for `METHOD FOO Bar`.
      *History (step 2a, superseded by the "Done with 4.10" note below — no longer the state of the code):* ~~Not done —
      blocked on 3.1 and the recording (review 1+2d, low). Implemented early, it changed which member a push writes:
      `METHOD Foo Bar : BOOL` over an existing method Foo read as member Bar, so the push deleted Foo and created Bar
      with Foo's text. Reverted to the modifier vocabulary; `SignatureParseTests` pins the refusal (STATIC, FOO,
      PUBLIK).~~ That refusal is gone (4.10): `SignatureParseTests` now reads `METHOD PUBLC Run : BOOL` as `Run`. Still
      true from 2a: `METHOD Foo END_METHOD` (no colon) is refused as an END line after code (`ChildSplitterTableTests` +2)
      — the early 2.5 had read it as a member named END_METHOD.
      **Step 2a numbers:** Engine 1923 (+1 skipped), Twincat 341, Codesys 229, Repo.Gates 107; `data.js` regenerated
      (driver interface).
      **Done with 4.10 (step 4b, `c974dba5ad`; 3.1 landed first).** `ParseSignature` takes the last word before the
      colon as the name, `Modifiers` is gone; `METHOD FOO Bar` is recorded as `sig_unknown_word`'s `METHOD Run Walk : BOOL`
      (with `METHOD PUBLC Run : BOOL`) on CODESYS SP21 and TwinCAT: both builds read the FIRST word as the name ("The name
      used in the signature is not identical to the object name"); known divergence `MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD`
      (niche: 0 corpus lines). Re-verified 2026-10-04: `SignatureParseTests` + `ChildSplitterTableTests` 125/125,
      `VOLT_FIXTURES=sig_unknown_word,sig_empty_type` conformance 35 pass / 6 skip / 0 fail. No code change in this step.
      **Review 1+2d's data case STANDS — accepted under D10 option 3, not resolved (gate 2, review finding 2).** Over an
      existing method Run, `METHOD Run Walk : BOOL` is read as member Walk: `ReconcileMembers` deletes Run and creates
      Walk with Run's text, nothing refused before it lands, while both IDEs name that header by its FIRST word (Run).
      The `sig_unknown_word` recording does not settle the update case (recorded as sent on a fresh FB), so the delete
      of an existing member is now pinned by `MemberHeaderLastWordTests` (engine, +1; green — it pins the accepted
      behaviour, not a fix) and named in `ParseSignature`'s comment. Same divergence, `MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD`,
      niche: 0 corpus lines (re-counted: 0 member headers with two non-modifier words before the colon in the six corpora).
      **Colon-less headers (gate 2, review finding 3) — kept, the finding's expected answer skipped.** Without a colon,
      `HeaderNameAt` reads past the six measured modifiers and names the first other word, `ParseSignature` the last, so
      the two DO disagree there (the "never disagree" comment was wrong and is corrected). The finding's expected row
      (`METHOD PUBLC end_method` → method end_method, like the colon form) is skipped: that text equals
      `METHOD Foo END_METHOD` up to letter case, which IEC does not read, and the 1+2d rows pin that as an END line after
      code — answering the colon form's way would undo them. Pinned instead as refused by name (`ChildSplitterTableTests`
      +2: METHOD and PROPERTY). The six-word list survives only for this colon-less END exemption and decides no name.
      Niche: 0 colon-less END-keyword names in the six corpora.
      **Gate 2 numbers (2026-10-04):** Engine 2221/0/1 (+3: `MemberHeaderLastWordTests` 1, `ChildSplitterTableTests` 2),
      Cli 260, Connector 115, Twincat 428, Codesys 297, Contracts 39, Repo.Gates 108; volt-cli `test/unit` 24; check 18/18;
      typecheck clean; LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 8060 pass / 34 skip / 381 todo / 0 fail
      (8475 tests, 206 files). No fixture or transpiler change, so no `rate:fixtures`.
- [x] 2.6 `StReader.cs:1039` — "property must declare a type" goes for POU properties (build reports it); interface
      property on TwinCAT handled as 2.4.
      Done: a POU property with no type reads `DataType` null (`SignatureParseTests`). The TwinCAT pre-flight of 2.4
      refuses an untyped INTERFACE property before the first write — a new item and an update adding one; an update
      of a member the IDE holds is written through (`PushKeepsWhatLandedTests` +2, red without the pre-flight).
- [x] 2.7 `NetworkTextReader.cs:285` — second / late VAR_TEMP block: read, and let the writer canonicalize.
      Done (`NetworkTextGateTests`). Review 1+2d (low): with 2.10, a late block could make one spelling two things — a
      scope variable `g1` read before the block and the wire after it. A late block may not declare a name the network
      already read as a variable (an operand or a target): NETWORK_DUPLICATE_NAME at the declaration, naming the
      earlier line (+2 rows; network-text.html). The LSP's network parser has no such rule yet (5.2).
- [x] 2.8 `NetworkTextReader.cs:292` — declared-never-defined wire: dropped on write, not refused.
- [x] 2.9 `NetworkTextReader.cs:330` — empty VAR_TEMP block accepted.
- [x] 2.10 `NetworkTextReader.cs:362` — wire named like a scope variable: accepted (wires resolve first).
      Done at the reader (`NetworkScopeTests`, `NetworkTextGateTests`); the gate's canonical comparison still refused
      the spelling until 2.12 (`PushServiceTests` at this commit expects NETWORK_NOT_CANONICAL).
      **Step 2b numbers:** Engine 1930 (+1 skipped), Twincat 341, Codesys 229, Repo.Gates 107.
- [x] 2.11 `NetworkTextReader.cs:1015` — wire also spelled as another name: accepted, same rule.
      Done: `AddOtherWords` deleted (`NetworkTextGateTests`, `WriterReaderAgreementTests`).
- [x] 2.12 `NetworkTextGate.cs:88` — `NETWORK_NOT_CANONICAL` goes: write the model; return the canonical text (push
      response or next pull). Remove the code from `Volt.Contracts/Vocabulary/ConflictCodes.cs`. `PushedText` keeps
      comparing layout-free.
      Done: the gate writes the model and returns its canonical text; the code is gone from `ConflictCodes`, data.js and
      network-text.html (ratchet 4 → 0); the reader's token trace went with it. Review 1+2d (low): the CLI's post-push
      comparison (`PushedText.SameExceptLayout`) told the user the IDE held "another program" after a body pushed in
      another SPELLING came back canonical — it now also compares canonical texts, both read in the body's own
      declarations (`PushedTextTests` +2 rows, +1 fact; the `AND(a, b)` row red before). LSP's network code list: V.2.
- [x] 2.13 `TaskDescriptorFormat.cs:117` — non-canonical `.task` written; canonical text comes back.
      Done: `Gate` is `Read`; `SameDescriptor` compares canonical renderings. Review 1+2d (high): `Read` kept the LAST
      value of a repeated label, so `Calls: A` + `Calls: B` dropped A without a word once the canonical comparison was
      gone — a repeated label is now refused by name and line (`TaskDescriptorFormatTests` +2, red before). e2e
      `task-writable.test.ts` (review, medium): the "not canonical is refused" case is rewritten to push the task's own
      settings re-spaced and expect the canonical bytes back — from the code, not yet run live (6.1); stale comments in
      `create-shapes.test.ts` / `rebuild.test.ts` fixed.
- [x] 2.14 `PushService.cs:534` (was 435, `RequireUnchanged` :520) — last-moment set re-check raises
      `STALE_ITEM_VERSION` (with D15, D16).
      Done (`PushKeepsWhatLandedTests`). Review 1+2d (low): the apply-time row now carries `yourVersion` and
      `currentVersion` like the pre-apply gate's (`StaleItemVersionException`), one code in one shape (8.4).
- [x] 2.15 `PushService.cs:557` (was 459, `RequireUnchangedBeforeDelete` :542) — last-moment delete re-check raises
      `STALE_ITEM_VERSION`.
      Done (`PushDeleteGuardTests`, with both versions).
      **Step 2c numbers:** Engine 1936 (+1 skipped), Twincat 341, Codesys 229, Contracts 39, Repo.Gates 107.
- [x] 2.16 `PushService.cs:1128` (was 903) — take the wire kind from the caller that validated it; delete the
      re-derivation (`PushService.cs:703` already refused it as a `PushRefusal`).
      Done: `WriteItemFromSource` takes `wireKind`; `AdmittedKind` answers INTERNAL_ERROR (`PushKindInvariantTests`).
- [x] 2.17 `PushService.cs:1755` (was 1369) — unknown top-level kind → INTERNAL_ERROR.
      Done (`PushKindInvariantTests`).
- [x] 2.18 `ItemKind.cs:286` (was 275) — unknown member kind → INTERNAL_ERROR.
      Done (`ItemKindTests`, `PushKindInvariantTests`).
- [x] 2.19 `Materializer.cs:92` — gone: `ec0152fe0f` (the driver states a DUT's subtype; no answer publishes
      `name.dut`) and `b6822e9751` (one `.dut`, subtype off the wire). A DUT stating no subtype is addressable as
      `X.dut`; nothing parses its header to name it.
- [x] 2.20 `CodesysNetworkWriter.cs:284` — unreachable FB-without-instance arm → INTERNAL_ERROR, model-invariant
      message, no v1 wording.
      Done: `InvalidOperationException` "network model invariant" (`NoKindFromTextTests` loses the TYPE-word entry).
- [x] 2.21 `CodesysNetworkWriter.cs:37` — graphical text at an item with no Implementation aspect → one named
      UNSUPPORTED (with D26).
      Done: `NotSupportedException` naming the missing aspect (`CodesysWriterNoBodySlotTests`).
      **Gate 1+2d (final state, every C# suite):** Engine 1943 (+1 skipped; baseline 1916),
      Cli 259, Codesys 230, Twincat 341, Connector 115, Contracts 39, Repo.Gates 107; volt-cli `bun test test/unit` 9,
      `tsc --noEmit` clean, `bun run check` 15/15. e2e not run (6.1): the two hand-edited e2e expectations stay unverified.
- [x] 2.22 `CodesysNetworkWriter.cs:51` — FBD↔LD view change written (after 3.5), else one named refusal in pre-flight (D7).
      Done (step 2e) — WRITTEN, measured live first (3.5): `CodesysNetworkWriter.WriteView` sets the aspect's
      `DefaultViewMode` string (`"Ld"`/`"Fbd"`) when it differs; a hidden view (IL, unknown, none) reaching the write is
      an InvalidOperationException (the body guard refuses network text over a hidden body first). Tests:
      `CodesysViewModeTests` (rewritten: premise was the refusal), e2e `graphical/view-change.test.ts` (live, both vendors).
      Review 2e+2g (medium, triaged niche): a flip writes the network whatever it holds — what the vendor's own switch
      does with an LD-only shape is task 3.10.
- [x] 2.23 `CodesysDriver.Content.cs:185` (was 190) — unknown view mode → UNSUPPORTED body marker naming it; declaration
      and members still pull (D27).
      Done (2e): `NetworkText.ViewLanguage` — one answer for both vendors: LD/FBD read, IL, an unknown view under its own
      name, none → `IMPLEMENTATION NWL UNSUPPORTED`; `CodesysDriver.ViewModeText` replaces `ReadViewMode`.
      Test: `CodesysUnknownBodyLanguageTests` (3; red before).
      Review 2e+2g (medium): a MISSING `DefaultViewMode` member fails loud naming the assembly (`NwlInterop.Declared`);
      only a null VALUE is the NWL line.
- [x] 2.24 `CodesysDriver.Content.cs:203` (was 208) — unknown body aspect → marker (D27).
      Done (2e): `UnreadLanguage` → `ImplementationMarker.VendorLanguage(<aspect name>)` (`UMLImplementationObject` →
      `IMPLEMENTATION UML UNSUPPORTED`). With 4.27's grammar: the bridge marker (`ImplementationMarker.Line`), the LSP mirror
      (`implementation-line.ts`, hover `network-services.ts`) and the VS Code grammar accept any word + UNSUPPORTED; a bare
      unknown word stays no line. Tests: `ImplementationKeywordTests` (+7), `implementation-line.test.ts`, `network.test.ts`,
      `implementation-line-grammar.test.ts`.
      Review 2e+2g (low): a vendor name spelling LD/FBD is the hidden LD/FBD line, not "a Volt bug"; a non-word name
      and ST stay refused (niche, accepted loss: 0 in the corpora).
- [x] 2.25 `CodesysObjectModel.Descriptors.cs:292` (was 296) — unknown task `Type:` → BAD_REQUEST (as TcTaskSchedule).
      Done (2e): `BridgeException(BAD_REQUEST)` naming the types; lookup by NAME only (`Enum.Parse` took `99`).
      Test: `CodesysTaskKindTests` (5; red before).
      Review 2e+2g (low): also refused in the PRE-FLIGHT (`ICodeStore.ValidateTask`, both vendors), and case-exact on
      both (TwinCAT accepted `cyclic`).
- [x] 2.26 `CodesysObjectModel.Libraries.cs:427` — gone: `f18af69c54`. Now `CodesysObjectModel.Libraries.cs:424`
      throws `CodesysDriver.NoAccessorCreate` (`CodesysDriver.Tree.cs:188`), a `NotSupportedException` → UNSUPPORTED,
      naming the create calls the container offers.
- [x] 2.27 `BeckhoffDriver.Content.cs:61` (was 60) — `ValidateSource` takes the engine's validated models, no re-parse (D8).
      Done (2e): `ICodeStore.ValidateSource(ItemRef? existing, IReadOnlyList<PushedNetworkBody> bodies)` — the engine's
      pre-flight (`ValidateSourceOrThrow`) returns each network body's validated model with its `BodySite`
      (`SourceScopes.SitesOf`); TwinCAT lowers the models, no `StReader`, no wire-name kind. Docs data regenerated
      (`docs/assets/data.js`, the driver-interface row). Tests: `DriverPreflightModelsTests`, `TcPreflightTests`.
- [x] 2.28 `BeckhoffDriver.Content.cs:67` (was 66) — PLCopen create refusals pre-flighted per BODY (D21). Test: a new
      graphical method with an Execute box in an existing POU is refused before any op lands. (push-keeps-what-landed
      now reports such a mid-batch stop with a receipt + NOT_ATTEMPTED; the pre-flight is still per ITEM.)
      Done (2f): the engine asks the driver on an UPDATE too, with the item; `BeckhoffDriver.ValidateSource` lowers exactly
      the bodies `ResolveBody` would CREATE (`CreatesBody`, now shared): a member not held under that name and kind, a
      missing accessor, a blank or undrawn implementation. A member's refusal names it. Tests: `TcPreflightTests` (+4),
      `DriverPreflightModelsTests.An_update_hands_the_driver_the_existing_item`, e2e `refused-shapes.test.ts` "a new
      graphical member in an existing POU" (live TwinCAT: refused naming `'Step'`, nothing landed; live CODESYS: written).
- [x] 2.29 `BeckhoffDriver.Content.cs:339` (and :355) — missing/unknown DefaultViewMode → marker (D27).
      Done (2f): through `NetworkText.ViewLanguage`, as CODESYS; `BeckhoffDriver.ViewModeOf` deleted.
      Test: `TcBodyLanguageTests` (rewritten through `ReadContent`: premise was the refusal).
- [x] 2.30 `TcNetworkWriter.cs:152` — unreachable arm → INTERNAL_ERROR.
      Done (2f): InvalidOperationException "… this is a Volt bug". Test: `TcNetworkWriterTests` (rewritten).
- [x] 2.31 `TcNetworkWriter.cs:165` — FBD↔LD view change written via DefaultViewMode on update (after 3.5).
      Done (2f): `TcNetworkWriter.WriteView` sets the archive slot in place; `NetworkText.RefuseViewModeChange` deleted (no
      caller left). Tests: `TcRoundTripTests` (only `DefaultViewMode` changes), e2e `view-change.test.ts` live on TwinCAT.
- [x] 2.32 `TcNetworkWriter.cs:934` — RESET in `Bits` → InvalidOperationException with CODESYS's message (D23).
      Done (2f): CODESYS's wording. Test: `TcNetworkWriterTests.A_reset_on_anything_but_a_coil_target_is_an_invariant`.
- [x] 2.33 `TcPlcOpenWriter.cs:339` (and :177, :187, :295, :328, :341, :394, :427, :477, :483) — model invariants →
      INTERNAL_ERROR, "Volt bug", not "cannot express as PLCopen" (the wording is `Refuse`, `TcPlcOpenWriter.cs:124`).
      Done (2g): `TcPlcOpenWriter.Invariant` (InvalidOperationException, "network model invariant … Volt bug") at the ten
      sites; the vendor limits (Execute box, multi-destination jump, single-consumer branch) keep `Refuse`.
      Test: `TcPlcOpenInvariantTests` (3).
      Review 2e+2g: +6 — every other invariant site but the Parallel arm (unreachable through `WriteProject`); the
      "assignment with no value" arm is deleted as unreachable.
- [x] 2.34 `TcArchive.cs:73` — unknown `<root>` language → marker (D27).
      Done (2g): `VendorLanguage(<root>)`. Test: `TcBodyLanguageTests` (unknown root pulls whole).
- [x] 2.35 `BeckhoffDriver.Tree.cs:385` (was 322) — move post-condition → INTERNAL_ERROR (still UNSUPPORTED).
      Done (2g): `BridgeException(INTERNAL_ERROR)`. No offline test: the member move needs the archive round trip and a
      project walk no double has (`TcHiddenBodyWriteTests` covers the archive half); the code is the whole change.
      Review 2e+2g: tested now — `TcMemberMovePostConditionTests` (the check is its own function).
      **Steps 2e+2f+2g numbers:** Engine 1960 (1958 + DocData regenerated, +1 skipped), Codesys 241, Twincat 353, Cli 259,
      Repo.Gates 107, Contracts 39; volt-cli `bun test test/unit` 9; LSP `test/frontend` 39, `test/conformance` 5946 pass +
      330 todo, `tsc` clean; VS Code grammar 4. Census against `0fce3a3820`: 565 → 563 sites, 21 gone, 19 new (against
      `2d4a1a46f2`: 577 → 563, 48 gone, 34 new). Live e2e (fixture IDEs, instance `bridge-refusal-review`): CODESYS
      view-change, refused-shapes, preflight, unsupported, hidden-*, unresolved-marker, task-writable — 49 pass; TwinCAT
      view-change, refused-shapes, preflight, unsupported, create-shapes, hidden-network-body, unresolved-marker,
      roundtrip — pass (hidden-members needs Project14, not opened).
      **Gate 2e+2g — review fixes (2026-10-03):**
      (1) medium, 2.23 — `CodesysDriver.ViewModeText` read `DefaultViewMode` with `NwlInterop.Get`, which answers null
      for a MISSING member exactly as for a null value, so an unpinned NWLObject assembly pulled every LD/FBD body as
      `IMPLEMENTATION NWL UNSUPPORTED` without a word. It now reads `NwlInterop.Declared` (new, with `NwlInterop.Has`):
      member absent → the `Missing` refusal naming the member and the assembly version; value null → the NWL line. The
      writer asks `Has` (an ST aspect of a fresh accessor has no view to set). Test:
      `CodesysUnknownBodyLanguageTests.A_network_aspect_whose_type_lacks_the_view_member_fails_loud_naming_it` (red before).
      (2) medium, 2.22/2.31 — the flip writes the same network whatever it holds; not fixed: triaged niche (0 FBD bodies
      with a `PARALLEL` in the corpora, no FBD-only shape known) and not cheap (a per-view shape table needs the vendor's
      switch measured). Recorded as DIALECT N23's open half and task 3.10.
      (3) low, 2.24/2.34 — `ImplementationMarker.VendorLanguage("Ld"|"Fbd")` threw "a Volt bug" on the read path; a
      vendor aspect/root named LD or FBD that is not the NWL one is now the hidden `IMPLEMENTATION LD|FBD UNSUPPORTED`
      line. A name that is no word, and ST (never hidden), stay refused naming them (UNSUPPORTED, the vendor's fact,
      still costing the item): niche, accepted loss (0 occurrences in the corpora — hidden lines there: CFC 3, SFC 2,
      LD 10, FBD 2). D27's claim narrowed to that in the code's doc. Tests: `ImplementationKeywordTests` (rewritten rows,
      premise "a Volt bug" wrong), `TcBodyLanguageTests` (+2 rows `<LD>`, `<Fbd>`), `CodesysUnknownBodyLanguageTests`
      (+1, `LDImplementationObject`).
      (4) low, 2.25 — a task `Type:` refusal is now PRE-FLIGHTED on both vendors: new `ICodeStore.ValidateTask(TaskSettings)`
      (DriverBase: refuse nothing), asked by the push pre-flight with the settings `TaskDescriptorFormat.Gate` read; CODESYS
      answers by the same `TaskKind` lookup (BAD_REQUEST), TwinCAT by the same `TcTaskSchedule.SysTaskPatch` its write
      builds. TwinCAT's `Type:` compare is case-exact now, as CODESYS's names and every descriptor label are (`cyclic` was
      accepted there and refused here). Tests: `PushTaskTests` (+1, batch `[new PRG_A.pou, task Type: Cyclicc]` refused,
      nothing created), `CodesysTaskKindTests` (+1), `TcTaskScheduleTests` (+1 row, +1 fact); docs data regenerated.
      (5) low, 2.33/2.35 — `TcPlcOpenInvariantTests` +6 (statement-fed assignment, RETURN, jump and wire; unknown call
      kind; a node type with no arm); the "assignment with no value" arm is DELETED (`Assign.Value` is never null and the
      walks before the lowering fault on one first — unreachable); the Parallel arm stays untested (RefuseImport refuses
      a Parallel before any lowering). 2.35's post-condition is `BeckhoffDriver.RequireMemberLanded` (private), tested by
      `TcMemberMovePostConditionTests` (4).
      **Gate 2e+2g numbers (after the review fixes):** Engine 1960 (+1 skipped), Cli 259, Codesys 244, Twincat 367,
      Connector 115, Contracts 39, Repo.Gates 106 of 107 — the one red, `NoKindFromTextTests` (retired `P.prg`/`B.fb`
      spellings), is `unresolved-identifier.test.ts`, an UNCOMMITTED edit of the parallel `lsp-sfc-step-names` 2 session,
      not in either commit; volt-cli `bun test test/unit` 9; `bun run check` 15/15; LSP `tsc` clean; LSP full suite
      (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 8042 pass, 378 todo, 34 skip, 4 fail — all four `test/frontend`
      baselines (printer, parse census, resolution, types), every delta that session's new uncommitted SFC fixtures
      (`sfc_step_typo_other_member`, `sfc_step_pointer_global_no_step`, …), none from this change; VS Code grammar 4.
      Census against `0fce3a3820`: 565 → 563 sites, 21 gone, 19 new (against `2d4a1a46f2`: 577 → 563, 48 gone, 34 new).
      Commits: 2e and 2f share one (`ICodeStore.ValidateSource`'s new signature, TwinCAT's per-body pre-flight and view
      read are one rewrite of `BeckhoffDriver.Content`/`PushService`, and `RefuseViewModeChange` goes from both writers at
      once — no tree between them builds); 2g is its own.

## 3. Measure (live; record the outcome in DIALECT.md, then keep or change)

- [x] 3.1 **Changed.** `StReader.cs:996` (was 809) — the IEC/ASCII identifier check. Half measured since: the names
      each vendor REFUSES for a new POU or member were measured live (`scripts/member-name-refusal*.log`) and are
      pre-flighted by name (`CodesysRefusedNames.cs` / `TcRefusedNames.cs` via `ICodeStore.RefusedName`,
      `PushService.cs:1053-1059`, `ChildRefusedException` cause `Name`). Still unmeasured: what `CreateChild` does with
      a non-ASCII or non-identifier name (`Fööbar`, `a-b`). Clean vendor refusal → add it to the measured lists and
      delete `IsIdentifier`; otherwise `IsIdentifier` becomes the vendor's measured rule, beside the name lists.
      Done (step 3a) — MEASURED, CHANGED: a clean vendor refusal on both, so `IsIdentifier` is deleted and the shape is
      the drivers' measured rule beside the word lists. CODESYS (`scripts/probe-identifier-names.py` ->
      `identifier-names.log`): 37 non-identifier shapes x 6 kinds (POU, METHOD, ACTION, PROPERTY, interface METHOD,
      interface PROPERTY) = 222 refusals, all "The name 'X' is not valid for this object."; a backtick-quoted name
      (`` `ab` ``, `` `a b` ``, `` `INT` ``, `` `a`b ``) is CREATED for all six and builds clean — a valid name
      `IsIdentifier` refused. TwinCAT (`probe-tc-refusal-measure.ps1 -Phase names` -> `tc-refusal-measure-names.log`):
      42 shapes x 6 = 252 refusals, all "Name mismatch", backtick names included. Both create `_`. DIALECT C28.
      `ICodeStore.RefusedName(kind, name)` (was `(name)`): the words for POU/METHOD/ACTION/PROPERTY only (where they were
      measured), the shape for all six; the pre-flight now asks interface members too (they had only the reader's check).
      Shared parts: `Volt.Engine/Ide/MeasuredNames.cs`. Code INVALID_ST -> UNSUPPORTED (`ChildRefusedException`, cause
      Name), still before the first write. Tests: `CodesysNameRefusalTests` (+3 theories), `TcNameRefusalTests` (+3),
      `PushKeepsWhatLandedTests` (+2: an interface member refused before the first write; asked with the kind),
      `SignatureParseTests` (rewritten: its premise was the unmeasured belief), `PushWithoutHeaderCheckTests` (header
      example `METHOD 1Reset` -> `METHOD : INT`, same reason). Live through the rebuilt bridges: `METHOD My-Name` and
      `ACTION Fööbar` refused pre-flight on both; a backtick-quoted METHOD created on CODESYS, refused on TwinCAT.
      Corpora: 0 backtick member names in the six.
      **Review 3a+3b (gate), fixed:** (low) a backtick name holding a blank or a colon (`` `a b` ``, `` `a:b` ``) never
      reached `RefusedName` — `StReader.ParseSignature` split the line at every blank and cut the type at the first colon,
      so `METHOD `a b` : INT` was INVALID_ST "'`a' is not an access modifier", a member CODESYS creates (C28) that could be
      pulled and never pushed back. Cheap, so fixed rather than marked niche (0 in the corpora): the reader splits words and
      finds the colon OUTSIDE backticks (`StReader.Words` / `OutsideBackticks`); `SignatureParseTests.A_backtick_quoted_
      name_is_one_name` +5, red before (the CODESYS driver doc now says the reader keeps a quoted name whole). (low) the
      `a__b` measured on interface members was unused — `MeasuredNames.WordsMeasuredFor` excluded both interface kinds, so
      an interface METHOD/PROPERTY `a__b` passed the pre-flight and was refused mid-batch: now `WordMeasuredFor(kind,
      word)` answers the listed words for a POU/METHOD/ACTION/PROPERTY and, for an interface member, the words ASKED there
      (`a__b`, both vendors refused it); `Codesys`/`TcNameRefusalTests.A_word_asked_on_an_interface_member_is_refused_
      there` +3 each, red before. `Log` on an interface member stays unasked (its test stands).
- [x] 3.2 `NetworkTextReader.cs:1036` — does the build report a declared wire type contradicting its producer?
      Yes → remove and record; silently kept → vendor-limit, keep.
      Done (step 3a) — MEASURED, KEPT (vendor-limit): `scripts/probe-wire-type-build.py` -> `wire-type-build.log`,
      DIALECT N25. The one producer the reader can contradict that stores a declared type is a comparison box; `GT` stored
      `INT` feeding a BOOL builds CLEAN and runs TRUE, the stored type stays `INT`; into an INT the build answers "Cannot
      convert type 'BOOL' to type 'INT'" word for word as for an untyped box. The build never names the declaration, so
      written it would round-trip a type the network does not compute. Doc on `NetworkTextReader.CheckWireTypes`; no code
      change, no new test (the refusal and its tests stand).
- [x] 3.3 `BodyFormatGuard.cs:164` — can FBD/LD → ST be written in place on either vendor?
      Done (step 3a) — MEASURED (DIALECT N24): CODESYS YES — `IPOUObject.Implementation` is writable; an FBD and an LD POU
      took a freshly constructed `STImplementationObject`, an ST POU an `NWLImplementationObject`, same guid, and the
      driver's text and network writes then landed, built and RAN (`body-language-change.log`). TwinCAT NO in place — ST
      text over an archive is refused by the IDE ("Data at the root level is invalid"), body unchanged
      (`tc-refusal-measure-language.log`). Refusal kept (vendor limit on TwinCAT, Volt's own on CODESYS); writing the
      CODESYS change is 4.7 (D7). The message names the route that exists (delete, push again).
- [x] 3.4 `BodyFormatGuard.cs:168` — can ST → LD/FBD be written on an existing body? Fix the message either way
      (graphical bodies ARE created by push).
      Done (step 3a) — MEASURED (N24): CODESYS YES (above). TwinCAT: an archive assigned to an ST POU's
      `ImplementationText` is TAKEN and read back verbatim but stored as ST TEXT — the build answers 104 errors on that POU
      (D32's shape, on a POU). Kept; message FIXED test-first (`GraphicalChildGuardTests.Network_text_over_a_textual_child_
      is_refused_naming_the_route_that_exists`, red before): no more "graphical bodies are authored in the IDE, not created
      by push" — "a push does not change an existing body's language … delete it and push it again: a push creates a
      graphical body", with the two languages.
      **Step 3a numbers:** census against `4ebeb61c98`: 563 -> 563 sites; 3a's rows: gone `IsIdentifier`'s `BadSignature`
      and the two `BodyFormatGuard` messages, new the two reworded messages (the name shapes are `RefusedName` strings,
      not throw sites). C# (3a+3b tree): Engine 1964 (+1 skipped), Cli 259, Codesys 268, Twincat 393, Contracts 39,
      Connector 115, Repo.Gates 106/107 — the one red is `NoKindFromTextTests` on the parallel `lsp-sfc-step-names`
      session's uncommitted `unresolved-identifier.test.ts`, as at gate 2e+2g. `docs/assets/data.js` regenerated (the
      `RefusedName` signature). volt-cli `bun test test/unit` 9; `bun run check` 15/15.
- [x] 3.5 `NetworkText.cs:148` — can DefaultViewMode be set on an update on live CODESYS (TwinCAT: on create already)?
      Measured 2026-10-03: yes on both — DIALECT N23. Written (2.22, 2.31).
- [x] 3.6 `CodesysDriver.Content.cs:436` (was 441) — CODESYS interface-accessor write: taken, refused or crash? (D28)
      Done (step 3b) — MEASURED, CHANGED (DIALECT D41, `scripts/probe-interface-accessor-write.py` ->
      `interface-accessor-write.log`): CODESYS TAKES the declaration write (the driver's object-manager write and the
      scripting `replace`, read back equal, IDE alive) and the BUILD judges it ("Only inputs, outputs, and inouts allowed
      in interface methods"); the accessor has NO Implementation aspect. So CODESYS writes an interface accessor's
      declaration (an unchanged one is not re-written) and refuses a BODY by name (`InterfaceAccessorGuard.RefuseBody`,
      UNSUPPORTED, "has no implementation"); TwinCAT keeps `RefuseIfChanged` (D21). Tests:
      `CodesysInterfaceAccessorWriteTests` (3; 2 red before). `CodesysHiddenBodyWriteTests` joins the `SystemInstances`
      collection (it raced the new class on the process-wide `ObjectMgr`). LSP: the four `unit_interface_property_
      accessor_var*` fixtures were `pushRefuses` on both vendors with the old message; now `twincatPushRefuses`, and their
      CODESYS builds RECORDED in one `record:language` batch (RECORD_ONLY, our live bridge with the change): VAR -> "Only
      inputs, outputs, and inouts allowed in interface methods"; VAR_INPUT -> "It is not allowed to define input variables
      in property accessors: scratch : INT" + the two override mismatches; VAR_OUTPUT / VAR_IN_OUT -> the two override
      mismatches. (The batch also re-recorded `plat_xint_into_string`; only its `durationMs` moved, reverted by hand.)
      `VOLT_FIXTURES` run of the four: green.
      **Review 3a+3b (gate), fixed:** (low) the body refusal ran inside `WriteContent` after the interface's and the
      property's declarations were committed (+2 commits before the throw — the test now asserts `Commits` unchanged, red
      before). It is a driver pre-flight now, `ICodeStore.ValidateInterfaceAccessor(Accessor)` (DriverBase: nothing):
      CODESYS refuses a body (`RefuseBody`), TwinCAT any declaration or body (`RefuseIfChanged(null, null, …)`, its write
      calls the same); `CodesysDriver.WriteContent` asks it for every interface accessor before its first commit, and
      `PushService.ValidateSourceOrThrow` for every interface property's GET/SET — so TwinCAT's declaration refusal (the
      four U21 fixtures' `twincatPushRefuses`) lands before the batch's first write too, which it did not. Measured on the
      way: the ST reader reads an interface accessor's whole text as its DECLARATION (no boundary line), so a push never
      carries a CODESYS body — `RefuseBody` guards the driver's own contract. Tests: `CodesysInterfaceAccessorWriteTests`
      +1 (pre-flight), `TcInterfaceAccessorPreflightTests` (3, new), `PushKeepsWhatLandedTests.An_interface_accessor_the_
      driver_refuses_is_refused_before_the_first_write` (red before). (low) the hand-edited recording: the recorder's
      selection is NOT wider than asked — `plat_xint_into_string` is `TARGET_PROBE` (`scripts/recording-target.ts`), which
      every `RECORD_ONLY` batch records on purpose so the merge is refused off the 64-bit oracle. Its diagnostics were
      unchanged and `durationMs` is compared by nothing (the recorder's own diff ignores it), so the file stays as it is:
      each value in it is a recorder output. Not re-recorded (a CODESYS start for a duration). Next time the probe's fresh
      `durationMs` is kept as recorded, not reverted. `testCount` 4741 -> 4745 is the four accessor fixtures.
- [x] 3.7 `BeckhoffDriver.Content.cs:512` (was 516) — which NotSupportedExceptions reach the Stamp catch on real
      creates (D24).
      Done (step 3b) — MEASURED: the catch now LOGS what it swallows (`VoltLog.Warn` "a created body keeps the importer's
      grouping; the in-place stamp refused (…)"). Live TwinCAT (Project14, rebuilt worker), 7 graphical e2e files —
      create-shapes, grouping, roundtrip, graphical-kinds, fanout, labels, comments: 48 pass, 47 creates; the catch fired
      3 times, ALL the same `TcNetworkWriter.Apply` refusal, "network 1 changes from 1 to 3 item(s)" — the one-wire-two-
      coils shape (`VltE2E_fanout`, `VltE2E_fanint`, `VltE2E_onewiretwo`): the importer splits one item into three inside
      the network (an item-level regrouping; `MergeImporterSplits` merges only network splits). Nothing else reached it.
      Statically, the rest that can is `Apply`'s generic `Refuse` (~35 sites: values the in-place writer cannot write),
      swallowed only for a body with no detail, and `RefuseEdgeOrder` (pre-flighted). Input for 4.24: the dedicated
      regrouping exception is the item-count arm (with the network-count arm D25 names).
- [x] 3.8 `TcNetworkWriter.cs:166` / `TcPlcOpenWriter.cs:50` — TwinCAT's negation/edge order (`TcUnmeasured.RefuseEdgeOrder`).
      Done (step 3b) — NOT MEASURABLE HERE, refusal KEPT (DIALECT N17 re-check): the TwinCAT user-mode runtime is installed
      (`C:\TwinCAT\3.1\Runtimes\UmRT_Default`, 4024.74) but unlicensed (`Target\License` empty), and the trial licence
      is issued only after a CAPTCHA in the XAE dialog — a human step. Corpora: 0 `R_EDGE(NOT …)` / `F_EDGE(NOT …)` in
      all six, so the refusal is niche. Owner step to lift it: activate a UmRT trial licence once, then run N17's
      sequence there. `TcUnmeasured` doc updated.
- [x] 3.9 `TcTaskSchedule.cs:82` — XML-escaped `Priority:` passed through: does TwinCAT's read-back decide validity?
      Done (step 3b) — MEASURED, CHANGED (DIALECT C19c, `tc-refusal-measure-priority.log`): `ConsumeXml` refuses NO
      priority; it stores a UINT16 and coerces silently (-1 -> 65535, 65536 -> 0, 99999999999 -> 59391, abc / `<5>` / `&`
      / empty -> 0, 1.5 -> 1, 0x10 -> 16, 007 -> 7). Escaping and letting the read-back decide would catch a value only
      after the task was overwritten, so the pre-flight keeps refusing — by the range 0..65535 (BAD_REQUEST; `-1` and
      `99999999999` passed as "whole numbers" before) — and the read-back compares NUMBERS (`Priority: 007` reads back
      `7`, which the string compare reported as a declined write). Tests: `TcTaskScheduleTests` +3 (written before the
      code; the red run was not logged). Live (rebuilt worker): `-1` and `65536` refused BAD_REQUEST before the write,
      `007` accepted, the task restored.
      **Review 3a+3b (gate), fixed:** (low) `0x10`, which C19c measured TwinCAT to store as 16, was refused BAD_REQUEST:
      `PriorityOf` takes the measured spellings — a decimal with blanks, a sign or leading zeros, and a C-style `0x` hex
      number — in 0..65535; an IEC `16#10` was not measured and stays refused. `TcTaskScheduleTests`: `0x10` moved from the
      refused rows to the written ones (`16`; its premise contradicted the log), + ` 7 `, + refused `0x` and `0x10000`.
      **Step 3b numbers:** census against `4ebeb61c98`: 3b's rows: gone the Priority "not a whole number", new the
      Priority range refusal and `InterfaceAccessorGuard.RefuseBody`. C# suites as in 3a's numbers. Live: CODESYS and
      TwinCAT fixture IDEs, instance `bridge-refusal-review`, both closed.
      **Gate 3a+3b numbers (after the review fixes, 2026-10-03):** C# Engine 1970 (+1 skipped; 3a 1964), Cli 259, Codesys
      272, Twincat 402, Contracts 39, Connector 115, Repo.Gates 106 of 107 — the one red, `NoKindFromTextTests` (retired
      `P.prg`/`B.fb` spellings), is `packages/volt-lsp-iec/src/analysis/checks/names/unresolved-identifier.test.ts` as
      COMMITTED by `lsp-sfc-step-names` (now archived, `53d6f007a7`), red at HEAD, no path of this change. Cli's
      `BridgePackagingTests.An_unstamped_bundle_…(Volt.Ide.Twincat)` hung once for ~25 min in the full run (its `dotnet
      build` child's MSBuild nodes holding the redirected stdout) and then passed; re-run with `MSBUILDDISABLENODEREUSE=1`:
      259 in 1 m 33 s. volt-cli `bun test test/unit` 9; `bun run check` 15/15; `bun run typecheck` clean (5 packages);
      `rate:fixtures`: `map.generated.ts` unchanged; LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 8050 pass,
      382 todo, 34 skip, 0 fail. Census: the review fixes add no throw site (`ValidateInterfaceAccessor` routes the two
      existing `InterfaceAccessorGuard` refusals; `PriorityOf` and `StReader.Words` throw nothing).
- [x] 3.10 (review 2e+2g, medium — triaged niche) — what does the vendor's own View switch (LD ⇄ FBD) do with a network
      the target view has no drawing for: convert it, refuse it, or show it as is? Both writers set `DefaultViewMode` and
      write the same network (network text has no per-view rule), so an LD body holding a `PARALLEL` branch flipped to
      `IMPLEMENTATION FBD` is accepted and pulls back FBD with the `PARALLEL` unchanged (DIALECT N23). Corpora 2026-10-03:
      0 of 10 FBD bodies hold a `PARALLEL`, 3 of 26 LD bodies do; no FBD-only shape is known (LD bodies hold boxes and
      wires). Measure live (CODESYS fixture IDE: View → FBD on an LD POU with a parallel branch; TwinCAT the same); a
      conversion or refusal there → refuse the flip in the pre-flight naming the shape, else record that the vendor holds it.
      Done (step 3, 2026-10-04) — MEASURED, KEPT (no refusal added): the vendor's own switch neither converts nor refuses
      between LD and FBD; it writes `DefaultViewMode`, the member Volt writes, and nothing else stored. DIALECT N23.
      Static (decompiled with `ilspycmd`): `NWLEditor.View`'s setter, identical in CODESYS `NWLEditor.plugin` 4.6.0.0 and
      TwinCAT's 3.5.13.23, sets `DefaultViewMode` and converts networks only on a transition to/from IL;
      `BoxTreePainter.Visit(IBoxTreeParallel)` draws a Parallel whatever the view.
      CODESYS (`scripts/probe-view-switch.py` -> `view-switch.log`, GUI SP21 Patch 4, the command's own `ExecuteBatch` on an
      opened editor): 2 POUs x 3 switches (there, back, there again) = 6 switches + save/close/reopen. LD program:
      `PARALLEL(IN := go, a, b)` (BoxShortCircuit), `a AND PARALLEL(MODE := Sequential, b, go)`, `a AND b`; FBD program:
      `ADD(i1, i2)`, `GT(ADD(i1, i2), i3)`, `a AND b`. Every switch: view changed, networks UNCHANGED (node ids, operands,
      Parallel modes), language model UNCHANGED; reopened == the session's read; build CLEAN before, switched, and after
      reopen; the picture shows the Parallel drawn as a brace branch in FBD. The only member that moved is
      `IBoxTreeBox4.Ordinary` on the AND boxes (2 in the LD program, 1 in the FBD one) — not serialized, recomputed by the
      editor for the view in front.
      TwinCAT (`scripts/probe-tc-view-switch.ps1` + `.ts` -> `tc-view-switch.log`, `ide.ps1 -Instance bridge-refusal-review
      -Fixture 14`, DTE `FBDLDIL.Viewasfunctionblockdiagram` / `Viewasladderlogic`, the same command GUIDs): LD `(a OR b)` +
      `(a AND b)` and FBD `(i1 + i2)` + `((i1 + i2) > i3)` + `(a AND b)`, 6 switches: each changed exactly 1 archive line
      (`DefaultViewMode`) and the pull only in its `IMPLEMENTATION` line; round trips archive- and pull-IDENTICAL; build
      success, 0 diagnostics naming the probe POUs. A Parallel is not measurable on TwinCAT — it cannot be created there
      (D30) and no archive holds one. Side fact (no Volt impact): opening the editor and saving with NO command rewrites a
      pushed POU's archive (24 / 42 lines: operand `Type` resolved, `LValue` true, the importer's empty `OutputItems`
      dropped), the pull IDENTICAL — so the probe compares the switches against that opened state.
      Numbers: 0 product files changed, 0 tests (no logic: a measurement); census unchanged (no throw site touched). The
      niche triage's "accepted loss" is withdrawn: there is no loss — a Volt flip is the vendor's flip. Both IDEs this step
      opened are closed (CODESYS probes exited; TwinCAT `ide.ps1 down`).
      Review 3 (gate step 3, 2026-10-04) — 4 low findings, all fixed:
      (a) "a Volt flip is the vendor's flip" rested on a code reading (the probe built its networks itself, not through
      the push). Pinned: `CodesysViewFlipParallelTests` (Codesys.Tests +1) pushes an LD body holding a fed
      `BoxShortCircuit` and an unfed `Sequential` Parallel through `CodesysNetworkWriter.Write`, pulls it, flips the
      line to FBD and back — `DefaultViewMode` is the one member written, no network is torn down or rebuilt, the pull
      is identical but its line, both modes kept; teeth: with the change gate disabled it fails (both networks torn
      down). Live: `view-change.test.ts` +1 "an LD body holding a PARALLEL flips to FBD and back, unchanged, and
      builds" — SP21 2/2 pass (accepted, pulled back as flipped, the project builds, each way); TwinCAT 1 pass 1 skip
      (the case skips there: no Parallel can be created, D30). Green on first run, as it should be: it pins a
      measured behaviour, not a fix.
      (b) `probe-view-switch.py`'s dump dropped members unsaid (a throwing getter, a non-NWL value, a list with a non-NWL
      element). Now every member is written (a throwing getter as its exception, a non-NWL value by its CLR
      ToString) and anything not compared by value is listed at the end of the log. Re-run (GUI SP21): it found two
      members the old dump had been dropping — `GenericObjectService` on every node (a service handle) and
      `BoxTreeBox.Image` (the box picture the editor caches once drawn; null after the reopen, so it read every reopen
      as CHANGED). Both are skipped as editor-only, and every skip (also `Ordinary`, `TheAddress`, `TheSymbolComment`)
      is CHECKED absent from its node's `SerializableValueNames` on each run (all False). Result unchanged: 8 of 8
      reports networks UNCHANGED and language model UNCHANGED, 0 members compared other than by value, reopened ==
      session, builds CLEAN.
      (c) `probe-tc-view-switch.ps1` hid the one diagnostic. It now logs every diagnostic and takes a baseline build
      before the probe POUs exist. Re-run (`ide.ps1 -Instance bridge-refusal-review -Fixture 14`): the one diagnostic
      is `info` "generate boot information...", in the baseline too; after == baseline: True; the switch results
      unchanged (1 archive line each way, round trips identical).
      (d) the dead `folder` command and `plcFolder` import are deleted from `probe-tc-view-switch.ts`.
      DIALECT N23 and `scripts/README.md` updated. Numbers: Engine 2221/0/1, Cli 260, Connector 115, Twincat 428,
      Codesys 298 (+1), Contracts 39, Repo.Gates 108, volt-cli unit 24, check 18/18, typecheck clean, LSP full suite
      (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 8060 pass / 34 skip / 381 todo / 0 fail; `map.generated.ts`
      unchanged (no fixture or transpiler change). Census unchanged (no `src` change). Both IDEs closed.

## 4. Design issues

- [x] 4.1 D1 — gone: `ec0152fe0f` + `b6822e9751`. A DUT has one extension `.dut`; the subtype is not on the wire, so
      it has no second source; `push-without-header-check` 1.2 holds for DUTs.
- [x] 4.2 D2 — gone: `f7eb383f47`. One POU extension `.pou`, kind from the IDE class; `PlcPouFb` default deleted.
- [x] 4.3 D3 — **Changed.** `IsGlobalListHeader` is gone (`15d421e57a`: `ProjectDeclarations` / `PushedDeclarations`
      select Globals by wire kind). Left: `StDeclaration.IsCallableHeader` (:90), `IsFunctionBlockType` (:179),
      `FunctionBlockHeader` (:170) via `CodeHelper.HeaderLine`, called from `NetworkScope.cs:98,115`. An FB instance
      still becomes a FUNCTION call when the FB's declaration header does not read — the wrong body is written. The
      kind on the wire is now `pou` for all three, so "FB or FUNCTION" must come from the IDE's POU type (DIALECT
      C2g/C2h), carried on the declarations the scope is built from; then delete the three.
      **Done (step 4a, design D3 option 3 — the IDE's POU type was measured out: a pushed callee has none until it is
      written, and an unclosed `(*` declares nothing on either vendor).** A POU is one by KIND (`kindOf`: the push's wire
      kind, else the IDE class, `ProjectDeclarations.KindOf`); a variable is an instance unless its type is a vendor-refused
      POU name or a project item of another kind. `IsCallableHeader`, `CallableHeader`, `IsFunctionBlockType`,
      `FunctionBlockHeader` and `CodeHelper.HeaderLine` deleted; ratchet counts → 0. Tests: `NetworkScopeTests` +4 (the
      unclosed-`(*` callee is an instance — the D3 bug; a project-FUNCTION-typed variable is an instance box; a POU by kind
      not header ×2); existing rows unchanged but for the two new arguments. Corpus oracle at its pinned tallies.
- [x] 4.4 D4 — a call-target type neither the project nor the library manifest names is refused by name; delete
      `NonBlockTypeWords` (`StDeclaration.cs:162`; still misses `WCHAR`).
      **Done (design D4 option 3).** `NonBlockTypeWords` deleted; the type words come from the vendor's measured
      refused-name list (`CodesysDriver/BeckhoffDriver.RefusedPouName`). "Misses `WCHAR`" was a false premise (both
      vendors take `WCHAR` as a name). No new refusal: `network_unknown_fb_type` recorded on both vendors in one batch each
      — both write the box, both builds say `Unknown type` + `…instance expected instead of 't1'` (DIALECT N26); rating
      `refused`. Tests: `CodesysScopeFactsTests` (6), `TcScopeFactsTests` (7: `LDT`/`LDATE`/`LTOD`/`LTIME_OF_DAY`/
      `LDATE_AND_TIME` are instances on TwinCAT, not on CODESYS).
- [x] 4.5 D5 — no refusal depends on the regex scope (closed by 1.3, 2.10, 2.11); if a name set is still needed,
      take it from the IDE (`StDeclaration.VarLine`).
      **Done (design D5 option 3).** `VarLine` replaced by a statement reader over `StTrivia` (one rule for
      `DeclaredNames` and the type read): wrapped lists, `AT` addresses, one-line blocks, trailing comments. Tests:
      `StDeclarationTests` +19 (7 red before). `REFERENCE TO T` stays no instance — niche: accepted loss (0 occurrences in
      the corpora).
- [x] 4.6 D6 — carry the live body language on `ItemContent`/`Member` from the driver; `BodyFormatGuard` stops
      sniffing text (`ShapeOf`, `BodyFormatGuard.cs:32`).
      **Done.** `StatedLanguage(Language, Hidden)` on `ItemContent`/`Member`/`Accessor` (`Stated`, null exactly where
      there is no body text), set by both drivers' `ReadBody`, `NetworkText.Pulled`, `FakeIde` and `StReader.Body`.
      `ShapeOf`, `LanguageOf`, `Saw` deleted; `RequireAuthorable` asks `Stated` too. A body with text and no stated
      language is refused loud. `RequireStBody` stays (the file needs it). Tests: `LanguageChangeGuardTests` (D6 rows),
      `ItemContentIsFullyCarriedTests` carries `Stated`, driver read rows in `CodesysLanguageChangeTests` /
      `TcLanguageChangeTests`.
- [x] 4.7 D7 — one language-change comparison in `BodyFormatGuard`, pre-flight, UNSUPPORTED, same on both vendors;
      `RefuseViewModeChange` leaves the drivers (`CodesysNetworkWriter.cs:51`, `TcNetworkWriter.cs:165`); CODESYS's raw
      member error replaced by the named refusal.
      Half done (2e/2f): the view change is WRITTEN on both vendors (3.5), so `RefuseViewModeChange` left the drivers and
      the engine; the ST ⇄ graphical comparison in `BodyFormatGuard` (3.3/3.4) is what remains.
      **Done (design D7 option 3; as-built note: it runs at the item's guard before its first write, not in the batch
      pre-flight — the live language needs a content read).** `ICodeStore.RefusedLanguageChange(site, from, to)`, abstract
      on `DriverBase`. Members measured live (`scripts/probe-member-language-change.py` → `member-language-change.log`):
      method, action, GET, SET all change in place, build and run — CODESYS answers null for pou/method/action/
      property_get/property_set and swaps the aspect inside the write's own transaction; TwinCAT refuses every site with
      N24's reason. Live e2e `graphical/language-change.test.ts` (POU ST→LD→ST, method ST→FBD→ST): CODESYS 2/2 pass,
      TwinCAT 2/2 refused untouched. `roundtrip.test.ts`'s "refuses ST over FBD" premise (Volt's own refusal) disproved
      by N24 on CODESYS: split by vendor. `GraphicalChildGuardTests` messages updated (the refusal is the vendor's now).
      Census vs HEAD: 563 → 570 sites (7 gone: the guard's two language-change refusals and five rewordings; 14 new:
      the rewordings, the vendor-asked refusal, the no-stated-language refusal, 3 arg-null, 4 CODESYS swap guards).
      **Step 4a gate — review fixes (7 findings, all fixed, none skipped; each test red before its fix):**
      (1, medium) CODESYS swapped the body aspect on a write that carried NO body — the push's declaration-only write
      (`Body = null`, the member-create path) still states the language, so an EMPTY aspect of the new language was
      committed and the IDE's body was lost when anything before the real body write threw. `NewBodyAspect` now takes the
      text written and swaps only when a body is written (`CodesysLanguageChangeTests.A_write_without_a_body_swaps_nothing…`).
      (2) The write and the guard read an empty body stating nothing differently (ST to the guard, nothing to the write,
      which then set "" on the network aspect mid-apply): `BodyFormatGuard.PushedLanguage` is the one rule, asked by the
      CODESYS write (`…An_empty_body_stating_no_language_is_ST_to_the_write_as_to_the_guard`). (3) `ProjectDeclarations`'
      index held tasks, so a task walked before an FB of its name made `KindOf` answer `task` and `m : Motor;` no instance:
      the index holds the top-level source kinds only (`ProjectDeclarationsKindTests`, 2, over a flat tree — `FakeIde`
      cannot hold two items of one name). (4, 5) The CLI's `SameBody` read with no refused name (a BOOL named `R_EDGE`
      took the edge construct, one program spelled twice was called two) and the engine tests ran on a 25-word stand-in:
      both now ask `Volt.Engine/Ide/BothVendorsRefusedNames.cs` (933 words, the two drivers' measured lists intersected,
      GENERATED and held to the probe logs by `RefusedNamesMatchTheLogsTests.The_engines_word_list_…`; exempt in
      `NoKindFromTextTests` like the drivers' lists). Tests: `PushedTextTests` +3, `NetworkScopeTests` +8 (`DATE_AND_TIME`,
      `__XWORD`, `BIT`, `__SYSTEM`, `__UXINT`, `TIME_OF_DAY`, `__XINT`, `ANY_INT` are no instance); the corpus oracle stays
      at its pinned tallies under the production list. (6) TwinCAT's write never asked `RefusedLanguageChange`: it does now
      where it writes a body (`RefuseLanguageChange` in `WriteOne` and `Collect`; blank = a create, a hidden live body is
      the guard's), so the ICodeStore contract holds on both vendors (`TcLanguageChangeTests` +2; DIALECT N24 says so).
      (7) Live e2e through Volt's own write path for an ACTION (ST→LD→ST) and a property's GET+SET (ST→LD→ST, the LD view
      on members): `language-change.test.ts` 4 cases. `graphical-kinds.test.ts`'s "a graphical accessor refuses a textual
      push" premise was Volt's own refusal, disproved on CODESYS by N24 (as `roundtrip.test.ts` in 4.7): split by vendor.
      Also: the repo gate `No_product_source_spells_a_retired_extension` was red at HEAD on two LSP tests from
      `lsp-sfc-step-names` (`P.prg`, `FB.fb`, `S_Fun.fun` as file keys) — renamed to `.pou`, both files green.
      **Numbers:** C# Engine 2018 (+1 skipped; +13), Cli 254 (= HEAD; its testhost hangs AFTER the last test at HEAD too —
      measured in a HEAD worktree, Release, `--blame-hang-timeout`), Codesys 292 (+2), Twincat 419 (+2), Connector 115,
      Contracts 39, Relay 49, Repo.Gates 108 (+1). LSP full (`VOLT_REQUIRE_FULL=1`): 8050 pass, 34 skip, 382 todo, 0 fail;
      fixture map unchanged (`rate:fixtures`); typecheck green. Live e2e (fixture IDEs, instance `bridge-refusal-review`):
      CODESYS full 254 pass / 24 skip / 0 fail; language-change 4/4 on both vendors (TwinCAT: refused untouched).
      TwinCAT full 254 pass / 24 skip / 0 fail. (A first TwinCAT full run lost its XAE in `hidden-members` — PLC_DISCONNECTED,
      the process gone, 45 cascading timeouts; that file passed 6/6 alone on a fresh XAE and the full rerun is the green
      one above, so it was not reproduced.)
      Census vs HEAD: 563 → 571 (7 gone, 15 new: 4.7's 14 and TwinCAT's write-side language-change refusal).
- [x] 4.8 D8 — pre-flight validates each network body once and passes the `NetworkBody` model to the write; drivers
      take a model, never text; the create-arm copies go (`PushService.cs:1180`).
      **Done (design D8 option 4).** `PushedNetworkBody(Site, Model, Scope)`; `SourceScopes.Validated(content, scopeFor)` is
      the one door (`NetworkText.Validate(` = 1 in product source, ratchet in `NoCodeCheckLeftTests`); the pre-flight keeps
      a `ValidatedSource(Content, Bodies)` per set op and the apply loop, `ApplySetItem`, `MoveItem` (both writes),
      `ApplyToUnopened` and `WriteItemFromSource` take it — no second `StReader.Read`, the create arm's `Validate` gone.
      `ICodeStore.WriteContent(item, content, bodies)` on both drivers and `FakeIde`; a network body with no entry is
      `InvalidOperationException` naming the site (`PushedNetworkBody.At`). Per body per push now: update 1 read / 1
      validation, create 1/1, move+edit 1/1 (written twice from it), replace 1/1 (were 2/2, 2/3, 3/3, 2/3).
      `docs/assets/data.js` regenerated. Tests: `PushValidatesOnceTests` (create, update, move+edit each build one scope
      per body; the fake refuses a model-less body; `Validated`'s sites), `CodesysWriteTakesModelTests`,
      `TcWriteTakesModelTests` (a body TEXT that does not read beside a valid model is written from the model);
      `PushSiblingDeclarationsTests` / `GlobalsByWireKindTests` assert the scope (`FakeIde.ScopesPushed`).
- [x] 4.9 D9 — StReader content scans gone (1.2, 2.1); one message for empty text and Unmarked; `Shape`
      (`ImplementationMarker.cs:78`) does not match a bare `Implementation` wrapped-expression line (test: an ST body
      with that line pulls).
      **Done (design D9 option 3).** `StatedLinesIn`/`IndexIn`/`RequireStBody`/`RefuseLinesInDeclarations` ask `Is`; the
      shape is read only by `LookalikeIn`, the hint of `Unmarked` (no language / bare CFC-SFC-IL / no language a body
      states, the old `Body()` wordings); the empty-text branch is gone (an empty POU or interface is "Missing END_… in
      'X'"). LSP in the same step (5.2 row (e)): `opensKeywordLine` asks the grammar, the three lookalike statement kinds
      are gone, `lookalikeLine` is the hint of the server's "states no language" finding. Tests:
      `ImplementationKeywordTests` (lookalike rows → `Unmarked` naming the line; empty POU/interface; ST bodies holding
      `Implementation`/`Implementation OR b`/`IMPLEMENTATION CFC` handed up unchanged), `ReadOnlyBodyTests` (they pull AND
      push back as written), `CodesysStBodyLineTests` / `TcStBodyLineTests` (driver reads), `ImplementationLanguagePushTests`
      (a bare keyword line in a declaration is written as sent — its premise was the shape; a boundary line in an
      interface member's declaration is still refused); LSP `implementation-line.test.ts` (+1, 2 rewritten),
      `implementation-keyword-diagnostics.test.ts` (+1); rule inventory FMT2/FMT3/FMT4 updated.
- [x] 4.10 D10 — `ParseSignature` returns name + type text, no vocabulary (2.4-2.6, 3.1).
      **Done (design D10 option 3; as-built: the END-after-code exemption keeps the six words — see design).** The name
      is the last word before the colon; `Modifiers` is gone. The ACTION line is refused (INVALID_ST) when it holds
      anything besides the keyword and a name (modifier, type, comment, `;`). Recorded `sig_unknown_word` and
      `sig_empty_type` (`oop/header-rules.ts`) on CODESYS SP21 and TwinCAT Project13, one batch each: both builds read the
      FIRST word as the name ("The name used in the signature is not identical to the object name"); `METHOD Run :` is
      "Type definition expected instead of ''" on both, which the LSP now reports (`parse/units/header.ts`, src test in
      `method.test.ts`); `sig_unknown_word` is a known divergence (`MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD`, niche: 0 corpus
      lines). Consequences recorded in a second batch per vendor: the five OVERRIDE fixtures are no longer refused by the
      push and both builds were recorded (three became as-sent with their base a fixture of its own:
      `unit_method_override_base`, `…_public_order_base`, `unit_property_override_base`), all in the same divergence set;
      `unit_action_modifier` is now refused by the push (`vendorRefuses`, its old rows predate it). Tests:
      `SignatureParseTests` (the STATIC/FOO/PUBLIK rows assert the name and type read; +`METHOD Run Walk`, +ACTION refusal
      and acceptance rows), `ChildSplitterTableTests` (PUBLIK row reads `method:M`; the ACTION-line comment row is refused;
      the two END rows kept).
- [x] 4.11 D11 — one shape table per kind on `ItemKind`; reader, writer, guard, `CanHold` ask it; fix the
      `InterfaceMethod` branch in `BodyFormatGuard` (:57, :100).
      **Done (design D11 option 3).** `ItemKind.ShapeOf(kind)` → `KindShape(Composite, MembersInside, Body, Accessors,
      Signature)`, a total switch (an unknown kind is `ArgumentException`). Asked by `StWriter`, `StReader` (source kinds
      only), `NetworkText.CanHold`, `BodyFormatGuard` (the interface method checks neither a body nor accessors),
      `SourceScopes.SitesOf`, `PushService` (accessor reconcile, `CreateSeed`), `CodesysDriver.ReadMember`.
      `ImplementationMarker.AppliesTo`, `StWriter.HasBody`, `BodyFormatGuard.CarriesAccessors` and the three `Gvl or Dut`
      copies deleted (ratchet: 0). Tests: `KindShapeTests` (the old predicates pinned against the rows; no answer changes),
      `LanguageChangeGuardTests.An_interface_method_is_checked_for_neither_a_body_nor_accessors` (asserts the sites asked).
- [x] 4.12 D12 — merged into 4.8 / 2.27; verify TwinCAT validates each body once.
      **Verified.** TwinCAT's write takes the model and scope at each body (`WriteOne`, `Collect`, `ResolveBody(existing,
      model, scope)`); its three write-path `NetworkText.Validate` calls are gone; the pre-flight's lowering
      (`ValidateSource`) stays — it asks the vendor's create question, not the text (D21). Proved by
      `TcWriteTakesModelTests` and the `NetworkText.Validate(` = 1 ratchet.
      **Step 4b numbers (before the gate):** C# Engine 2059 (+1 skipped; +41), Codesys 297 (+5), Twincat 424 (+5),
      Repo.Gates 108, Contracts 39, Cli 259; corpus oracle at its pinned tallies (in Engine). LSP: test/conformance 5956
      pass / 338 todo / 0 fail, test/frontend 39/39 (baselines rewritten: +5 fixtures, +6 known divergences per vendor),
      changed-area src tests 451 + method.test 5; typecheck and lint clean. Recordings: CODESYS/TwinCAT build for
      sig_unknown_word, sig_empty_type, the five OVERRIDE fixtures and three base fixtures; CODESYS run for the three bases.
      Census vs HEAD: 571 → 575 (8 gone: the empty-text branch, the three lookalike arms of `Body()`, the shape refusal in
      declarations, the old `Unmarked`, the modifier and old action refusals; 12 new: the boundary-line refusal in
      declarations, two `Unmarked` arms, the action-line refusal, `ItemShape`/`ShapeOf` ArgumentExceptions, the
      unreachable-language guard in `Body()`, two arg-null, the model-less body, two push INTERNAL_ERRORs).
      **Step 4b gate — review fixes (5 findings, all fixed, none skipped; each test red before its fix):**
      (1, medium) an action's DECLARATION, not only its line: trivia above the ACTION keyword and a VAR section or comment
      under it were read into the declaration neither write stores (`Action ? null`) and dropped. `StReader.
      RefuseActionDeclaration` refuses every non-blank line in it but the ACTION line, naming it (INVALID_ST; 0 in the
      corpora — a pull composes `ACTION <name>`). `ChildSplitterTableTests`: +4 rows (above, VAR under, comment under,
      blank line accepted); "trivia between members" keeps its premise on a PROPERTY (its action half asserted the drop).
      LSP: `unit_action_var_section` is `pushRefuses` (+execSkip); `parse/units/action.ts` reports the push's words for
      the line, above and under, and reads the action by the push's name, so `Act()` binds (`method.test.ts` +1).
      (2, medium) `unit_action_modifier` / `unit_action_var_section` left `ACTION_HEADER_DROPPED_BY_THE_PUSH` (set
      deleted) and their pre-refusal build rows were dropped from both build recordings (check-recording's "vendorRefuses
      — the row predates it"); U17 lists neither (recheck note); map: both `unaskable`, no divergence.
      (3, low) the empty type is read for every line the push never writes into a declaration: `header.ts`
      `refusedEmptyType` (IMPLEMENTATION line, END_METHOD on an interface method, GET/SET/END_PROPERTY on a property —
      POU or interface; `emptyType` keeps a property node's type), one "Type definition expected instead of ''" and no
      cascade (`method.test.ts` +1, five shapes).
      (4, low) FMT8's reserved-name report is gone (`format/reserved-names.ts` + test deleted, `claimedKeywordLines`
      with it): `IMPLEMENTATION` is a name like any other, as the push writes it since 1.2 — 5.2 row (a) done.
      `implementation-keyword-diagnostics.test.ts`: the two "reserved" tests (premise: the push refused the name) became
      one "no diagnostic in any file or naming position" test; FMT8 inventory row and `docs/architecture.md` updated.
      (5, low) `HeaderNameAt` with a colon on the line takes the last word before it — ParseSignature's word — and keeps
      the six words only for a colon-less line (`METHOD PUBLC end_method : INT` is the method end_method;
      `ChildSplitterTableTests` +2). Design D10 as-built notes amended.
      **Gate numbers:** C# Engine 2065 (+1 skipped; +6), Codesys 297, Twincat 424, Repo.Gates 108, Contracts 39,
      Cli 259, Connector 115, Relay 49 — all green. LSP full (VOLT_REQUIRE_FULL=1): 8060 pass / 34 skip / 381 todo / 0 fail (8475 tests, 206 files); test/frontend 39/39
      (baselines rewritten: known-divergence files −4 per vendor, push-refused-with-parse-error +2 per vendor, bare names
      resolved +6, no NEW finding, no ceiling rise); typecheck and lint clean; map regenerated (2 fixtures known →
      unaskable). Census vs HEAD: 571 → 576 (8 gone, 13 new: the 12 above + `RefuseActionDeclaration`).
- [x] 4.13 D13 — canonical gates gone (2.12, 2.13) and the reader's layout rules with them (2.7-2.11).
      **Done (design D13).** Code already gone at HEAD (`NETWORK_NOT_CANONICAL`: 0 in `src`, `Volt.Contracts`, LSP code
      list; `.task` `Gate` is `Read`). The comments that still stated the rule are rewritten: `NetworkTextReader.cs`
      (:236 misordered header, :297 stored title/comment), `NetworkText.cs:28`, `NetworkSpelling.cs:14` (writer/reader
      drift shows as the gate's read-back INTERNAL_ERROR), `ICodeStore.cs:89`, `PushService.cs:139`,
      `docs/driver.html:139`, the `TaskDescriptorException` summary, and five LSP comments that still said
      "NETWORK_NOT_CANONICAL stays the push's" (`network-analysis.ts`, `network-text/ast.ts`, `network-text/parser.ts`,
      `network.test.ts` (+ test title), `network-real-shapes.test.ts`). History mentions kept (`NetworkTextGate.cs:21`,
      `network-text.html` gate section, `PushService.cs:1216` "WAS refused"). V.2 ticked.
      **Review 4c fixes (gate):** (medium) two LSP package docs still stated the refusal as a live invariant —
      `docs/behavior.md` "The round trip is exact" requirement (SHALL refuse non-canonical text; scenario "refused with
      NETWORK_NOT_CANONICAL") rewritten to the as-built rule (a complete, writable model is written whatever its
      spelling and the canonical text comes back; refused only for the reader's `NETWORK_*` diagnostics or
      `NETWORK_UNSUPPORTED`; scenario "a valid hand-spelled body is written"), and `docs/data-model.md:386` "stays the
      push's" → "is gone". `git grep` outside openspec now finds the code only as history. (low) `NetworkSpelling.cs`'s
      rewritten comment claimed every writer/reader drift surfaces as the gate's read-back INTERNAL_ERROR; the gate
      re-reads, it does not compare models, so drift that reads back into a DIFFERENT model passes it. Comment corrected:
      the gate catches only the does-not-read-back half; the other half only the offline `Read(Write(m)) ≅ m` oracle
      (`NetworkModelOracle`). No runtime model comparison added (no doc/comment finding has a failing test; a runtime
      check is a design change, not this step's).
- [x] 4.14 D14 — `TaskDescriptorException` becomes a coded `BridgeException` (BAD_REQUEST); every re-code in §2
      covered by a code-asserting test. (Today it reaches `PushService.ConflictFor` uncoded → INTERNAL_ERROR.)
      **Done (design D14).** `TaskDescriptorException : BridgeException`, code fixed at `BAD_REQUEST`; type, seven
      messages and the `Assert.Throws` rows unchanged. Tests (red before): `TaskDescriptorFormatTests.
      Every_refusal_is_coded_BAD_REQUEST` (7 rows, one per throw site), `PushTaskTests.A_FIELD_VOLT_CANNOT_ROUND_TRIP_
      stops_the_push` asserts the conflict's `BAD_REQUEST`. §2 re-code audit: 2.14/2.15 (`PushKeepsWhatLandedTests`,
      `PushDeleteGuardTests`), 2.16-2.18 (`PushKindInvariantTests`, `ItemKindTests`), 2.25 (`CodesysTaskKindTests`)
      already asserted `ErrorCode`; the rows re-coded by exception CLASS (2.2 `ArgumentException`, 2.20/2.30/2.32/2.33
      `InvalidOperationException`, 2.21 `NotSupportedException`, 2.35 coded INTERNAL_ERROR) asserted only the class —
      `PushConflictCodeTests.Each_refusal_class_reaches_the_wire_with_its_code` (5 rows, incl. the `.task`) pins the
      wire code each class gets. V.1's `.task` clause amended to BAD_REQUEST.
- [x] 4.15 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D15 — one last-moment version helper on `Versioning.SafeVersion`; null folder/kind → ITEM_UNVERIFIED on
      both arms (`PushService.cs:520` throws on a null folder, `:542` returns).
- [x] 4.16 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D16 — `currentFolder` nullable ("unknown") — `PushService.cs:578` still `inCache ? cached.Folder : ""`;
      uncached item → ITEM_UNVERIFIED, not a hash against root; move compare treats unknown as unknown.
- [x] 4.17 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D17 — `Owner()` (`PushService.cs:1567` `?? pou`) and member-folder misses (`:1589` `?? Owner()`) throw
      NOT_FOUND by name.
- [x] 4.18 D18 — gone: `DutSubtypeChanges.cs` deleted (`b6822e9751`); the `ItemKind` "Kind is recovered from file
      content on push" comment rewritten (`ec0152fe0f`); `NoKindFromTextTests` repo gate (`a313c74b38`) keeps it out.
- [x] 4.19 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D19 — compute the landing wire name once; the same one goes to the engine read and `ValidateSource`
      (`PushService.cs:208` reads `ToName ?? Name`, `:223` hands the driver `Name`).
- [x] 4.20 D20 — **Changed.** `?? Method` is gone (`15d421e57a`: `BeckhoffDriver.Content.cs:596` refuses an unknown
      member type by name, `:597`). Left: `?? ""` at `BeckhoffDriver.Content.cs:707`, and no shared
      `MemberKind(code, ownerIsInterface)` (CODESYS keeps a private one, `CodesysDriver.Content.cs:243`).
      **Done (design D20; as-built: a third `member` argument so the refusal names the member on both vendors, as the
      design's "stays refused" line asks).** `ItemKind.MemberKind(code, ownerIsInterface, member)` in the Engine, rule
      unchanged (owner decides method/interface method and property/interface property; else `Map(code)`; else
      UNSUPPORTED naming member and code). Asked by `CodesysDriver.ReadMember` (private map deleted), `BeckhoffDriver.
      ReadMember` (takes `ownerIsInterface` = `KindCode(item) == PlcItf`, like CODESYS) and `BeckhoffDriver.Creates`
      (the held member's kind, same rule), and `FakeIde.MembersOf` (its third private copy deleted). TwinCAT
      `WriteAccessor`'s `?? ""` is `?? throw BridgeException(INTERNAL_ERROR)` naming the code and property. Tests:
      `ItemKindTests` (+12: 10 code×owner rows, unknown code refused ×2), `TcMemberKindTests` (+4 owner rows — PlcMethod
      under an interface and PlcItfMeth under an FB were red before; the unknown-code row asserts member + code). No
      LSP fixture: no user-written text changes its answer.
      **Step 4c numbers (before the gate):** C# Engine 2245 (+1 skipped; +24), Twincat 432 (+4), Codesys 298, Cli 260,
      Connector 115, Contracts 39, Repo.Gates 108; `bun run check` 18/18. LSP (comments only): network src tests 109,
      test/conformance 5958 pass / 337 todo / 0 fail, test/frontend 39/39, typecheck clean, rate:fixtures leaves
      map.generated.ts unchanged. No recordings (nothing user-visible in the LSP).
      **Review 4c fix (low):** the TwinCAT unknown-code test had been loosened to two `Contains` checks when the shared
      message dropped "tree"; it now pins the shared rule's exact phrase ("member 'Mystery' has item type 9999, a member
      Volt has no kind for"), and `ItemKindTests.A_member_code_with_no_kind_is_refused_by_name` pins the same phrase +
      "refusing to treat it as a method" (was `'Mystery'` + `9999`). The vendor prefix ("CODESYS:" / "TwinCAT:") is NOT
      restored, by decision: the rule is one vendor-neutral Engine map (D20), the answering bridge's pipe names the
      vendor, and drivers cannot reach the branch (`MemberSites.Of` admits only `IsMember` codes).
      **Step 4c gate numbers:** C# Engine 2245 (+1 skipped), Twincat 432, Codesys 298, Cli 260, Connector 115,
      Contracts 39, Relay 49, Repo.Gates 108 — all green; `bun run check` 18/18; typecheck clean (cli, lsp-iec, vscode);
      lint 0 errors. LSP full (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): 8060 pass / 34 skip / 381 todo / 0 fail
      (8475 tests, 206 files; delta vs 4b gate: 0). No fixture or transpiler change → map not regenerated.
- [x] 4.21 D21 — covered by 2.28.
      Done with 2.28.
- [x] 4.22 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D22 — N21 stated once (engine), vendor fact as data; after 1.5 only the "cannot build what the text means"
      arms remain on both vendors.
- [x] 4.23 D23 — covered by 2.32.
      Done with 2.32.
- [x] 4.24 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D24 — a dedicated regrouping exception; the Stamp catch catches only it (after 3.7). (It excludes
      `TcEnoRefusal` already; any other `NotSupportedException` is still swallowed.)
- [x] 4.25 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D25 — the in-place refusal travels as the inner exception / in the message when the rebuild also refuses;
      fix `TcNetworkWriter.cs:488`'s wording.
- [x] 4.26 D26 — a body pushed at an item with no body slot is refused by name on both vendors; ask the object, not a
      kind table (`CodesysObjectModel.cs:229` returns silently; `BeckhoffDriver.Content.cs:583` `HasBodySlot`).
      **Done (step 4d, design D26).** Each object model's one text write asks the OBJECT for every slot it is sent a
      text at, before either slot is written: CODESYS `WriteSourceText` → `RequireSlot` (`GetMember(iobj, aspect) == null`,
      inside the checkout, so it rolls back), TwinCAT `WriteText` → `RequireSlot` (a binder miss or a COM missing-member
      HRESULT, the classification `ReadImplementation` uses); a non-null text at a missing `Interface`/`Implementation`
      (`DeclarationText`/`ImplementationText`) is `BridgeException(UNSUPPORTED)` naming the item and the slot.
      `HasBodySlot` is deleted. **The producer was the gap the design anticipated:** `StReader` sent `""` (not null) as the
      body of a GVL, a DUT, an interface, an interface member and a property — so with the object asked, every GVL push
      would have been refused; it sends null now (nothing compared on it: Engine/Cli suites unchanged). Tests (red
      before): `CodesysNoSlotTextTests` (+3: body at an object with no Implementation → UNSUPPORTED, 0 commits, 1
      rollback, declaration untouched; declaration at no Interface → same; declaration alone lands),
      `TcNoSlotTextTests` (+5: body / declaration at a missing member refused before either write; the driver's POU body
      at an object without the slot — was a raw RuntimeBinderException; a body at a GVL — was DROPPED by the kind table;
      a GVL as the reader sends it lands), `NoBodySlotIsNullTests` (+4, Engine: GVL/DUT/interface + its members/property
      carry a null body). No LSP fixture: no text a user writes changes its answer.
- [x] 4.27 D27 — covered by 2.23, 2.24, 2.29, 2.34; the marker grammar accepts a vendor-named unknown language.
      Done with 2.23, 2.24, 2.29, 2.34 and the grammar (bridge, LSP, VS Code).
- [x] 4.28 D28 — covered by 3.6: refusal TwinCAT-only if CODESYS takes the write.
      Done with 3.6 (step 3b): CODESYS writes the declaration and refuses only a body; TwinCAT refuses the whole accessor.
- [x] 4.29 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D29 — measure `ErrorList.ErrorItems` on TcXaeShell; read diagnostics structurally or record why not.
- [x] 4.30 **Deferred (owner, 2026-10-03): internal refactor, not user-visible — not in this change.** D30 — `LibraryManifestFromXml` (`BeckhoffDriver.Content.cs:782`) requires the members the vendor XML always
      carries (measure which); a missing one makes the manifest unreadable (`?? name` at :788, :794).
- [x] 4.31 (from `push-without-header-check` 5Qb, live: `packages/volt-cli/scripts/merged-classes.log` lines 112, 229)
      A move into a tree node that is NOT a folder — `Device` on Pro2193, `Task Configuration` on Bakon Nano — is
      ACCEPTED as "moved" while the object stays where it was: the workspace says the new folder, the IDE disagrees,
      and the next pull moves the file back. CODESYS refuses such a move in its own UI. Test-first: a `set` whose
      `toFolder` resolves to a non-folder node is refused by name before anything is applied (on both vendors; TwinCAT
      has no `Task Configuration` node — measure what its move does with a non-folder target), and `MoveItem`'s
      post-condition (`PushService.cs:1005` "could not be found after being moved", and `BeckhoffDriver.Tree.cs:385`,
      2.35) catches an IDE that ignored the move. Still open at HEAD: no non-folder check exists.
      **Done (step 4d).** Holders MEASURED first (`scripts/probe-move-holders.py` → `move-holders.log`, CODESYS SP21 on
      copies): parents of every top-level source object — Pro2193 532 folder / 1 Application / 2 root, Bakon 128/2/0, AWA
      51/2/1, Lenze 178/0/2, the fixture 0/4/0: root, folder, Application, nothing else. TwinCAT measured once
      (`probe-tc-move-target.ps1` → `tc-move-target.log`, Project14 copy, Volt's own archive move): into a POU node (602)
      and into `References` (617) both REFUSED ("No elements imported"), and the second refusal left the GVL at the PLC
      project root, so the undo re-imported it as `GVL_PackML_1` (DIALECT C2q, new). (a) Pre-flight:
      `TreeNav.RefusedMoveTarget` descends a move's `toFolder` read-only (the move's own match) and refuses `UNSUPPORTED`
      "'X' cannot move into '<path>': '<node>' is a <kind> node, not a folder …" when the deepest existing node is not the
      root, a `PlcFolder` or an `Application`; only a MOVE of an item the IDE holds (a create keeps the vendor's refusal);
      collected like every pre-flight refusal, so no op of the batch lands. (b) Post-condition in `MoveItem`:
      `TreeNav.FolderHolds(newFolder, name)` after `ide.Move`, else `UNSUPPORTED` "this IDE did not apply the move … the
      item is still in '<folder>'" (from a walk, on the failure path only). FakeIde: `ContainerKinds` (Device / Plc Logic /
      Application nodes) and `IgnoreMoves`; and its folder refs are now ENCODED paths with a decoded name (a folder named
      "Interfaces / Data" was two nodes in the fake, which the post-condition exposed in
      `Move_into_a_folder_whose_name_contains_a_slash_creates_ONE_decoded_folder`). Tests: `MoveIntoNonFolderTests` (+9:
      Device, Task Configuration, Plc Logic, a new folder under Device → refused, nothing recorded, refs unchanged, a
      fine second op not applied; Application, a folder, a new folder under the Application, the root → land; an IDE
      that ignores the move → refused naming '<its folder>'). Live negatives are 8.2's.
      **Gate 4d review fixes (all four taken, tests red first):** (1) MEDIUM — a vendor-refused archive move that
      DEPOSITED the item at the PLC project root (C2q) was undone into a clash (`GVL_PackML_1`) and reported as a plain
      refusal: `TcItemArchive.Move` now takes the PLC root and the object model's child-name walk (`ChildNames`, through
      `ChildAt`, so a C2i child is never opened); the undo deletes a copy of the name the root did NOT hold before the
      import, then restores, and a restore under another name is refused naming both ("… its undo restored the item as
      'GVL_PackML_1', not 'GVL_PackML' — rename it back …"). `TcItemArchiveTests` +3 (deposit cleaned; a name the root
      held before is untouched; renamed restore refused). (2) the holder rule judged a folder CREATED under a non-holder
      (`Device/Brand New`), which nothing measured: `RefusedMoveTarget` now judges only a target that EXISTS (a path with
      folders to create goes to the vendor; the post-condition answers); the row is removed with the reason, C2q says
      "unmeasured". C2q's TwinCAT holder claim now cites a census: the pulled `twincat-project14` corpus (8 in the
      folders DUTs/FBs/GVLs/POUs, 2 at the PLC root, none elsewhere outside References). (3) the post-condition matched
      by BARE name: `FolderHolds(ide, folder, name, kind)` and the "stayed" walk match name AND wire kind (a C2i child by
      its stated kinds); the pre-flight's `itemCache[Bare]` part of the finding is SKIPPED — the cache holds only
      addressable items (`ItemKind.IsAddressableItem`: top-level source + writable references), so a visualization
      never enters it. FakeIde: a tree child's handle carries its kind (two same-named items resolved the first),
      `DropsOnMove`. (4) `MoveIntoNonFolderTests` +3: TwinCAT `References` (PlcLibMan 617) refused in the pre-flight; FB
      `CM_Carrier` ignored-move with its visualization in the target → refused "still in 'A'" (red before); an item in
      neither folder afterwards → refused saying so.
- [x] 4.32 (from `push-without-header-check` 5Qb) THE RE-TYPE ROUTE in one push: `deleteItem X.pou` + `set X.dut`
      (either order). Two wire identities, one IDE object name; refused `BAD_REQUEST` in the pre-flight
      (`PushService.cs:745`, `RequireOneOpPerItem`, `OneOpPerItemTests`). Decide (owner) whether a re-type in one push
      is written instead — delete, drop the cache entry, create — or stays refused ("delete in one push, create in the
      next"; the CLI sends both rows of a re-typed file in one `volt push`, so today's remedy needs two commits). Either
      way the single-op re-type guard (`PushService.cs:1229`, "a push cannot re-type an object by its NAME") keeps its
      message.
      **Done (step 4d, owner default per design: STAYS REFUSED).** `RequireOneOpPerItem` keeps `BAD_REQUEST`; the message
      now states the CLI remedy: "… A re-type in one push is not written: commit the deletion of 'A.pou' and `volt push`,
      then commit 'A.dut' and `volt push`." (which name is deleted and which created is read off the ops, either order).
      The single-op re-type guard's message is unchanged. `OneOpPerItemTests` premise unchanged; +2 rows pin the wording
      (red before).
      **Step 4d numbers (before the gate):** C# Engine 2260 (+1 skipped; +15), Twincat 437 (+5), Codesys 301 (+3), Cli 260,
      Connector 115, Contracts 39, Relay 49, Repo.Gates 108; volt-cli `bun test test/unit` 24; `bun run check` 18/18.
      Census vs `cf455f6e1d`: 578 → 583 sites (1 gone: the old re-type wording; 6 new: the move pre-flight and
      post-condition, the re-type wording, CODESYS `RequireSlot` + its INTERNAL "aspect vanished", TwinCAT `RequireSlot`);
      vs `2d4a1a46f2`: 577 → 583 (66 gone, 72 new). No LSP code, fixture or recording changed (nothing a user writes
      changes its answer), so test/conformance, test/frontend and rate:fixtures are not re-run here; map unchanged.
      **Gate 4d numbers (after the review fixes):** C# Engine 2262 (+1 skipped; +2 vs before the gate: +3 rows, −1
      `Device/Brand New`), Twincat 440 (+3), Codesys 301, Cli 260 (one run hung in the testhost for 10 min and was
      killed; two re-runs with `--blame-hang` green in 68 s, no hang — not reproduced), Connector 115, Contracts 39,
      Relay 49, Repo.Gates 108; volt-cli `bun test test/unit` 24/0; `bun run check` 18/18; `bun run typecheck` clean;
      LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 8060 pass / 34 skip / 0 fail (unchanged; no LSP code,
      fixture or recording changed, so the fixture map is not regenerated). Census 583 → 584 (+1: the TwinCAT
      renamed-restore refusal in `TcItemArchive.RoundTrip`).

## 5. LSP parity (`packages/volt-lsp-iec`)

- [x] 5.1 **Changed.** Conformance fixtures + live recordings for every row of the proposal's "What the LSP must pick
      up" table (1.1, 1.2, 1.3, 1.5, 2.4, 2.5, 2.6, and 3.1/3.2 if they remove). The 2.19 row (DUT stating no subtype)
      is gone with 2.19; `push-without-header-check` 4.1 owns the unclosed-comment DUT/FB/GVL recordings.
      **Done (step 5, 2026-10-04).** Row by row; 12 new fixtures in `test/conformance/fixtures/objects/removed-push-checks.ts`
      (category `removed-push-checks`), recorded in ONE batch per vendor (CODESYS SP21 + TwinCAT Project13, own
      `-Instance bridge-refusal-review` IDEs) and `record:exec` for the ST ones that build:
      1.1 `rcc_st_body_network` — both builds: "';' expected instead of 'out'", "';' expected instead of end of POU" +
      two "has no effect" warnings (no Volt message); 1.2 `rcc_implementation_variable`/`_method`/`_enum_value` — clean
      on both, run confirmed; 1.3 `rcc_network_undeclared_wire_shape` (`out := g7;`) — "Identifier 'g7' not defined" +
      "Cannot convert type 'Unknown type: 'g7'' to type 'BOOL'" on both, `rcc_network_located_wire_shape`
      (`g5 AT %IX0.0 : BOOL;`) clean on both; 1.5 `rcc_network_eno_without_en` — CODESYS "An inconsistent element has been
      detected (Missing EN pin). Consider making a correction." + "Cannot convert type 'INT' to type 'BOOL'", TwinCAT
      refused by `TcEnoRefusal` (`vendorRefuses.twincat`); 2.1 (the retired comment, 5.2b) `rcc_retired_comment_in_body`
      — clean on both, run confirmed; 2.4/2.5 were already recorded (`sig_empty_type`, `sig_unknown_word`); 2.6
      `rcc_property_no_type` / `rcc_property_empty_type` — both vendors answer with a cascade over the getter declaration
      they synthesize ("',, AT or :' expected instead of ';'" / "Type definition expected instead of ';'", "'END_VAR'
      expected instead of ''", "Cannot convert type 'BOOL' to type 'INT'", TwinCAT adds "Type definition expected
      instead of ''" to the colon-less one); 3.1 (removed `IsIdentifier`, the vendors' create rule) — `rcc_member_backtick_name`
      (`` METHOD `a b` : INT ``) clean on CODESYS, refused on TwinCAT (Name mismatch), `rcc_member_name_not_identifier`
      (`METHOD My-Name`) refused by both IDEs' create rule (vendorRefuses both, execSkip); 3.2 measured KEPT (N25), no row.
- [x] 5.2 LSP reports each recorded error with the build's message and line; reports nothing for `implementation` as
      an identifier, a `(* @volt-` comment, and the layout rules. Colocated src test per fix.
      LSP-only since steps 1/2 (review 1+2d) — each a false positive under the parity rule until fixed here:
      (a) DONE at the 4b gate: FMT8 `src/frontend/syntax/format/reserved-names.ts` reported every identifier
      `implementation` — deleted (1.2); (b) FMT7 `retired-comments.ts` reports every
      `(* @volt-… *)` comment "as the push refuses it" — 1.4/2.1 (keep only the no-boundary hint, if any);
      (c) `implementation-line.ts:215` reports "its body is network text" for NETWORK…END_NETWORK under
      IMPLEMENTATION ST, where the build's own error belongs — 1.1; (d) `network-text/parser.ts` reports the layout
      rules 2.7-2.11 and an undeclared `gN` (1.3); and it lacks the one rule the bridge ADDED (2.7 review): a late
      VAR_TEMP block declaring a name the network already read as a variable is NETWORK_DUPLICATE_NAME.
      **Done (step 5, 2026-10-04)**, test-first, each with its colocated test: (b) FMT7's report deleted — the parser
      reports no `(* @volt-… *)` comment; `retired-comments.ts` is only `retiredCommentIn`, read by the server as the HINT
      of the one finding for a body that states no language, in the push's words (`StReader.Unmarked`)
      (`retired-comments.test.ts` rewritten, `source-object.test.ts`/`server.test.ts` premises rewritten — the removed
      check); (c) the "its body is network text" arm of `implementation-line.ts` deleted, and with it
      `format/network-header.ts` + test (`opensNetwork`, the bridge's deleted `OpensNetwork`) and `lineAround`'s `code`
      mode; the ST parser's two messages are the build's (`implementation-line.test.ts` pins them exactly); (d)
      `network-text/parser.ts` ported from the bridge reader: VAR_TEMP read wherever it stands and a second block adds
      to the first, empty block and declared-never-defined wire accepted, wire named like a scope variable is the
      wire, `refuseUndeclaredWire` and `addOtherWords` deleted (an undeclared `gN` is the analysis's "Identifier … not
      defined", as the build says), the late-block NETWORK_DUPLICATE_NAME added with the bridge's message and line
      (`bridgeLine`); `NetworkScopeView.contains` deleted (nothing asks it); parser/network tests whose premise was a
      removed rule rewritten (`WIRE_LAYOUT` table +6, late-block +2 rows, wire-shadow analysis +1). Also: `.ENO` on a
      function/operator box with no EN reports CODESYS's "Missing EN pin" (`network-missing-en`, CODESYS only — TwinCAT's
      driver refuses the box, no wording exists; `headIsVariable` keeps an FB call out, resolved type or not); a
      PROPERTY header with no colon reads as the empty type (one message at the name) instead of breaking off into a
      stray GET "the push refuses" (`property.test.ts` +1). FMT7/FMT8 rows in `test/frontend/rules.ts` restated with
      the new fixtures (count unchanged, 352).
      **Agreement:** 8 of 11 recorded CODESYS rows and 7 of 9 TwinCAT rows agree exactly; the rest are the marks below. Known divergences (niche):
      `PROPERTY_WITHOUT_A_TYPE` (`rcc_property_no_type`, `rcc_property_empty_type`, both vendors — "niche: accepted
      loss (0 occurrences in the corpora)": every PROPERTY header in the six declares a type); `ENO_WITHOUT_EN_OUTPUT_TYPE`
      (`rcc_network_eno_without_en`, CODESYS — the INT→BOOL message needs an operator box's ST reading; niche: accepted
      loss, 0 occurrences: all 26 `.ENO` reads in the corpora are on a box with an EN).
      **Step 5 numbers:** LSP `bun test test/conformance` 5970 pass / 0 fail (full, once); `test/frontend` 39/0 after
      `VOLT_WRITE_BASELINE=1` (COUNT lines only — the 24 new fixture files; no finding added or lost, no ceiling rose);
      `bun test src scripts` 1881/0; `test/corpus` + `test/catalog` 166/0; typecheck clean; lint (layering) clean;
      `rate:fixtures`: confirmed 2717→2723, refused 1783→1786, not-lowered 337→336 (`pwh_gvl_retired_volt_comment` now
      lowers and is confirmed — the retired-comment report had refused its no-object assembly), unaskable 69→73.
      **Review 5+6 (gate, 2026-10-04) — six findings, each test-first:**
      (1, medium) `PROPERTY_WITHOUT_A_TYPE` hid a false positive: the LSP's one message was the METHOD rule's
      "Type definition expected instead of ''", which neither build gives for a POU property (only TwinCAT's colon-less
      one). `parse/units/property.ts` now gives the first message of the cascade BOTH builds give for the shape —
      "',, AT or :' expected instead of ';'" with no colon, "Type definition expected instead of ';'" after one
      (`property.test.ts` +1; `method.test.ts`'s review-4b premise for the two POU-property cases rewritten — disproved
      by the recording `rcc_property_empty_type`, not by the code). The mark stays: the LSP MISSES the rest of the
      cascade (niche, 0 occurrences). (2, medium) row 3.1 was not met and nothing showed it: the LSP models no create
      refusal by name (nor the 1092 measured words), so `METHOD My-Name` gets a wrong-cause message and TwinCAT's
      backtick refusal none. Niche: accepted loss (0 occurrences in the corpora — no POU or member header in the six
      names itself outside an ASCII identifier, none with a backtick); recorded as
      `CREATE_REFUSAL_BY_NAME_NOT_MODELLED` (`support/divergences.ts`: CODESYS `rcc_member_name_not_identifier`, TwinCAT
      it and `rcc_member_backtick_name`, each with the vendor's sentence), held by `fixtures.test.ts` as an expected
      failure per vendor — a vendorRefuses fixture has no build, so the replay never saw it. (3, low) the 5.2d network
      rules got fixtures, recorded live in one batch per vendor (own `-Instance bridge-refusal-review` IDEs, CODESYS
      SP21 + TwinCAT Project13): `rcc_network_var_temp_after_statement`, `_second_var_temp`, `_empty_var_temp`,
      `_wire_never_defined`, `_wire_named_like_variable` — clean on both builds, the LSP silent;
      `rcc_network_late_block_shadows_read` refused by the push on both, live ("NETWORK_DUPLICATE_NAME … after line 3",
      line 4 — the LSP's message; vendorRefuses). The shadow fixture's wire is fed by a group: TwinCAT's driver refuses a
      wire fed by a bare leaf as an unmeasured import shape (NETWORK_UNSUPPORTED), no answer about the name. (4, low)
      measured the user-FUNCTION case, `rcc_network_eno_function_without_en`: CODESYS answers "The assignment source is
      incorrect." — NOT "Missing EN pin" (the check borrowed the operator's message for every non-variable head, a false
      positive the review predicted as unmeasured); TwinCAT refuses it (`TcEnoRefusal`, vendorRefuses). `network-missing-en`
      now splits by box kind: an operator box (the bridge's `CallKind.Operator`: the infix table and NOT) "Missing EN
      pin", a head resolving to a declared callable (`isRealCall`) "The assignment source is incorrect." (new
      `Messages.assignmentSourceIncorrect`, CODESYS only), any other head (MOVE, SEL, unresolved) nothing — unmeasured;
      `headIsVariable` takes a namespace-qualified POU (`Util.Twice`) as a function, a member the namespace does not show
      stays a path (unknown, nothing rests on it); moved below `instanceFb` with its own doc (`network.test.ts` +1).
      (5, low) `retiredCommentIn` cuts as `FindRetiredComment` does: the tag on the opening's own line, the hint up to
      that line's `*)` or its end (`retired-comments.test.ts` +1). (6, low) the replay compares no line; the claim is
      corrected here: 5.2's "and line" holds for TwinCAT's ST row only, now pinned by `fixtures.test.ts` "lines —
      TwinCAT's" (`rcc_st_body_network`: TwinCAT's ST line = the file's line less the IMPLEMENTATION line; three of four
      agree, "';' expected instead of end of POU" sits on END_FUNCTION_BLOCK where the build puts it on the body's last
      line — held as an expected failure; every "end of POU" is the same, 146 recorded and never compared: a line-parity
      gate for the whole replay is follow-up work, not this change). A network body's TwinCAT lines are its own element
      numbering (6 and 7 for one statement on file line 8), no text line: not compared, no parity claimed.
      **Gate 5+6 numbers (2026-10-04):** LSP full suite `VOLT_REQUIRE_FULL=1 bun test` (VOLT_FIXTURES unset) **8088 pass
      / 34 skip / 380 todo / 0 fail** (8060 at the 4d gate; 5 diverge as expected failures, LSP-only 0 on both vendors);
      typecheck clean; layering clean; root `bun run lint` 0 errors; `test/frontend` 39/0 after `VOLT_WRITE_BASELINE=1`
      (COUNT lines only, the 7 new fixtures: files 9994→10008); `rate:fixtures`: confirmed 2723, refused 1786,
      not-lowered 336, lsp-gap 74, diverges 5, unaskable 73→80 (the 7 new network fixtures, NOT_ST).

## 6. Gate

- [x] 6.0 `bun run check` is red at c974dba5ad: "every cited DIALECT row exists" reads this change's design decision `D7`
      (cited on lines that also say "DIALECT", e.g. `CodesysLanguageChangeTests.cs:12`, `CodesysObjectModel.cs:181`) as
      DIALECT row D7, which does not exist. Cite design decisions unambiguously (e.g. "bridge-refusal-review D7") so the
      check passes; the check itself stays strict. — no code-check left
      **Done — already green when step 6 ran (2026-10-04), no change needed:** `bun run check` 18/18. Every citation of
      this change's D7 reads "openspec `bridge-refusal-review` D7" (`CodesysObjectModel.cs:182`,
      `CodesysLanguageChangeTests.cs:12`, `TcLanguageChangeTests.cs:8`), and `scripts/check-wiring.ts` skips exactly that
      form — an id directly after `openspec <change>` — since `ad6db35328` (push-partially-applied-flag 3). A bare `D7`
      beside "DIALECT" still fails it.

- [x] 6.1 Full C# suites green; e2e on both vendors.
      **Gate 5+6 (2026-10-04): green.** The Cli "hang" was a test bug, measured: `BridgePackagingTests.Run` builds a
      bundle with `dotnet build`, whose REUSABLE MSBuild nodes outlive it (~15 min idle) holding the redirected stdout,
      so `stdout.Result` saw no end of stream until they exited — each bundle build blocked ~15 min holding the packaging
      mutex (the TwinCAT bundle built 06:30:08, the next build started 06:45:09, exactly as its nodes idled out). Fixed:
      `MSBUILDDISABLENODEREUSE=1` on the child (the command line stays the script's). Cli **260/0 in 70 s**; Engine
      2262/0/1, Connector 115, Twincat 440, Codesys 301, Contracts 39, Relay 49, Repo.Gates 108; volt-cli `test/unit` 24;
      `bun run check` 18/18. e2e: the step-6 run below stands — no bridge or driver code changed since (the gate fixes
      are LSP, fixtures and one Cli test helper).
      **Step 6 run (2026-10-04) — all green but one Cli class, left open for the gate:** Engine 2262/0/1, Connector 115,
      Twincat 440, Codesys 301, Contracts 39, Repo.Gates 108, Relay 49, volt-cli `test/unit` 24; check 18/18.
      **Cli 255 pass, 0 fail, `BridgePackagingTests` not finished:** the first `dotnet test test/Volt.Cli.Tests/` hung
      in `BridgePackagingTests` (testhost idle, no child process, still holding the `Global\volt-packaging-tests`
      mutex), and a second run (`--blame-hang`, 4 min) passed the other 255 and hung on that mutex in
      `An_unstamped_bundle_reports_dev_and_the_commit_it_was_built_from` (sequence + dump under `%TEMP%\brr\clires`).
      Unrelated to steps 5/6 (no Cli or packaging code touched; the other session runs builds in parallel); the stuck
      testhost could not be stopped from this session — re-run `Volt.Cli.Tests` once it is gone.
      **e2e (own fixture IDEs, `-Instance bridge-refusal-review`):** CODESYS SP21 293 tests: 281 pass, 12 skip
      (`-Production` / vendor-only), 0 fail — the 1.4 `retired` GVL row of `push-without-header-check.test.ts` now run
      live (`fetched`). TwinCAT Project13: 272 pass, 13 skip, 3 fail — all three need Project14's fixtures
      (`VltFixtureCfc` is a PROGRAM in Project13, `VltFixtureMembers` exists only in Project14); re-run on Project14
      (`-Fixture 14`): `hidden-declaration` + `hidden-members` 11 pass / 0 fail.
- [x] 6.2 **Changed.** Grep gate (in `Volt.Repo.Gates`, beside `NoKindFromTextTests`) over `packages/volt-cli/src`:
      zero hits for `OpensNetwork`, `RefuseReservedNames`, `RefuseRetiredComment`, `NETWORK_NOT_CANONICAL`,
      `IsCallableHeader`, `IsFunctionBlockType`, `FunctionBlockHeader`, `NonBlockTypeWords`; `CodeHelper.HeaderLine`
      used only by child delimiting. Already at zero at HEAD (keep them in the gate): `IsGlobalListHeader`,
      `?? ItemKind.Kinds.Method`, `PlcPouFb; // default`, and `ParseCodeHeader` / `INVALID_CODE_HEADER` as code (both
      survive only in history comments: `CodeHelper.cs:20`, `StWriter.cs:77`, `PushModels.cs:95`,
      `ConflictCodes.cs:127` — match code, not comments).
      **Done (step 6, 2026-10-04): the ratchet is CLOSED.** `NoCodeCheckLeftTests` already held every retired name at 0
      (each step set its own); 6.2 makes it the gate: doc says closed, and `HeaderLine` — deleted with its last caller
      in 4a (D3), so "used only by child delimiting" became "used by nothing" — lost its `Defines` exemption for
      `CodeHelper.cs` (no file may define it now; key renamed `HeaderLine`). The two stale `<see cref="HeaderLine"/>`
      in `CodeHelper.cs` docs are now plain text. The step-4b door (`NetworkText.Validate(` = 1) stays a count.
- [x] 6.3 Re-census with `scripts/refusal-census.ts`: every refusal site in `Volt.Engine/Format`, `Volt.Engine/Sync`,
      `Volt.Engine/Ide` and both drivers appears in the proposal's tables as keep (including the 47 "New since
      2026-09-29" rows); any new site is classified before it lands.
      **Done (step 6, 2026-10-04).** `refusal-census.ts --against 2d4a1a46f2`: 577 sites then, **584 now; 66 gone, 73
      new, 0 moved**. All 73 are classified in proposal.md "New during this change (73)": 73 keep, 0 change —
      internal-invariant 39, needed-to-write 15 (one is `directed-library-signatures`', `LibraryFetch.cs:172`),
      vendor-limit 13, request-shape 4, version-or-conflict-gate 2. None is a code check. (Steps 5–6 add no site:
      step 5 changed no `src` of volt-cli; 6.2 touched only a doc comment.)

## 7. New since 2026-09-29

- [x] 7.1 The C2i hierarchy-vouch refusals (`twincat` POUs that crash TcXaeShell, DIALECT C2i) answer
      INTERNAL_ERROR for an IDE STATE, not a Volt bug: `TcObjectModel.cs:209, 216, 246, 295, 300, 308`,
      `TcSolutionExplorer.cs:100, 111`. `:216` (two children of one name, DIALECT D34) is a project fact — UNREADABLE
      or UNSUPPORTED by name; the rest name what the IDE did not vouch for. Decide the code with V.1 (likely a
      connection-state code or UNSUPPORTED), test the code per site.
      **Done (step 7, 2026-10-04).** All eight sites answer `ITEM_UNVERIFIED` (design step 7). Measured on the way: the
      design's "the code escapes only through an apply-time lookup" held for the three FOLDER sites (`TcObjectModel`
      ChildAt ×2, RequireListed) — and `ItemLookup.Walk` re-coded every coded refusal from `ChildCount`/`ChildAt` as
      INTERNAL_ERROR, so the lookup now passes an `ICodedError` through with its code (root fix; only an uncoded fault is
      wrapped). The five PROJECT-level sites (`Explorer()` :295/:300/:308, `ExplorerSnapshot.From` :100/:111) run at walk
      START, outside `WalkInner`'s catches, so they also reach `refs`/`fetch`/`push` as an ERROR FRAME carrying
      `ITEM_UNVERIFIED` — the one gate code that can be a frame; documented in `ConflictCodes.ItemUnverified`, wire.html and
      DIALECT C2i. **Open for V.4:** `DocDataTests` declares frame codes from BridgeErrorCodes only, so that frame is not in
      the per-op lists — V.4 decides (declare it, or report the root `unwalked` instead of failing the walk). Tests
      (`TcUntouchablePouTests`): 4 new — lookup into a guarded folder with two children of one name (D34), lookup into a
      guarded node whose count moved, lookup through a folder the hierarchy lists short, a node without its canonical
      name — and the 4 existing INTERNAL_ERROR assertions (8 cases) take the V.1 code. Twincat 444.
- [x] 7.2 `NOT_FOUND` is raised only for post-conditions (`PushService.cs:784, 872, 982, 1005, 1201, 1300, 1314, 1640,
      1664, 1679`; `CodesysDriver.Content.cs:361`; `BeckhoffDriver.Content.cs:122, 154, 237, 248`;
      `BeckhoffDriver.Tree.cs:381, 395`) — "the IDE lost the item Volt just wrote/read", never "the request names nothing". Decide
      (with V.4): keep it as the one "the IDE lost it" code and document that in wire.html, or fold it into
      INTERNAL_ERROR. A client today cannot tell it from `ITEM_MISSING`.
      **Done (step 7, 2026-10-04).** `BridgeErrorCodes.NotFound` → `IdeLostItem = "IDE_LOST_ITEM"` at all 18 sites (no
      message or behaviour change), documented on the constant and in wire.html (both rows: "a post-condition of a push:
      the IDE no longer holds what Volt just wrote or read … never the request names nothing"); `FromBridge`,
      `WireVocabularyGuardTests`, `DocDataTests` (+ regenerated docs data/openrpc), the comments in PushModels, PushService,
      IProjectTree, BeckhoffDriver.Content; `PartiallyAppliedFieldsTests` (3) take the new code. 0 clients branch on it
      (CLI, volt-control, volt-vscode).
- [x] 7.3 `StReader.cs:161` — a U+FEFF after the start of the text is refused INVALID_ST because the splitter's scans
      would disagree about it (5E). It is a Volt splitter limit, not the IDE's: make the splitter read it as a code
      character everywhere and write it, or keep it as "niche: accepted loss" (0 in the six corpora) and say so in
      the message. Record what the CODESYS build says of it.
      **Done (step 7, 2026-10-04).** Fixture `ufeff_after_start` (`grammar/lexer.ts`: `n :<U+FEFF> INT;` beside `m : INT;`,
      body `m := 2;`) recorded with `record:exec` (the push refuses it on both vendors, so `record:language` cannot reach a
      build): CODESYS **refuses** it — "Type definition expected instead of '<U+FEFF>'". So `INVALID_ST` stays and the
      message quotes the build (`ChildSplitterTableTests` pins it); niche (0 occurrences in the six corpora) — the splitter
      is not changed. The LSP gives the build's message on both dialects (agrees; rated `refused`); no divergence mark.
      Frontend baselines: counts only (+1 fixture), no finding and no ceiling moved.
      **Amended by the step-7 review (7.4):** the message above claimed more than the one measured position, and the
      "both dialects" agreement had no TwinCAT recording (record:exec is CODESYS-only) and no test pinning the wording.
- [x] 7.4 Gate step 7 — review findings first, then the full suites.
      **F1 (medium, fixed): the U+FEFF refusal quoted the build at positions never asked.** Recorded with `record:exec`
      (one batch, then one more after a contaminated fixture): `ufeff_in_comment` — the build ACCEPTS it (runs, `m = 2`);
      `ufeff_in_body` — refused, "';' expected instead of '<U+FEFF>'"; `ufeff_in_string` / `ufeff_in_wstring` — the build
      ACCEPTS it (runs). The first string fixture named its variable `s`, and CODESYS's "Unexpected token 's'" cascade was
      about the name (`S` is the set operator), not the U+FEFF — renamed `txt` and re-recorded. So
      `StReader.RefuseInnerBom` branches on WHERE the character stands (`StTrivia.Classes`, a per-column class beside
      `Code`): between two tokens → `INVALID_ST` quoting both measured build messages; inside a comment or a string literal
      → `UNSUPPORTED`, "the CODESYS build accepts it there (measured), but Volt's splitter does not read U+FEFF … (niche:
      accepted loss, 0 occurrences in the corpora)"; inside a pragma (not measured) → `UNSUPPORTED`, the splitter's limit
      and no claim about the build. `ChildSplitterTableTests` theory, 7 rows (declaration, body, STRING, WSTRING, block
      comment, `//` comment, pragma). Ratings: after_start + body `refused`, comment + wstring `confirmed`, string
      `not-lowered` (`string-non-ascii`, the transpiler's own not-measured refusal).
      **F2 (low, fixed):** `refused:` pins the build's words on the two refused fixtures — `ufeff_after_start` "Type
      definition expected instead of '<U+FEFF>'", `ufeff_in_body` "Expression expected instead of '<U+FEFF>'" (in
      codesys.run.json and in the LSP's codesys errors; fixtures.test.ts "refused — the vendor rejects it, in words we
      repeat"). The TwinCAT half is the LSP's dialect only — no TwinCAT recording exists for a text the push refuses.
      **F3 (low, fixed):** `ITEM_UNVERIFIED` is declared as an error frame on `refs`/`fetch`/`push` in `DocDataTests`
      (with an outcome line; `Every_declared_error_code_exists` admits exactly that one gate code), regenerated
      `docs/assets/data.js` + `volt-bridge.openrpc.json`; `PushModels` no longer says the frame vocabulary is
      BridgeErrorCodes alone. (V.4 still decides whether a root that cannot be vouched for should be `unwalked` instead.)
      **F4 (low, fixed):** `ProjectDeclarations.Index` keeps `ITEM_UNVERIFIED` from a folder anywhere (skipping it would
      resolve its names as unknown — a guess) but says why the op needed it: "resolving the body's names needs every
      declaration of the project, and this folder could not be read — the refusal is the folder's, not the item's";
      documented on `ConflictCodes.ItemUnverified` and in wire.html. New `ProjectDeclarationsUnverifiedFolderTests`.
      **Numbers:** Engine 2270/0/1, Cli 260, Connector 115, Twincat 444, Codesys 301, Contracts 39, Relay 49,
      Repo.Gates 108; volt-cli `test/unit` 24; `bun run check` 18/18; typecheck green; LSP 8094/34 skip/381 todo/0 fail (VOLT_REQUIRE_FULL=1). Frontend baselines: counts only (+5 fixtures); the one finding the run raised — `ufeff_in_string`'s initializer does not fold, a non-ASCII character typed into a STRING whose stored bytes are not measured (the transpiler's `string-non-ascii` too) — is counted in `bound-census.ts` as "not asked … niche: accepted loss (0 occurrences in the corpora)" (0 non-ASCII STRING initializers in the six corpora, counted), no ceiling moved.
      e2e not re-run: the step's code changes are the push's pre-IDE splitter refusal and a message in the declarations
      index — no driver or wire path an e2e row drives (no e2e row holds a U+FEFF); the step-6 run stands.

## Error-code vocabulary (owner question, 2026-09-29; re-audited 2026-10-03)

24 codes now (was 22): `BridgeErrorCodes` 11 (+`IDE_UNSUPPORTED`, `codesys-minimum-version`, raised by
`BridgePipeHost.cs:68` on every op but health) and `ConflictCodes` 13 (7 `NETWORK_*`, 5 gate, +`NOT_ATTEMPTED`,
`push-keeps-what-landed`, `PushService.cs:267`). Every code is still raised by production code (no dead code).
`INVALID_CODE_HEADER` was already gone before this change (`c3a49a49ed`). Published by: `refs`/`fetch` (PLC_DISCONNECTED,
WRONG_PROJECT, NO_SIDECAR (fetch only), INTERNAL_ERROR, UNSUPPORTED/UNREADABLE as unreadable listings), `push`
(everything in `ConflictCodes.FromBridge` + the gate + NETWORK_* + NOT_ATTEMPTED as conflicts; PLC_DISCONNECTED /
WRONG_PROJECT / BAD_REQUEST as frames), `build` (PLC_DISCONNECTED, INTERNAL_ERROR), any op (IDE_UNSUPPORTED,
BAD_REQUEST for an unknown op or malformed body, INTERNAL_ERROR fallback in `PipeServer`).

- [x] V.1 **Changed.** Codes on the wrong situation, at HEAD: a stale item version as `BAD_REQUEST`
      (`PushService.cs:534, 557`) → `STALE_ITEM_VERSION`; a refused `.task` (`TaskDescriptorException`, uncoded →
      INTERNAL_ERROR) → `BAD_REQUEST` (amended by D14: a malformed descriptor is the request's grammar, not a vendor
      limit — done in 4.14); known vendor limits as `INTERNAL_ERROR` (`CodesysObjectModel.Descriptors.cs:341`,
      `BeckhoffDriver.Content.cs:460`, `TcObjectModel.cs:576`, and the new C2i sites of 7.1) → `UNSUPPORTED`; Volt
      invariants as `BAD_REQUEST` / `INVALID_ST` / `UNSUPPORTED` (2.2, 2.16-2.18, 2.35); model errors worded "cannot
      express as PLCopen" (`TcPlcOpenWriter.cs:124`) → say what the model lacks. `INTERNAL_ERROR` is left for Volt's
      own broken invariants only. A request for a read-only descriptor (`PushService.cs:192`) and a move of a non-source
      item (`:952`) are request-shape answered `UNSUPPORTED` — decide whether that stays (a Volt rule, not a vendor
      limit) or becomes `BAD_REQUEST`.
      **Done (step V, 2026-10-04).** Re-coded, each with an offline double asserting the new code and the item (red
      before): `ItemLookup` ×3 (the IDE refused a child count / child / name read) and `PushService` forced replace of
      an unopened item whose folder the walk skipped → `ITEM_UNVERIFIED` (`ErrorCodeVocabularyTests`; `FakeIde` gains
      `FaultingChildReads`/`FaultingNameReads`); a member the IDE holds no declaration for (both drivers) → `UNREADABLE`
      (`CodesysMemberWithoutDeclarationTests`, `TcMemberWithoutDeclarationTests`); the TwinCAT member-move post-condition
      → `IDE_LOST_ITEM` (`TcMemberMovePostConditionTests`, message no longer says "Volt bug"); the CODESYS task call-list
      rebuild ×3, the TwinCAT PLCopen import that built nothing ×2 and the save the IDE refused → `UNSUPPORTED`
      (`CodesysTaskCallListRefusalTests`, `TcIdeRefusalCodeTests`; the import double gains `PlcOpenImport`, the empty-body
      arm has no double — same shape, same code); `TcPlcOpenWriter.Refuse` says "Volt's TwinCAT lowering has no spelling
      for it" (`TcPlcOpenInvariantTests`). **The open decision, taken as the design names it:** a push of a read-only
      descriptor and a move of a non-source item → `BAD_REQUEST` (`ProjectSettingsReadOnlyPushTests` ×3 rows take the
      code; the move is reached only when a non-`.task` name finds a TASK by its bare name — the one addressable
      non-source kind). **Kept INTERNAL_ERROR against the design, measured:** `PushService.RequireUnchanged`'s null folder
      (design ":627 folder unknown because the walk skipped it") is unreachable — every caller that passes a version passes
      the cache's non-null folder; an item in an unread folder is refused by the gate first — so it is an invariant;
      `BeckhoffDriver.Content` accessor code with no Volt kind (design ":740") is reached only with `PlcPropGet`/`PlcPropSet`
      (both call sites), both of which map — an invariant too. Census vs HEAD (`refusal-census.ts --against HEAD`): 585 →
      585 sites, 16 re-coded (16 gone + 16 new, same file and message; 0 moved).
- [x] V.2 `NETWORK_NOT_CANONICAL` goes with the layout-only gate (design issue 6): text that is complete and writable is
      written; the code is removed from Volt.Contracts, ConflictCodes, network-text.html and the LSP's network code list
      (5 TS files reference it today).
      Done (2.12; 4.13): 0 as code anywhere; the five TS files now mention it only as gone. Stays in the 6.2 grep gate.
- [x] V.3 `NO_SIDECAR` (`FetchService.cs:51`, "supply knownItems … or run `volt init`") is named after an internal cache
      a client never sees: rename to a request-shape code or fold into `BAD_REQUEST` with the same message; update
      clients and wire.html. Unchanged at HEAD.
      **Done (step V).** Folded into `BAD_REQUEST`, the message naming the wire fields: "a fetch needs a baseline: send
      `knownItems` (or `onlyItems` for a directed read), or `init: true` for a first pull". `BridgeErrorCodes.NoSidecar`
      deleted; `FetchService`, `RefsFetch` doc, wire.html (row removed, BAD_REQUEST's row lists it), `WireVocabularyGuardTests`,
      `DocDataTests` (fetch declares BAD_REQUEST), `PipeTransportTests`, `FetchIncrementalTests`; data.js/openrpc regenerated.
      0 clients branched on it (CLI, volt-control, volt-vscode, volt-desktop, e2e).
- [x] V.4 **Changed.** Gate: every code in BridgeErrorCodes/ConflictCodes is raised by production code AND documented
      with the situation it means (wire.html for the frame and gate codes, network-text.html for `NETWORK_*`, which
      wire.html does not list); a code raised for two different kinds of situation fails the gate (today: BAD_REQUEST,
      INTERNAL_ERROR, UNSUPPORTED — V.1; NOT_FOUND vs ITEM_MISSING — 7.2). Also: `ConflictCodes.FromBridge` omits
      `INTERNAL_ERROR`, which `PushService.ConflictFor` (:372) puts on every unclassified refusal — and since
      push-keeps-what-landed every apply-time stop is a conflict, so clients DO receive it there; list it.
      **Done (step V).** `Volt.Repo.Gates/WireVocabularyTests`: 22 situations, each naming its remedy and its ONE code, with
      the census of raise sites (every `BridgeErrorCodes.X`/`ConflictCodes.X` reference in comment-stripped `src`,
      Contracts and the CLI client excluded) per file with exact counts — 74 (code, file) rows. Fails on: a new or gone
      site, a code under two situations, a code raised nowhere, a code with no `class="name"` row (wire.html; network-text.html
      for `NETWORK_*`). 6 teeth tests. `ConflictCodes.FromBridge` lists `INTERNAL_ERROR` (wire.html "Seven of these codes",
      its conflict row; DocDataTests' push outcome). The situation docs live on the constants (BAD_REQUEST, UNSUPPORTED,
      INTERNAL_ERROR, ITEM_UNVERIFIED) and in wire.html's rows. 7.1's open question: the project-level C2i frame stays a
      frame, declared on refs/fetch/push (7.4 F3) — the walk cannot list a root it could not read as `unwalked` without a
      root to name. Numbers: Engine 2279/0/1, Twincat 447, Codesys 305, Repo.Gates 115, Contracts 39, Relay 49, Cli 255
      (BridgePackagingTests not run), volt-cli `test/unit` 24, `bun run check` 18/18.
- [x] V.5 Gate step V — review findings first, then the full suites. All four findings were right; each was fixed with a
      failing test first.
      **F1 (medium) — a refused TwinCAT save answered `UNSUPPORTED`.** That code was declared on neither push nor build, it
      arrives as a frame and not a conflict, and its remedy says "no retry", while saving again is exactly what fixes it.
      → new frame code **`IDE_SAVE_FAILED`** (`BridgeErrorCodes`; TwinCAT `File.SaveAll` only). It is declared on push and
      build (`DocDataTests` outcomes + notes; openrpc/data.js regenerated), has its own row in wire.html, and the
      UNSUPPORTED row no longer lists "save". The message names the remedy (save in the IDE or retry, then pull) and the
      COM exception stays the inner exception, so an RPC drop still degrades the session. Test:
      `TcIdeRefusalCodeTests.A_save_the_IDE_refused_is_IDE_SAVE_FAILED_and_keeps_the_IDE_exception`. The vocabulary
      now has 25 codes.
      **F2 (low) — a member with no declaration is `UNREADABLE`, but force cannot get past it.** Measured offline: no
      forced update gets past an item whose live read throws, because the update path reads the item before it writes.
      This was already true for any such item, not only this one. A delete followed by a create in two pushes does work.
      → `PushService.ReadLive` wraps the 4 live reads (last-moment version, refused member create, guard read ×2). A
      coded UNREADABLE keeps its code and the IDE's words and adds "cannot be updated in place, with or without force …
      push its deleteItem, then push it again as a create". wire.html, the constant's doc and the gate situation state
      the exception. Test: `ErrorCodeVocabularyTests.A_forced_update_of_an_item_the_IDE_does_not_return_is_UNREADABLE_naming_delete_then_create`
      (the refusal, then the delete push and the create push are both accepted).
      **F3 (low) — the `ItemLookup` faults named no folder and dropped the inner exception.** → each of the three
      messages now names the folder whose read was refused ("the project root" / "the folder 'X'"; that folder's name is
      read only after a fault) and passes the IDE's exception as inner, so `BeckhoffDriver.IsRpcFault` sees it. The
      ITEM_UNVERIFIED remedy in wire.html now reads "the message names it; a refs/fetch walk lists its skips in
      `unwalkedFolders`". Test: `LookupFaults` gains 2 nested-folder rows, and every row asserts the place and the inner
      exception.
      **F4 (low) — the vocabulary gate could not see codes assigned by exception TYPE.** → `WireVocabularyTests` gets a
      second census: every `throw new` of a BCL exception type that carries no code (InvalidOperation / NotSupported /
      NotImplemented / IO / MissingMethod / COM / bare `Exception`; `Argument*` guards excluded), counted per file. A new
      one fails until it is coded or counted. Baseline: 110 throws in 34 files, **accepted as they stand, not
      classified one by one**. The gate holds new sites; auditing which of the 110 are IDE refusals is open work (see
      8.1). 3 teeth tests. Census changes: IDE_SAVE_FAILED +1 situation, UNSUPPORTED −1 (TcObjectModel.Build), UNREADABLE
      PushService 3→5.
      **Numbers:** Engine 2282/0/1, Cli 260 (with BridgePackagingTests, MSBUILDDISABLENODEREUSE=1), Connector 115, Twincat
      447, Codesys 305, Contracts 39, Relay 49, Repo.Gates 124; volt-cli `test/unit` 24; `bun run check` 18/18; typecheck
      green; LSP 8094 pass/34 skip/381 todo/0 fail (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset). No fixtures or transpiler
      changed, so the fixture map was not regenerated. e2e was not re-run: the changes are offline-proven codes and
      messages, and no e2e row asserts any of them.

## 8. Negative e2e — every refusal proven live (owner, 2026-10-03: "our e2e tests don't really have negative tests")

Measured 2026-10-03: the live e2e suite (51 files) asserts only 5 distinct wire codes (UNSUPPORTED ×3,
NETWORK_UNSUPPORTED ×2, STALE_PROJECT_VERSION, ITEM_EXISTS, INVALID_ST) of the 24 in the vocabulary; the negative
paths live almost only in the offline C# doubles, which cannot show what the real IDE does. After V.1–V.4 settle the
codes, every code is proven against both live IDEs.

**Out of scope here (owner, 2026-10-03):** live tests for network text (LD/FBD) — the `NETWORK_*` codes, graphical
bodies, 4.3's FB-vs-FUNCTION network call — need design work first (the LD/FBD coverage change). Those rows are
listed in 8.1's table as "deferred: LD/FBD design", not tested and not counted as gaps by 8.3.

- [ ] 8.1 One live negative matrix (`test/e2e/refusals/`), both vendors, data-driven (a table: trigger → expected code,
      message fragment, and the state after): for EVERY code in BridgeErrorCodes/ConflictCodes that a client can
      receive, one minimal trigger. Each row asserts (a) the exact code, (b) the message names the item, (c) the
      project after the call — `refs` unchanged for a pre-write refusal (nothing written), exactly the receipt for an
      apply-time stop — and (d) the CODESYS and TwinCAT answers are byte-identical except where DIALECT names the
      difference. A code with no live trigger on a vendor is listed with the reason (e.g. CODESYS-only), never skipped
      silently.
- [ ] 8.2 The behaviour changes of this change get a live negative test each: the removed code checks now ACCEPT
      (1.x: the IDE's own build reports the error instead), the silent drops now REFUSE (4.26 body without a slot,
      4.31 move into a non-folder, D27 unknown view mode/language no longer drops the POU). (4.3's network body: deferred,
      see above.)
- [ ] 8.3 Gate (`Volt.Repo.Gates`, beside V.4): every client-visible code appears in the 8.1 table; a code added
      later without a live row fails the gate.
- [ ] 8.4 Close the vendor gaps behind the wire (owner, 2026-10-03: "both should behave identically behind the wire").
      8.1's "except where DIALECT names the difference" is NOT an escape hatch: every row where CODESYS and TwinCAT
      answer differently (code, message shape, state after) is a defect to fix in the driver below the seam, so the
      wire answer is identical. Only an IRREDUCIBLE vendor fact may remain (e.g. TwinCAT C2i: opening a broken POU's
      tree item crashes XAE) — then the wire still gives the same code and shape on both vendors as far as the fact
      allows, and DIALECT names why it cannot be unified, with the live evidence. Be CRITICAL (owner): the default
      answer is "we don't need this divergence". A divergence counts as irreducible only after at least two alternative
      vendor paths were tried and measured live (another API, another read order, a guarded read, a different seed),
      each recorded; a remaining one is listed for the OWNER to accept, not accepted by the agent. Also sweep the
      divergences that already exist: every e2e row that expects a vendor difference (`vendor-parity`, the per-row
      "vendor difference" notes, e.g. `uc_fb` CODESYS unreadable / TwinCAT fetched) and every DIALECT row that leaks
      into the wire answer — each one challenged the same way. (This is about wire BEHAVIOUR; the
      load-bearing representation asymmetries below the seam in DIALECT.md stay as they are.) Each closed gap gets
      its row in 8.1 asserting byte-identical answers. Known candidate: a broken-text POU — CODESYS `X.pou`, TwinCAT
      `unreadable` + `--force` (5.H / C2i): find the closest identical wire answer the crash guard allows.
