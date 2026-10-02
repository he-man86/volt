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

## 5. Pull names every item from the IDE, never from Volt's parse; unknown DUT subtype = `.dut` (owner, 2026-10-02)

Replaces the parked 5.1–5.3 and their three open decisions. Owner decisions (2026-10-02):
- **The kind is the IDE's.** An item's kind (POU / DUT / GVL / interface …) comes from the IDE object — both vendors keep
  a DUT as its own object type, so "it is a DUT" never depends on its text.
- **The DUT subtype** (enum / struct / alias / union / text-list enum) comes from the vendor's own answer, in this order:
  (1) a per-object type or property the IDE stores; (2) the vendor's own parse (CODESYS language model / signature;
  TwinCAT's CODESYS-core model if reachable); (3) nothing else → the item is published as **`E_Mode.dut`**. Volt does
  not guess. There is no "unnamed" state (dropped with this decision).
- **No parser gaps.** If — and only if — 5.A shows a vendor with no stored answer and no reachable vendor parse, ONE
  total classifier below that vendor's seam may read the declaration (5.C). "Total": every possible text maps to exactly
  one answer, and anything it cannot classify with certainty is `.dut` — never a wrong subtype, never a throw.
- **No legacy after the refactor** (5.F): every other header/text read that decides a kind is deleted, and a repo gate
  keeps it that way.
- **No guessing, only intentional fallbacks** (owner, 2026-10-02). After this change no code picks a kind, subtype or
  name that the IDE did not state. The ONE fallback is `.dut`, and it is an exception, not a default: it appears only for
  a DUT whose subtype NO source can state (the vendor itself cannot classify the text). Every fallback in the change is
  named in design.md, has a test that triggers it, and is counted. Acceptance for the whole section: on every DUT that
  the vendor compiles (all six corpora, every fixture, the live 5.G shapes) the `.dut` count is **0**; `.dut` appears
  only for the broken-text shapes, and each one is listed.

### 5.A Evidence (running 2026-10-02: the vendor kind-source investigation)
- [x] 5.A.1 Per vendor, every item type created on a fixture copy (each DUT subtype incl. enum with base type and
      attributes; alias of each shape — elementary, STRING(n), ARRAY, POINTER TO, REFERENCE TO, subrange; union; struct;
      struct EXTENDS; CODESYS text-list enum; PRG/FB/FUN; interface; GVL) plus each with BROKEN text (unclosed `(*`,
      `TYPE X : END_TYPE`, missing END_TYPE, empty). A full dump of every exposed fact per item; the table
      "item × source → correct / wrong / lags / unavailable" in DIALECT.md; whether each source follows an in-place
      subtype change without a reload. Library DUTs: does `LibSignature.Flags` carry the subtype.
      Evidence: f09722f327 (DIALECT C2g/C2h/C2i, C2f corrected; design.md "Vendor evidence (2026-10-02)";
      probe-kind-source.py + probe-tc-kind-source.ps1 with their logs).
- [x] 5.A.2 Decided (owner, 2026-10-02):
      - **CODESYS:** source (2) — the precompile signature (`Type`+`Structure` / `+Union` / `Alias`, `VarGlobal`+`Enum`),
        current without a build, no text read. The object/class/icon carry nothing (one `DUTObject`); the text-list enum
        has its own class. `HasErrors` is NOT "no answer" (a duplicate member still answers `Enum`); "no answer" =
        signature `None`. `TYPE X : END_TYPE` is CODESYS's own `Alias`. `.dut` only where the signature is `None`.
      - **Library DUTs:** `LibSignature.Flags` (1278 struct, 51 union, 94 alias, 550 enum; none without a flag).
      - **TwinCAT:** no text-free source is always right (tree code lags and re-derives from text on reload; files, XML,
        icon carry nothing; LanguageModel empty; the caption is a UI string and cannot tell alias from nothing). Owner
        chose the **total classifier (5.C)** in the TwinCAT driver, PROVEN against CODESYS's signature on the same texts
        (TwinCAT runs the same compiler core): 5.C.3's oracle is the CODESYS precompile signature. Not chosen: the
        Solution Explorer caption; an in-proc VS package.
      - **POU kind:** CODESYS from the object/signature (5.D); TwinCAT from its tree code (the vendor's answer, C2f).

### 5.H TwinCAT crash on a broken POU (C2i — found by 5.A, must be fixed before 5.G)
- [x] 5.H.1 After a solution load, touching the tree item of a TwinCAT POU whose text declares nothing (`Child(i)` /
      `LookupChild`) kills TcXaeShell (RPC 0x800706BE, access violation in `TwinCAT System Manager.dll`; reproduced 4×).
      Volt's pull walk would do exactly that. Measure a walk that never touches such an item's tree object (e.g. names and
      kinds from the parent's export / the project file, then a guarded per-item read), red test on a double that
      throws like the vendor, live repro on a fixture copy (`-Instance push5`) proving the walk survives and names the item.
      If no safe walk exists, the item is refused by name in `refs` (an intentional fallback, counted) — never a crash.

      DONE (2026-10-02), design choice D. `TcObjectModel.ChildAt` is the single point that opens a PLC tree child; it
      reads the Solution Explorer hierarchy once per op (`TcSolutionExplorer`, `[ComImport]` interop, no XAE
      assembly loaded) and never opens a `.TcPOU` captioned with its bare name: the child answers
      `UnreadableItemException` (Engine) with no COM call. Fast path (nothing flagged) = plain `Child[i]`, no
      `PathName`/`LookupChild`. Guarded folder = addressed by `LookupChild(name)` after a child-count check (mismatch →
      the folder is unwalked). Walk names it in `unreadable` with `UnreadableObject.Kinds` = prg/fb/fun, so its
      folder stays walked and `Removal` keeps its known file; `ItemLookup` skips it for other names and refuses it
      `UNREADABLE` by name (`Locate` answers it for forced ops); `TreeNav`, `FindLibraryManager`, the task scan before
      a delete and `Move`'s confirm pass it over. Push: unforced set/delete refused `UNREADABLE`; forced delete =
      parent `DeleteChild(name)`; forced set = delete + create in the walk's folder (`ApplyToUnopened`); a forced op
      whose extension names a non-POU kind is refused. Unreadable hierarchy or no PLC node → `INTERNAL_ERROR`, named.
      One deviation from the design: the snapshot is dropped at every op start (`MarshalToIdeThread`) and at
      `WalkItems`, and after a structural write only while something is flagged (a text write never re-reads it: the
      in-session item is safe, measured) — so a clean project pays one hierarchy read per op and nothing per write.
      Tests: `Volt.Ide.Twincat.Tests/TcUntouchablePouTests` (9: a double that throws `0x800706BE` and DIES on the
      poisoned touch — walk, lookup, delete-by-name, fast path, count mismatch, unreadable hierarchy, missing PLC node,
      the flag rule), `Volt.Engine.Tests/sync/UnopenedItemTests` (7: refs/fetch naming and removal, lookup, unforced
      refusals, forced delete, forced set in the same folder, wrong-kind refusal; `FakeIde.UnopenedItems`).
      `TcHiddenBodyWriteTests` now drives a BOUND driver (`TcUntouchablePouTests.BoundDriver`): every write runs bound
      in production, and the guard reads the bound project's hierarchy.
      Live (own XAE, `-Instance push-without-header-check`, worker built from this tree): on a reloaded Project14 copy
      holding 4 such POUs (`VltX_EP/PP/UCF/UCFB`) `refs` named all 4 in `unreadable`, walked every other item,
      `unwalkedFolders` [] — XAE alive, 0 Application-1000 events; 742 ms (first hierarchy read in a fresh worker
      ≈ 0.7 s, then 112 ms per refs). Forced push repaired `VltX_UCFB` (same folder) and deleted `VltX_PP`. Volt's
      own push of `pwh_unclosed_comment_fb`'s text created the shape (named unreadable at once, in session); saved
      and reloaded: alive, named. Forced push of fixed texts for it and `VltX_EP`/`VltX_UCF` → `fetch` names
      `FB_LANG_pwh_uc_fb.fb` in `VltCensus`; saved and reloaded: `refs` walks clean (only the three 5.B DUTs remain
      unreadable). Counted fallback: 1 (the untouchable POU in `unreadable`); 0 of 16,990 corpus POU files.
      Review fixes (2026-10-02): (1) an unforced op on an untouchable POU is refused in the PUSH PRE-FLIGHT (the gate
      let a delete through as idempotent, so earlier ops of the batch had landed) — `UnopenedItemTests`
      `Without_force_an_op_on_it_refuses_the_whole_push_before_an_earlier_op_is_written`; (2) the re-find after a
      graphical member-body archive write passes an untouchable sibling over (`BeckhoffDriver.ChildNamed`, shared
      with Move's confirm) — `Re_finding_a_POU_after_its_member_bodies_are_written_passes_an_untouchable_sibling_over`;
      (3) the guard no longer fails OPEN: every hierarchy read inside the PLC project is checked (a failed name,
      caption, canonical or child-list read refuses by name instead of reading as "" or ending the list; the depth
      cutoff too), and the PLC project and every PLC folder outside a POU must be listed with the tree's exact child
      count (`TcObjectModel.ChildCount`) — so a short or lazily-filled hierarchy refuses that folder (unwalked) before
      a child is opened. Live (own XAE on a Project14 copy, worker built from this tree): `GetCanonicalName` answers
      E_NOTIMPL for the PLC project node (so a failure is recorded per node, refused only where the snapshot
      classifies); fixture refs 17 items, 0 unwalked, 95 ms warm; with a broken-at-load `VltX_B`: named, 0 unwalked,
      XAE alive, 0 Application-1000. (4) The in-place-repair premise is unmeasured, so a POU flagged once stays
      untouchable for the worker session until Volt deletes it through its parent
      (`A_POU_flagged_once_stays_unopened_after_its_caption_heals_until_Volt_deletes_it`). (5) Red-before-fix shown on
      a scratch copy with the 5.H routing neutralized (ChildAt always `Child[i]`, the engine's C2i catches/routing and
      `Kinds` removal handling off): all 8 `UnopenedItemTests` and every routing test of `TcUntouchablePouTests` fail;
      the hierarchy-read tests were shown red against the lenient reader.
      GATE 5H (2026-10-02): `dotnet build Volt.sln` 0 errors / 0 warnings (Debug; the Release build is blocked only by
      a running `VoltBridgeTwincat` worker holding its own bin dir — not started by the gate, left alone). C# suites: Cli
      274/0 fail, Engine 1848 pass / 1 skip / 0 fail (incl. the 8 new `UnopenedItemTests`), Connector 113/0, Ide.Twincat
      283/0 (incl. the 14 new `TcUntouchablePouTests`), Ide.Codesys 197/0, Contracts 19/0, Repo.Gates 54/0. volt-cli `bun test
      test/unit` 4/0; `bun run typecheck` green (5 packages); `bun run check` 14 passed / 0 failed + DIALECT citation
      gates green. No fixture, recording or transpiler file changed, so no fixture-map regeneration and no LSP suite run
      (5H touches no TypeScript; the LSP tree's uncommitted edits belong to another change and are not in this commit).

### 5.B Contract (both vendors, red first)
- [x] 5.B.1 `IIdeDriver` reports kind plus an optional DUT subtype (`null` = no vendor answer). `Materializer.FullWireName`
      uses it: subtype → `name.<subtype>`, null → `name.dut`. Red tests (FakeIde gets a per-item subtype answer): a DUT
      with no answer publishes `.dut`; with an answer `.enum` etc.; the bare name is identical either way.
      DONE (2026-10-02), design B1. `Volt.Engine.Item.DutSubtype` (Struct|Enum|Union|Alias); `ItemContent.DutSubtype`
      (last, optional; set by `ReadContent`, never by `StReader`); `ItemKind.DutExtension` reads the one table;
      `FullWireName` no longer reads text and refuses a subtype on a non-DUT by name. Both drivers' `ReadContent` set it
      through the interim `CodeHelper.TryDutSubtype` (called only there; 5.C/5.D/5.F replace and delete it).
      `FakeIde.Item.DutAnswer` + `DutAnswers` pins. Tests: `DutSubtypeAnswerTests` (10), `CodesysDutSubtypeReadTests`
      (9), `TcDutSubtypeReadTests` (8). Counted fallback `.dut`: 0 of 8175 corpus DUTs (design "Implemented").
- [x] 5.B.2 `.dut` is a writable source extension everywhere: C# `ItemKind`, the LSP, volt-control, the four VS Code
      manifest places — `bun run check` parity green. Push accepts `.dut` for any DUT and writes the text as sent.
      DONE (2026-10-02): `(Kinds.Dut, "dut")` row; LSP `source-extensions.ts` + `source-object.ts`; volt-control
      `files.ts`; VS Code `languages.extensions`, tmLanguage `fileTypes`, `volt-icons.json`, `workspaceContains`.
      `bun run check` 14 passed / 0 failed. Docs regenerated (`VOLT_WRITE_DOCS=1`: `data.js`), `items.html#dut` /
      `#dut-migration` and `wire.html#dut-subtype` rewritten. Create/update/delete under `.dut`:
      `DutBareIdentityPushTests`.
- [x] 5.B.3 Renames: a pull that names `E_Mode.dut` as `E_Mode.enum` (text fixed in the IDE) is a git rename the CLI
      handles like any rename; a push of `E_Mode.dut` over an IDE item now answering `.enum` is accepted (same bare
      identity, DUT kind) — no refusal, no `--force`. Tests at both layers (transport + CLI).
      DONE (2026-10-02): `PushConflicts` resolves an update under a DUT name absent from the version map to the live
      DUT of the same bare name and gates it by that item's version (equal → update; else `STALE_ITEM_VERSION`, never
      `ITEM_MISSING`); create → `ITEM_EXISTS`; delete reaches only the live name. Transport: `DutBareIdentityPushTests`
      (service), `DutNameTransportTests` (pipe). CLI: `DutSubtypeFileTests` — pull `.dut` → `.enum` → `.dut`; push of
      fixed text under `E_Mode.dut` (receipt `E_Mode.enum`, next pull renames); an edit of `E_Mode.dut` while the IDE
      fixed it (held by the project LEASE, not a DUT refusal; the pull's rename carries the edit; push lands; design
      "Implemented"). Red shown with the 5.B behaviour neutralized: 19/25 engine and 6/6 CLI new tests fail.
      Tests whose premise the owner decision changed, each saying so in its summary: `ItemKindTests`,
      `DutSubtypeCodeTests` (2), `DutSubtypeChangePushTests` (3), `DutSubtypeFileTests` (5), `DutBaselineMigrationTests`
      (3), `ExtensionListTextTests` (2), `WireVocabularyGuardTests`, `DocDataTests`, `BlackBoxTests` (fixture only),
      volt-control `files.test.ts`, LSP `source-extensions.test.ts`.
      GATE 5B (2026-10-02): `dotnet build Volt.sln -c Release` 0 errors (28 warnings, all in untouched test files —
      none in a 5B path). C# suites: Cli 280/0 fail (5H: 274), Engine 1871 pass / 1 skip / 0 fail (5H: 1848), Connector
      113/0, Ide.Twincat 291/0 (5H: 283), Ide.Codesys 206/0 (5H: 197), Contracts 19/0, Repo.Gates 54/0. volt-cli
      `bun test test/unit` 4/0; volt-control 121/0; volt-vscode 39/0; `bun run typecheck` green (5 packages);
      `bun run check` 15 passed / 0 failed (5H: 14 — the new Claude Code plugin `extensionToLanguage` parity site).
      LSP full suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset): 7096 pass / 34 skip / 195 todo / 0 fail across
      200 files (incl. `scripts/held-as.test.ts`). No fixture, recording or transpiler file changed, so no fixture-map
      regeneration.

### 5.C The total classifier (ONLY where 5.A.2 says a vendor needs it)
- [ ] 5.C.1 One function in that vendor's driver (not Engine, not CLI), built on ONE trivia skipper shared with the child
      splitter (5.E) — not a second copy. Grammar it accepts:
      `[trivia] TYPE [trivia] name [trivia] [EXTENDS base] [trivia] : [trivia] X` where X = `STRUCT` → struct,
      `UNION` → union, `(` → enum, any other type expression → alias; everything else → `null` (→ `.dut`).
- [ ] 5.C.2 Its table test — every row is a test, each with the vendor's recorded answer where 5.A has one:
      comments before TYPE and between every two tokens; nested `(* (* *) *)`; `//` line comments; `(*` inside a `//`
      comment and `//` inside `(* *)`; an UNCLOSED `(*` anywhere; pragmas and attributes (`{attribute 'strict'}`,
      `{attribute 'qualified_only'}`) before TYPE and between `:` and the body; conditional pragmas (`{IF defined(X)}`
      around the body or a keyword → `.dut` unless the vendor answers); keywords in any case; tabs, CRLF, BOM, trailing
      spaces; enum with base type `(A,B) UINT`, with initial values, with an attribute inside; `STRUCT` / `UNION` on the
      next line; struct EXTENDS; alias of every 5.A.1 shape incl. subrange; several types in one TYPE block; TYPE without
      END_TYPE; empty text; only comments; a text that is a POU or a GVL (→ `null`; the kind came from the IDE).
- [ ] 5.C.3 Agreement gate: over all six corpora and every fixture DUT, the classifier's answer equals the vendor's own
      answer wherever one exists (CODESYS language model as the oracle) — 0 disagreements, every `.dut` counted and
      listed. A fuzz pass (random truncations / comment insertions of real DUTs): never throws, never a subtype the
      vendor denies.

### 5.D CODESYS: no Volt text read at all
- [ ] 5.D.1 POU kind and DUT subtype from the IDE (object type + language-model signature, the `ExtractLibrarySignatures`
      path); `CodesysTypeMap.RefinePou`, `LeadingKeyword`, `NeedsDeclaration` and the declaration read in
      `CodesysDriver.Tree.KindCodeOf` are deleted. A broken `.prg` pulls back as `.prg`. The push pre-flight timing shows
      the lookup is not slower than the read it replaces (numbers written here).
- [ ] 5.D.2 Library DUTs: `LibSignatureRenderer.Dut` takes the subtype from `LibSignature.Flags` (5.A.1), not the text.

### 5.E Child elements (the one place headers stay — made gap-free too)
- [ ] 5.E.1 The child splitter (`StReader.SplitChildren` / `FirstMemberLine` / `FirstCodeLine`) uses the same trivia skipper
      as 5.C and gets the same table treatment: comments, pragmas and attributes before and between `METHOD` / `PROPERTY` /
      `ACTION` / `TRANSITION` lines; nested and unclosed comments; a keyword inside a comment or a string; CRLF/BOM; every
      modifier order (`METHOD PUBLIC ABSTRACT`); `END_METHOD` on the same line. Each row tested; an unsplittable file is
      refused by name with its line, never split wrong.

### 5.F No legacy
- [ ] 5.F.1 Deleted: `CodeHelper.DutSubtype` (all callers); the `UnreadableDut` sentinel paths and the `DutSubtypeChanges`
      text logic in push; `StDeclaration.IsGlobalListHeader` (`ProjectDeclarations` takes GVLs from the item kind); the
      "unnamed" design text; every comment/doc that describes reading a kind from text (`ItemKind.cs`, `RefsFetch.cs`,
      `CodeHelper.cs`, `StWriter.cs`, the wire docs and generated doc data via VOLT_WRITE_DOCS=1). `IsCallableHeader` /
      `IsFunctionBlockType` in `NetworkScope` read other items' kinds from the known item kinds instead of their header
      (a lookup swap only — network text itself is parked).
- [ ] 5.F.2 Repo gate (`Volt.Repo.Gates`): no code outside an allow-list (the child splitter; the 5.C classifier if it
      exists) reads a declaration's first code line or matches `TYPE` / `STRUCT` / `FUNCTION_BLOCK` / `PROGRAM` /
      `VAR_GLOBAL` to decide a kind. Grep-based, the allow-list inside the test.
- [ ] 5.F.3 e2e 3.2's `held: "unreadable"` DUT rows become `.dut` rows; the forced cleanup becomes a plain delete.

### 5.G Verify
- [ ] 5.G.1 Live on both vendors (fixture copies, `ide.ps1 -Instance push5`): every 5.A.1 shape — push as sent, pull, push
      the fixed text, pull: name, kind and subtype right at every step (`.dut` exactly while the vendor has no answer).
- [ ] 5.G.2 Full C# suites, `bun test test/unit` (volt-cli), the LSP suite for `.dut`, `bun run check`; docs regenerated.
