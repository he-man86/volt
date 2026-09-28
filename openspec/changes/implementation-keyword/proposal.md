## Why

The declaration/implementation boundary in a workspace file is the comment `(* @volt-implementation *)` — and
`(* @volt-implementation LD|FBD *)` for a graphical body. It works (it replaced an inference that broke on trailing
comments, wrapped `EXTENDS`/`IMPLEMENTS` and `{IF}` pragmas — b50b298a80), but it reads as tooling noise: an `@volt`
tag in a comment that every engineer has to have explained. The owner's call (2026-09-28): a **keyword** that
reads like the rest of ST and needs no explanation.

```
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bStart : BOOL;
END_VAR
IMPLEMENTATION
bRun := bStart AND NOT bStop;
END_FUNCTION_BLOCK

METHOD Reset
IMPLEMENTATION LD
NETWORK
...
```

Accepted trade-off: `IMPLEMENTATION` is not IEC 61131-3, so a workspace file is no longer valid ST to a third-party
tool. That costs nothing that matters: push strips the line (the IDE never sees it), and the LSP and the VS Code
grammar are Volt's own. There are no users yet, so there is no migration either.

## What Changes

- **The marker is a keyword line.** `IMPLEMENTATION` alone on its line, or `IMPLEMENTATION LD` /
  `IMPLEMENTATION FBD` for a graphical body. Same position, same rules as today's comment: one per body that has an
  implementation (POU, method, action, property accessor — `ImplementationMarker.AppliesTo`, unchanged), none on a
  GVL, DUT or interface.
- **Matched as a whole line, never as a word.** Only a line holding exactly `IMPLEMENTATION` [+ `LD`|`FBD`] (spacing
  free, case-insensitive as ST keywords are) is the boundary. A variable or FB that happens to be named
  `implementation` elsewhere is untouched: a bare identifier alone on a line is not a valid ST statement, so the
  line form cannot collide with real code.
- **One definition.** `ImplementationMarker` (C#) stays the only place the spelling lives; the LSP mirrors it in
  one place too. Writer, reader, network-text reader/gate, the LSP's body splitter, semantic tokens/highlighting and
  the TextMate grammar all use it.
- **The old comment is not read.** A file with `(* @volt-implementation *)` has no boundary line and is refused by the
  existing rule ("pull the project once"). No translator — there are no users. `MATERIALIZATION` 3 → 4.
- **Our own data moves:** the six corpora re-pulled, the e2e bodies, conformance fixtures, C# fixtures and goldens
  rewritten, the docs (`network-text.html`, `items.html`, `cli.html`, the scaffolded workspace doc).

## Non-goals

- No change to WHERE the boundary goes or which items carry one.
- No per-kind keywords (`BEGIN_FUNCTION_BLOCK`…): one keyword, the header already names the kind.

## Impact

- `packages/volt-cli/src/Volt.Engine/Format/St/{ImplementationMarker,StReader,StWriter}.cs`,
  `Format/Network/{NetworkText,NetworkTextReader,NetworkTextGate}.cs`, `Library/LibraryManifest.cs`.
- `packages/volt-lsp-iec/src/syntax/bodies.ts`, `src/network-text/*`, `src/network/*`, `src/services/structure/*`,
  `src/server/*`, `test/conformance/support/mark-implementations.ts`, `scripts/record-language.ts`.
- `packages/volt-vscode/languages/structured-text/*.tmLanguage.json` (keyword highlighting).
- Tests: ~50 C# test files and fixtures, 16 e2e graphical tests, conformance fixtures; the six corpora (~457 files).
