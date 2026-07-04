## 0. Prerequisite

- [ ] 0.1 Confirm `st-body-ast` is landed — `BodyModel.statements` + `statementsOk` available (it is; archived work).

## 1. Shared semantic-query service — the "one step back" (D6)

Build `src/semantic/type-infer.ts` as the shared service both `checks/**` and `lsp/queries/**` consume. Do the dedup FIRST (behavior-preserving) so inference layers onto a clean base.

- [x] 1.0a Shared `Expr`/`Statement` **walker** → `src/parser/ast-walk.ts` (`exprChildren`/`walkExpr`/`stmtExprs`/`stmtChildLists`/`walkStatements`/`walkAllExprs`). `coverage-report.ts`'s two hand-rolled walks collapsed to one `walkAllExprs` call. Corpus ratchet green (0 mismatches, baselines held).
- [x] 1.0b Shared symbol finder `findSymbolByName` (+ `findMemberBearing`) in `src/semantic/type-infer.ts`. Collapsed the **4 duplicated symbol-walks** into it: `completion.findSymbol`, `signature-help.findCallable`, `vg/calls.findCallableType`, `vg/type-env.findTypeAst`. (`_shared.findScopeByName` is a single shared scope-by-name helper — not a copy — left as-is.) Full suite 5772 pass, all snapshots intact (completion's shallow→DFS was behavior-preserving). `resolveMemberChain` (the multi-hop) lands in §2 where inference consumes it, built on this primitive.
- [x] 1.0c Shared `renderTypeExpr` in `type-infer.ts`; collapsed the **2 identical** copies (`signature-help`, `vg/calls`). The other 2 have DIFFERENT contracts and stay separate by design: `hover.typeText` (typed, real `ARRAY[dims]` + enum values) and `vg/type-env.renderType` (uppercases, returns `undefined`) — unifying them would change output.

## 2. Type-inference engine (on the shared service)

- [ ] 2.1a Define `InferredType` in `type-infer.ts`: `elem` (name + bits + signed + class BOOL/INT/REAL/TIME/STRING), `enum`/`struct`/`fb` (with scope), `array` (element), `pointer`/`ref` (target), `string` (wide), `unknown`.
- [ ] 2.1b Map `ResolvedType` (from `type-resolver.ts`) → `InferredType` at the boundary; keep `type-resolver` unchanged (extend, don't replace — D6).
- [ ] 2.1c Implement `inferExprType(expr, scope, project) → InferredType`: literals (with width/sign/class), identifiers (via symbol table), member access (via `resolveMemberChain`), index (→ element), deref (→ target), call (→ callee return type), unary, binary (IEC result type), paren. Any unresolved sub-part ⇒ `unknown`.
- [ ] 2.1d Unit tests per rule: integer width/sign, REAL vs LREAL, member chain `a.b.c`, array element, deref, call return, binary promotion, and `unknown` propagation (an unresolved leaf makes the whole expr `unknown`).

## 2. Deepen the existing type checks (one at a time, ratchet after each)

## 3. Deepen the existing type checks (one at a time, ratchet after each)

- [ ] 3.1 Migrate `check-assignment-types.ts` onto `statements` + `inferExprType` (fall back to the token path when `!statementsOk`). Now types member/index/deref/call l-values and r-values. Re-run `real-corpus.test.ts` — must stay `<=` baseline (pro2193 3, bakon 10, awa 0, lenze 0).
- [ ] 3.2 Migrate `check-binary-operators.ts` onto the walker (operands of any shape, not just `id op id`). Ratchet.
- [ ] 3.3 Migrate `check-conversion.ts` onto the walker (`CONV(<any expr>)`, composite arg types). Ratchet.

## 4. Call-argument checking (new — default OFF until proven)

- [ ] 4.1 `check-call-arguments.ts`: resolve the callee's declared inputs (via the shared service, replacing the signature-help param collection); check argument count within required/optional range.
- [ ] 4.2 Check named-argument names against the callee's declared parameters (ST analogue of VG `vg-unknown-pin`).
- [ ] 4.3 Check positional + named argument types are assignment-compatible (via `reference/type-conversion.ts`). Skip when callee or a param type is `unknown`/overloaded.
- [ ] 4.4 Config-gate (default off); oracle-validate on the corpora with `scripts/lsp-vs-compiler.ts` (zero spurious hits); enable + set a corpus floor.
- [ ] 4.5 Unit tests: wrong count, wrong type, unknown named param, overloaded-callee skip.

## 5. Narrowing-conversion diagnostic (new — default OFF, compiler-parity)

- [ ] 5.1 `check-narrowing-conversion.ts`: flag implicit narrowing / loss-of-precision (LREAL→REAL, and the wider integer/real narrowings the compiler warns on) using `inferExprType` + the conversion table's loss classification.
- [ ] 5.2 Validate against the CODESYS compiler oracle — match the 27 bakon LREAL→REAL warnings; confirm no spurious hits on the other corpora. Enable + set floor.
- [ ] 5.3 Unit tests: LREAL→REAL warns, REAL→LREAL does not, INT→SINT narrowing behavior matches the compiler.

## 6. Land it

- [ ] 6.1 `cd packages/volt-lsp-iec && bun test` green (unit + corpus) and `bun typecheck` clean; the §1 dedup left behavior unchanged (full suite green after each collapse).
- [ ] 6.2 Corpus precision floors hold for the always-on checks; new opt-in checks have their own oracle-proven floors. Zero new false positives on built objects.
- [ ] 6.3 Remove the token-fallback path from a migrated check only if body-parse-clean is high enough to justify it (else keep + note); update the toolchain map.
- [ ] 6.4 `openspec validate st-type-inference`; sync the `language-server` delta + archive.
