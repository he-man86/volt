## Why

The declaration/implementation boundary in a workspace file is the comment `(* @volt-implementation *)`, or
`(* @volt-implementation LD|FBD *)` for a graphical body. It works: it replaced an inference that broke on trailing
comments, wrapped `EXTENDS`/`IMPLEMENTS` and `{IF}` pragmas (b50b298a80). But it reads as tooling noise, an `@volt`
tag in a comment that every engineer has to have explained. The owner's call (2026-09-28): a **keyword** that reads
like the rest of ST and needs no explanation, and that states every body's language, ST included.

```
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bStart : BOOL;
END_VAR
IMPLEMENTATION ST
bRun := bStart AND NOT bStop;
END_FUNCTION_BLOCK

METHOD Reset
IMPLEMENTATION LD
NETWORK
...
END_METHOD
```

Accepted trade-off: `IMPLEMENTATION` is not IEC 61131-3, so a workspace file is no longer valid ST to a third-party
tool. Push strips the line, so the IDE never sees it, and the LSP and the VS Code grammar are Volt's own. There are
no users yet, so there is NO backward compatibility: no translator and no migration note.

## What Changes

- **The boundary is `IMPLEMENTATION <LANG>`**, alone on its line, exactly where the comment marker stands today, on
  exactly the items `ImplementationMarker.AppliesTo` covers (POU, method, action, property getter and setter). One
  keyword for every kind; the header already names the kind.
- **Every body states its language**: `ST`, `LD` or `FBD`, always. ST is no longer the unstated default.
- **The language is the one signal for how a body is read.** `ST` goes to the ST reader; `LD`/`FBD` go to network
  text. Anything that today decides "is this body graphical?" by other means (the comment's language, the first line,
  content sniffing) reads the keyword instead, in both the engine and the LSP. A body whose text contradicts its
  stated language is refused by name, never re-read as the other.
- **A missing or unknown language is refused by name** on push, and is an LSP diagnostic. It is never guessed.
- **Matched as a whole line.** Only a line holding exactly `IMPLEMENTATION <LANG>` (spacing free, case-insensitive as
  ST keywords are) is the boundary. `IMPLEMENTATION` joins the reserved-name set, so no workspace identifier can take
  it.
- **One definition per runtime.** `ImplementationMarker` (C#) is the only place the spelling lives on the bridge
  side; the LSP mirrors it in one module. The writer, reader, network-text reader and gate, the LSP body splitter,
  semantic tokens, folding and the TextMate grammar all use it.
- **The comment is gone, not tolerated.** A file carrying `(* @volt-implementation *)` has no boundary line and is
  refused by the existing rule ("pull the project once"). `MATERIALIZATION` goes from 3 to 4.
- **Our own data moves:** the six corpora are re-pulled; e2e bodies, conformance fixtures, C# fixtures and goldens
  are rewritten; the docs (`network-text.html`, `items.html`, `cli.html`, the scaffolded workspace doc) follow.

## Non-goals

- No change to WHERE the boundary goes or which items carry one.
- No change to network text beyond where its language is read from.

## Impact

- `packages/volt-cli/src/Volt.Engine/Format/St/{ImplementationMarker,StReader,StWriter}.cs`,
  `Format/Network/{NetworkText,NetworkTextReader,NetworkTextGate,NetworkScope}.cs`, `Library/LibraryManifest.cs`,
  and the drivers wherever they ask whether a body is graphical.
- `packages/volt-lsp-iec/src/syntax/*`, `src/network-text/*`, `src/network/*`, `src/services/structure/*`,
  `src/server/*`, `test/conformance/support/mark-implementations.ts`, `scripts/record-language.ts`.
- `packages/volt-vscode/languages/structured-text/*.tmLanguage.json`.
- Tests: about 50 C# test files and fixtures, 16 e2e graphical tests, the conformance fixtures, and the six corpora
  (about 457 files).
