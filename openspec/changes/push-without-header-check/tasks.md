## 1. Current situation

- [x] 1.1 List every push path that parses or checks the header, per kind (POU, DUT, GVL), starting from the call
      sites in the proposal. Record what acts on push today.

      Read from the code (2026-09-29, before the change). Every one of these acted on push:

      - **`StReader.Read` step 1 — every kind (POU, interface, DUT, GVL).** `CodeHelper.ParseCodeHeader(sourceText)`
        ran first on every pushed text and threw `INVALID_CODE_HEADER` for an empty text, "No header line found"
        (a never-closed opening `(*` makes the whole text trivia — the `c802b74d` shape) and an unrecognized
        keyword. Then `RequireKind(declared, expectedKind)` refused `INVALID_ST` when the header's kind was not the
        extension's (only when a kind was passed). With no kind passed, the HEADER decided the kind. Its callers on
        the push path:
        - `PushService.ValidateSourceOrThrow` (the batch pre-flight, ~835): a CREATE passed the wire kind (parse +
          check); an UPDATE passed none (parse only; the header decided the kind).
        - `PushService.WriteItemFromSource` (the apply, ~903): the same split — create by wire kind, update by
          header; then, on an update, the re-type guard compared the LIVE kind with the HEADER's kind
          (`UNSUPPORTED`) and `StReader.RequireKind(split.Kind, wireKind)` (~998) compared the header with the
          extension (`INVALID_ST`).
        - `PushService.DeclarationsIn` (~400, the sibling-declaration index for network-text scopes):
          `StReader.Read(src)` with no kind — the header decided; a failure was swallowed, so an item whose header
          did not parse (any kind) silently fell out of the index.
        - `BeckhoffDriver.ValidateSource` (TwinCAT's create pre-flight): `StReader.Read(sourceText, null)` — the
          header parse, `INVALID_CODE_HEADER` for any kind.
        - `PushedText.SameExceptLayout` (29-30): the CLI's post-push comparison of the pushed text with the IDE's,
          by the wire kind — parse + check, after the push had applied.
      - **A POU's structure followed its header's kind**: `FindOuterBlock` looked for the END line of the kind (header
        or extension), so a `.fb` whose text said `PROGRAM … END_PROGRAM` had no END line to find.
      - **`DutSubtypeChanges.RequireNameMatchesBody` — DUT only** (~140), for every DUT `set` with a body:
        `IsDutDeclaration` asked `ParseCodeHeader` (~165) whether the text was a DUT; if it was, `CodeHelper.DutSubtype`
        read the subtype and a subtype other than the name's extension — or none — was refused `BAD_REQUEST`.
      - **DUT and GVL, beyond the header** (owner addition, 2026-09-29 — ZERO checks on their text): the empty-text
        refusals (`StReader` "Empty ST source", `INVALID_ST`; `PushService.ApplySetItem` "sourceText is empty",
        `BAD_REQUEST`), the retired `(* @volt-… *)` comment refusal, `RefuseReservedNames` (a name spelled
        `IMPLEMENTATION`) and `RefuseLinesInDeclarations` (an `IMPLEMENTATION`/`%FOLDER` line in the declaration).
      - **Children** (METHOD, ACTION, PROPERTY and GET/SET, interface members): `SplitChildren` /
        `ParseSignature` — kept (2.1b). Their refusals named neither the item nor the file line ("Expected
        METHOD/ACTION/PROPERTY at line 1" counted from under the POU's END line), and a member whose doc comment was
        never closed was not refused at all: the rest of the file read as trivia and the member was DROPPED, which a
        push then deleted from the IDE.

- [x] 1.2 Measure the `.fb`-with-`PROGRAM`-text case with the check off, both vendors: what does the project hold
      DECIDED by the owner (2026-09-29), not measured: a top-level text that contradicts its extension (e.g. `K.fb` saying
      `PROGRAM`) is written as sent and the IDE reports it as a compile error; the workspace file keeps the body, so fixing
      the header and pushing again restores it. No push-side guard. 3.2 still exercises the case live on both vendors.
      afterwards, and what does `refs` report? **Live — after transpile-fix-all** (it needs CODESYS and TwinCAT,
      and another run holds CODESYS). Note for the measurement: the re-type guard's comment recorded that writing
      `PROGRAM X` over a live function block made CODESYS CLEAR the body. The guard still refuses a NAME that
      re-types (`X.fb` → `X.prg`); the TEXT no longer does, so this is exactly the case to measure on an UPDATE as
      well as a create.

## 2. Remove

- [x] 2.1 Drop header parsing and the header/extension check for every TOP-LEVEL item on every push path found in 1.1
      (`StReader.Read` step 1, `PushService` `RequireKind`, `DutSubtypeChanges` subtype-vs-body): the extension is the kind.
      `StReader.Read(text, kind, name)` takes the kind as REQUIRED; every caller passes the wire name's kind.
      `ParseCodeHeader`, `RequireKind`, `IsDutDeclaration` and the name-vs-body check are deleted. A DUT or a GVL
      returns its text verbatim before anything is read (no empty, retired-comment, reserved-name or stray-line
      refusal); `ApplySetItem`'s empty-`sourceText` refusal is gone. The re-type guard now compares the live kind
      with the NAME's. A program, a function and a function block share one outer shape, so any of their three END
      lines closes any of them. `INVALID_CODE_HEADER` is deleted from `BridgeErrorCodes`, `ConflictCodes.FromBridge`,
      `docs/wire.html` and the generated doc data: no push raises it, and its one other raise site (`StWriter`, a kind
      with no END line, on a pull where it is only ever listed `unreadable`) is `UNSUPPORTED` now — the gate
      `Every_error_code_is_reachable_as_a_frame_or_a_conflict` refuses a code nothing can observe.
- [x] 2.1b Keep header parsing ONLY where a CHILD element (METHOD, ACTION, PROPERTY + GET/SET, interface members) is found
      and delimited inside its item's file; a child whose header cannot be read is refused naming the item and line.
      Every child refusal (`expected METHOD/ACTION/PROPERTY`, a missing `END_METHOD`/`END_ACTION`/`END_PROPERTY`,
      `Cannot parse … signature`) now reads `'<item>', line <n>: …`, with n the line IN THE FILE. A never-closed
      `(*` hides no structure: the structure is read as if it opened nothing (`StTrivia.UnterminatedOpenings`), the
      text carried unchanged — so a never-closed member doc comment is refused naming its line instead of dropping
      the member.
- [x] 2.2 Keep only what performing the push needs (the `IMPLEMENTATION` split); its refusal stays `INVALID_ST`.
      For a POU or an interface: the outer END line, the `IMPLEMENTATION` line and what it states, the children,
      and the refusals that protect the split itself (the retired `@volt-` comment, `IMPLEMENTATION` reserved, a
      keyword or `%FOLDER` line inside a declaration) — all `INVALID_ST`.
- [x] 2.3 Update the tests that assert `INVALID_CODE_HEADER` on push. Tests whose premise was the removed rule were
      changed and say so in their summary: `KindFromExtensionTests`, `PushedTextTests.An_item_is_read_at_its_wire_kind`,
      `ItemKindIsNotRewritableTests` (the TEXT no longer re-types; a NAME that re-types is still refused),
      `DutSubtypeChangePushTests` (the subtype-vs-body theory, the bare-`TYPE` theory, the FB-text-under-a-DUT-name
      code), `PushServiceTests` (empty and prose creates are POUs now), `PushConflictCodeTests`,
      `ImplementationKeywordTests` / `ReadOnlyBodyTests` / `ImplementationLanguagePushTests` (their GVL/DUT rows now
      assert written-as-sent), `CodeHelperTests` (the `ParseCodeHeader` classification tests went with it). The
      format tests pass the kind `Read` now requires.

## 3. Verify

- [x] 3.1 The `c802b74d` shape (unclosed opening comment in a DUT) pushes; a build then reports it. Same for an FB, a
      GVL and an enum with an unclosed comment; an `X.struct` whose text is an enum pushes as written.
      OFFLINE, against `FakeIde`: `test/Volt.Engine.Tests/sync/PushWithoutHeaderCheckTests.cs` (plus an empty
      `.struct`, a `.gvl` with a retired comment, a `.struct` member named `IMPLEMENTATION`, prose under a `.struct`,
      a `.fb` whose text says `PROGRAM`, and two child refusals naming item and line). "A build then reports it" is
      the live half — with 3.2.
- [x] 3.2 Full C# suites green; e2e on both vendors. (2026-09-30) C# green: Engine 1816/1 skip, Cli 263, Connector
      110, Twincat 255, Codesys 166, Contracts 19, Relay 46, Repo.Gates 54; `bun test test/unit` 4; consumers
      volt-control 115, volt-desktop 25, volt-vscode 37. **e2e live: CODESYS 239 pass / 24 skip / 0 fail, TwinCAT
      (Project14) 239 / 24 / 0** (263 tests, 48 files). New `test/e2e/items/push-without-header-check.test.ts` is the
      live half of 3.1 and the measurement 1.2 asked for:
      - Every shape of 3.1 and 4.1 is ACCEPTED on both vendors. A build only reaches a referenced item (an
        unreferenced one is not compiled — CODESYS answers "The application is up to date", 0 errors, even for
        `n := ;`), so the test references each from the main program: the four unclosed-`(*` shapes (struct, enum,
        GVL, FB) then fail the build at the reference (`Unknown type: '<name>'`, `Identifier '<name>_g' not defined`).
      - `X.struct` holding an enum: `refs` names it `X.enum`, builds clean, both vendors.
      - `X.fb` whose text says `PROGRAM`, create AND update: ONE object, body and folder kept, never a second or
        half-written item. CODESYS takes the text's kind (`refs` → `X.prg`); TwinCAT keeps its tree kind (`refs` →
        `X.fb`, and a pull renders `PROGRAM X … END_FUNCTION_BLOCK`). Pushing the fixed FB text under the name `refs`
        publishes gives back the FB on both (asserted as an `expectVendorDifference`).
      - A DUT whose text states no subtype (unclosed `(*`, empty, prose) and a GVL holding a retired `@volt-`
        comment are written but come back only in `refs.unreadable`; a plain delete is refused UNREADABLE, only
        `--force` deletes them — task 5.1's acceptance, open.
      `items/dut-subtype-change.test.ts` "a body of another subtype under the old name" asserted the removed rule
      (BAD_REQUEST); it now asserts written-as-sent, `refs` naming it by what it holds (premise changed by the owner's
      rule, like its offline twin).
      **Review fixes (2026-09-30), e2e re-run green on both vendors:**
      - The CLI path (not only the bridge wire) for a pushed item the IDE publishes under another name: the receipt
        had no entry under the pushed name, so a create kept neither name and the next pull added `X.prg` beside
        `X.fb`. The push now names it ("the IDE holds X.fb as X.prg") and pins the pushed name, so the pull moves the
        file (`Commands.HeldUnderAnotherName`, engine answer `PushedText.MayBeHeldAs`; `PushCommandTests`, with an
        opt-in `FakeIde.RetypesFromDeclaration` modelling CODESYS).
      - TwinCAT's `PROGRAM … END_FUNCTION_BLOCK` was adopted as a "layout" over the pushed `END_PROGRAM`: the post-push
        comparison now reads the outer END keyword as a token (`StReader.OuterEndKeyword`; `PushedTextTests`).
      - The vendor asymmetry is DIALECT **C2f**; the re-type guard's comment and message no longer claim a text write
        cannot change the kind ("a push cannot re-type an object by its NAME").
      - e2e: the build's exact messages are pinned per shape (the oracle for 4.1/4.2 — identical on both vendors, all
        on the main program's reference); every shape's held state is asserted (fetched back as sent, or listed
        `unreadable`); a push of the fixed text under the ORIGINAL name at the version held before is refused by the
        version gate (CODESYS `ITEM_MISSING`, TwinCAT `STALE_ITEM_VERSION`) with nothing written — the restore goes
        through a pull. **Open for the owner:** 1.2 says "fixing the header and pushing again restores it"; read
        literally (no pull between), a CODESYS push under the original name would reach the re-type guard (live
        program vs `.fb`) — the guard 2.1 kept. It is refused earlier by the gate today; if the literal reading is
        meant, the guard must be relaxed for CODESYS, which is a decision, not a fix.
      **Gate (2026-09-30, after the review fixes):** typecheck green (5 packages), lint 0 errors, `bun run check`
      green; no fixture or transpiler change, so no `rate:fixtures`. C#: Engine 1824 / 1 skip (+8 over 1816: `PushedTextTests`,
      `MayBeHeldAs` ×7 + the outer END keyword), Cli 265 (+2: `PushCommandTests` held-under-another-name), Connector 110,
      Twincat 255, Codesys 166, Contracts 19, Relay 46, Repo.Gates 54 — 0 fail. `bun test test/unit` 4. Consumers:
      volt-control 115 / 0 fail, volt-desktop 25, volt-vscode 37. volt-control's `diagnostics.e2e` "clean
      workspace" was RED once the LSP dist was rebuilt (1 error): its fixture predated implementation-keyword (no
      `IMPLEMENTATION ST` line → "states no language"), a premise the file format retired on 2026-09-28, independent
      of this change — fixed in its own commit.

## 4. LSP parity — the LSP reports what CODESYS reports for every shape push now lets through

The push no longer refuses these shapes, so the IDE's build is the answer and the LSP must give that answer, no more and
no less (an LSP-only message is a false positive). Each shape is a conformance fixture recorded LIVE with
`bun run record:language` (and TwinCAT where it records), whose kind is the extension and whose source is the text.

- [x] 4.1 Fixtures + live recordings, CODESYS and TwinCAT: an unclosed opening `(*` in a DUT (struct), an enum, a GVL and
      an FB; an FB whose text declares `PROGRAM`; an empty struct; prose text under a struct; a struct whose body is an
      enum; a struct member named `IMPLEMENTATION`; a GVL holding a retired `(* @volt-… *)` comment. Record CODESYS's exact
      messages and lines (or that it builds clean).
      (2026-09-30) `test/conformance/fixtures/objects/written-as-sent.ts`, 21 fixtures, each `asSent` (new `LanguageTest`
      field: the source is ONE item's text, pushed verbatim under `pouName` + the kind's extension — the recorder no longer
      parses/marks it) and referenced from PLC_PRG. The ten shapes above, plus the probes that find each RULE rather than
      one answer: prose above / below a well-formed STRUCT and VAR_GLOBAL, a missing `;` in a STRUCT, a GVL and a POU VAR
      block, an empty and a prose GVL, `.enum` holding a STRUCT, `.prg` holding a FUNCTION_BLOCK. Recorded live with
      `record:language` (RECORD_ONLY) on CODESYS SP21 and TwinCAT (Project14), and `record:exec` for the six that build
      and declare something. Messages: every unclosed-`(*`/empty/prose DUT → only PLC_PRG's `Unknown type: '<name>'`
      (+ C0035 for `v()` on the FB); the GVL → `Identifier … not defined` + the conversion; FB-says-PROGRAM,
      struct-holds-enum, member `IMPLEMENTATION`, retired-comment GVL, prose/empty GVL, enum-holds-struct,
      prg-holds-FB → build clean. The rules: a DUT/GVL text that does not OPEN with TYPE / VAR_GLOBAL|VAR_CONFIG declares
      nothing and draws no message; a missing `;` after a type is `';, :=, REF=, ( or [' expected instead of '<name>'`
      and swallows the next declaration (CODESYS says nothing for it in a GVL; TwinCAT does). **Lines:** the recordings
      carry `line: 0` for every message — the bridge publishes no position (see `codesys-imessage-position-api`), so
      the gate compares messages; the colocated tests pin where each is reported. Recorder fixes this needed:
      `record-language.ts` deletes an item where the IDE holds it (under its bare name when CODESYS re-typed it, forced
      when `refs` lists it `unreadable`), sweeps unreadable orphans; `fixture-units.ts` loads a body that states its
      `IMPLEMENTATION ST` line without the line (it was loaded as code: "',, AT or :' expected instead of 'ST'") and
      refuses an as-sent text that is not one object.
- [x] 4.2 LSP: for each recorded error, the same diagnostic (message and line) — including the unclosed-comment case, where
      the LSP reports nothing today; for each shape CODESYS builds clean, no diagnostic. Test-first (the fixtures are the
      acceptance test); `bun test test/conformance` and build-conformance green.
      (2026-09-30) Root causes, each with its colocated test: (a) `syntax/source-object.ts` + `parseDocument(uri, …)` — a
      workspace file is read as the object its extension names; a DUT/GVL whose text does not open with its keyword
      declares nothing and reports nothing, and the POU-only format rules (IMPLEMENTATION reserved, retired `@volt-`
      comment) do not apply to a DUT/GVL — used by the workspace store, the replay, `evidence.ts`, the corpus
      (`source-object.test.ts`; the server test that held an enum value named IMPLEMENTATION reserved changed premise
      with the push's 2.1, as its C# twin did); (b) C0077 `Unknown type: '<name>'` for a bare declared type nothing
      declares, and C0035 for calling its instance — `unknownTypeName` in `analysis/resolution.ts`, `dialect-type.ts`
      generalized into `declarations/unknown-type.ts`, mapped to C0077 (catalog entry `implemented`); CODESYS only —
      TwinCAT's `References/` lacks types its compiler knows (External Types, `ST_LibVersion`), so on TwinCAT six
      fixtures are known divergences with that reason (`unknown-type.test.ts`); (c) the missing-`;` wording and
      recovery (`var-section.ts endAfterType`, `parser.test.ts`); (d) `FUNCTION … EXTENDS` parsed and answered
      "No definition found for base class" (`header-rules.test.ts`); (e) C0145 in TwinCAT's spelling "Functionblocks".
      Known divergences with reasons (`support/divergences.ts`): CODESYS 5 (`pwh_struct_then_prose`,
      `pwh_gvl_then_prose`, `hdr_function_extends`, `hdr_function_implements`, `pwh_gvl_missing_semicolon`), TwinCAT 10
      (the first four + the six Unknown-type). Exact agreement CODESYS 2560 → 2582, TwinCAT 2546 → 2562 (floors raised);
      no false positives on either. `bun test test/conformance` 4462 pass / 102 todo / 0 fail; `src` + catalog +
      libraries 1505 pass / 0 fail; corpus 19 pass / 1 skip / 0 fail (the TwinCAT library GVLs drew C0077 only once it
      was unmapped — mapped now). `rate:fixtures`: confirmed 2060, refused 567, not-lowered 102, lsp-gap 9, diverges 3,
      unaskable 40, unasked 0. Two new fixtures rate `not-lowered` — `pwh_struct_member_implementation` and
      `pwh_gvl_retired_volt_comment`: the transpiler parses the assembled fixture as no object, so the POU format rules
      refuse it — transpiler work, not this step.
      **Review fixes (2026-09-30):** (1) a file saved with a UTF-8 BOM declared nothing (the BOM stood before TYPE /
      VAR_GLOBAL): the crawl now reads a source file as the push sends it, BOM removed (`workspace-refs.ts`
      `readSourceText`, also the corpus loaders; `workspace-refs.test.ts`). (2) `FUNCTION F IMPLEMENTS I : INT` read
      IMPLEMENTS only after the return type, so the rest of the file became body (LSP-only messages): both clauses are
      read after the name (`function.ts`, `header-rules.test.ts`); `hdr_function_*` stay divergences with a true reason
      (the LSP gives the clause's message, not the vendors' cascade). (3) a global missing its `;` is silent on CODESYS —
      a vendor fact on the parse error (`ParseError.globalMissingSemicolon`), gated in `checkParseErrors` and the
      server's parse-error stream; `pwh_gvl_missing_semicolon` left `KNOWN_DIVERGENCES.codesys`. `pwh_struct_then_prose`
      / `pwh_gvl_then_prose` stay marked, and their reason now says the LSP's "unexpected identifier … at file scope" is
      an LSP-only message (one shape each, no rule measured). (4) `record-language.ts` deletes only what the push added,
      under a same-FAMILY name (`PushedText.MayBeHeldAs`) or, for a DUT/GVL, `unreadable` — never another kind's item.
      (5) bare `TYPE_CLASS` measured: `op_sys_type_class_bare` builds clean on both vendors; `unknownTypeName` now
      agrees with `nameResolves`. (6) `call_ldate_instance` recorded on both: TwinCAT gives "Unknown type: 'LDATE'" +
      C0035, CODESYS C0035 — the LSP already answered both. (7) `sourceObjectOf` matches extensions exactly, as the
      crawl and the CLI do. Floors: CODESYS 2585, TwinCAT 2564. `rate:fixtures`: refused 568, not-lowered 103
      (`op_sys_type_class_bare` — the transpiler does not know TYPE_CLASS), unasked 0.
- [x] 4.3 The three stale notes in `packages/volt-lsp-iec/docs/codesys-reference/error-catalog.json` that describe the
      bridge refusing with "Unrecognized code header" (FUNCTION EXTENDS, FUNCTION IMPLEMENTS, VAR block in an INTERFACE):
      re-record them live and correct them.
      (2026-09-30) Re-recorded as conformance fixtures on both vendors (`fixtures/oop/header-rules.ts`: `hdr_function_extends`
      and `_implements`, each with and without a return type after the clause, and `hdr_interface_var_input` reached through
      an implementing FB), and the three notes rewritten to what was recorded. `scripts/verify-catalog.ts` was NOT used: it
      pushes texts with no IMPLEMENTATION line and synthesizes `PLC_PRG` on TwinCAT, and a report-only run answered for
      neither vendor's real build — so the entries' `*Actual`/`verified` fields are left as that script wrote them, and the
      notes say so. That script is stale tooling to fix or delete on its own.

**Gate (2026-09-30):** typecheck green (5 packages); root lint (oxlint) 0 errors; `bun run check` 14 pass / 0 fail.
`rate:fixtures` re-run: 2783 fixtures, `map.generated.ts` byte-identical to the tree (confirmed 2060, refused 568,
not-lowered 103, lsp-gap 9, diverges 3, unaskable 40; edge agree 2109 / disagree 0). volt-lsp-iec full `bun test`:
6179 tests, 5997 pass / 34 skip / 148 todo / **0 fail**; exact agreement CODESYS 2585/2783, TwinCAT 2564/2783 (= the
raised floors). Consumers on the rebuilt LSP dist: volt-control 115 / 0 fail, volt-desktop 25, volt-vscode 37.
Pre-existing, not this step (files unmodified since before the change): the package `lint` layering check flags
`services/structure/semantic-tokens.ts → network/network-analyze.js`, and `bun run build` reports `Bun` /
`import.meta.dir` type errors in `test/conformance/support/{rustc,transpile-confidence,fixture-units}.ts` (it emits).

## 5. Pull reads the kind from the IDE object, never from the text (found by bridge-refusal-review, 2026-09-29)

Without these, section 2's promise fails on the pull side: a text the push now writes as sent comes back wrong.

- [ ] 5.1 A DUT's SUBTYPE on pull comes from the IDE object, not from `CodeHelper.DutSubtype(declaration)` in
      `Materializer`: measure what each vendor exposes (CODESYS `IDUTObject`/its DUT type; TwinCAT's tree code, which lags
      an in-place change until a reload — DIALECT C2e) and use the object's own answer; where no vendor answer exists,
      decide with the owner before falling back to anything. Acceptance: a DUT pushed with an unclosed `(*` or as
      `TYPE X : END_TYPE` pulls back under its extension, and the next push that fixes the text is accepted (not refused
      as unreadable); no `--force` needed to delete it.
- [ ] 5.2 CODESYS POU kind on pull from the object type, not the header (`CodesysTypeMap.cs:173` defaults to function
      block): a `.prg` whose text has an unclosed `(*` pulls back as `.prg`. TwinCAT checked the same way.
- [ ] 5.3 Live on both vendors with 3.2: push each shape of 3.1, pull, push the fixed text, pull — the item keeps its name
      and kind throughout.
