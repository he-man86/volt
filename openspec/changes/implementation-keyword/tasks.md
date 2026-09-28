Loop (sized to a medium change, per the 2026-09-27 workflow analysis): implement each section test-first; ONE
review round per section with the **data** lens (can a file lose, misplace or mislabel its body?); fix; commit. A
second round runs only if the first found a high or medium finding. One final review covers the whole change with
the **spec** and **layering** lenses.

## 1. Tests red

- [ ] 1.1 C#: `ImplementationMarker` recognises `IMPLEMENTATION ST`, `IMPLEMENTATION LD`, `IMPLEMENTATION FBD`
      (spacing, case); it rejects the old comment, a bare `IMPLEMENTATION`, an unknown language, `IMPLEMENTATION ST;`,
      trailing tokens, and the word inside a statement.
- [ ] 1.2 C#: StWriter writes `IMPLEMENTATION <LANG>` for every kind `AppliesTo` covers (POU, method, action, getter,
      setter); StReader splits on it, including the three historical traps (a trailing comment after `END_VAR`, a
      wrapped `EXTENDS`/`IMPLEMENTS`, an `{IF}` pragma).
- [ ] 1.3 C#: the stated language decides the reader: `ST` is read as ST, `LD`/`FBD` as network text. A body that
      contradicts its language (network text under `ST`, ST under `LD`) is refused by name; nothing is written.
- [ ] 1.4 C#: a missing language (`IMPLEMENTATION` alone) is refused by name, naming the item.
- [ ] 1.5 C#: a file carrying only the old comment is refused with the existing "pull the project once" message.
- [ ] 1.6 LSP: body splitting and language selection from the keyword, the missing/contradicting-language
      diagnostic, the semantic token, folding.

## 2. Engine

- [ ] 2.1 `ImplementationMarker`: the keyword, the line regex, `For(language)`; `IMPLEMENTATION` in the reserved-name
      set.
- [ ] 2.2 StReader, StWriter, the network-text reader, gate and `NetworkText.LanguageOf`, and every driver or engine
      site that asks "is this body graphical?", read the stated language and nothing else.
- [ ] 2.3 `LibraryManifest.Materialization` goes from 3 to 4.
- [ ] 2.4 Every C# fixture and golden rewritten (mechanical); all C# suites green.

## 3. LSP and editor

- [ ] 3.1 One LSP module for the keyword and line regex; `bodies.ts`, the network-text parser, semantic tokens,
      folding, diagnostics, `mark-implementations.ts` and `record-language.ts` use it and pick the body's reader from
      the stated language.
- [ ] 3.2 volt-vscode TextMate: `IMPLEMENTATION` and `ST`/`LD`/`FBD` highlighted as keywords, with a grammar test.
- [ ] 3.3 Conformance fixtures and LSP tests rewritten; `bun typecheck` and `bun test` green.

## 4. Data and docs

- [ ] 4.1 e2e bodies rewritten; e2e green on CODESYS and TwinCAT (Project14; Project13 is usable again).
- [ ] 4.2 Re-pull the six corpora; `corpus.test.ts` and build-conformance give the same result as before.
- [ ] 4.3 Docs: `network-text.html`, `items.html` (regenerate with `VOLT_WRITE_DOCS=1`), `cli.html`, the scaffold
      doc, DIALECT/ARCHITECTURE mentions, and CLAUDE.md if it names the marker. `git grep volt-implementation`
      finds nothing outside `openspec/changes/archive`.
- [ ] 4.4 Final review (spec and layering), fix, archive, delete the recreated `openspec/specs/`.
