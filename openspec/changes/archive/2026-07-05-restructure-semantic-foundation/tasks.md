Executes the `architecture.md` blueprint (Phases A–E) as a clean, bottom-up rebuild. **Invariant for EVERY
task:** `cd packages/volt-lsp-iec && bun test` (3594, 0 fail) + `bun typecheck` clean + corpus 0-error +
conformance replay green BEFORE the task's commit. Build clean module → route consumers → delete duplicates →
verify → commit. No big-bang. Superseded files move to `semantic/_legacy/` (or `parser/_legacy/`) as reference
until their replacement is green, then the folder is deleted at task 8.

## A. Base layer — the pro foundation (parser/AST/treewalker)

- [ ] A.1 Complete the AST model: `ArrayType.dims:{lower,upper: Expr}`, `StringType.length: Expr`, a
      `SubrangeType{base,lower,upper}` node (stop discarding `(lo..hi)` at `type-expr.ts:183`), `VectorType`,
      enum member values as `Expr`, `VarDecl.init: Expr`, and `Literal{text,kind,value,type}` (values parsed;
      ints `bigint`). Fix the `NamedType` qualifier inversion.
- [ ] A.2 Parser produces the complete nodes (keep the parse driver + lexer). Migrate the consumers that read
      the previously-opaque spans — **formatter** (prints declarations from structured AST, not source-slice
      reprints), hover (`ARRAY[lo..hi]`), checks — node-by-node.
- [ ] A.3 Verify: body-AST corpus 100%-clean, `parse(format(x))≡parse(x)` + format-corpus (1511 files) hold,
      parse-error/fuzz tests green. AST-shape tests for the new structured nodes.

## B. Symbols & scopes

- [ ] B.1 `scope-nav.ts`: `findChildScopeByName`/`findScopeBySpan`/`walkScopes`; replace the 6+ re-impls
      (`_shared`, `type-resolver`, `type-infer`, `check-unresolved-identifier`). **Guard (risk #5):** keep the
      `qualified_only` resolution path independent — it is a *resolution* concern, NOT the compat-layer enum
      isolation merged in C; add/keep a test that a bare non-`qualified_only` enum member still resolves (Req 18).
- [ ] B.2 Split `symbol-table-build.ts`: one `makeScope(kind,name,node)` collapses the 15 `ingest*`; extract
      the EXTENDS post-pass. Corpus ingest 100%.

## C. Type system (the clean core — one SSOT per concern)

- [ ] C.1 `type-system/elementary.ts` — the SOLE type-facts table: `+BIT`, alias keys (`TIME_OF_DAY`→`TOD`…),
      an `ANY_*` generic sub-table (resolve the `ANY_MAGNITUDE`/`BIT`/`ANY_*` gaps). **Golden test:** derived
      views (`NUMERIC_RANK`/`ISOLATED`/`INTEGER_TYPES`/`DATETIME`/…) equal the old sets exactly.
- [ ] C.2 Derive-and-delete the 6 scattered copies (check-assignment-types, check-binary-operators,
      type-resolver, type-conversion, type-infer) — each imports from `elementary.ts`.
- [ ] C.3 `type-system/type.ts` (rich `Type` union, `UNKNOWN` total fallback) + `resolve.ts` (reads A's
      structured facts directly) + `render.ts` (ONE parameterized renderer). **Guard (risk #2):** before
      deleting `renderTypeExpr`/hover `typeText`/code-action `typeExprToString`/vg `renderType`, add one
      exact-output assertion per call site so display strings can't silently drift.
- [ ] C.4 `type-system/const-eval.ts` (`evalConst`; literals already valued by A; folds unary/const-ref/
      const-arith; non-const→undefined) + `infer.ts` (one engine; `inferExprType` stays the public entry).
- [ ] C.5 `type-system/compat.ts` — merge `isAssignable` (check) + `isAcceptableSource` (reference) + inline
      narrowing + `temporalArithResult` into ONE relation on A. **Golden test (risk #4):** diff old-vs-new
      `compat` verdicts across the full elementary cross-product BEFORE deleting the originals (conformance only
      samples fixtures). Preserve every oracle rule (REAL↔LREAL non-error, BIT↔BOOL, enum isolation,
      return-true-when-unsure).
- [ ] C.6 Route the 5 type-checking checks (assignment/binary/conversion/narrowing/call-arg) through `compat`;
      delete their local logic. **Guard (risk #6):** add an invariant test that a `Type` with any unresolved
      sub-part still yields skip at every check consumer (the conservative/zero-FP contract, Req 1/37).

## D. Semantic services

- [ ] D.1 `symbol-resolve` (`symbolAtOffset`/`symbolAndRangeAtOffset`) + `messages.ts` (per-vendor builders
      alongside `cannotConvert`). Corpus 0-FP + conformance replay unchanged.

## E. Features — query dedup + the 3 bug fixes

- [ ] E.1 Query utils: `locations.ts` (`locationOfSymbol`, dedup ×7), `token-scan.ts` (`tokenAt`,
      `enclosingCall`), adopt `getAnyBody`/`getUnitName` (delete `bodyOf`×3/`pouBody`/inline guards).
- [ ] E.2 `symbol-kinds.ts`: 3 mappers off one exhaustive kind list + ONE `humanKind` (hover's richer labels).
      **Bug fix + guard (risk #3):** add the hover↔completion label-parity test; update any `completion.test.ts`
      assertion locked to the old `detail` wording.
- [ ] E.3 `definition`/`hover` delegate to `symbolAtOffset` (bug fix 2 — nav no longer drifts from
      references/rename). Nav assertion tests.
- [ ] E.4 `hierarchy.ts`: one `HierarchyItem`+builder+`prepareHierarchy`; merge call+type-hierarchy.
      **Bug fix + guard (risk #1):** `incomingCalls` uses type-aware `findReferences`; add a MEMBER-call test
      (`m.Start()`) with a same-named method on a *different* FB that must NOT appear (the negative case).
- [ ] E.5 Extract `config/editorconfig.ts` from `format.ts` and `hover-annotations.ts` from `hover.ts`
      (pure moves; their tests stay green). Fold code-action `typeExprToString` into `render.ts`.

## 6. Dead code + catalog cleanup

- [ ] 6.1 Delete: `conversionsForSource`, over-exported `findSymbolByName`, `void parseResult`,
      `semantic-tokens` always-0 mods, `folding-range` duplicate `type_decl` branch, `data-types.ts` dead
      family enum + 4 shadowed alias entries; `type-conversion` lookups → the `TYPE_CONVERSIONS` Map.
- [ ] 6.2 Derive `data-types.ts` "Range …" hover prose from `elementary.ts` (numbers live once).

## 8. Land it

- [ ] 8.1 Full suite green + typecheck + corpus 0-error + conformance replay. Delete `_legacy/`; grep-confirm
      the removed symbols have zero references. `check-divergence` clean.
- [ ] 8.2 `openspec validate restructure-semantic-foundation`; sync the `language-server` delta + archive.
      Rebase `st-static-typechecker` onto the delivered Phase-C core.
