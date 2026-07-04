## Context

`volt-lsp-iec` has a two-tier representation:

- **Declarations** — a real AST (`src/parser/ast.ts`, ~339 lines of node types; `TypeExpr`, var sections, unit headers). Built by the unit parsers in `src/parser/units/**` + `src/parser/var-section.ts` + `src/parser/type-expr.ts`.
- **Bodies** — NOT parsed. A body is a `BodySpan { kind, tokens: Token[], span }` (`src/parser/ast.ts:323`). The tokens are already lexed by `src/lexer/lexer.ts`; nothing turns them into a tree.

Everything that reads a body reads the flat token array and pattern-matches. `src/semantic/body.ts` wraps a `BodySpan` into a `BodyModel { identifiers, calls, st, vg }` — `identifiers`/`calls` come from `src/semantic/identifier-scan.ts` (a linear token walk classifying each identifier as `isCall` / `isMemberAccess`), and `st` is just the raw `BodySpan` handed to the token-based checks.

### Confirmed gaps this creates (the "missing gaps" investigation)

1. **Type checks are single-token and bail on `.`** — `src/semantic/checks/check-assignment-types.ts`: `classifyRhs` (line 94) inspects the *first* RHS token only (`identifier` → symbol type, `string_lit` → STRING, …). It explicitly skips when the LHS is preceded by `.` (member assignment, line 48) and cannot type any expression with an operator, call, member, or index. `check-binary-operators.ts` / `check-conversion.ts` are the same shape (token-pattern, ~95–101 lines each). `type-resolver.ts` resolves a *declared named type* → kind+scope but, by its own header, "does NOT perform full expression type inference."
   Even `check-unresolved-identifier.ts` only resolves **one** member level — guarded by `ref.qualifier.length === 1` (line 90); a chain `a.b.c` falls through the `continue` (line 116) unchecked, and only struct/FB bases are handled (arrays/pointers/aliases/library types skipped).
2. **No call-argument checking exists at all** — nothing verifies arg count, arg types, or named `param := value` against a callee signature. `signature-help.ts` is display-only (it picks the active param by *counting commas*, never comparing arguments). The *only* call-site argument validation anywhere is VG-only and one-dimensional: `check-vg-code.ts` `checkPins` flags a named pin the FB doesn't declare (`vg-unknown-pin`) — no arg count, no positional types, and it skips member-chain instances entirely. Named args `FB(p := v)` are classified-and-skipped in `identifier-scan.ts` / `body.ts` / the unresolved check, never validated.
3. **Nav resolves only the head identifier of a chain** — go-to-definition (`definition.ts:14-18`, documented) returns name-based matches for the member token; completion (`completion.ts:75`) detects member-access with a single-level regex `([ident])\s*\.\s*([ident])?$` and cannot walk `a.b.c` or `arr[i].x`; references/rename/document-highlight are pure name-match (`motor.Start` matches every `Start` project-wide — documented in `references.ts:11-17`); call-hierarchy *drops* `fb.method()` calls (`call-hierarchy.ts:137-139`).
4. **Control flow is never structured** — CASE/FOR/WHILE/IF are token runs used only for cosmetic re-indentation (`format.ts`) and are *explicitly excluded* from folding (`folding-range.ts:12-14`). No statement nodes ⇒ no loop-variable, CASE-label, reachability, or branch-narrowing analysis is possible. (VG bodies are the exception — they already have a real AST in `src/vg/`.)
5. **The one concrete diagnostic the compiler has and we don't** — the LREAL→REAL narrowing warning (harden-lsp-real-project task 8.1) is unreachable without expression types, which need this tree. The `S=` set-assignment FP (task 8.2) is also a body-structure gap.

The single structural chokepoint tying all five categories together is `BodyModel` (`src/semantic/body.ts:19-70`): it exposes only `identifiers`, `calls`, and the raw `st` token span, and every ST check and nav query reads through that name-list-plus-tokens view. There is no ST expression/statement node anywhere under `src/parser/`. Adding the tree *there* is what unlocks all five.

Constraint that dominates every decision: **the corpus ratchet is at/near zero false positives on four real projects** (pro2193, bakon-nano, awa-palletizer, lenze-mid). A body parser that is even slightly wrong regresses that hard. See [[clean-refactor-after-design-changes]] and the harden-lsp-real-project ratchet.

## Goals / Non-Goals

**Goals**
- A statement/expression AST for ST bodies, consuming the existing lexed `BodySpan.tokens` (no re-lexing).
- Exposed on `BodyModel` as `statements`, additive — existing `identifiers`/`calls`/`st`/`vg` fields keep working.
- Conservative recovery: a body the grammar can't model yet falls back to the token scan; **zero new diagnostics**, zero corpus regression.
- Enough coverage of real ST that the four corpora parse their bodies cleanly (measured, ratcheted).

**Non-Goals (future phases)**
- Type inference / typechecker rules over the tree (Part B).
- The narrowing-conversion diagnostic and the `S=` FP fix (they *ride on* this tree; not in this change).
- Changing nav-query *behavior* (member-chain go-to-def/hover/completion) — this change lands the tree + wiring; behavior changes are follow-ups.
- Any JS/C/test transpiler.
- Touching VG bodies — they keep their own model.

## Decisions

### D1: Hand-written recursive-descent + precedence-climbing expression parser
ST's grammar is small and fixed (no generics, closures, or templates). A hand-written statement parser plus a precedence-climbing (Pratt) expression parser is the right size — a few hundred lines each — and matches the style of the existing unit parsers (`src/parser/cursor.ts` already provides a token cursor). **Alternatives:** a parser-generator (overkill, new dependency, worse error recovery — rung 4 says no new dep for what a few hundred lines do); extending the existing declaration parser inline (wrong seam — bodies have their own grammar). Reuse `cursor.ts`'s cursor abstraction.

This is **not an invented grammar** — it is the textbook tree-walk front-end (lexer → recursive-descent + Pratt → AST; *Crafting Interpreters*), independently confirmed by every serious ST implementation (esstee, RuSTy, MATIEC all use the same shape). We reject *importing* those (Rust/C, LGPL/GPL — copyleft is a nonstarter for a closed commercial product, and none returns a TS body AST that plugs into our lexer/symbol-table). We *do* take their grammar, which is a fact, not code.

### D1a: Operator precedence — lifted from the IEC 61131-3 standard and cross-checked against RuSTy
Encode this ladder explicitly (lowest → highest binding), matching RuSTy's `expressions_parser.rs` chain (`parse_or_expression` → … → `parse_qualified_reference`):

| Level | Operators | Assoc |
|---|---|---|
| OR | `OR` | left |
| XOR | `XOR` | left |
| AND | `AND` / `&` | left |
| equality | `=` `<>` | left |
| comparison | `<` `>` `<=` `>=` | left |
| additive | `+` `-` | left |
| multiplicative | `*` `/` `MOD` | left |
| exponent | `**` | **right** |
| unary | `NOT` `+` `-` | prefix |
| postfix | `.member` `[index]` `^` `(args)` | left, binds tightest |

Postfix operations bind tightest and are processed left-to-right in a single loop, enabling chains like `foo()[i]^.member` (RuSTy's `parse_qualified_reference` does exactly this). Exponent is the only right-associative binary level. One unit test per level pins associativity; disambiguate against CODESYS where a corpus body's evaluation reveals the intended grouping.

### D2: Additive on `BodyModel`, opt-in per consumer
Add `statements?: StatementList` to `BodyModel`, populated only for `language: "st"`. Existing consumers are untouched this phase; each migrates to the tree in its own follow-up change, verified against the ratchet. This keeps the diff shippable and the risk bounded — nothing changes behavior until a consumer opts in. **Alternative:** big-bang rewrite of every check onto the tree in one change — rejected; it couples the risky parser to N behavior changes and makes a ratchet regression impossible to bisect.

### D3: Fallback = the current token scan, triggered on any parse incompleteness
The body parser returns `{ statements, ok: boolean }`. If `ok` is false (unconsumed tokens, unexpected token, a construct not yet modeled), consumers that want the tree ignore it and use the existing `identifiers`/`calls`. No parse-error diagnostic is ever emitted from body parsing in this phase — the compiler remains the oracle for body errors. **Alternative:** emit parse diagnostics — rejected; it would invent false positives on constructs we simply haven't modeled yet, violating the zero-FP invariant.

### D4: New node types live in `ast.ts`; parser split into `src/parser/statements.ts` + `src/parser/expression.ts`
Keeps all AST node shapes in one file (as today) and the body grammar in two focused parser files beside the unit parsers. `body.ts` calls the new `parseStatements(bodySpan)`; VG detection (`isVgBody`) short-circuits first, unchanged.

### D5: Grammar coverage is corpus-driven, not spec-exhaustive
Model the ST constructs the four corpora actually use first; measure body-parse-clean % as a new corpus metric and ratchet it up, exactly as parse/ingest/precision are ratcheted today. Unmodeled exotic constructs fall back (D3) rather than blocking the change. This is the same discipline that took the corpora to zero FPs.

## Risks / Trade-offs

- **A subtly-wrong expression parser silently mis-structures a body** → the ratchet only catches *diagnostic* regressions, and this phase emits no diagnostics from the tree. **Mitigation:** add a body-parse-clean coverage metric to `real-corpus.test.ts` (a new ratcheted axis), plus focused unit tests over the tricky ST forms (precedence, named args, `p^.field[i]`, nested calls). Round-trip a sample of corpus bodies (tree → identifier set) and assert it equals the current token-scan identifier set — a cheap equivalence check that flags mis-parses without needing type info.
- **Operator precedence / associativity errors** → IEC precedence differs from C in places (e.g. `AND`/`OR`/`XOR`, `MOD`). **Mitigation:** encode the IEC 61131-3 precedence table explicitly with a unit test per level; cross-check against CODESYS evaluation where a corpus body disambiguates.
- **Scope creep into Part B** → the temptation to "just add the narrowing check while we're here." **Mitigation:** non-goal, enforced by the spec — this change adds representation only.
- **Performance on large bodies** → parsing every body on each edit. **Mitigation:** bodies are small; parse is O(tokens). If it shows up, it composes with the planned per-document caching (harden-lsp-real-project task 5.2), not this change.

## Migration Plan

1. Add node types to `ast.ts`; build `expression.ts` then `statements.ts` on `cursor.ts`.
2. Wire `parseStatements` into `body.ts` behind `language === "st"`; populate `BodyModel.statements`, keep all existing fields.
3. Add the body-parse-clean coverage axis to `coverage-report.ts` + `real-corpus.test.ts`; establish baselines for the four corpora; assert no regression on the existing axes.
4. Add grammar unit tests + the identifier-set equivalence check.
5. Ship. Follow-up changes migrate consumers (nav, then checks) onto the tree, each ratchet-verified — and Part B (typechecker) builds on it.

**Rollback:** the tree is additive and behind `ok`/fallback; dropping the `statements` field reverts to today's behavior with no consumer impact.

## Open Questions

- Do we model `statements` as a flat list with nested children, or expose a lightweight visitor helper in this change too? (Lean: ship the tree + node types now; a `walk()` helper can land with the first consumer that needs it — YAGNI until then.)
- Should property getter/setter and action bodies share the exact same entry point as FB/method bodies? (Expected yes — they are all `BodySpan`; confirm no header-token differences during implementation.)
- Where do inline `{IF ...}` conditional-compilation pragmas sit relative to statements — consume-and-ignore like today's token scan, or model as nodes? (Lean: consume-and-ignore this phase to preserve current behavior.)
