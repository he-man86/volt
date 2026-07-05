## 0. Prep — the type lattice + legacy inventory (design ground)

- [x] 0.1 Extract the IEC type lattice from `docs/codesys-reference/04-type-conversion.md` + `06-data-types.md`:
      every elementary type's min/max/bits/signed/family, the ANY_* type groups, and the conversion critical
      rules. Captured in `design.md` (task-0 tables).
- [x] 0.2 Inventory the existing oracle-calibrated rules in `checks/check-assignment-types.ts` `isAssignable`
      (`NUMERIC_RANK`, `ISOLATED`, BIT↔BOOL, enum isolation, REAL↔LREAL, return-true-when-unsure) so nothing
      verified is lost in the migration. Captured in `design.md` (legacy-rule inventory).
- [x] 0.3 Confirm the fit + seams (single `inferExprType`, single `typeExprToInferred`, `typeExpr` carried) and
      that this is enrichment, not rewrite. Recorded in `design.md` (Context).

## 1. Rich `Type` model + constant evaluation

- [ ] 1.1 `reference/elementary-types.ts`: the elementary table from task 0 (name→{family,bits,signed,range})
      with `bigint` ranges. Single source for ranges + families.
- [ ] 1.2 Enrich `type-infer.ts` `InferredType` → `Type` (additive union per `design.md`): populate range/family
      for elementary, bounds for subrange/array (off `typeExpr`), `maxLen` for string, members for enum.
      `UNKNOWN_TYPE` stays the total fallback.
- [ ] 1.3 `semantic/const-eval.ts`: `evalConst(expr, scope, project) → ConstValue | undefined` — literals
      (int/real/typed, `16#`), unary `-`, constant `CONSTANT` refs, constant binary arithmetic. Integers fold
      to `bigint`. Unit tests: values + the "not constant → undefined" cases.
- [ ] 1.4 Unit tests: `Type` construction from representative declarations (elementary w/ range, `INT(1..100)`,
      `ARRAY[1..10]`, `STRING(20)`, enum) — assert the carried facts.

## 2. Unified assignability

- [ ] 2.1 `semantic/assignable.ts`: `assignable(src, srcConst?, dst) → Violation | undefined` over `Type`.
      Port EVERY rule from the task-0 legacy inventory (family/bits widening, ISOLATED cross-family, BIT↔BOOL,
      enum isolation, REAL↔LREAL non-error, return-undefined-when-unsure) + the new value-range checks
      (overflow, subrange, array-index, string-len, enum-range, REAL→INT range).
- [ ] 2.2 Migrate `check-assignment-types.ts`, `check-conversion.ts`, `check-binary-operators.ts`,
      `check-narrowing-conversion.ts`, `check-call-arguments.ts` onto `assignable` — behaviour-preserving.
      Their existing fixtures + the corpus 0-error ratchet are the regression floor (must stay green).
- [ ] 2.3 Apply `assignable` at the remaining Pass-1 contexts: VAR initializer, `ARRAY` index, CASE label.

## 3. Pass-1 gap rows — record then mirror

- [ ] 3.1 Record the written fixtures (`range-bounds.ts`, `overflow.ts`) against the live IDEs (CS `:8556` + TC
      `:8555`) via `record:language`; classify each verdict (error/warning/silent) per vendor.
- [ ] 3.2 Implement the confirmed rules in `assignable` and mirror each message byte-exact (per-vendor
      templates where CS/TC wording differs). Add string-len + enum-range fixtures. Replay green.
- [ ] 3.3 Update `coverage-matrix.md` Pass-1 rows to ✅ (or documented divergence); corpus 0-error holds.

## 4. Pass 2 — type-declaration validation

- [ ] 4.1 `check-type-declaration.ts`: walk `TypeExpr`/DUT — `POINTER TO BIT` & the composite-BIT/double-ref
      set (D1), BIT outside STRUCT/FB (D2), ENUM<2 (D4), STRUCT/UNION<2 (D6), nested `AT` (D7), `__VECTOR` (D8).
- [ ] 4.2 Fixtures per row → record → mirror. Matrix Pass-2 rows ✅.

## 5. Pass 3 — declaration-context validation

- [ ] 5.1 Extend `check-var-section-placement.ts` (or a sibling): PERSISTENT-without-RETAIN (V4), RETAIN in a
      function (V5), VAR_EXTERNAL with init (V8), `call_after_*` POU with VAR_INPUT (G6); verify V2/V3/V7.
- [ ] 5.2 Fixtures per row → record → mirror. Matrix Pass-3 rows ✅.

## 6. Pass 4 + tail

- [ ] 6.1 Call-site: `VAR_IN_OUT` passed a literal/constant (V6). Flow: null-guard `AND_THEN` suggestion (O1).
- [ ] 6.2 Pragma tail: enable `unknownPragma` after oracle-verify (G1), insert-location (G2), deprecated `INI`
      (O4). Each fixture → record → mirror.

## 7. Land it

- [ ] 7.1 `bun test` green + `bun typecheck` clean; corpus precision 0 errors on all 4; `lsp-vs-compiler.ts`
      (live) shows no compiler diagnostic the LSP misses on the 3 clean corpora.
- [ ] 7.2 `openspec validate st-static-typechecker`; sync the `language-server` delta + archive; mark the
      coverage-matrix scoreboard complete.
