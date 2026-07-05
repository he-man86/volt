## Why

Now that `st-body-ast` gives every ST body a real statement/expression tree, the diagnostics can finally see *types through expressions*. Today the type checks are token-pattern heuristics that infer a type only for a single identifier or literal and **bail on any `.`, call, or nested expression** (`check-assignment-types` `classifyRhs`, `check-binary-operators`, `check-conversion`); there is **no call-argument type checking at all**, and the one diagnostic the CODESYS compiler emits that we don't — the LREAL→REAL narrowing warning — is unreachable without expression types. This change adds the **type-inference engine** over the tree and deepens the checks onto it, closing the accuracy gap while holding the zero-false-positive invariant on all four corpora.

## What Changes

- **New: an expression type-inference walker** — `inferExprType(expr, scope, project) → InferredType`, walking the `st-body-ast` `Expr` tree bottom-up. Reuses the existing `type-resolver.ts` (named type → kind + scope) and symbol table; adds elementary-type propagation (width/signedness for the integer family, REAL vs LREAL, STRING/WSTRING, TIME), member-access typing (`a.b` → resolve `a`'s type's scope, look up `b`), index/deref typing, call-return typing, and IEC binary-operator result typing. Conservative: anything unresolvable infers `unknown`, and `unknown` **always skips** the check (no new false positives).
- **Deepen the existing type checks onto the walker** — migrate `check-assignment-types` / `check-binary-operators` / `check-conversion` from the flat token scan to the tree + inference, removing their bail-on-member-access limitation. Behavior-preserving or strictly-improving, ratchet-guarded.
- **New: call-argument checking** — validate a call against the callee signature: argument count, positional/named argument types, and named-parameter names. First coverage of this class (today only VG `vg-unknown-pin` exists).
- **New: narrowing-conversion diagnostic** — the LREAL→REAL / loss-of-precision warning the compiler emits (bakon: 27), opt-in, matching the compiler.
- **Out of scope (separate changes)**: member-chain *navigation* (go-to-def/hover/completion — `st-nav-chains`); the structural formatter/pretty-printer (`st-format`); the `S=` set-assignment grammar gap (harden 8.2); full IEC generics resolution beyond what the corpus needs; the interpreter (`st-interpreter`).

## Capabilities

### New Capabilities
- (none — internal analyzer engine under the existing `language-server` capability)

### Modified Capabilities
- `language-server`: add requirements that ST expressions are type-inferred over the body AST, that the type-aware diagnostics (assignment / binary-operator / conversion) resolve through member/index/call expressions rather than bailing, that call arguments are checked against the callee signature, and that an opt-in narrowing-conversion diagnostic exists — all with **no regression** to the corpus precision/coverage ratchet (zero new false positives on built objects).

## Impact

- **Depends on `st-body-ast`** (archived/landed) — walks its `Expr`/`Statement` tree via `BodyModel.statements`.
- **Code (volt-lsp-iec):** new `src/semantic/type-infer.ts` (the walker + `InferredType` model, building on `type-resolver.ts`); rewrites of `check-assignment-types.ts` / `check-binary-operators.ts` / `check-conversion.ts` onto it; a new `check-call-arguments.ts`; a new opt-in `check-narrowing-conversion.ts`; config wiring in `lsp/config`.
- **Tests:** unit tests per inference rule + per diagnostic; the `real-corpus.test.ts` ratchet is the gate — precision floors (pro2193 3, bakon 10, awa 0, lenze 0) must not rise, and any new diagnostic must be validated against the `lsp-vs-compiler.ts` oracle before its floor is set.
- **No wire/bridge/protocol impact.** Analyzer-internal.
- **Unlocks:** member-chain nav (`st-nav-chains`) and, longer-term, shares its type model with the interpreter.
