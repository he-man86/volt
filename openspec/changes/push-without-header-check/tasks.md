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

## 5. Pull names every item from the IDE, never from Volt's parse — every DUT is .dut (pivot 5.P); was: unknown DUT subtype = `.dut` (owner, 2026-10-02)

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

### 5.P PIVOT (owner, 2026-10-02): ONE DUT extension, `.dut` — no subtype on the wire, no classifier

"Keep it simple": the separate `.struct` / `.enum` / `.alias` / `.union` extensions are not worth the parsing complexity,
its risks and a `.dut` fallback beside them. Every DUT is `name.dut`, on both vendors, always — the kind (DUT) is the
IDE's object type (5.A), so naming a DUT needs no text and no vendor parse at all. This supersedes 5.A.2's subtype
sources and the classifier (5.C, stopped mid-work and DELETED; its WIP is kept outside the repo, not to be revived), and
reverses the archived `dut-subtype-on-the-wire` naming. No backward compatibility (no users of the split names yet;
PLCAssist follows the wire names and is told). No migration code. Still no guessing: nothing in Volt decides a DUT's
subtype any more — the IDE and its build own it.

- [x] 5.P.1 One DUT kind: `.dut` is the ONLY DUT extension in C# `ItemKind` (and every map derived from it), the LSP's
      source-extension set, volt-control, and the four VS Code manifest places; `.struct` / `.enum` / `.alias` / `.union`
      removed everywhere (`bun run check` parity green). Library DUTs render as `.dut`. A CODESYS text-list enum is a
      DUT too: measure what Volt does with it today (5.A: its own class `TextListEnumerationObject`) and keep that
      behaviour under `.dut` (read-only if push cannot write it — say so by name, never silently).
      DONE (2026-10-02): `ItemKind.SourceKindExtensions` has one DUT row; `ExtFor` is total (one extension per kind,
      `ToDictionary` throws on a second row); `DutExtension` deleted. LSP `source-extensions.ts` + `source-object.ts`,
      volt-control `files.ts`, VS Code `languages.extensions` / tmLanguage `fileTypes` / `volt-icons.json` (one DUT icon)
      / `workspaceContains`, the Claude Code plugin's `extensionToLanguage`: `.dut` only. `bun run check` 15 passed / 0
      failed. Library DUTs: `LibSignatureRenderer.Dut` → `ItemKind.ExtFor(Kinds.Dut)`. Text-list enum measured: it is
      classified `PlcDut`, read and written through its `Interface` aspect (C2e) — kept, writable, `X.dut`
      (`CodesysTextListEnumTests`, new). Split names refused: `ItemKindTests.A_split_dut_name_names_no_kind`,
      `DutOneNameTests` (BAD_REQUEST, forced or not).
- [x] 5.P.2 Engine and drivers: the subtype leaves the contract — `IIdeDriver` reports the kind only; `Materializer`
      names a DUT `name.dut`; deleted: `CodeHelper.DutSubtype`, 5.B's subtype answer (`DutSubtypeAnswer`, the
      no-answer `.dut` branch — now there is no branch), `DutSubtypeChanges`, the `UnreadableDut` sentinel paths,
      `DutBareIdentity` special cases (a subtype change is no longer a rename: the name stays `name.dut`), the
      CODESYS signature-subtype lookup and `LibSignatureRenderer.Dut`'s subtype (always `.dut`). Tests that pinned the
      split names are deleted or rewritten to `.dut` (tests change only because the owner changed the premise).
      DONE (2026-10-02): deleted `Item/DutSubtype.cs`, `ItemContent.DutSubtype`, `CodeHelper.DutSubtype` /
      `TryDutSubtype` / `DutSubtypeOrNull` (and its private scanner), `Sync/DutSubtypeChanges.cs` and its `Normalize`
      call, `PushConflicts.LiveDut` + both arms, `PushService.UnreadableDut` + the DUT pre-flight; `NamesThisItem` is a
      kind comparison (no content read; `DeleteReaches` gone), both drivers' `DutSubtypeOf`, `FakeIde.DutAnswer` /
      `DutAnswers` / `DutAnswerFor`; `Materializer.FullWireName(bare, kind)` for every kind. Also `Removal.SeenUnderAnotherName`
      (dead with one extension per kind; design "Implemented"). Test files deleted (subject gone): `DutSubtypeChangePushTests`,
      `DutBareIdentityPushTests`, `DutSubtypeAnswerTests`, `DutSubtypeCodeTests`, `CodesysDutSubtypeReadTests`,
      `TcDutSubtypeReadTests`, `DutNameTransportTests`, `LibraryDutExtensionParityTests` (+ CLI `DutSubtypeFileTests`,
      `DutBaselineMigrationTests`, 5.P.3): 12 files, 2786 lines. Rewritten to `.dut`, each saying the owner changed the
      premise: `ItemKindTests`, `KindFromExtensionTests`, `TransportMatrixTests`, `PushServiceTests`, `PushedTextTests`,
      `PushWithoutHeaderCheckTests`, `PushDeclarationTransportTests`, `ImplementationLanguagePushTests`, `PartialWalkTests`,
      `BuildDiagnosticNameTests`, `LibSignatureRendererTests`, `TcLibrarySignaturesTests`, `WireVocabularyGuardTests`,
      `DocDataTests`, `UnopenedItemTests`, `ReadOnlyBodyTests`, `FetchExclusionTests`, `NetworkTextV1DetectionTests`,
      `CodeHelperTests`, `ItemContentIsFullyCarriedTests`, `CliHoldsNoItemKindLogicTests`. New, red first
      (`DutOneNameTests`, 9 cases; run against HEAD in a scratch worktree: 6 red — the struct→enum update renamed to
      `X.enum`, the 4 split names were accepted, the unguarded unreadable-DUT delete was refused `UnreadableDut`
      where the POU's is deleted): struct→enum is one `writecontent:X` under `X.dut`; `X.struct`/`.enum`/`.union`/
      `.alias` refused `BAD_REQUEST`, nothing written; an unreadable DUT's delete matches an unreadable POU's in all four
      force × ifVersion combinations. Docs: `items.html#dut` / `wire.html#dut` rewritten, `#dut-subtype` and
      `#dut-migration` removed, `data.js` regenerated (`VOLT_WRITE_DOCS=1`), DIALECT C2e "How Volt relies on it".
- [x] 5.P.3 CLI: no subtype logic anywhere (`IdeTree`, pull, push, status); `DutBaselineMigration` and any `.enum`/
      `.struct` file handling deleted. A repo bound before 5.P has split-name baseline keys, so its next pull/push is
      refused by name until `.git/volt/ide-refs.json` is deleted; the rebuilding pull then sees the split-name files as
      removed + `name.dut` added (plain git; no special code). Black-box tests at both layers name DUTs `.dut`.
      DONE (2026-10-02): the CLI held no subtype code (5.B had removed it); `DutSubtypeFileTests` and
      `DutBaselineMigrationTests` deleted (review fix: its non-DUT baseline-less pull rows and the refusal of a split-name
      key at both doors, `LoadIdeRefs` and the pending baseline `volt merge --continue` promotes, live on in
      `SidecarBaselineTests`, red against a no-op `RefuseUnknownNames`); `Sidecar`'s `X.dut` note reworded kind-neutrally (a split-name baseline key is
      refused by the generic unknown-name rule) and the CLI gate's `Sidecar.cs` allowance deleted. Rewritten to `.dut`:
      `IdeTreeTests` (the subtype-sweep test deleted), `PullCommandTests` (a subtype change over a partial walk is a
      content change of `X.dut`; a moved DUT's old file is retired), `BlackBoxTests` (a subtype rewrite is a plain
      `volt push`, no `--force`, `writecontent:X` only), `PushCommandTests`, `ExtensionListTextTests`. Transport layer:
      `DutOneNameTests`, `TransportMatrixTests`. e2e (live, not run here): `dut-subtype-change.test.ts` deleted,
      `push-without-header-check.test.ts` / `fixtures.ts` name DUTs `.dut`.
- [x] 5.P.4 LSP: every DUT file is `.dut`; the fixtures, scripts and recordings' item names that state a subtype
      (dut-subtype 4.8, 6aecd5d476) go back to `.dut`; the LSP reads a DUT's shape from its text as it always does
      (that is analysis, not naming). Conformance numbers unchanged apart from the renames. Coordinate with the running
      LSP queue: touch only extension tables, fixture names and DUT-name scripts.
      DONE (2026-10-02): fixture `kind` union → `"dut"` (53 fixtures: 49 rows in 15 files + `units.ts`' `bareType`, 3
      calls); `record-language.ts` (`KIND_EXT` / `UNIT_EXT` give `dut`, the subtype throw deleted), `verify-catalog.ts`,
      `held-as.ts` (FAMILY: `dut` only; its test rewritten), `fixture-units.ts` library regex `\.(fun|fb|itf|dut)$`,
      `fixtures.test.ts` `extFor` (one line), `probe-projectsettings-effect.ts`; test URIs `X.struct`/`.enum`/… → `X.dut`
      in 15 src test files (43 names). R1: the six corpora's 8175 DUT files (5524 `.struct`, 2060 `.enum`, 210 `.union`,
      381 `.alias`) renamed to `bare.dut`, contents untouched — 8175/8175 R100 in the index, 0 collisions, 0 left.
      Recordings: 0 item names changed, no re-record. `rate:fixtures` leaves `map.generated.ts` byte-identical.
      Numbers unchanged: `test/corpus` output identical line for line to HEAD's (run in a scratch worktree), 19 pass / 1
      skip; `test/conformance` 5214 pass / 152 todo / 0 fail; `test/frontend` 31 pass / 0 fail.
      Docs: LSP README, `docs/behavior.md`, `volt-vscode/README.md`, `agents.mdx`. Left: `src/frontend/symbols/binder.test.ts`
      (three `.enum`/`.alias` test URIs; carries the LSP queue's uncommitted work; passes).
      GATE 5.P (2026-10-02): run in a scratch worktree of HEAD + exactly the 5.P paths (the tree also holds the LSP
      queue's uncommitted frontend-conformance 3.2 work — inheritance, hierarchy, recordings, baselines,
      `fixtures.test.ts` ceilings — kept out of the gate and out of the commit). `bun run typecheck` green (5 packages);
      `dotnet build Volt.sln -c Release` 0 errors (28 warnings, as 5B). C# suites: Cli 237/0 fail (5B: 280 — the
      deleted DUT-subtype/migration tests), Engine 1711 pass / 1 skip / 0 fail (5B: 1871), Connector 113/0,
      Ide.Twincat 283/0 (5B: 291), Ide.Codesys 198/0 (5B: 206), Contracts 19/0, Repo.Gates 54/0. volt-cli
      `bun test test/unit` 4/0; volt-control 113/0 (5B: 121); volt-vscode 39/0; `bun run lint` 0 errors;
      `bun run check` 15 passed / 0 failed. LSP full suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset): 7097 pass /
      34 skip / 195 todo / 0 fail across 200 files (5B: 7096 — the first run's one failure was the map's NOTES
      `endsWith` reading a CRLF checkout of `map.generated.ts` in the fresh worktree; `rate:fixtures` rewrote it
      byte-identical to HEAD, and `fixtures.test.ts` re-run in full: 5125 pass / 151 todo / 0 fail). `rate:fixtures`:
      `map.generated.ts` unchanged.

### 5.Q PIVOT 2 (owner, 2026-10-02): ONE POU extension, `.pou` — an extension carries only what the IDE stores per object

Rule (owner): **a wire extension may only carry what the IDE stores PER OBJECT** (its class / tree item type), never
what is decided by parsing the object's text. Kind audit (2026-10-02, scratchpad `kind-audit/` probes + logs; Pro2193
class census) — only `.prg` / `.fb` / `.fun` broke it: CODESYS has ONE `POUObject` class whose PRG/FB/FUN-ness follows
the text (C2f/C2g), TwinCAT's 602/603/604 lag in-session and are re-derived from the text on reload (C2h). Per object on
both vendors and therefore KEPT: `.itf` (`InterfaceObject` / 618 — stays that class even with PROGRAM text), `.gvl`
(`GVLObject` / 615), `.dut` (5.P), every member class (method / interface method / property / accessor / action /
transition), and every descriptor/reference kind. The stopped 5.D (POU kind from the CODESYS signature, `--force` for a
broken POU) is superseded and NOT committed; its WIP + evidence (C2j: CODESYS's parse agreed with its signature on
262/262 POUs) is kept outside the repo (scratchpad `push5D-wip/`), the evidence may be re-used in DIALECT.

- [x] 5.Q.1 One POU extension: `.pou` is the ONLY extension for a PROGRAM / FUNCTION_BLOCK / FUNCTION, in C# `ItemKind`
      (+ every derived map), the LSP (`frontend/syntax/format/source-object.ts`, `source-extensions.ts`), volt-control,
      the VS Code manifest places, `scripts/check-wiring.ts` (`bun run check` parity green); `.prg` / `.fb` / `.fun`
      removed everywhere. `LibSignatureRenderer` names library items through `ItemKind.ExtFor` (no hard-coded
      `".fb"`/`".fun"`/`".itf"`/`".gvl"`). Corpus + fixtures renamed with `git mv` (contents unchanged); recordings keyed by
      fixture name need no re-recording — prove it (conformance numbers identical apart from the names).
      DONE (2026-10-02): `ItemKind`: one POU row `(Kinds.Pou, "pou")`, `Kinds.Program/Function/FunctionBlock` deleted,
      `PlcPou` = 604 (602/603 kept as TwinCAT tree codes, all three `Map` → `pou`); `PushService.PouKindToCode`,
      `StReader.OuterEndKeywords`, `PushedText.MayBeHeldAs` (case-variants only), `LibSignatureRenderer` (every library
      item through `ItemKind.ExtFor`, no extension literal). Parity sites: LSP `source-extensions.ts` / `source-object.ts`,
      volt-control `files.ts`, VS Code `languages.extensions` / tmLanguage `fileTypes` / `volt-icons.json` /
      `workspaceContains`, the Claude Code plugin; `bun run check` 15 passed / 0 failed. LSP scripts (`record-language.ts`
      UNIT_EXT/KIND_EXT, `verify-catalog.ts`, `held-as.ts` FAMILY, `fixture-units.ts`, `fixtures.test.ts` extFor,
      `evidence.ts`, `test/frontend/sources.ts`, `libraries/index.ts`), test URIs (132 LSP files, mechanical, code
      member accesses like `routine.fb` excluded), `error-catalog.json` repro URIs, `resolution-dump.json` names.
      Renamed (contents untouched, 17,051 R100): the six corpora's 16,990 POU files, the library repo's 50 bodies,
      volt-cli's 11 test fixtures — staged with explicit paths; NOTE they were swept into the unrelated commit
      `36594321c8` (another workflow committed the whole index). Proof, in a scratch worktree of `3c66511693` before and
      after this step's LSP change: `test/corpus` 19 pass / 1 skip both, output identical line for line; `test/conformance`
      5260 pass / 152 todo / 1 fail both (the fail is the CRLF-checkout NOTES artifact 5.P saw), output identical but for
      timings; `test/frontend` 31 / 0 both; `rate:fixtures` leaves `map.generated.ts` byte-identical. Recordings: 0 item
      names changed; CODESYS needs no re-record (C2g). TwinCAT re-record of the 233 `program`/`function` fixtures: see
      design 5.Qa "Implemented" — 176 identical, 56 never recorded on TwinCAT before (not merged), **1 differs** — refused now: the TwinCAT seed lag on a graphical `.ENO`, a known divergence (5.Q.9).
- [x] 5.Q.2 Kind from the class, never from text or signature: CODESYS `IPOUObject` (incl. `POUObjectCheckFunction`) →
      `pou`, `IInterfaceObject` → `itf`; TwinCAT `.TcPOU` → `pou`, 618 → `itf`. Deleted: the header reads in
      `CodesysTypeMap` (`RefinePou`, `LeadingKeyword`, `NeedsDeclaration`, the declaration read in `KindCodeOf`),
      `TcSolutionExplorer.PouKinds` beyond `pou`, the POU re-type guard in `PushService.WriteItemFromSource`,
      `Commands.HeldUnderAnotherName` for POUs. A POU with broken text pulls back as `X.pou` — no unreadable state, no
      `--force` (5.D's question is gone). TwinCAT C2i (5.H) stays guarded.
      DONE (2026-10-02): `CodesysTypeMap` (`RefinePou`, `LeadingKeyword`, `NeedsDeclaration`, the declaration parameter)
      and the Interface-aspect read in `KindCodeOf` deleted — `IPOUObject` → `PlcPou`; CODESYS `CreateChild`'s Program and
      Function arms and `SeedType` deleted (one FB seed, S1); TwinCAT's `PlcPouFunc` vInfo arm deleted;
      `TcSolutionExplorer.PouKinds` = `[pou]`. The re-type guard keeps refusing a name of another FAMILY
      (`ItemKindIsNotRewritableTests.Renaming_a_pou_to_a_dut_is_refused`, the owner changed the FB→PRG premise).
      `PouEndLineTests.A_pou_whose_text_declares_nothing_pulls_as_pou`. DIALECT C2f "How Volt relies on it" rewritten;
      C2j added (5.D's evidence, `probe-pou-kind-{signature,parser}.py` + logs, history only).
- [x] 5.Q.3 The outer END line (owner: it separates the POU from its children, so it stays): the writer mirrors the
      declaration's header keyword — `PROGRAM` → `END_PROGRAM`, `FUNCTION_BLOCK` → `END_FUNCTION_BLOCK`, `FUNCTION` →
      `END_FUNCTION` — read with the ONE trivia skipper (5.E). The reader accepts any of the three as the boundary.
      A header that names none of them (broken text) gets ONE documented fallback END line, chosen in design and named
      there — an intentional, tested, COUNTED fallback: 0 on every POU the vendor compiles. Table test (comments,
      pragmas, attributes before the keyword; CRLF/BOM; any case).
      DONE (2026-10-02): `StReader.PouHeaderKeyword` (the first word leading a line's code, in the reader's view —
      design "Implemented" says why not the first token), `StWriter.EndKeyword` mirrors it, `StWriter.FallbackPouHeader`
      = `FUNCTION_BLOCK` (F1), logged per item by `Materializer.LogEndLineFallback`. `PouEndLineTests`: 16 mirror rows
      (round-tripped through the reader), 8 fallback rows, the log. Counted on the six corpora with this C# code:
      16,990 / 16,990 files mirror the END line they already have, fallback 0.
- [x] 5.Q.4 CODESYS create order: the declaration is written before members are created (which children a POU accepts
      follows its text — FUNCTION text refuses methods/properties/actions/transitions; measured); a member create the IDE
      refuses is refused by name with the IDE's reason, never a half-created POU without saying so. TwinCAT measured for
      the same (a 603 FUNCTION accepting members?) and recorded in DIALECT.
      DONE (2026-10-02): `WriteItemFromSource` writes the declaration alone before `ReconcileMembers` when the push
      creates a member and changes the declaration (design "Implemented"); a member create the IDE refuses is
      `UNSUPPORTED` naming item, member, kind and the IDE's message — a create rolled back whole (the rollback now spans
      the sequence), an update saying what landed. `FakeIde.RefusesMembersByText` models C2k; `DeclarationBeforeMembersTests`
      (5); expected call logs in `PouMergeWriteTests` / `TransportMatrixTests` gain the early write (owner's O2).
      DIALECT C2k (CODESYS, `probe-kind-audit2.py`) and its TwinCAT column measured live: TwinCAT refuses too ("SubType
      mismatch"), before and after a reload (`probe-tc-function-members.ts` → `tc-function-members.log`); C2l added.
- [x] 5.Q.5 Members: on pull the member's CLASS decides its kind (method / property / action / transition), not its
      header keyword; a stored member text whose keyword disagrees with its class (measured possible) is reported by name,
      never round-tripped as a delete + a create of another kind.
      DONE (2026-10-02): `Materializer.RefuseMemberOfAnotherClass` + `StReader.MemberHeaderKeyword` (the splitter's
      `ScanContext`): a method whose text opens with PROPERTY / FUNCTION_BLOCK / ACTION, or a property opening METHOD, refuses
      its item on pull (`UNSUPPORTED`, listed unreadable); `MemberKindIsItsClassTests` (9). `BeckhoffDriver.ReadMember`'s
      `?? Method` is a failure by name (5.Q.7's, same code). Red check: with the three behaviours (O2, M-a, the mirror)
      disabled, 22 of the new tests fail. Gates: `WireVocabularyGuardTests` (retired POU kinds and extensions),
      `CliHoldsNoItemKindLogicTests`. C# suites: Engine 1754 pass / 1 skip, Cli 237, Codesys 198, Twincat 283, Connector
      113, Contracts 19, Repo.Gates 54 — 0 fail; volt-cli `bun test test/unit` 4/0; volt-control 121/0; volt-vscode 39/0;
      volt-desktop 28/0; `bun run typecheck` green; lint 0 errors.
- [x] 5.Q.6 Merged classes (the extension carries LESS than the IDE stores): a create or re-create that would silently
      downgrade a special class — `VarPersistentObject` / NVL / `ParameterList` / `NetVarProperties` GVLs,
      `TextListEnumerationObject`, `POUObjectCheckFunction`, `AbstractPOUMethodObject` — is refused by name; an update of
      the text keeps the class. Documented in DIALECT; tests per class on the doubles.
      DONE (2026-10-02, design 5.Qb Q2): evidence first, live through the shipped push (`ide.ps1 -Instance
      push-without-header-check -RunScript probe-merged-classes.py` + `probe-merged-classes.ts` → `merged-classes.log`), a
      Pro2193 copy and a Bakon Nano copy: `PersistentVars` (`VarPersistentObject`), `CheckBounds` ×2
      (`POUObjectCheckFunction`, `KindOfCheckFunction=CheckBounds`; a plain POU reads `None`), `IQSlices`
      (`TextListEnumerationObject`), `CAN_TO_PLC` (`NVLObject`, `NetVarProperties` unchanged) and the abstract
      `TakePicture` through its owner — update in place, rename, rename back + move, move home + original text: the same
      GUID and CLR class after every one of the 4 × 6 steps, so the design's assumption holds. The batch that lost them,
      on the pre-5Qb bridge: `[deleteItem, set]` → `ITEM_MISSING` (version gate), `[set, deleteItem]` → half-applied;
      FORCED, `PersistentVars` deleted + the set failing on its dead GUID, `CheckBounds` deleted under an ACCEPTED push.
      Code: `PushService.RequireOneOpPerItem` (pre-flight beside `RequireWireNames`, `BAD_REQUEST` "'X' is named by two
      ops in this push (…). One op per item: …", nothing applied; identities = each op's `name` + a set's `toName`,
      OrdinalIgnoreCase); `Commands.Push` pairs a `Delete` row and an `Add`/`Modify` row of one item name into ONE
      `SetItemOp { ToFolder, SourceText, IfVersion }` (name logic only). Tests, red first: `OneOpPerItemTests` (8: both
      orders forced and not, rename onto a set name, case variants, `X.pou`+`X.dut` NOT refused, one-op batch accepted —
      6 red with the guard off), `MergedClassKeptTests` (16: update / rename / move-with-edit × 5 classes + the abstract
      method through its owner; `FakeIde.Item.Class` label kept in place, lost on a create),
      `PushCommandTests.A_file_moved_and_rewritten_past_the_rename_threshold_pushes_one_move_and_edit` (red against HEAD's
      `Commands.cs`). DIALECT **C2n** (classes, corpus counts 15 / 3 / 1 (≤ 11 by text) / 1 / 0 / 10, what a plain create
      loses, the measurements); `docs/wire.html` "One op per item". Not refused (by design): a create of a NEW name is the
      plain class. Seen on the way, recorded for `bridge-refusal-review`: a move into a non-folder node (`Device` on
      Pro2193, `Task Configuration` on Bakon) is ACCEPTED as "moved" and leaves the object where it was.
      Review fixes (2026-10-02): both seen-on-the-way defects are now `bridge-refusal-review` 4.31 (non-folder move) and
      4.32 (re-type in one push); `deleteItem X.pou` + `set X.dut` (either order) is REFUSED in the pre-flight now — the
      apply's bare-name cache sent the set through the deleted POU's dead handle (`OneOpPerItemTests`, the former
      "NOT refused" test replaced, red first); `Commands.Push` splits a git `Rename` whose names another row also
      names back into Delete + Add before pairing by name
      (`PushCommandTests.A_rename_that_git_paired_across_two_names_pushes_by_name`, red first: BAD_REQUEST "named by two
      ops"); `ide.ps1` `Wait-ForPipe` returns only a pipe served by a process this `-Instance` recorded (`Test-Ours`).
- [x] 5.Q.7 Smaller fixes from the audit: `ProjectDeclarations.Globals(pushed)` keys pushed GVLs by the wire kind, not
      `IsGlobalListHeader` (deleted); `BeckhoffDriver.ReadMember`'s `ItemKind.Map(code) ?? Method` silent fallback
      becomes a failure by name; `TcLibrarySignatures`' enum-from-shape decision is labelled in code and DIALECT as a
      Volt inference (a library item has no per-object source) and counted in the library census.
      DONE (2026-10-02, design G2 + I1): `Ide/PushedDeclarations` (`ByName` + the bare names whose WIRE kind is `gvl`,
      built by `PushService.DeclarationsIn` through `FromWire`) is the type of every `pushedDeclarations` parameter
      (`ICodeStore`, `DriverBase`, `ProjectDeclarations`, `PushService`, both drivers, `FakeIde`); `Globals(pushed)` yields
      `pushed.Globals` then the IDE's GVLs the push does not replace; `StDeclaration.IsGlobalListHeader` deleted (0
      callers left). `GlobalsByWireKindTests` (5: `VAR_CONFIG` GVL, unclosed-`(*` GVL, a POU opening `VAR_GLOBAL` is
      not one, the IDE half by class, end to end through a push); `NetworkScopeTests`' block-comment GVL premise
      re-worded to the wire kind (owner rule, not the code). The corpus count the change fixes: 1 GVL whose first code
      line is not `VAR_GLOBAL` (bakon-nano `Variable_Configuration.gvl`), 0 non-GVLs opening with it. `ReadMember`
      (internal now) pinned by `TcMemberKindTests` (code 9999 → `UNSUPPORTED` naming the member and code; unreachable
      through `MemberSites`, which yields `IsMember` codes only, all mapped). `TcLibrarySignatures.InferredEnum` + the
      parse's `Tally(NoBody, Unknown, InferredEnums)` and a Debug line "N enums inferred from shape"; DIALECT D27 names
      it Volt's inference — 12 of 18 VarGlobal signatures in `twincat-project14` (re-counted on the corpus: 12 `.dut` in
      `References/Tc2_System`, 6 `.gvl` across Tc2_System 3 / Tc2_Standard 1 / Tc3_Module 2).
      `TcLibraryInferredEnumTests` (5: the fixture's tally 1 / 2 / 0, a mixed VarGlobal is a GVL, the rule's table).
- [x] 5.Q.8 PLCAssist note (proposal Impact): wire names change `X.prg`/`X.fb`/`X.fun` → `X.pou` and DUT subtypes →
      `X.dut`, in the same release; the client keys by wire name.
      DONE (2026-10-02, design N1): proposal.md Impact — "Clients: none required" replaced by the PLCAssist note (one
      release, old names refused `BAD_REQUEST` never mapped, re-read `refs` and rename keys, one op per item).
      GATE 5Qb (5.Q.6–5.Q.8, 2026-10-03): run in a scratch worktree of HEAD (`22917a0677`) + exactly the 34 5Qb paths —
      the tree also holds the LSP queue's uncommitted frontend-conformance 3.5 work (`call-arguments`,
      `unresolved-identifier`, `external-write`, `resolution`, `infer/*`, `names/members.ts`, recordings, divergences,
      ceilings, dumps, `map.generated.ts`), kept out of the gate and the commit; 5Qb touches no LSP file. `bun run
      typecheck` green (5 packages); `dotnet build Volt.sln -c Release` 0 errors (30 warnings). C# suites: Cli 239/0
      (5Qa: 237), Engine 1797 pass / 1 skip / 0 fail (5Qa: 1767), Connector 113/0, Ide.Twincat 296/0 (5Qa: 290),
      Ide.Codesys 202/0, Contracts 19/0, Repo.Gates 54/0 (incl. the generated-docs gate). volt-cli `bun test test/unit`
      4/0; volt-control 113/0; volt-vscode 39/0; volt-desktop 28/0; `bun run lint` exit 0; `bun run check` 15 passed /
      0 failed. No fixture or transpiler change: `rate:fixtures` rewrites `map.generated.ts` byte-identical to HEAD (4210
      fixtures; confirmed 2428, refused 1506, not-lowered 161, lsp-gap 43, diverges 4, unaskable 68; edges agree 2540 /
      disagree 0 / not-run 110). LSP full suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset, rustc cache sampled):
      7241 pass / 34 skip / 205 todo / 1 fail (7481 tests, 201 files, 672 s) — the one fail the map-NOTES check on the
      worktree's fresh CRLF checkout (`core.autocrlf=true`; `map.endsWith(section)`), gone once `rate:fixtures` wrote the
      file LF; `test/conformance/fixtures.test.ts` re-run in full: 5203 pass / 161 todo / 0 fail, so **7242 pass / 34
      skip / 205 todo / 0 fail**; agreement CODESYS 3868 / 4210, TwinCAT 3787 / 4210 (the 3.4 library fixtures; floors
      unchanged). Seen, not 5Qb's: root `bun run build` fails in this environment — `@volt/cli` finds no .NET SDK on the
      default `dotnet` (the SDK-path gotcha) and `@volt/lsp-iec`'s `tsc` build type-checks `test/` without Bun types
      (HEAD's; the LSP files are HEAD's in the worktree).
- [x] 5.Q.9 5Qa review fixes (2026-10-02).
      (a) **TwinCAT seed lag on a graphical `.ENO` — known divergence, niche: accepted loss.** The re-record's one
      difference was misread as a FUNCTION callee: `network_unnamed_target_of_void_call`'s callee is a PROGRAM. Measured
      live (`scripts/probe-tc-graphical-callee-seed.ts` → `tc-graphical-callee-seed.log`, DIALECT C2m): TwinCAT builds a
      call box from the callee's lagging 604 tree code, so `.ENO` on a box calling a PROGRAM **or** a FUNCTION created in
      the same session is refused (`network_unnamed_target_of_valued_call` too, never re-recorded on TwinCAT before:
      refused); a build in between does not re-derive the code; a call WITHOUT `.ENO` is accepted, fetches back
      identical and builds clean. 0 such calls in the TwinCAT corpus, 2 in the six corpora (lenze-mid, CODESYS: `Alarms_ResetAlarmLogging` and `SidecorrectionCalculation`, both FUNCTIONs).
      Both fixtures carry `vendorRefuses.twincat` (their committed TwinCAT rows predate S1 and stay as the vendor's
      answer for the source; `check-recording.ts` names such a dropped row instead of "NEEDS A REASON"); pinned live by
      `test/e2e/graphical/callee-seed-lag.test.ts` (fails the day TwinCAT takes it). S1 itself stays (owner decision
      only if this ever matters: a TwinCAT-side remedy; S2 is what the rule forbids).
      (b) **CODESYS, C2g on the shape that broke** (`RECORD_ONLY` the two fixtures above + `ng_box_output_arrow` + 12
      function_block fixtures with METHOD/PROPERTY members, one run): 14 / 15 identical, the 15th differs only in the
      compiler's implicit-temp number (`__…ImpVar15` → `ImpVar19`, a name no run reproduces — `divergences.ts`); not
      adopted. TwinCAT, the same 12 FB fixtures: 12 / 12 identical (O2 on a live create with members).
      (c) **e2e, both vendors**, which also found a 5.H bug: TwinCAT `RequireListed` compared a folder's child count
      against the hierarchy snapshot read at the START of the operation, so a create or delete followed by a lookup in
      the same push (a create + update + delete batch, every member create's re-find) was refused "holds 2 … the
      Solution Explorer lists 3". A clean snapshot made stale by Volt's own structural write is now read afresh before a
      folder is refused (`TcObjectModel._staleSinceWrite`; `TcUntouchablePouTests.A_lookup_after_a_delete_in_the_same_
      operation_reads_the_hierarchy_afresh`, red before). And a DUT beside a folder of its name (D34) overwrote the
      folder's listed count with its own 0, hiding the folder's POUs (`ExplorerSnapshot.Collect`;
      `A_DUT_beside_a_folder_of_its_name_does_not_hide_the_folders_children`, red before). `uc_fb` (a POU whose
      opening comment never closes) is `unreadable` on TwinCAT in the writing session too — the C2i guard reads the
      caption — so its e2e row is per vendor and design 5.Qa's "no --force within the session" is corrected. Results:
      CODESYS 248 pass / 3 fail → the 3 re-run green (two were vendor-parity racing the TwinCAT run, one a stale
      `.alias`); TwinCAT 230 pass / 10 fail → every failed file re-run green alone (graphical ones were the same race),
      vendor-parity 11/11 with both bridges up. Stale 5.P DUT names in e2e (`.struct`/`.enum`/`.alias` in
      `whole-project`, `name-clash`, `vendor-parity`, `kinds/top-level`) → `.dut`.
      (d) Smaller: M-a reads a member's opening word with `StTrivia.Code` (nesting), not the splitter's `ScanContext`
      (a nested comment was refused naming 'STILL'); `PouHeaderKeyword` passes over word-led lines that are not a POU
      keyword (a never-closed comment's prose fell back to END_FUNCTION_BLOCK on a PROGRAM; corpus END lines unchanged by
      construction — on all 16,990 the first word-led line is the header); a member create is worded as the IDE's
      refusal only when the driver recognises the vendor's measured answer (`ChildRefusedException`; CODESYS "is not
      accepted by parent object", TwinCAT "(SubType mismatch)") — any other failure is an unclassified fault, the create
      still rolled back; `tc-function-members.log` after-reload label corrected (the probe sent K2 + K3); stray BOM in
      `PushedText.cs`, stale `.prg`/`.fb` mentions (`written-as-sent.ts` note, `volt-desktop/src/main.ts`,
      `files.test.ts`). Not fixable: the corpus renames sit in commit `36594321c8` (history is not rewritten; bisect
      across it reads no POU files).
      (e) Second review round, each red first: a refused member create on an UPDATE names the members the reconcile
      already DELETED (deletes run first; it said "its members and body were not" / "nothing of 'K' was written" with a
      method gone — `DeclarationBeforeMembersTests.An_update_that_drops_a_member_…`); a member with a NESTED comment
      before its keyword is refused on pull by name until 5.E.1 (`StReader.MemberHeaderKeywordAsSplit`, the splitter's
      own view; (d)'s nesting read alone moved the refusal to every push of the file — the pull test now also reads the
      file back; 0 such members in the corpora); `PouHeaderKeyword` takes a keyword-led line as the header only when
      the rest is header-shaped (modifiers, one name, then nothing / `:` / EXTENDS / IMPLEMENTS — prose "Function to
      compute speed" closed a PROGRAM with END_FUNCTION; all 16,990 corpus END lines still equal it); TwinCAT: a guarded
      folder holding two children of one name (D34) is refused (unwalked) instead of reading one twice and the other
      never, and a folder beside a POU of its name is held to the hierarchy's count (`ExplorerSnapshot.InsidePou`: a
      listed node is not inside a POU) — both niche, 0 in the corpora; the seed-lag count is 2, not 3 (lenze-mid's
      `Alarms_ResetAlarmLogging` and `SidecorrectionCalculation`; every other `.ENO` callee is an operator or an FB).
      GATE 5Qa (2026-10-02): run in a scratch worktree of HEAD (`36594321c8`) + exactly the 5Qa paths — the tree also
      holds the LSP queue's uncommitted frontend-conformance 3.4 work (library namespaces: `names/libraries.ts`, the
      22 `lib_ns_*` recordings, `scope-nav` / `resolve` / `library-namespaces` / `incremental` / `workspace-store`,
      `divergences.ts`, `rules.ts`, `baseline.ts`, the ceilings and floors in `fixtures.test.ts`, the dumps' counts), kept
      out of the gate and out of the commit: each file it shares with 5Qa is committed in its 5Qa form (HEAD with the
      `.pou` rename; `fixtures.test.ts` the `extFor` line only), so the 3.4 diff stays in the tree on top of this commit.
      `bun run typecheck` green (5 packages); `dotnet build Volt.sln -c Release` 0 errors (30 warnings, untouched test
      files). C# suites: Cli 237/0, Engine 1767 pass / 1 skip / 0 fail (5.Q.5: 1754), Connector 113/0, Ide.Twincat 290/0
      (5.Q.5: 283), Ide.Codesys 202/0 (5.Q.5: 198), Contracts 19/0, Repo.Gates 54/0 (incl. the generated-docs gate).
      volt-cli `bun test test/unit` 4/0; volt-control 113/0; volt-vscode 39/0; volt-desktop 28/0 (boot test after
      `bun run build`); `bun run lint` exit 0; `bun run check` 15 passed / 0 failed. `rate:fixtures`: `map.generated.ts`
      byte-identical to HEAD (4188 fixtures; confirmed 2423, refused 1505, not-lowered 152, lsp-gap 36, diverges 4,
      unaskable 68; edges agree 2530 / disagree 0 / not-run 110). LSP full suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES`
      unset, rustc cache sampled): **7208 pass / 34 skip / 196 todo / 0 fail** (7438 tests, 201 files, 423 s; 5.P: 7097
      pass / 195 todo — the 5Qa src tests); agreement CODESYS 3854 / 4188, TwinCAT 3784 / 4188 (floors unchanged).

### 5.E Child elements (the one place headers stay — made gap-free)
- [x] 5.E.1 The child splitter (`StReader.SplitChildren` / `FirstMemberLine` / `FirstCodeLine`) uses ONE trivia skipper
      (`StTrivia`) and gets a table test, one row per case: comments, pragmas and attributes before and between
      `METHOD` / `PROPERTY` / `ACTION` / `TRANSITION` lines; nested and unclosed comments; a keyword inside a comment or
      a string; `//` vs `(* *)` mixes; CRLF/BOM; every modifier order (`METHOD PUBLIC ABSTRACT`); `END_METHOD` on the
      same line. An unsplittable file is refused by name with its line, never split wrong.
      DONE (2026-10-03): `ScanContext` deleted; `SplitChildren`, `ReadMethodOrAction`, `ReadProperty`,
      `FirstMemberLine`, `FirstCodeLine`, `BackOverMemberTrivia`, `FindOuterBlock` and the member signature read
      (`ParseSignature`, was `CodeHelper.WithoutComments`, deleted) all read `StTrivia.Code` over the whole region in
      ONE forward pass. `StTrivia`: a BOM at the start of the text is trivia; a string keeps its quotes in the code view
      (its text blanked), so a line holding one stays a code line, as it was to `CodeOn`. Refused by name with the file
      line, never split wrong: an END line after code on its line (`A := 1; END_METHOD`, `METHOD A : INT END_METHOD`,
      `END_GET`/`END_SET`/`END_PROPERTY`, the outer END) — it let a member run on and swallow the next one (an interface
      member silently); a member keyword leading a line inside an open member; comments/pragmas after the last member
      (dropped in silence before). The 5Qa interim pull refusal (`MemberHeaderKeywordAsSplit`, Materializer's nested-
      comment refusal) is deleted; `MemberKindIsItsClassTests` now pulls and reads such a member back.
      `ChildSplitterTableTests`: 39 rows + 3 body rows + the outer-END row, 43 tests (17 of the first 41 red on the old splitter; the 2 trailing-comment rows were written with their fix). Corpus census (reflection
      over `FindOuterBlock` + `SplitChildren`, signatures only — the corpora predate the IMPLEMENTATION line): 19,699
      POU/interface files, 56,997 members, byte-identical before/after (names, kinds, types, declaration hashes),
      0 refusals before and after; 0 corpus files hold text after their last END line. `CodeHelper.CodeOn` stays for
      `HeaderLine` (5.F.1) and `StDeclaration`'s variable/EXTENDS readers (network text, parked).
      REVIEW FIXES (2026-10-03): (a) text AFTER an END keyword on its line (`END_METHOD // note`,
      `END_FUNCTION_BLOCK (* note *)`, a comment opened there running over the next member) — and after an accessor's
      GET / SET — is refused naming the line (`StReader.RefuseTextAfter`): the IDE stores no such line, so it was dropped
      in silence, or landed in the next member as orphaned text. (b) A U+FEFF anywhere but the text's first character is
      refused naming its line (a sliced region read it as a BOM while the whole text read it as code). (c) The PULL reads
      its own file back through the splitter alone (`StReader.SplitMembers`, `Materializer.RefuseUnreadableBack`) and
      refuses the item — listed unreadable — unless every member comes back as itself: an IDE member holding a shape the
      splitter refuses, or a comment one member leaves open and the next closes (which swallowed the member between),
      no longer pulls into a file the push refuses or splits into other members. Split only — the body checks stay the
      push's (a full `Read` would refuse every network body the writer and reader still disagree on). Fixtures fixed
      on independent grounds: `TransportMatrixTests` / `FetchExclusionTests` served an IDE declaration holding Volt's
      `IMPLEMENTATION` line and END line, which no IDE stores. Table: 59 rows (+ 3 body rows, 3 outer-END-beside rows,
      the outer-END-after-code row); new coverage rows for END_SET / END_PROPERTY after code, PROPERTY / METHOD / ACTION
      opened inside a method, accessor or property declaration. Corpus: 0 lines with text after an END keyword, 0
      mid-text U+FEFF, `SplitMembers` refuses 0 of the corpora's .pou files (the 2,114 library .itf refusals are the
      pre-boundary interface layout with members after END_INTERFACE, refused before this change too).
      Known divergences: a comment BEFORE an END keyword on its line (`(* x *) END_GET`) is still dropped —
      `StReaderTriviaBoundaryTests.An_accessor_closed_on_a_commented_line_keeps_its_body` pins its acceptance, so it is
      left to the owner — niche: accepted loss (0 occurrences in the corpora). A HAND-WRITTEN file whose comments nest
      across members (`(* a (* b *)` in one, a stray `*)` in the next) is read as one comment, as both vendors read one
      text — niche: accepted loss (0 occurrences in the corpora); the pull side of it is closed by (c).
      GATE 5E (2026-10-03): C# suites green (Debug; the Release build of the solution is blocked only by a running
      TwinCAT worker holding `Volt.Ide.Twincat\bin\Release` — not ours, not killed): Volt.Engine.Tests 1867 pass / 1 skip
      (1868), Volt.Cli.Tests 239, Volt.Connector.Tests 113, Volt.Ide.Twincat.Tests 296, Volt.Ide.Codesys.Tests 202,
      Volt.Contracts.Tests 19, Volt.Repo.Gates 54 — 0 fail. volt-cli `bun test test/unit` 4/4; `bun run check` green.
      5E touches no TypeScript and no fixture/transpiler (no `rate:fixtures`); the LSP typecheck/suite in the tree at
      gate time carried another workflow's uncommitted frontend-types WIP (2 TS2554 in files 5E does not touch), so they
      do not measure this step.

### 5.F No legacy
- [x] 5.F.1 Deleted: `StDeclaration.IsGlobalListHeader` (`ProjectDeclarations` takes GVLs from the item kind); every
      comment/doc that describes reading a kind or subtype from text or naming DUTs by subtype (`ItemKind.cs`,
      `RefsFetch.cs`, `CodeHelper.cs`, `StWriter.cs`, DIALECT rows that only served the subtype — kept as history notes,
      the wire docs and generated doc data via VOLT_WRITE_DOCS=1, CLAUDE.md/README mentions of `.enum`/`.struct`).
      `IsCallableHeader` / `IsFunctionBlockType` in `NetworkScope` read other items' kinds from the known item kinds
      instead of their header (a lookup swap only — network text itself is parked). The stale e2e tests for subtype
      changes (`dut-subtype-change.test.ts`) are deleted; `held: "unreadable"` DUT rows become plain `.dut` rows.
      (First item DONE in 5Qb / 5.Q.7: `StDeclaration.IsGlobalListHeader` deleted, `ProjectDeclarations` takes pushed
      GVLs from the wire kind.)
      DONE (2026-10-03): no product code changed — every remaining item was a comment, a doc or a test. Comments that
      spelt a retired extension reworded as history in words (`ItemKind.cs` ×2, `PushedText.cs`, `PushService.cs`
      `RequireWireNames`, `CodesysObjectModel.Libraries.cs`, `TcObjectModel.cs`); `CodeHelper.HeaderLine`'s doc no longer
      claims it "classifies what the IDE holds" (its one caller is network-text scope, allow-listed by 5.F.2; the
      design's 5.Qa knock-on keeps `IsCallableHeader` / `IsFunctionBlockType` a read of the callee's declaration, since
      `pou` cannot say FB or FUNCTION). DIALECT C2g / C2h (the rows that only served the subtype) gain a "How Volt relies
      on it (history)" note; C2e/C2f/C2j already carried one. `RefsFetch.cs`, `StWriter.cs`, CLAUDE.md and every README
      held no subtype/kind-from-text wording any more (CLAUDE.md said `CM_Carrier.pou` already); the website mockup
      (`volt-web` `VSCode.jsx`) printed `FB_Conveyor.fb` twice → `.pou`. Generated doc data unchanged (`DocDataTests`
      green, nothing to regenerate: no fact table moved). `dut-subtype-change.test.ts` was already deleted in 5.P. The
      e2e `held: "unreadable"` DUT rows (`uc_struct`, `uc_enum`, `empty`, `prose`) RE-RECORDED LIVE on both vendors
      (own fixture copies, `ide.ps1 -Instance push-without-header-check`; TwinCAT on a worker built from this tree,
      since the shared Release bin was locked by another session's worker): all four are `fetched` as `X.dut` with the
      text sent; the `DUT_PUBLISHED_AS_DUT` mark, `expectHeldOrKnown` and the DUT entries of the sweep's kind map are
      deleted (CODESYS 11/11, TwinCAT 11/11, run twice). LSP: `binder.test.ts`' three `.enum` / `.alias` URIs and
      `source-object.test.ts`' query-string row now say `.dut` (24/24).
- [x] 5.F.2 Repo gate (`Volt.Repo.Gates`): no code outside the child splitter reads a declaration's first code line or
      matches `TYPE` / `STRUCT` / `UNION` / `FUNCTION_BLOCK` / `PROGRAM` / `VAR_GLOBAL` to decide a kind or a name;
      no source mentions `.struct` / `.enum` / `.alias` / `.union` / `.prg` / `.fb` / `.fun` as an extension; no kind is
      derived from a signature or a text where the class states it. Grep-based, allow-list in the test.
      DONE (2026-10-03): `NoKindFromTextTests` (23 tests). Rule 1 — in `volt-cli/src`, a header reader
      (`HeaderLine` / `FirstCodeLine` / `FirstMemberLine` / `PouHeaderKeyword` / `MemberHeaderKeyword` / `CodeOn`) or a
      header keyword (`TYPE` / `STRUCT` / `UNION` / `FUNCTION_BLOCK` / `PROGRAM` / `VAR_GLOBAL`) in a string, in code
      (comments stripped by a small C#/script scanner), only in the allow-listed files, each with its reason: readers
      StReader (splitter + END mirror), StWriter (END mirror), Materializer (member text held to its class, END
      fallback log), CodeHelper, StDeclaration (network-text scope); keywords StReader, StWriter, StDeclaration,
      Materializer, LibSignatureRenderer (writes from the vendor signature), NetworkTextReader / CodesysNetworkWriter
      (refusal messages). Rule 2 — the deleted kind sources and CODESYS's per-object parse / precompile signature
      (`IsGlobalListHeader`, `TryDutSubtype`, `DutSubtype`, `TcDutSubtype`, `RefinePou`, `LeadingKeyword`,
      `ParseCodeHeader`, `GetSignature`, `FindSignature`, `ParseInterface`, `POUType`) named nowhere in `src` code.
      Rule 3 — no product source (every package's `src`, `volt-web/app`, CLAUDE.md, READMEs, ARCHITECTURE.md; 500+
      files) spells `.struct` / `.enum` / `.union` / `.alias` / `.prg` / `.fb` / `.fun` in a comment or a string
      (interpolations are code: `routine.fb`, `${n.fb}` pass); allowed: DIALECT.md (history rows), the two refusal
      tests (`source-extensions.test.ts`, volt-control `files.test.ts`). Every allow-list entry must still match. Red on
      HEAD: 10 offenders (ItemKind ×3, PushService ×2, binder.test.ts ×3, VSCode.jsx ×2), green after; the theory rows
      pin each shape caught and passed. `InferredEnum` (TwinCAT library enums, 5Qb I1) is no kind decision where a
      class states it — a library item has no class — and is not flagged. Volt.Repo.Gates 77/77.
      GATE 5F (2026-10-03): run in a scratch worktree of HEAD (`b257b5c4f1`) + exactly the 5F paths. The tree also
      holds another workflow's uncommitted LSP frontend-types WIP, which stays out of the gate and out of the commit.
      Gate fix, red on a clean checkout: `NoKindFromTextTests` read `packages/volt-desktop/main.mjs`, which is gitignored
      build output, so it threw FileNotFound wherever nothing had been built. Its source `volt-desktop/src/main.ts` is
      already scanned, so the entry is removed. `bun run typecheck` green (5 packages). `dotnet build Volt.sln -c Release`
      0 errors (31 warnings). C# suites: Cli 239/0, Engine 1867 pass / 1 skip / 0 fail, Connector 113/0, Ide.Twincat
      296/0, Ide.Codesys 202/0, Contracts 19/0, Repo.Gates 92/0 (5E: 54; +23 `NoKindFromTextTests` cases and their theory rows).
      volt-cli `bun test test/unit` 4/0; volt-control 123/0; volt-vscode 39/0; volt-desktop 28/0 (after `bun run build`);
      `bun run lint` exit 0; `bun run check` 15 passed / 0 failed. 5F touches no fixture and no transpiler, so the map
      does not move: `rate:fixtures` content matches HEAD (4259 fixtures; confirmed 2446, refused 1524, not-lowered
      162, lsp-gap 55, diverges 4, unaskable 68; edges agree 2572 / disagree 0 / not-run 110). LSP full suite
      (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset, rustc cache sampled): **7302 pass / 34 skip / 206 todo / 0 fail**
      (7542 tests, 201 files, 646 s). The first run reported 1 fail, the map NOTES check. It was a worktree artifact:
      `core.autocrlf` had checked the map out with CRLF. After `rate:fixtures` rewrote it with LF and no content diff,
      `fixtures.test.ts` re-ran in full at 5251 pass / 162 todo / 0 fail. Agreement: CODESYS 3914 / 4259, TwinCAT
      3825 / 4259.

### 5.G Verify
- [ ] 5.G.1 Live on both vendors (fixture copies, `ide.ps1 -Instance push5`): every 5.A.1 shape incl. the broken-text
      ones — push as sent, pull, push the fixed text, pull: every DUT is `name.dut` and every POU `name.pou` throughout (a PROGRAM rewritten as a FUNCTION_BLOCK
      in place is a content change, its END line follows),
      a subtype change (struct → enum in place) is an ordinary content change, the TwinCAT broken-POU case survives (5.H).
- [ ] 5.G.2 Full C# suites, `bun test test/unit` (volt-cli), the LSP suite, `bun run check`; docs regenerated.
