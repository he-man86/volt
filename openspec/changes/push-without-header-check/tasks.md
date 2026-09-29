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
- [ ] 3.2 Full C# suites green; e2e on both vendors. The C# suites are green offline (Engine, Cli, Codesys,
      Twincat, Contracts, Repo.Gates) and `bun test test/unit`; **the e2e on both vendors is live — after
      transpile-fix-all.**

## 4. LSP parity — the LSP reports what CODESYS reports for every shape push now lets through

The push no longer refuses these shapes, so the IDE's build is the answer and the LSP must give that answer, no more and
no less (an LSP-only message is a false positive). Each shape is a conformance fixture recorded LIVE with
`bun run record:language` (and TwinCAT where it records), whose kind is the extension and whose source is the text.

- [ ] 4.1 Fixtures + live recordings, CODESYS and TwinCAT: an unclosed opening `(*` in a DUT (struct), an enum, a GVL and
      an FB; an FB whose text declares `PROGRAM`; an empty struct; prose text under a struct; a struct whose body is an
      enum; a struct member named `IMPLEMENTATION`; a GVL holding a retired `(* @volt-… *)` comment. Record CODESYS's exact
      messages and lines (or that it builds clean).
- [ ] 4.2 LSP: for each recorded error, the same diagnostic (message and line) — including the unclosed-comment case, where
      the LSP reports nothing today; for each shape CODESYS builds clean, no diagnostic. Test-first (the fixtures are the
      acceptance test); `bun test test/conformance` and build-conformance green.
- [ ] 4.3 The three stale notes in `packages/volt-lsp-iec/docs/codesys-reference/error-catalog.json` that describe the
      bridge refusing with "Unrecognized code header" (FUNCTION EXTENDS, FUNCTION IMPLEMENTS, VAR block in an INTERFACE):
      re-record them live and correct them.
