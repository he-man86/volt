## Why

Today `volt-lsp-iec` parses **declarations** into a real AST, but POU **bodies are flat token streams** (`BodySpan.tokens: Token[]`) analyzed by pattern-matching. Every body-facing check and nav query bails the moment it meets a `.` (member access) or a nested expression: `check-assignment-types` inspects only single-token operands and skips anything with a `.`; go-to-definition/hover/completion resolve only the *head* identifier of `a.b.c`, never the member; there is **no call-argument checking at all** (arg count, arg types, named `x := y`); CASE/FOR/WHILE/IF are token-scanned, never structured.

This is the ceiling. Type-aware diagnostics (the narrowing-conversion gap the compiler catches and we don't — harden-lsp-real-project task 8.1), member-chain navigation, and the later typechecker + JS/C transpiler all need one thing first: **a real statement/expression tree for bodies**. That tree is the treewalker.

## What Changes

- **New: an ST body AST** — a statement + expression parser that consumes the already-lexed `BodySpan.tokens` and produces a typed tree (`IfStatement`, `CaseStatement`, `ForStatement`, `WhileStatement`, `RepeatStatement`, `Assignment`, `ExprStatement`, and expression nodes: `BinaryExpr`, `UnaryExpr`, `MemberExpr` (`a.b`), `IndexExpr` (`a[i]`), `DerefExpr` (`p^`), `CallExpr` (positional + named `x := y` args), `Identifier`, `Literal`). Every node carries source `Span`s for LSP coordinate mapping.
- **New: a treewalker** — a visitor over the body AST that existing consumers migrate onto, replacing the flat-token scan in `body.ts` / `identifier-scan.ts`.
- **Parsed body model**: `BodyModel` gains a `statements` tree alongside the existing `identifiers`/`calls`/`st` fields, produced only for `language: "st"` bodies (VG bodies keep their own `vg` model unchanged).
- **Conservative parse recovery**: a body that fails to parse cleanly degrades to the current token-scan behavior (no new parse-error diagnostics, no regressions) — the AST is *additive* until each consumer opts in.
- **Out of scope (future phases, explicitly not this change)**: the typechecker rules that walk the tree for type inference/mismatch (Part B), the narrowing-conversion diagnostic itself, member-chain resolution *behavior* in nav queries (this change lands the tree + wiring; behavior changes ride on top), and any JS/C/ST→test transpiler.

## Capabilities

### New Capabilities
- (none — this is internal analyzer infrastructure under the existing `language-server` capability, not a new user-facing surface)

### Modified Capabilities
- `language-server`: add a requirement that ST POU bodies are parsed into a statement/expression AST exposed on the body model, with conservative fallback to token-scan on parse failure and **no regression** to the corpus precision/coverage ratchet. Behavior of individual diagnostics and nav queries is unchanged in this phase; only the analyzable representation is added.

## Impact

- **Code (volt-lsp-iec):** new `src/parser/statements.ts` + `src/parser/expression.ts` (or `src/parser/body/**`) feeding `src/parser/ast.ts` node types; `src/semantic/body.ts` (populate `statements`); `src/semantic/identifier-scan.ts` (becomes an AST walk, or a compatibility shim over it). Existing token-based checks are untouched this phase (they keep working) — they migrate consumer-by-consumer in follow-ups.
- **Tests:** new unit tests for the expression/statement grammar; the `real-corpus.test.ts` ratchet is the guardrail — parse-clean %, ingest %, and the diagnostic floors must not regress on any of the four corpora (pro2193 / bakon-nano / awa-palletizer / lenze-mid).
- **No wire/bridge impact.** Pure analyzer-internal. No changes to `volt-bridge`, `volt-git`, or the protocol.
- **Foundation unlocked:** Part B typechecker, the narrowing-conversion diagnostic, member-chain nav, and a future transpiler all build on this tree.
