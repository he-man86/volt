## Decision

One per-document boundary in `DiagnosticsPublisher.compute`: a throw becomes one `not-analysed` error for that document,
as a throwing parse or bind already does. Deep input itself stays unanalysable; its generation moves to
`volt-cli-rework`'s LSP fuzz task.

## Options considered

| Option | Verdict |
|---|---|
| A. Iterative walks of every left-deep pass, a parser depth guard with a new `nesting-too-deep` code, a per-check catch giving `check-failed` | Rejected (below). |
| **B. One catch per document in the publisher, existing `not-analysed`** | **Chosen** |
| C. B plus an iterative flat-chain walk in inference | Deferred: only if the fuzz suite or a field case measures a real flat chain near the limit. |

## Measurements

- Limits on Node 24 (src bundled for node): parentheses 3000, nested `IF` 1500, flat `+`/`OR` 5000. Bun's stack is
  larger.
- Corpus maxima over 26451 files: parentheses 7 (bakon-nano), statement nesting 8 (pro2193), binary chain 29
  (bakon-nano), unary chain 1. Every limit is at least ~140x above real code.
- Nested input overflows inside the shared lazy body parse, which caches nothing on a throw, so ~45 checks re-throw;
  the flat chain overflows in 6 checks through inference.
- Server: `compute` → `documentDiagnostics` has no catch; `workspaceReport` maps every URI; `workspaceDiagnostics: true`
  (`server.ts:62`). One throw fails the request for the whole workspace. The parse/bind quarantine (`not-analysed`)
  covers parse and bind only.

## Cut, and the rule that cut it

- **The parser depth guard and `nesting-too-deep`.** An LSP-only error CODESYS was never measured to give, for input
  ~140x deeper than real code. Rules: measured cases only; LSP parity (an LSP-only message is a false positive).
- **The per-check `check-failed` catch in `runRegistry`.** For nested input the throw comes from the shared body parse,
  so one item would get ~45 `check-failed` errors and 45 re-parses. A fallback layer at the wrong granularity. Rule: no
  fallbacks; the per-document boundary covers a bug in any check.
- **Iterative rewrite of every recursive pass.** No real flat chain near 3000. Rule: measured cases only.
- **The 20000-depth tests and the census.** They belong to the fuzz suite (`volt-cli-rework` task 30); the corpus
  measurement is answered above.
- **"PLC Assist must find a new way to crash a check".** `computeDiagnostics` keeps throwing; PLC Assist adapts to Volt
  and needs nothing.

## Protocol

None: LSP only, no bridge wire.
