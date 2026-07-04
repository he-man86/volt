## Context

`st-body-ast` landed the statement/expression tree on `BodyModel.statements` (with `statementsOk`). This change adds the **type-inference walker** over that tree and deepens the diagnostics onto it. It is "Part B" of the treewalker plan discussed with the user; Part A (the tree) is done.

Current state to build on / replace:
- `type-resolver.ts` — resolves a *named type* → `{ kind: elementary|enum|struct|function_block|alias|unknown, scope?, aliasTarget? }`. This is the lookup foundation; it does NOT infer expression types (its header says so). Keep it; the walker calls it.
- `check-assignment-types.ts` — `classifyRhs` types a single RHS token; `simpleIdentifierType` handles only `named_type`/`string_type`; **skips any `.`/call/nested expr**. `check-binary-operators.ts` matches only `id op id`; `check-conversion.ts` only `CONV(id)`. All three are the token-pattern checks to migrate.
- `reference/type-conversion.ts` `getConversion` — the IEC assignability/conversion table; reuse it for compatibility decisions.
- `symbol-table.ts` — scope/decl lookup; the walker uses it to type identifiers.

The dominant constraint, again: **zero false positives on four real corpora** (pro2193 3, bakon 10, awa 0, lenze 0 — all library-blind). A type checker that is even slightly wrong regresses that. The `lsp-vs-compiler.ts` oracle and the `real-corpus.test.ts` ratchet are the gates.

## Goals / Non-Goals

**Goals**
- `inferExprType(expr, scope, project) → InferredType` over the `Expr` tree — the reusable engine.
- Deepen assignment/binary/conversion checks onto it (remove bail-on-`.`), behavior-preserving-or-better, zero new FP.
- New call-argument checking (count / types / named names).
- New opt-in narrowing-conversion diagnostic (the one compiler-parity gap), oracle-validated.

**Non-Goals**
- Member-chain *navigation* (go-to-def/hover/completion) — separate `st-nav-chains` (it reuses this walker but is a different surface).
- The structural formatter — separate `st-format`.
- Full IEC generic/overload resolution beyond corpus need; SFC `S=`/`R=` grammar (harden 8.2); the interpreter.
- Turning any new diagnostic ON by default before it is oracle-proven and corpus-clean.

## Decisions

### D1: `InferredType` is a small tagged model, richer than `ResolvedType`
`ResolvedType` lacks the elementary identity (INT vs LREAL, width, signedness) that narrowing/promotion need. Add `InferredType`: `{ kind: "elem", elem: ElemType }` (ElemType carries name + bits + signed + class BOOL/INT/REAL/TIME/STRING) | `{ kind: "enum"|"struct"|"fb", scope }` | `{ kind: "array", element }` | `{ kind: "pointer"|"ref", target }` | `{ kind: "string", wide }` | `{ kind: "unknown" }`. `unknown` is the universal escape hatch. **Alternative:** extend `ResolvedType` in place — rejected; it's the declared-type resolver used elsewhere, and overloading it with elementary width/sign risks those callers. The walker maps a `ResolvedType` → `InferredType` at the boundary.

### D2: The walker is bottom-up and total (never throws, never partial-fails to a wrong type)
Every `Expr` arm returns an `InferredType`; on any unresolved sub-part it returns `unknown` (not a guess). This is what preserves zero-FP: a consumer only acts on a fully-known type. Reuse `type-resolver.resolveNamedType` for named types, `symbol-table` lookup for identifiers, `getConversion` for compatibility. **Alternative:** a constraint-solver / bidirectional checker — massive overkill for ST (no generics/inference vars); rejected by the ladder.

### D3: Migrate the three token-pattern checks onto the walker, guarded by the ratchet
Rewrite `check-assignment-types` / `check-binary-operators` / `check-conversion` to consume `BodyModel.statements` (when `statementsOk`) and `inferExprType`, falling back to the current token path when `!statementsOk` (so unparsed bodies keep today's behavior). Each rewrite must leave corpus diagnostics `<=` baseline. Do them one at a time, re-running the ratchet after each. **Alternative:** leave the old checks and add parallel new ones — rejected; two code paths for one concern, and the old ones' bail-on-`.` is the very bug we're fixing.

### D4: New diagnostics start OFF and earn their ON by oracle + corpus
Call-argument checks and narrowing-conversion are added behind config, default off, and only turned on (and given a corpus floor) after `lsp-vs-compiler.ts` confirms they match the compiler on the corpora with zero spurious hits. This is the same discipline that kept the corpus at zero FP. Narrowing specifically is validated against the 27 bakon warnings the compiler emits.

### D5: Reuse, don't rebuild, the compatibility table
Assignability (INT→DINT ok, LREAL→REAL narrowing, enum→base, etc.) already lives in `reference/type-conversion.ts`. The checks call it with `InferredType`s rather than re-encoding IEC rules. Narrowing is "assignable-with-loss" — a classification the table can express.

## Risks / Trade-offs

- **A subtly-wrong inference rule flips a corpus body to a false positive** → the whole zero-FP invariant. **Mitigation:** `unknown`-skips-everything (D2); migrate one check at a time under the ratchet (D3); new diagnostics default-off until oracle-proven (D4). Per-rule unit tests.
- **Member/scope resolution depth** (typing `a.b.c` needs `a`'s type's scope, then `b`'s type's scope…) → recursion + partial resolution. **Mitigation:** the walker already recurses; each hop returns `unknown` on miss, so depth degrades safely to skip.
- **Overload / generic standard functions** (`SEL`, `MUX`, `MIN/MAX`, `ADD`) have polymorphic signatures → call-arg checking could FP. **Mitigation:** treat unresolved/overloaded callees as `unknown` → skip; only check calls whose signature is unambiguous. Grow from there.
- **Double code path during migration** (tree path + token fallback) → temporary complexity. **Mitigation:** fallback is only for `!statementsOk` bodies (~15% today, shrinking as the grammar ratchets up); remove it once body-parse-clean is high enough.

## Migration Plan

1. Build `src/semantic/type-infer.ts`: `InferredType` + `inferExprType` (+ `ResolvedType → InferredType` boundary). Unit-test the inference rules.
2. Migrate `check-assignment-types` onto the walker; run the ratchet (must stay `<=` baseline). Then `check-binary-operators`, then `check-conversion`, each ratchet-verified.
3. Add `check-call-arguments` (count → named-names → types), default off; oracle-validate; enable + set floor.
4. Add `check-narrowing-conversion`, default off; validate against the compiler's bakon warnings; enable + set floor.
5. Full suite + typecheck; `openspec validate`; sync `language-server` delta + archive.

**Rollback:** the walker is additive; each migrated check retains the token fallback, so reverting a check to token-only is local. New diagnostics are config-gated.

## Open Questions

- Do the migrated checks keep the token fallback permanently, or is body-parse-clean high enough soon to drop it? (Lean: keep until parse-clean > ~95% on all corpora, then delete the dead path.)
- Should `InferredType` live beside `type-resolver.ts` or fully absorb it later? (Lean: separate now; consider merging once the interpreter also needs a value/type model, to avoid two.)
- Which config keys gate the new checks, and do any belong ON by default once proven? (Decide per-check after oracle validation; narrowing likely stays opt-in like the compiler's warning level.)
