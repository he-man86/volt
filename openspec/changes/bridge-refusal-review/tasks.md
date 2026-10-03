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
- [ ] 2.5 `StReader.cs:992` — no modifier vocabulary: the name is the last word before `:`, the line passes through
      (after 3.1). Record the build error for `METHOD FOO Bar`.
      **Not done — blocked on 3.1 and the recording (review 1+2d, low).** Implemented early, it changed which member a
      push writes: `METHOD Foo Bar : BOOL` over an existing method Foo read as member Bar, so the push deleted Foo and
      created Bar with Foo's text. Reverted to the modifier vocabulary; `SignatureParseTests` pins the refusal (STATIC,
      FOO, PUBLIK). Review 1+2d (low) on the same lines: `METHOD Foo END_METHOD` (no colon) is refused as an END line
      after code again (`ChildSplitterTableTests` +2) — the early 2.5 had read it as a member named END_METHOD.
      **Step 2a numbers:** Engine 1923 (+1 skipped), Twincat 341, Codesys 229, Repo.Gates 107; `data.js` regenerated
      (driver interface).
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
- [ ] 2.11 `NetworkTextReader.cs:1015` — wire also spelled as another name: accepted, same rule.
- [ ] 2.12 `NetworkTextGate.cs:88` — `NETWORK_NOT_CANONICAL` goes: write the model; return the canonical text (push
      response or next pull). Remove the code from `Volt.Contracts/Vocabulary/ConflictCodes.cs`. `PushedText` keeps
      comparing layout-free.
- [ ] 2.13 `TaskDescriptorFormat.cs:117` — non-canonical `.task` written; canonical text comes back.
- [ ] 2.14 `PushService.cs:534` (was 435, `RequireUnchanged` :520) — last-moment set re-check raises
      `STALE_ITEM_VERSION` (with D15, D16).
- [ ] 2.15 `PushService.cs:557` (was 459, `RequireUnchangedBeforeDelete` :542) — last-moment delete re-check raises
      `STALE_ITEM_VERSION`.
- [ ] 2.16 `PushService.cs:1128` (was 903) — take the wire kind from the caller that validated it; delete the
      re-derivation (`PushService.cs:703` already refused it as a `PushRefusal`).
- [ ] 2.17 `PushService.cs:1755` (was 1369) — unknown top-level kind → INTERNAL_ERROR.
- [ ] 2.18 `ItemKind.cs:286` (was 275) — unknown member kind → INTERNAL_ERROR.
- [x] 2.19 `Materializer.cs:92` — gone: `ec0152fe0f` (the driver states a DUT's subtype; no answer publishes
      `name.dut`) and `b6822e9751` (one `.dut`, subtype off the wire). A DUT stating no subtype is addressable as
      `X.dut`; nothing parses its header to name it.
- [ ] 2.20 `CodesysNetworkWriter.cs:284` — unreachable FB-without-instance arm → INTERNAL_ERROR, model-invariant
      message, no v1 wording.
- [ ] 2.21 `CodesysNetworkWriter.cs:37` — graphical text at an item with no Implementation aspect → one named
      UNSUPPORTED (with D26).
- [ ] 2.22 `CodesysNetworkWriter.cs:51` — FBD↔LD view change written (after 3.5), else one named refusal in pre-flight (D7).
- [ ] 2.23 `CodesysDriver.Content.cs:185` (was 190) — unknown view mode → UNSUPPORTED body marker naming it; declaration
      and members still pull (D27).
- [ ] 2.24 `CodesysDriver.Content.cs:203` (was 208) — unknown body aspect → marker (D27).
- [ ] 2.25 `CodesysObjectModel.Descriptors.cs:292` (was 296) — unknown task `Type:` → BAD_REQUEST (as TcTaskSchedule).
- [x] 2.26 `CodesysObjectModel.Libraries.cs:427` — gone: `f18af69c54`. Now `CodesysObjectModel.Libraries.cs:424`
      throws `CodesysDriver.NoAccessorCreate` (`CodesysDriver.Tree.cs:188`), a `NotSupportedException` → UNSUPPORTED,
      naming the create calls the container offers.
- [ ] 2.27 `BeckhoffDriver.Content.cs:61` (was 60) — `ValidateSource` takes the engine's validated models, no re-parse (D8).
- [ ] 2.28 `BeckhoffDriver.Content.cs:67` (was 66) — PLCopen create refusals pre-flighted per BODY (D21). Test: a new
      graphical method with an Execute box in an existing POU is refused before any op lands. (push-keeps-what-landed
      now reports such a mid-batch stop with a receipt + NOT_ATTEMPTED; the pre-flight is still per ITEM.)
- [ ] 2.29 `BeckhoffDriver.Content.cs:339` (and :355) — missing/unknown DefaultViewMode → marker (D27).
- [ ] 2.30 `TcNetworkWriter.cs:152` — unreachable arm → INTERNAL_ERROR.
- [ ] 2.31 `TcNetworkWriter.cs:165` — FBD↔LD view change written via DefaultViewMode on update (after 3.5).
- [ ] 2.32 `TcNetworkWriter.cs:934` — RESET in `Bits` → InvalidOperationException with CODESYS's message (D23).
- [ ] 2.33 `TcPlcOpenWriter.cs:339` (and :177, :187, :295, :328, :341, :394, :427, :477, :483) — model invariants →
      INTERNAL_ERROR, "Volt bug", not "cannot express as PLCopen" (the wording is `Refuse`, `TcPlcOpenWriter.cs:124`).
- [ ] 2.34 `TcArchive.cs:73` — unknown `<root>` language → marker (D27).
- [ ] 2.35 `BeckhoffDriver.Tree.cs:385` (was 322) — move post-condition → INTERNAL_ERROR (still UNSUPPORTED).

## 3. Measure (live; record the outcome in DIALECT.md, then keep or change)

- [ ] 3.1 **Changed.** `StReader.cs:996` (was 809) — the IEC/ASCII identifier check. Half measured since: the names
      each vendor REFUSES for a new POU or member were measured live (`scripts/member-name-refusal*.log`) and are
      pre-flighted by name (`CodesysRefusedNames.cs` / `TcRefusedNames.cs` via `ICodeStore.RefusedName`,
      `PushService.cs:1053-1059`, `ChildRefusedException` cause `Name`). Still unmeasured: what `CreateChild` does with
      a non-ASCII or non-identifier name (`Fööbar`, `a-b`). Clean vendor refusal → add it to the measured lists and
      delete `IsIdentifier`; otherwise `IsIdentifier` becomes the vendor's measured rule, beside the name lists.
- [ ] 3.2 `NetworkTextReader.cs:1036` — does the build report a declared wire type contradicting its producer?
      Yes → remove and record; silently kept → vendor-limit, keep.
- [ ] 3.3 `BodyFormatGuard.cs:164` — can FBD/LD → ST be written in place on either vendor?
- [ ] 3.4 `BodyFormatGuard.cs:168` — can ST → LD/FBD be written on an existing body? Fix the message either way
      (graphical bodies ARE created by push).
- [ ] 3.5 `NetworkText.cs:148` — can DefaultViewMode be set on an update on live CODESYS (TwinCAT: on create already)?
- [ ] 3.6 `CodesysDriver.Content.cs:436` (was 441) — CODESYS interface-accessor write: taken, refused or crash? (D28)
- [ ] 3.7 `BeckhoffDriver.Content.cs:512` (was 516) — which NotSupportedExceptions reach the Stamp catch on real
      creates (D24).
- [ ] 3.8 `TcNetworkWriter.cs:166` / `TcPlcOpenWriter.cs:50` — TwinCAT's negation/edge order (`TcUnmeasured.RefuseEdgeOrder`).
- [ ] 3.9 `TcTaskSchedule.cs:82` — XML-escaped `Priority:` passed through: does TwinCAT's read-back decide validity?

## 4. Design issues

- [x] 4.1 D1 — gone: `ec0152fe0f` + `b6822e9751`. A DUT has one extension `.dut`; the subtype is not on the wire, so
      it has no second source; `push-without-header-check` 1.2 holds for DUTs.
- [x] 4.2 D2 — gone: `f7eb383f47`. One POU extension `.pou`, kind from the IDE class; `PlcPouFb` default deleted.
- [ ] 4.3 D3 — **Changed.** `IsGlobalListHeader` is gone (`15d421e57a`: `ProjectDeclarations` / `PushedDeclarations`
      select Globals by wire kind). Left: `StDeclaration.IsCallableHeader` (:90), `IsFunctionBlockType` (:179),
      `FunctionBlockHeader` (:170) via `CodeHelper.HeaderLine`, called from `NetworkScope.cs:98,115`. An FB instance
      still becomes a FUNCTION call when the FB's declaration header does not read — the wrong body is written. The
      kind on the wire is now `pou` for all three, so "FB or FUNCTION" must come from the IDE's POU type (DIALECT
      C2g/C2h), carried on the declarations the scope is built from; then delete the three.
- [ ] 4.4 D4 — a call-target type neither the project nor the library manifest names is refused by name; delete
      `NonBlockTypeWords` (`StDeclaration.cs:162`; still misses `WCHAR`).
- [ ] 4.5 D5 — no refusal depends on the regex scope (closed by 1.3, 2.10, 2.11); if a name set is still needed,
      take it from the IDE (`StDeclaration.VarLine`).
- [ ] 4.6 D6 — carry the live body language on `ItemContent`/`Member` from the driver; `BodyFormatGuard` stops
      sniffing text (`ShapeOf`, `BodyFormatGuard.cs:32`).
- [ ] 4.7 D7 — one language-change comparison in `BodyFormatGuard`, pre-flight, UNSUPPORTED, same on both vendors;
      `RefuseViewModeChange` leaves the drivers (`CodesysNetworkWriter.cs:51`, `TcNetworkWriter.cs:165`); CODESYS's raw
      member error replaced by the named refusal.
- [ ] 4.8 D8 — pre-flight validates each network body once and passes the `NetworkBody` model to the write; drivers
      take a model, never text; the create-arm copies go (`PushService.cs:1180`).
- [ ] 4.9 D9 — StReader content scans gone (1.2, 2.1); one message for empty text and Unmarked; `Shape`
      (`ImplementationMarker.cs:78`) does not match a bare `Implementation` wrapped-expression line (test: an ST body
      with that line pulls).
- [ ] 4.10 D10 — `ParseSignature` returns name + type text, no vocabulary (2.4-2.6, 3.1).
- [ ] 4.11 D11 — one shape table per kind on `ItemKind`; reader, writer, guard, `CanHold` ask it; fix the
      `InterfaceMethod` branch in `BodyFormatGuard` (:57, :100).
- [ ] 4.12 D12 — merged into 4.8 / 2.27; verify TwinCAT validates each body once.
- [ ] 4.13 D13 — canonical gates gone (2.12, 2.13) and the reader's layout rules with them (2.7-2.11).
- [ ] 4.14 D14 — `TaskDescriptorException` becomes a coded `BridgeException` (BAD_REQUEST); every re-code in §2
      covered by a code-asserting test. (Today it reaches `PushService.ConflictFor` uncoded → INTERNAL_ERROR.)
- [ ] 4.15 D15 — one last-moment version helper on `Versioning.SafeVersion`; null folder/kind → ITEM_UNVERIFIED on
      both arms (`PushService.cs:520` throws on a null folder, `:542` returns).
- [ ] 4.16 D16 — `currentFolder` nullable ("unknown") — `PushService.cs:578` still `inCache ? cached.Folder : ""`;
      uncached item → ITEM_UNVERIFIED, not a hash against root; move compare treats unknown as unknown.
- [ ] 4.17 D17 — `Owner()` (`PushService.cs:1567` `?? pou`) and member-folder misses (`:1589` `?? Owner()`) throw
      NOT_FOUND by name.
- [x] 4.18 D18 — gone: `DutSubtypeChanges.cs` deleted (`b6822e9751`); the `ItemKind` "Kind is recovered from file
      content on push" comment rewritten (`ec0152fe0f`); `NoKindFromTextTests` repo gate (`a313c74b38`) keeps it out.
- [ ] 4.19 D19 — compute the landing wire name once; the same one goes to the engine read and `ValidateSource`
      (`PushService.cs:208` reads `ToName ?? Name`, `:223` hands the driver `Name`).
- [ ] 4.20 D20 — **Changed.** `?? Method` is gone (`15d421e57a`: `BeckhoffDriver.Content.cs:596` refuses an unknown
      member type by name, `:597`). Left: `?? ""` at `BeckhoffDriver.Content.cs:707`, and no shared
      `MemberKind(code, ownerIsInterface)` (CODESYS keeps a private one, `CodesysDriver.Content.cs:243`).
- [ ] 4.21 D21 — covered by 2.28.
- [ ] 4.22 D22 — N21 stated once (engine), vendor fact as data; after 1.5 only the "cannot build what the text means"
      arms remain on both vendors.
- [ ] 4.23 D23 — covered by 2.32.
- [ ] 4.24 D24 — a dedicated regrouping exception; the Stamp catch catches only it (after 3.7). (It excludes
      `TcEnoRefusal` already; any other `NotSupportedException` is still swallowed.)
- [ ] 4.25 D25 — the in-place refusal travels as the inner exception / in the message when the rebuild also refuses;
      fix `TcNetworkWriter.cs:488`'s wording.
- [ ] 4.26 D26 — a body pushed at an item with no body slot is refused by name on both vendors; ask the object, not a
      kind table (`CodesysObjectModel.cs:229` returns silently; `BeckhoffDriver.Content.cs:583` `HasBodySlot`).
- [ ] 4.27 D27 — covered by 2.23, 2.24, 2.29, 2.34; the marker grammar accepts a vendor-named unknown language.
- [ ] 4.28 D28 — covered by 3.6: refusal TwinCAT-only if CODESYS takes the write.
- [ ] 4.29 D29 — measure `ErrorList.ErrorItems` on TcXaeShell; read diagnostics structurally or record why not.
- [ ] 4.30 D30 — `LibraryManifestFromXml` (`BeckhoffDriver.Content.cs:782`) requires the members the vendor XML always
      carries (measure which); a missing one makes the manifest unreadable (`?? name` at :788, :794).
- [ ] 4.31 (from `push-without-header-check` 5Qb, live: `packages/volt-cli/scripts/merged-classes.log` lines 112, 229)
      A move into a tree node that is NOT a folder — `Device` on Pro2193, `Task Configuration` on Bakon Nano — is
      ACCEPTED as "moved" while the object stays where it was: the workspace says the new folder, the IDE disagrees,
      and the next pull moves the file back. CODESYS refuses such a move in its own UI. Test-first: a `set` whose
      `toFolder` resolves to a non-folder node is refused by name before anything is applied (on both vendors; TwinCAT
      has no `Task Configuration` node — measure what its move does with a non-folder target), and `MoveItem`'s
      post-condition (`PushService.cs:1005` "could not be found after being moved", and `BeckhoffDriver.Tree.cs:385`,
      2.35) catches an IDE that ignored the move. Still open at HEAD: no non-folder check exists.
- [ ] 4.32 (from `push-without-header-check` 5Qb) THE RE-TYPE ROUTE in one push: `deleteItem X.pou` + `set X.dut`
      (either order). Two wire identities, one IDE object name; refused `BAD_REQUEST` in the pre-flight
      (`PushService.cs:745`, `RequireOneOpPerItem`, `OneOpPerItemTests`). Decide (owner) whether a re-type in one push
      is written instead — delete, drop the cache entry, create — or stays refused ("delete in one push, create in the
      next"; the CLI sends both rows of a re-typed file in one `volt push`, so today's remedy needs two commits). Either
      way the single-op re-type guard (`PushService.cs:1229`, "a push cannot re-type an object by its NAME") keeps its
      message.

## 5. LSP parity (`packages/volt-lsp-iec`)

- [ ] 5.1 **Changed.** Conformance fixtures + live recordings for every row of the proposal's "What the LSP must pick
      up" table (1.1, 1.2, 1.3, 1.5, 2.4, 2.5, 2.6, and 3.1/3.2 if they remove). The 2.19 row (DUT stating no subtype)
      is gone with 2.19; `push-without-header-check` 4.1 owns the unclosed-comment DUT/FB/GVL recordings.
- [ ] 5.2 LSP reports each recorded error with the build's message and line; reports nothing for `implementation` as
      an identifier, a `(* @volt-` comment, and the layout rules. Colocated src test per fix.

## 6. Gate — no code-check left

- [ ] 6.1 Full C# suites green; e2e on both vendors.
- [ ] 6.2 **Changed.** Grep gate (in `Volt.Repo.Gates`, beside `NoKindFromTextTests`) over `packages/volt-cli/src`:
      zero hits for `OpensNetwork`, `RefuseReservedNames`, `RefuseRetiredComment`, `NETWORK_NOT_CANONICAL`,
      `IsCallableHeader`, `IsFunctionBlockType`, `FunctionBlockHeader`, `NonBlockTypeWords`; `CodeHelper.HeaderLine`
      used only by child delimiting. Already at zero at HEAD (keep them in the gate): `IsGlobalListHeader`,
      `?? ItemKind.Kinds.Method`, `PlcPouFb; // default`, and `ParseCodeHeader` / `INVALID_CODE_HEADER` as code (both
      survive only in history comments: `CodeHelper.cs:20`, `StWriter.cs:77`, `PushModels.cs:95`,
      `ConflictCodes.cs:127` — match code, not comments).
- [ ] 6.3 Re-census with `scripts/refusal-census.ts`: every refusal site in `Volt.Engine/Format`, `Volt.Engine/Sync`,
      `Volt.Engine/Ide` and both drivers appears in the proposal's tables as keep (including the 47 "New since
      2026-09-29" rows); any new site is classified before it lands.

## 7. New since 2026-09-29

- [ ] 7.1 The C2i hierarchy-vouch refusals (`twincat` POUs that crash TcXaeShell, DIALECT C2i) answer
      INTERNAL_ERROR for an IDE STATE, not a Volt bug: `TcObjectModel.cs:209, 216, 246, 295, 300, 308`,
      `TcSolutionExplorer.cs:100, 111`. `:216` (two children of one name, DIALECT D34) is a project fact — UNREADABLE
      or UNSUPPORTED by name; the rest name what the IDE did not vouch for. Decide the code with V.1 (likely a
      connection-state code or UNSUPPORTED), test the code per site.
- [ ] 7.2 `NOT_FOUND` is raised only for post-conditions (`PushService.cs:784, 872, 982, 1005, 1201, 1300, 1314, 1640,
      1664, 1679`; `CodesysDriver.Content.cs:361`; `BeckhoffDriver.Content.cs:122, 154, 237, 248`;
      `BeckhoffDriver.Tree.cs:381, 395`) — "the IDE lost the item Volt just wrote/read", never "the request names nothing". Decide
      (with V.4): keep it as the one "the IDE lost it" code and document that in wire.html, or fold it into
      INTERNAL_ERROR. A client today cannot tell it from `ITEM_MISSING`.
- [ ] 7.3 `StReader.cs:161` — a U+FEFF after the start of the text is refused INVALID_ST because the splitter's scans
      would disagree about it (5E). It is a Volt splitter limit, not the IDE's: make the splitter read it as a code
      character everywhere and write it, or keep it as "niche: accepted loss" (0 in the six corpora) and say so in
      the message. Record what the CODESYS build says of it.

## Error-code vocabulary (owner question, 2026-09-29; re-audited 2026-10-03)

24 codes now (was 22): `BridgeErrorCodes` 11 (+`IDE_UNSUPPORTED`, `codesys-minimum-version`, raised by
`BridgePipeHost.cs:68` on every op but health) and `ConflictCodes` 13 (7 `NETWORK_*`, 5 gate, +`NOT_ATTEMPTED`,
`push-keeps-what-landed`, `PushService.cs:267`). Every code is still raised by production code (no dead code).
`INVALID_CODE_HEADER` was already gone before this change (`c3a49a49ed`). Published by: `refs`/`fetch` (PLC_DISCONNECTED,
WRONG_PROJECT, NO_SIDECAR (fetch only), INTERNAL_ERROR, UNSUPPORTED/UNREADABLE as unreadable listings), `push`
(everything in `ConflictCodes.FromBridge` + the gate + NETWORK_* + NOT_ATTEMPTED as conflicts; PLC_DISCONNECTED /
WRONG_PROJECT / BAD_REQUEST as frames), `build` (PLC_DISCONNECTED, INTERNAL_ERROR), any op (IDE_UNSUPPORTED,
BAD_REQUEST for an unknown op or malformed body, INTERNAL_ERROR fallback in `PipeServer`).

- [ ] V.1 **Changed.** Codes on the wrong situation, at HEAD: a stale item version as `BAD_REQUEST`
      (`PushService.cs:534, 557`) → `STALE_ITEM_VERSION`; a refused `.task` (`TaskDescriptorException`, uncoded →
      INTERNAL_ERROR) and known vendor limits as `INTERNAL_ERROR` (`CodesysObjectModel.Descriptors.cs:341`,
      `BeckhoffDriver.Content.cs:460`, `TcObjectModel.cs:576`, and the new C2i sites of 7.1) → `UNSUPPORTED`; Volt
      invariants as `BAD_REQUEST` / `INVALID_ST` / `UNSUPPORTED` (2.2, 2.16-2.18, 2.35); model errors worded "cannot
      express as PLCopen" (`TcPlcOpenWriter.cs:124`) → say what the model lacks. `INTERNAL_ERROR` is left for Volt's
      own broken invariants only. A request for a read-only descriptor (`PushService.cs:192`) and a move of a non-source
      item (`:952`) are request-shape answered `UNSUPPORTED` — decide whether that stays (a Volt rule, not a vendor
      limit) or becomes `BAD_REQUEST`.
- [ ] V.2 `NETWORK_NOT_CANONICAL` goes with the layout-only gate (design issue 6): text that is complete and writable is
      written; the code is removed from Volt.Contracts, ConflictCodes, network-text.html and the LSP's network code list
      (5 TS files reference it today).
- [ ] V.3 `NO_SIDECAR` (`FetchService.cs:51`, "supply knownItems … or run `volt init`") is named after an internal cache
      a client never sees: rename to a request-shape code or fold into `BAD_REQUEST` with the same message; update
      clients and wire.html. Unchanged at HEAD.
- [ ] V.4 **Changed.** Gate: every code in BridgeErrorCodes/ConflictCodes is raised by production code AND documented
      with the situation it means (wire.html for the frame and gate codes, network-text.html for `NETWORK_*`, which
      wire.html does not list); a code raised for two different kinds of situation fails the gate (today: BAD_REQUEST,
      INTERNAL_ERROR, UNSUPPORTED — V.1; NOT_FOUND vs ITEM_MISSING — 7.2). Also: `ConflictCodes.FromBridge` omits
      `INTERNAL_ERROR`, which `PushService.ConflictFor` (:372) puts on every unclassified refusal — and since
      push-keeps-what-landed every apply-time stop is a conflict, so clients DO receive it there; list it.

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
