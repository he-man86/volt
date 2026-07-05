## Why

The LSP's type analysis is a **name-string checker**: a type is `{kind, name}` with no range, no bounds, no
member detail; assignability is `isAssignable(lhs: string, rhs: string)`; there is no constant evaluation. That
ceiling is exactly why a whole cluster of compiler diagnostics is impossible today — subrange violations,
literal overflow, array-index bounds, `REAL_TO_INT` range, string truncation, enum-range. Each would be a
bespoke check bolted on.

A professional typechecker isn't N checks — it is a **rich type model + constant evaluation + one
assignability relation, applied systematically**. Reframing the diagnostic backlog (`coverage-matrix.md`, ~23
gaps) as *completing a static typechecker on the treewalker* turns most of those gaps into consequences of
modelling the type system once. The engine is already the LSP's shared core — diagnostics, hover, completion,
signature-help, and member-chain nav all call `inferExprType` — so enriching it improves every feature at once.

This is the compiler's **analysis frontend** (name resolution + inference + type-rule checking), NOT a compiler
(no IR, optimization, codegen, linking). The IDE stays the build/run authority; we calibrate the typechecker's
verdicts + wording to it byte-for-byte via the existing record→oracle loop.

## Capabilities

### New Capabilities

- **Rich `Type` model** — types carry the facts checks need: elementary **range** (from doc 06), **subrange**
  bounds, **array** dims, **string** `maxLen`, **enum** members, plus the existing struct/FB member scope.
- **Constant evaluation** (`evalConst`) — fold literals and constant expressions to values, enabling every
  range/bounds/overflow rule.
- **Unified assignability** (`assignable(src, srcConst?, dst)`) — one relation over the rich model, applied at
  every type context (assignment, init, argument, return, array index, CASE label). Closes the
  overflow/subrange/bounds/narrowing/string/enum cluster at once.
- **Type-declaration validation pass** — structural DUT/type-expression rules (`POINTER TO BIT`, ENUM/STRUCT
  member counts, nested `AT`, `__VECTOR`).
- **Declaration-context validation pass** — VAR-section placement + modifiers per POU kind.

### Modified Capabilities

- **`language-server` diagnostics** — the existing conversion / assignment / binary / narrowing / call-argument
  checks migrate from ad-hoc name-string comparisons onto the one `assignable` relation (behaviour-preserving,
  guarded by their fixtures + the corpus), so they share a single, testable type lattice.

## Impact

- `packages/volt-lsp-iec/src/semantic/type-infer.ts` (enriched `Type` model), a new `const-eval.ts` and
  `assignable.ts`, and the 7 `checks/check-*.ts` that do type comparison (routed through `assignable`).
- No wire/protocol change; no consumer API change (`inferExprType` stays the entry point, richer return).
- Definition of done tracked in `src/tests/conformance/coverage-matrix.md` (the ST Static Typechecker matrix):
  every in-scope row ✅ against the oracle + `lsp-vs-compiler.ts` empty on all 4 corpora.
