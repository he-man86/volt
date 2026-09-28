Loop (sized to a medium change, per the 2026-09-27 workflow analysis): implement each section test-first; ONE
review round per section with the **data** lens (can a file lose, misplace or mislabel its body?); fix; commit. A
second round runs only if the first found a high or medium finding. One final review covers the whole change with
the **spec** and **layering** lenses.

## 1. Tests red

- [x] 1.1 C#: `ImplementationMarker` recognises `IMPLEMENTATION ST`, `IMPLEMENTATION LD`, `IMPLEMENTATION FBD`
      (spacing, case); it rejects the old comment, a bare `IMPLEMENTATION`, an unknown language, `IMPLEMENTATION ST;`,
      trailing tokens, and the word inside a statement.
- [x] 1.2 C#: StWriter writes `IMPLEMENTATION <LANG>` for every kind `AppliesTo` covers (POU, method, action, getter,
      setter); StReader splits on it, including the three historical traps (a trailing comment after `END_VAR`, a
      wrapped `EXTENDS`/`IMPLEMENTS`, an `{IF}` pragma).
- [x] 1.3 C#: the stated language decides the reader: `ST` is read as ST, `LD`/`FBD` as network text. A body that
      contradicts its language (network text under `ST`, ST under `LD`) is refused by name; nothing is written.
- [x] 1.4 C#: a missing language (`IMPLEMENTATION` alone) is refused by name, naming the item.
- [x] 1.5 C#: a file carrying only the old comment is refused with the existing "pull the project once" message.
- [x] 1.6 LSP: body splitting and language selection from the keyword, the missing/contradicting-language
      diagnostic, the semantic token, folding.
- [x] 1.7 Data-lens review round, as red tests: a keyword line inside a block comment is no boundary (C# + LSP); a
      body Volt cannot write is stated by its `(* @volt-graphical: … *)` marker line, never `IMPLEMENTATION ST`,
      and pushes back as a no-op; `IMPLEMENTATION` is reserved (push refusal + LSP diagnostic); the LSP holds the
      whole-line rule; an LD/FBD push asserts what reached the IDE; refusals name the whole stated line; an
      unknown language is a keyword diagnostic and the body is read by neither reader.
- [x] 1.8 Data-lens review round 2, as red tests: a keyword line in a comment opened mid-line or nested is no
      boundary, and `(*` in a line comment or string opens nothing (C# + LSP); the pre-change unsupported shape
      (retired comment, then the marker line) is refused naming `volt pull`; code added under or after a marker line
      is refused by name; a member's `%FOLDER` follows its marker line and round-trips; a second keyword line in a
      body is refused by name (C#) and a diagnostic (LSP); `IMPLEMENTATION` is reserved in every naming position
      (method-local VAR, method/action/property name, POU name, enum value, struct member).

## 2. Engine

- [x] 2.1 `ImplementationMarker`: the keyword, the line regex, `For(language)`; `IMPLEMENTATION` in the reserved-name
      set.
- [x] 2.2 StReader, StWriter, the network-text reader, gate and `NetworkText.LanguageOf`, and every driver or engine
      site that asks "is this body graphical?", read the stated language and nothing else.
- [x] 2.3 `LibraryManifest.Materialization` goes from 3 to 4.
- [ ] 2.4 Every C# fixture and golden rewritten (mechanical); all C# suites green.
      Fixtures and goldens are rewritten and every C# suite is green except the four corpus-backed
      `ModelRoundTripOracleTests`, which read `volt-lsp-iec/test-corpus`: the corpora still carry the retired comment,
      so they read as pre-change files ("pull once") and the oracle finds no bodies. They go green with 4.2's re-pull.
      `bun run check`'s materialization-parity row is red for the same cross-section reason (C# writes 4, the LSP
      still reads 3); it goes green with 3.1.
      Section-2 review round 1 (data lens), fixed with tests: a marker body is the WHOLE body (`BodyMarker.Is` is no
      longer a prefix test), so code under a marker line stated `IMPLEMENTATION ST` is refused instead of dropped and
      an ST body opening with a marker-spelled comment pulls as ST and pushes back; a marker under a stated language
      is refused; a keyword-shaped line in any declaration (GVL, DUT, interface, a name alone on its line) is refused
      as reserved; the retired comment is refused only where it stands as a boundary (directly above a marker line).
      Section-2 review round 2 (data lens), fixed with tests: the retired-comment check walks up over `%FOLDER` too
      (the old member shape: comment, `%FOLDER`, marker), and a `%FOLDER` line anywhere in a declaration is refused
      by name; `%FOLDER` is peeled only at its place (the first line under a member's boundary, the last line of a
      property's or an interface member's declaration — the latter used to be pushed into the IDE as code); the
      keyword line outranks a marker-spelled declaration comment as the boundary, and a marker body's line is the
      last one; two keyword-shaped lines in one region are refused naming both; `OpensNetwork` no longer calls ST
      that names a variable `network` network text.

## 2b. Read-only bodies state their language (owner decision 2026-09-28)

The `(* @volt-graphical: <what> *)` comment goes too: no `(* @volt-… *)` comment survives in a workspace file.

- [x] 2b.1 Red first: a CFC/SFC/IL body pulls as `IMPLEMENTATION CFC|SFC|IL` with an empty body; an LD/FBD body
      network text cannot represent pulls as `IMPLEMENTATION LD|FBD UNSUPPORTED` with an empty body and the reason in
      the pull message (naming the item); each pushes back unchanged as a no-op; code under either is refused by name;
      `%FOLDER` follows the keyword line; a pushed file holding any `(* @volt-… *)` comment is refused naming
      `volt pull`.
      `sync/ReadOnlyBodyTests.cs` (pull, fetch reasons, no-op push back, code under/after the line, UNSUPPORTED only
      after LD/FBD, `%FOLDER`, any `(* @volt-… *)` comment refused — a string or `//` comment is no comment);
      `ImplementationKeywordTests` (line recognition, one spelling, round trip); CLI `PullCommandTests`/`InitCommandTests`.
- [x] 2b.2 `ImplementationMarker` learns the read-only forms; the body-marker writer/reader (`BodyMarker`,
      `BodyFormatGuard`, the unsupported-body routing, section-1 tests 1.7/1.8 that pinned the comment) move to them;
      the `@volt-graphical` spelling is deleted from the engine.
      `BodyMarker` is deleted (its file keeps `UnrepresentableBodyException`, whose `Marker` is now `Reason`). A
      read-only body is its canonical line in memory (`IsReadOnlyBody`); the reason rides `ItemContent`/`Member`/
      `Accessor.Unsupported`, set only by the drivers. The keyword's SHAPE now takes anything after a word
      (`IMPLEMENTATION CFC x := 1;` is refused naming the line, not as a reserved name) — the LSP mirrors that in 3.1.
      An unknown CODESYS body aspect is refused by name instead of becoming a marker naming the type. The Execute-box
      reason is one wording on both vendors (`BoxRefusals.UnreadableExecuteMarker`, was `EXECUTE`). The round-1 rule
      "an ST body opening with a marker-spelled comment pushes back" is reversed by the owner's decision: any
      `(* @volt-… *)` comment is refused, so an IDE body that itself holds one pulls and cannot be pushed until the
      comment is edited in the IDE (no data is lost; the push writes nothing).
- [x] 2b.3 The CLI pull message names every `UNSUPPORTED` item and its reason (the reason no longer lives in the
      file). All C# suites green.
      The wire carries `FetchedItem.unsupported` ({member, language, reason}); `volt pull` (ok and conflict) and
      `volt init` name each body by file and member. Green except, as before, the four corpus-backed
      `ModelRoundTripOracleTests` (4.2's re-pull).
      Section-2b review round (data lens), fixed with tests: a read-only line on a member NEW to an existing POU (added,
      renamed, or retyped — which deletes and recreates it) is held to the create rule and refused naming the member,
      before anything is deleted (it used to delete the diagram and create an empty ST member); an IDE item that
      itself holds a `(* @volt-… *)` comment is refused on pull naming the comment (listed unreadable, the file left
      alone) instead of pulled into a file every push refuses; an ST body the IDE holds with a keyword-shaped line
      outside comments is refused by the driver (`ImplementationMarker.RequireStBody`, both vendors and FakeIde)
      instead of pulled as the language the line states; TwinCAT refuses an NWL archive with no `DefaultViewMode`
      (was pulled as `IMPLEMENTATION IL`) and an unknown graphical XML root (was pulled as ST text), as CODESYS does.
      Section-2b review round 2 (data lens), fixed with tests: a read-only line stating a different language than the
      read-only body the IDE holds (`IMPLEMENTATION SFC` over CFC, `LD UNSUPPORTED` → `FBD UNSUPPORTED`, → `IL`, at
      item and member level) is refused naming both lines (`BodyFormatGuard` compared only the shape and pushed it as a
      no-op, leaving the file and baseline mislabelled); a `(* @volt-… *)` comment NESTED inside another comment is
      refused on push and on pull like an outermost one (`StTrivia.CommentOpenings` lists nested openings).

## 3. LSP and editor

- [x] 3.1 One LSP module for the keyword and line regex (the read-only forms included; the `@volt-graphical` comment gone); `bodies.ts`, the network-text parser, semantic tokens,
      folding, diagnostics, `mark-implementations.ts` and `record-language.ts` use it and pick the body's reader from
      the stated language.
      `src/syntax/implementation-keyword.ts` holds the spelling (the bridge's two patterns, `statementOf`,
      `implementationLine`) and `splitImplementation`, which every POU body goes through (`util.codeBody`): the line
      (and a member's `%FOLDER` under it) is taken OUT of `BodySpan.tokens` and kept as `BodySpan.implementation`, so
      the ST parser, the network parser and `fixture-units` read the code alone. The line is the body's first
      significant token opening a whole line of the keyword's shape (comments are their own tokens, nested ones
      included). `bodyReader`/`isGraphicalBody`/`isStBody` read the stated language only; every ST consumer (parse
      errors, symbol bodies, folding, selection, lowering, the scripts) asks `isStBody`, so a read-only body is read by
      neither. Reported as parse errors on the line: no language, one no body can state (anything after it, UNSUPPORTED
      after ST/CFC/SFC/IL), code under a read-only line, network text under `ST`, a second line in a body; every other
      `IMPLEMENTATION` identifier is reserved (`reportReservedNames`). Deleted as dead: `bodyForm`, the v1 first-line
      detection behind the bare comment, `BARE_/GRAPHICAL_MARKER_LINE`, `bodyText`, the FB parser's `NETWORK` sniff
      that let `END_METHOD` close a function block. The `@volt-graphical` hover is `readOnlyBodyHover` on the line.
      `MATERIALIZATION_FORMATS` gains row 4; under a materialization mismatch the bodies that state no language are
      quiet (a format-3 ladder is ST to this server) and the manifest names the re-pull. A body with NO line is still
      read as ST: the LSP also reads hand-written fixture ST and the library repo, which carry none; a workspace file
      without it is the push's to refuse. Proved by `syntax/implementation-keyword.test.ts`,
      `services/structure/implementation-keyword-structure.test.ts`, `server/implementation-keyword-diagnostics.test.ts`,
      `server.test.ts` (format 3 told once, bodies quiet), `network.test.ts` (read-only hover),
      `mark-implementations.test.ts`. Two section-1 tests were superseded by 2b and rewritten to it: CFC/SFC/IL are
      read-only languages, not unknown ones (the unknown-language test now uses `XYZ`, `ST UNSUPPORTED`,
      `CFC UNSUPPORTED`; code under a read-only line has its own test), and the read-only file uses the keyword lines
      and CALLS its members (CODESYS compiles only what is used, so an uncalled member drew nothing whatever its line).
- [x] 3.2 volt-vscode TextMate: `IMPLEMENTATION` and `ST`/`LD`/`FBD` highlighted as keywords, with a grammar test.
      `syntax.tmLanguage.json` `#implementation-line` (whole line; the read-only forms too; UNSUPPORTED only after
      LD/FBD; after `#comments`), `src/implementation-line-grammar.test.ts`.
- [x] 3.3 Conformance fixtures and LSP tests rewritten; `bun typecheck` and `bun test` green.
      Graphical fixtures and every LSP test spell `IMPLEMENTATION LD|FBD`; ST fixtures gain `IMPLEMENTATION ST` at push
      (`markImplementations`); `corpus.test.ts` classifies bodies by the stated language (it sniffed `NETWORK`). Green
      except the three corpus-backed `corpus.test.ts` rows (ST materialization, graphical networks, lowering REACH):
      the corpora still carry the retired comment (34 files hold a graphical one), so their ladders read as ST. They go
      green with 4.2's re-pull, like the four C# `ModelRoundTripOracleTests`. `bun run check` is green (materialization
      parity 4 = 4). The LSP's own `README.md`/`docs/` mentions of the retired comment are left for 4.3.
      Section-3 review round (data lens), fixed with tests: the formatter (Format Document / Format Selection) printed a
      body from its tokens alone and so deleted every `IMPLEMENTATION` line and every member's `%FOLDER` — it now prints
      both from the AST (`ImplementationLine.folder`), keeps any non-ST body verbatim, and both round-trip gates
      (`format.test.ts`, `corpus.test.ts`) compare the line and the folder; `%FOLDER` is read exactly where the push
      peels it (the line directly under a METHOD's or ACTION's line, `%FOLDER ` in that case, with a path) and nowhere
      else, so a directive the push would write into the IDE as code is an ST error (the statement parser's silent
      `%FOLDER` skip is deleted); a `(* @volt-… *)` comment is a parse error naming `volt pull`, as the push refuses it,
      and with no manifest to name the re-pull, the line-less body it stands in is quiet but for that finding.
      That finding makes the pre-change corpora report themselves: four more corpus-backed `corpus.test.ts` rows (zero
      declaration errors, formatter round-trip, AMBIGUOUS NAMES, REFUSAL REACH — the last two are built from the files
      that parse clean) are red for the same reason as the three above, and go green with 4.2's re-pull.

## 4. Data and docs

- [ ] 4.1 e2e bodies rewritten; e2e green on CODESYS and TwinCAT (Project14; Project13 is usable again).
- [ ] 4.2 Re-pull the six corpora; `corpus.test.ts` and build-conformance give the same result as before.
- [ ] 4.3 Docs: `network-text.html`, `items.html` (regenerate with `VOLT_WRITE_DOCS=1`), `cli.html`, the scaffold
      doc, DIALECT/ARCHITECTURE mentions, and CLAUDE.md if it names the marker. `git grep volt-implementation`
      finds nothing outside `openspec/changes/archive`.
- [ ] 4.4 Final review (spec and layering), fix, archive, delete the recreated `openspec/specs/`.
