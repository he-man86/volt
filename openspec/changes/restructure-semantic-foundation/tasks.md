Invariant for EVERY task: `cd packages/volt-lsp-iec && bun test` (3594, 0 fail) + `bun typecheck` clean +
corpus ratchet 0-error stay green before the task's commit. Build clean module → route consumers → delete
duplicates → verify → commit. No big-bang.

## 1. Type-facts SSOT (`type-system/elementary.ts`) — the keystone

- [ ] 1.1 Finish the structured table as the sole source: add `BIT`, the alias/abbreviation keys
      (`TIME_OF_DAY`→`TOD`, `DATE_AND_TIME`→`DT`, `LDATE_AND_TIME`→`LDT`, `LTIME_OF_DAY`→`LTOD`), and a
      separate `ANY_*` generic-family table (`{name, members}`), resolving the `ANY_MAGNITUDE`/`BIT`/`ANY_*`
      gaps the audit found. Expose `elementaryType`, `isNumeric`, `canonicalElem`, `isElementary`, family/rank
      views.
- [ ] 1.2 Derive-and-delete the copies: `NUMERIC_RANK`+`ISOLATED`+both `ENUM_ISOLATED` (check-assignment-types),
      `INTEGER_TYPES`+`NUMERIC_TYPES` (check-binary-operators), the `ELEMENTARY_TYPES` set (type-resolver) and
      array (type-conversion) + its `integerFamily`/`dateFamily`, `ELEM_ABBREV`+`DATETIME_TYPES`+
      `DURATION_TYPES` (type-infer). Each consumer imports from `elementary.ts`.
- [ ] 1.3 Unit tests for the table (every elementary name resolves; alias→canonical; range/rank/family correct)
      and that the derived views match the old sets exactly (a golden test, so the migration provably loses
      nothing). Full suite green.

## 2. Compatibility relation (`type-system/compat.ts`)

- [ ] 2.1 Move `isAssignable` out of `check-assignment-types.ts` and `isAcceptableSource` out of
      `reference/type-conversion.ts`, plus the inline narrowing rule and `temporalArithResult`, into one
      `compat.ts` built on `elementary.ts`: `assignable`, `isNarrowing`, `arithResultType`, `conversionSource`.
      Preserve every oracle-calibrated rule (BIT↔BOOL, enum isolation, REAL↔LREAL non-error, widening,
      return-true-when-unsure).
- [ ] 2.2 Route `check-assignment-types`, `check-call-arguments`, `check-binary-operators`,
      `check-narrowing-conversion`, `check-conversion` through `compat.ts` (delete their local logic). Their
      fixtures + the conformance replay + corpus are the regression floor — stay green.

## 3. `Type` model + inference/resolve/render (`type-system/`)

- [ ] 3.1 `type.ts`: the rich `Type` union (per design) + constructors; `UNKNOWN` total fallback; a shim for
      `.name`/`.scope`/`.typeExpr` so consumers migrate incrementally.
- [ ] 3.2 Move `type-resolver.ts` → `type-system/resolve.ts` (declared `TypeExpr` → `Type`, populating
      elementary facts / string maxLen / array dims / enum members) and the inference half of `type-infer.ts` →
      `type-system/infer.ts` (one engine). Keep `inferExprType` as the public entry (richer return).
- [ ] 3.3 `render.ts`: one parameterized renderer (`{arrayDims, unknown, upper}`); fold
      `renderTypeExpr`, hover `typeText`, code-action `typeExprToString`, vg `renderType`/`simpleType` into it.

## 4. `const-eval.ts`

- [ ] 4.1 `evalConst(expr|BodySpan, scope, project) → ConstValue | undefined` — literals (int/real/typed/`16#`),
      unary `-`, constant `CONSTANT` refs, constant binary arithmetic; integers fold to `bigint`; non-constant →
      undefined. Reuses `parser/expression.ts` to parse opaque `BodySpan`s (array dims, string length,
      initializers). Unit tests incl. the "not constant" cases.

## 5. Shared services + query dedup

- [ ] 5.1 `scope-nav.ts`: `findChildScopeByName`, `findScopeBySpan`, `walkScopes`; replace the 6+ re-impls in
      `_shared.ts`, `type-resolver`, `type-infer`, `check-unresolved-identifier`.
- [ ] 5.2 `symbol-resolve` (`symbolAndRangeAtOffset`) + `lsp/queries/locations.ts` (`locationOfSymbol`);
      `definition` and `hover` delegate to it (bug fix: nav no longer drifts). Adopt `getAnyBody`/`getUnitName`
      everywhere (delete `bodyOf`×3, `pouBody`, inline unit-name guards).
- [ ] 5.3 `hierarchy.ts`: one `HierarchyItem` + builder + `prepareHierarchy(predicate)`; merge
      call-hierarchy + type-hierarchy. Bug fix: `incomingCalls` uses type-aware `findReferences`.
- [ ] 5.4 `symbol-kinds.ts`: co-locate the 3 kind mappers keyed off one exhaustive kind list; ONE `humanKind`
      (hover's richer labels). Bug fix: hover/completion agree. Add a test asserting the label parity.
- [ ] 5.5 `token-scan.ts`: `tokenAt` + `enclosingCall`; replace the 4 token-scan copies + the 2 paren walkers.

## 6. Dead code + oversized-file splits

- [ ] 6.1 Delete: `conversionsForSource`, over-exported `findSymbolByName`, `void parseResult`,
      `semantic-tokens` always-0 mods, `folding-range` duplicate `type_decl` branch, `data-types.ts` dead
      family enum + 4 shadowed alias entries; switch `type-conversion` lookups to `TYPE_CONVERSIONS` Map.
- [ ] 6.2 Split: `symbol-table-build.ts` — one `makeScope(kind,name,node)` collapses the 15 `ingest*`
      near-duplicates; extract the EXTENDS post-pass. Extract `config/editorconfig.ts` from `format.ts`
      (~280 lines) and `hover-annotations.ts` from `hover.ts`.
- [ ] 6.3 Derive `data-types.ts` "Range …" hover prose from `elementary.ts` (numbers live once).

## 7. Parser: subrange capture

- [ ] 7.1 `type-expr.ts:183` — retain the already-consumed `(lo..hi)` as `NamedType.subrange?` (additive; only
      when the constraint contains `..`). `resolve.ts` reads it into `Type.subrange` via `const-eval`. Test:
      the AST now carries the bounds; a follow-up (`st-static-typechecker`) consumes them.

## 8. Land it

- [ ] 8.1 Full suite green + typecheck clean + corpus 0-error + conformance replay green. Grep-confirm the
      deleted symbols have zero remaining references. `check-divergence` clean.
- [ ] 8.2 `openspec validate restructure-semantic-foundation`; sync the `language-server` delta + archive.
      Rebase `st-static-typechecker` onto the delivered core (its model/const-eval/compat tasks now point here).
