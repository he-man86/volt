## 0. Prerequisite

- [ ] 0.1 Confirm `st-body-ast` is landed — `BodyModel.statements` + `statementsOk` available (it is; archived work).

## 1. Type-inference engine

- [ ] 1.1 Define `InferredType` in `src/semantic/type-infer.ts`: `elem` (name + bits + signed + class BOOL/INT/REAL/TIME/STRING), `enum`/`struct`/`fb` (with scope), `array` (element), `pointer`/`ref` (target), `string` (wide), `unknown`.
- [ ] 1.2 Map `ResolvedType` (from `type-resolver.ts`) → `InferredType` at the boundary; keep `type-resolver` unchanged.
- [ ] 1.3 Implement `inferExprType(expr, scope, project) → InferredType`: literals (with width/sign/class), identifiers (via symbol table), member access (resolve base type → look up member in its scope), index (→ element), deref (→ target), call (→ callee return type), unary, binary (IEC result type), paren. Any unresolved sub-part ⇒ `unknown`.
- [ ] 1.4 Unit tests per rule: integer width/sign, REAL vs LREAL, member chain `a.b.c`, array element, deref, call return, binary promotion, and `unknown` propagation (an unresolved leaf makes the whole expr `unknown`).

## 2. Deepen the existing type checks (one at a time, ratchet after each)

- [ ] 2.1 Migrate `check-assignment-types.ts` onto `statements` + `inferExprType` (fall back to the token path when `!statementsOk`). Now types member/index/deref/call l-values and r-values. Re-run `real-corpus.test.ts` — must stay `<=` baseline (pro2193 3, bakon 10, awa 0, lenze 0).
- [ ] 2.2 Migrate `check-binary-operators.ts` onto the walker (operands of any shape, not just `id op id`). Ratchet.
- [ ] 2.3 Migrate `check-conversion.ts` onto the walker (`CONV(<any expr>)`, composite arg types). Ratchet.

## 3. Call-argument checking (new — default OFF until proven)

- [ ] 3.1 `check-call-arguments.ts`: resolve the callee's declared inputs (reuse the signature-help param collection); check argument count within required/optional range.
- [ ] 3.2 Check named-argument names against the callee's declared parameters (ST analogue of VG `vg-unknown-pin`).
- [ ] 3.3 Check positional + named argument types are assignment-compatible (via `reference/type-conversion.ts`). Skip when callee or a param type is `unknown`/overloaded.
- [ ] 3.4 Config-gate (default off); oracle-validate on the corpora with `scripts/lsp-vs-compiler.ts` (zero spurious hits); enable + set a corpus floor.
- [ ] 3.5 Unit tests: wrong count, wrong type, unknown named param, overloaded-callee skip.

## 4. Narrowing-conversion diagnostic (new — default OFF, compiler-parity)

- [ ] 4.1 `check-narrowing-conversion.ts`: flag implicit narrowing / loss-of-precision (LREAL→REAL, and the wider integer/real narrowings the compiler warns on) using `inferExprType` + the conversion table's loss classification.
- [ ] 4.2 Validate against the CODESYS compiler oracle — match the 27 bakon LREAL→REAL warnings; confirm no spurious hits on the other corpora. Enable + set floor.
- [ ] 4.3 Unit tests: LREAL→REAL warns, REAL→LREAL does not, INT→SINT narrowing behavior matches the compiler.

## 5. Land it

- [ ] 5.1 `cd packages/volt-lsp-iec && bun test` green (unit + corpus) and `bun typecheck` clean.
- [ ] 5.2 Corpus precision floors hold for the always-on checks; new opt-in checks have their own oracle-proven floors. Zero new false positives on built objects.
- [ ] 5.3 Remove the token-fallback path from a migrated check only if body-parse-clean is high enough to justify it (else keep + note); update the toolchain map.
- [ ] 5.4 `openspec validate st-type-inference`; sync the `language-server` delta + archive.
