# LSP analysis as a library — the diagnostics engine without the server

## Why

`@volt/lsp-iec` is two things in one package: a pure analysis engine (`syntax` → `symbols` → `types` →
`analysis`, no I/O) and an LSP server over it (`server/`, `workspace-refs.ts`: `node:stream`, file watching,
`vscode-languageserver-protocol/node`). The root barrel exports both, so a consumer that only wants diagnostics
for a set of files in memory drags in a server, Node streams and a protocol stack it will never start.

That consumer now exists: a hosted tool that validates AI-written ST against the whole project before pushing it
to the IDE, running server-side with the project held in memory, never on disk. It wants exactly
`parse` + `buildSymbolTable` + `computeSemanticDiagnostics` and nothing above them.

## What this change is

1. **A subpath export, `@volt/lsp-iec/analysis`**: the layers up to and including `analysis` (plus
   `network-text`, which the parser routes `NETWORK` bodies to). No `node:` import, no protocol dependency.
   `check-layering.ts` gains the rule that nothing under that surface imports `server/` or `node:*`, so it
   stays true.
2. **A versioned, published build** of the package, so a consumer outside the monorepo pins a version instead of
   copying `dist/`. Where it is published is below (open question).

## What this is not

- **Not a new API.** The functions exist and are what the server and the conformance replay already call.
  This change draws a boundary around them; it does not add a facade.
- **Not a behaviour change.** Same checks, same vendor tables, same zero-false-positive ERROR invariant.
- **Not product coupling.** Volt ships a library; who calls it is not Volt's business.

## Open question

Publish where? npm under a scope, or GitHub Packages (private). Either works for the consumer; npm is the
default unless the package should stay private.
