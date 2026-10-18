> Standalone, `packages/volt-lsp-iec` only. No bridge wire and no protocol number. Deep-input generation belongs to
> `volt-cli-rework`'s LSP size-and-fuzz task (`tasks.md:30`).

## Why

PLC Assist's unit test "a check that crashes lets the write through" (2026-10-18) made `volt-lsp-iec` throw
`RangeError: Maximum call stack size exceeded` on an item with 5000 nested parentheses. Reproduced on Node 24 with the
calls PLC Assist makes (`parseDocument` → `buildSymbolTable` → `computeDiagnostics`):

| Input in a body | Fine at | Throws at | Recursion |
|---|---|---|---|
| nested parentheses | 2000 | 3000 | parser (`parseBinary` … `punctOperand` → `parseAssignable`) |
| nested `IF` | 1000 | 1500 | parser (`parseIf` → `parseIfBranch` → `parseStatementList`) |
| flat `1 + 1 + …` / flat `OR` | 3000 | 5000 | inference (`inferExprType` ↔ `binaryResultType`) |

Real code is far below every limit. Across the six corpora (26451 files) the deepest parenthesis nesting is 7, the
deepest statement nesting 8, the longest binary chain 29 and the longest unary chain 1. The only trigger is the
synthetic test.

The measured defect is in Volt's own server, which the throw takes down beyond the one file:

- `DiagnosticsPublisher.compute` (`src/server/diagnostics-publisher.ts`) calls `documentDiagnostics` with no boundary,
  and `workspaceReport` maps every URI through it. One throwing document fails the whole `workspace/diagnostic` request:
  every file in the editor loses its diagnostics, on every re-pull, since nothing is cached on a throw.
- The same publisher already has that boundary for a parse or bind that throws: the document is quarantined and reports
  one `not-analysed` error. A throw while computing diagnostics has none.

## What Changes

- **One boundary per document in the publisher.** `compute` catches a throw from `documentDiagnostics`, logs it as the
  bind quarantine does, and returns one `not-analysed` error for that document, with a message that says its findings
  could not be computed (the existing message says its declarations are left out, which is not true here). The result is
  cached for the generation like any other, and the workspace report keeps serving every other document.
- `computeDiagnostics` keeps throwing for library callers: loud, and PLC Assist's fail-open on a throw is its own
  policy. Its crash test keeps working unchanged.
- No depth guard, no new diagnostic code, no iterative rewrite: nothing real reaches the limits.

## Impact

- `packages/volt-lsp-iec/src/server/diagnostics-publisher.ts`, one test.
- Republish of the `volt-lsp-iec` bundle for PLC Assist: the owner's step.
