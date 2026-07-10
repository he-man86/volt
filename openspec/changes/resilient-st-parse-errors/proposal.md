## Why

Statement-level syntax errors (missing `THEN`, missing `;`, a `FOR` with no `:=` initializer, a
misplaced VAR block) are the single biggest remaining gap between the LSP and the live IDE, and today the
LSP's message for them is **wrong or misleading**. Example — a `PROGRAM` whose `IF` is missing `THEN`:

- CODESYS: `'THEN' expected instead of 'x'` — precise, at the offending token.
- Volt LSP: `unterminated program: expected END_PROGRAM` — a *symptom*, anchored on the wrong token.

The root cause is **not** a weak parser. Two facts, measured (not assumed):

1. **The statement parser already produces the right message.** For a well-terminated POU with a missing
   `THEN`, `parseStatements` returns `ok:false` with `firstError: "expected THEN in IF, got identifier 'x'"`
   — then **discards it** (design D3: statement-parse errors are "never surfaced to the user"). The
   unit parser meanwhile captures the body as opaque tokens and only ever reports the outer
   "unterminated" error, so the precise inner error never reaches a diagnostic.
2. **The grammar is complete for real code.** Running `parseStatements` over the whole corpus: **1938 / 1938
   non-empty ST bodies parse with zero errors (100%).** So surfacing statement-parse errors would produce
   **zero false positives** on known-good code today.

Design D3 swallowed these errors when parser completeness was *unproven*, to protect the zero-FP invariant.
That protection is now measurable: a statement-parse error on clean code is a **grammar gap**, and the same
corpus/conformance gate that guards the checks can guard it. This change surfaces statement- and
declaration-level parse errors as diagnostics, upgrades recovery to **resilient (error-tolerant) parsing** so
one mistake yields one precise diagnostic instead of a cascade, and keeps the zero-FP invariant with a
permanent completeness gate.

## What Changes

- **Surface statement-parse errors (gated).** After the unit parse, run `parseStatements` over each
  non-graphical ST body; on `!ok`, emit a diagnostic at the error span. Gate it behind a **zero-FP
  completeness gate**: any statement-parse error on corpus/conformance code fails CI (it is a grammar gap to
  fix, never a shipped FP). Message wording routes through `messages.ts` and maps to the CODESYS catalog code
  (C0006/C0011/C0013/C0015/C0020/C0026/C0027/C0030/C0031/C0189/C0190 …) as metadata.
- **Resilient recovery.** Replace the parser's "return `undefined` → break the whole body" behavior with
  best-practice error-tolerant recovery: on an unexpected/missing token, record ONE diagnostic, synthesize a
  missing node or wrap unexpected tokens in an error node, recover to the construct's synchronization set
  (`;`, statement-starter keywords, block closers), and continue. Bounded blast radius: a missing `THEN`
  produces one diagnostic and still parses the branch body + `END_IF`.
- **Declaration-structure errors too.** Apply the same treatment to the unit/VAR-section parser so the
  "unterminated program", "VAR block keyword expected" (C0212/C0213), and "'…' not allowed in this place"
  (C0173) class become precise rather than cascading — retiring most of the catalog **parser** triage bucket.
- **Completeness gate.** Extend the corpus test + conformance replay to assert zero statement/declaration
  parse errors on clean code, so the grammar can evolve without silently regressing to false positives.

Scope: this change lands the surfacing path, the resilient-recovery upgrade for the statement parser, the
completeness gate, and the first tranche of catalog-mapped messages. Full declaration-parser resilience and
per-code CODESYS wording reconciliation (via the live recorder) are follow-on tasks.

## Capabilities

### Modified Capabilities
- `st-language-server`: adds a requirement that statement- and declaration-level **syntax** errors are
  surfaced as diagnostics with a precise span and message, produced by resilient (error-tolerant) parsing,
  and held to the same zero-false-positive gate as the semantic checks (a parse error on clean corpus/
  conformance code is a defect). Reverses design D3's "never surface statement-parse errors" stance, now that
  grammar completeness is measured and gated. The "IDE stays authoritative for statement *semantics*"
  guarantee is unchanged — this surfaces *syntax* structure the parser already decides, not type/flow
  semantics.

## Impact

- **Code:** `packages/volt-lsp-iec/src/syntax/{statements,expression,cursor}.ts` (resilient recovery),
  `src/syntax/units/*` + `type-decl.ts`/`var-section.ts` (declaration recovery), a new surfacing step in
  `src/analysis` or `src/server/diagnostics.ts`, `src/analysis/messages.ts` (parse-error wording), and the
  catalog `triage:"parser"` entries flip toward `implemented`.
- **Tests:** colocated statement-parse-error tests; the corpus zero-FP gate + conformance replay extended to
  parse errors; the burn-in gains the newly-implemented C-bucket codes.
- **Docs:** `docs/codesys-reference/TRIAGE.md` parser bucket shrinks; the `st-body-ast` design D3 note is
  superseded (recorded, not deleted).
- **No upstream/opencode impact** — purely additive to `volt-lsp-iec`.
