Loop (sized to a medium change, per the 2026-09-27 workflow analysis): implement each section test-first; ONE
review round per section with the **data** lens (can a file lose or misplace its body?); fix; commit. One final
review over the whole change with the **spec** + **layering** lenses. Stop a section when its round has no
high/medium finding.

## 1. Tests red

- [ ] 1.1 C#: `ImplementationMarker` recognises `IMPLEMENTATION`, `IMPLEMENTATION LD`, `IMPLEMENTATION FBD` (spacing,
      case); rejects the old comment, `IMPLEMENTATION;`, `IMPLEMENTATION x`, and the word inside a statement.
- [ ] 1.2 C#: StWriter writes the keyword line; StReader splits on it for every kind `AppliesTo` covers, including
      the three historical traps (trailing comment after `END_VAR`, wrapped `EXTENDS`/`IMPLEMENTS`, `{IF}` pragma).
- [ ] 1.3 C#: a body whose code uses an identifier `implementation` (`implementation := 1;`, `x := implementation;`)
      round-trips unchanged.
- [ ] 1.4 C#: a file carrying only the old comment is refused with the existing "pull the project once" message.
- [ ] 1.5 LSP: body splitting, network-text language detection, semantic token for the keyword, folding.

## 2. Engine

- [ ] 2.1 `ImplementationMarker`: the keyword spelling and line regex; `For(language)` → `IMPLEMENTATION LD`.
- [ ] 2.2 Network text reader/gate/`NetworkText.LanguageOf` read the keyword line; nothing else changes there.
- [ ] 2.3 `LibraryManifest.Materialization` 3 → 4.
- [ ] 2.4 Every C# test fixture/golden rewritten (mechanical: the old line → the keyword line), suites green.

## 3. LSP and editor

- [ ] 3.1 One LSP constant/regex for the line; `bodies.ts`, the network-text parser, semantic tokens, folding,
      `mark-implementations.ts`, `record-language.ts` use it.
- [ ] 3.2 volt-vscode TextMate: `IMPLEMENTATION` (+ `LD`/`FBD`) highlighted as a keyword; grammar test.
- [ ] 3.3 Conformance fixtures and LSP tests rewritten; `bun test` green.

## 4. Data and docs

- [ ] 4.1 e2e bodies rewritten; e2e green on CODESYS and TwinCAT (Project14).
- [ ] 4.2 Re-pull the six corpora (CODESYS via `ide.ps1`; TwinCAT Project14); `corpus.test.ts` and build-conformance
      unchanged in result.
- [ ] 4.3 Docs: `network-text.html`, `items.html` (regenerate, `VOLT_WRITE_DOCS=1`), `cli.html`, scaffold doc,
      DIALECT/ARCHITECTURE mentions; `git grep volt-implementation` → zero outside the archive.
- [ ] 4.4 Final review (spec + layering), fix, archive, delete the recreated `openspec/specs/`.
