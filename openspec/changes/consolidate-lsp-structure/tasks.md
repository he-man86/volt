# Tasks — consolidate volt-lsp-iec

Source: the two audits of 2026-09-14 (types; structure), findings with file:line in the session transcript and summarised
here. Rule for every task: a failing test first (a recorded fixture when it is vendor behaviour), then the fix, then
"why did no test catch it?". One commit per task group; all offline gates green at each.

## A. Bugs the duplication hid

- [x] A1 **Layering lint is blind** — `scripts/check-layering.ts` ranked `graphical`/`graphical/text` (gone); `network/`,
      `network/text/` and the top-level files (`workspace-refs`, `detect-vendor`, `init`, `source-extensions`) were never
      checked. DONE 2026-09-14: every folder ranked (a new rule 0 fails on an unranked folder — the class fix), cross-group
      `_`-helper imports and cross-layer cycles refused. It found one violation — `oop/inheritance.ts` imported the names
      group's `_identifier-resolution.ts` — fixed by moving that to `analysis/resolution.ts` (C3's first part). README and
      TESTING paths updated. *Why missed:* the lint had no test of its own coverage; renaming a folder silently exempted it.
- [x] A2 **`LDATE#`/`LTOD#`/`LDT#` literals typed DATE/TOD/DT** by `types/infer.ts` `literalType` (lower was right).
      DONE 2026-09-14: recorded (`cc_ldate_literal_into_date`, `cc_ltod_*`, `cc_ldt_*`, `cc_fp_ldate_*`) — the prefix now
      decides. The recording also showed CODESYS prints the abbreviated types in full ('TIME_OF_DAY', 'LDATE_AND_TIME'),
      whatever the declaration wrote: `types/elementaryDisplayName`, the inverse of `ELEM_ALIASES`, used by `renderType`.
      *Why missed:* no fixture had an L-date literal; the transpiler's own literal typing hid that the LSP's disagreed.
- [ ] A3 **Lowering ignores a typed literal's prefix** — `REAL#1.5` → LREAL, `INT#5` → SINT/context (`lower.ts` literalType).
      Oracle case first.
- [ ] A4 **Six `X_TO_Y` parsers** (`infer.ts:376`, `reference.ts:197`, `narrowing.ts:35`, `conversion.ts:14`, `lower.ts:366`,
      `_identifier-resolution.ts:21` loose on purpose) — `TIME_OF_DAY_TO_UDINT`/`DATE_AND_TIME_TO_*` unrecognised in three.
      One `parseConversionName` in `types/`; record a narrowing fixture on an alias source.
- [ ] A5 **Property-accessor scope** — `services/shared/resolve-at.ts:82`, `assist/signature-help.ts:15`,
      `assist/inlay-hints.ts:23` use the unit scope where `symbols/bodies.ts:42` uses the accessor's. Test a getter local.
- [ ] A6 **Inlay hints rebuild parameters** (`inlay-hints.ts:30`) — no hints for FB-instance calls or inherited inputs;
      use `resolveCallee`.
- [ ] A7 **Network wording hard-coded** — `network-analysis.ts:175` (jump label; TwinCAT differs), `:213` (no input).
- [ ] A8 **`this-super-context.ts:18` compares `THIS` case-sensitively**; `external-write.ts:49` / `inout-external-access.ts:44`
      do not. Verify lowercase `this`, then one `isSelfRef`.
- [ ] A9 **Label keys**: ST `jump-labels.ts` upper-cases, network lower-cases — verify case-insensitivity holds in both.
- [ ] A10 **Three string-literal length rules** — `lower.ts` `decodeIecString` (measured), `string-constant.ts:31`,
      `assignment.ts:81` (raw count over-counts `$` escapes). One decoder in `syntax/literal-value.ts`.
- [ ] A11 **`network-analyze.ts:88` `synthTypeExpr`** loses string length, arrays and pointers.
- [ ] A12 **`lower.ts` `wider` is order-dependent** at equal rank, mixed sign (DINT vs UDINT) — only one order measured.
- [ ] A13 **Gap 14** (transpile-st-to-rust tasks): a declaration's non-literal initializer is never type-checked.

## B. `src/types` is the only home of type knowledge

- [ ] B1 Exported `elementaryRef(name)` / `elemOf(t)`; replace `infer.elem`, `resolve.resolveElementary`,
      `lower.named/boolType/elem`, and redundant re-lookups (`conversion.ts:23/31`, `_shared.ts:90`).
- [ ] B2 Predicates over `string | Type` with an explicit BIT policy: `isIntegerType`, `isNumericType`, `isRealType`,
      `isStringType`, `isBoolType`, `isTemporal`, `inTypeGroup`; switch every hard-coded family/name list (lower,
      `binary-operators`, `intrinsic-operands`, `indexing`, `bit-number` (BIT kept as a named exception), `pointer-conversion`
      (derive, key by name not `renderType`)).
- [ ] B3 Facts on the table: temporal tick unit, mantissa bits, `DEFAULT_STRING_LENGTH`, duration-for-date; switch
      `lower` `UNIT_NS`/`/^L/`/`withStringCapacity`, `infer.durationFor`, `compat.MANTISSA_BITS`.
- [ ] B4 `types/arith.ts`: `commonType` (from `wider`, after A12), `promoteForRuntime` (from `promoted`), exported
      `checkedNegationType`, `exptResultType`, `temporalResultType` (incl. duration × integer), `arithmeticOperandError`
      (from `binary-operators`). Keep run-time vs checked types clearly named. Fix `docs/architecture.md:62`.
- [ ] B5 Literal typing: export `literalType` (after A2), `REAL_LITERAL_TYPE`, `ANY_INT_RANGE`; lower keeps only context
      adoption; switch `enum-init.ts:28`, `constant-overflow.ts:18`.
- [ ] B6 `isSameType` and a shared `checkableType` (or inference types an enum-value reference); switch
      `call-arguments.ts:185/227`, `assignment.ts:51`, `comparison.ts:60`, `_shared.ts:86`.
- [ ] B7 Rendering: `typeToTypeExpr` (for A11), `memberScopeOf` (completion.ts:87 = infer scopeOf); compiler-exact type
      text (`comparison.ts:65`, `subrange.ts:35`, `assignment.ts:78`) into `analysis/messages`.
- [ ] B8 `defaultValueOf(type)` into `transpile/ir` (interp `defaultOf` = emit `defaultLiteral`).

## C. Structure

- [ ] C1 `Document` from `services/shared/resolve-at.ts:32` to `syntax/`.
- [ ] C2 One body iterator: `bodiesAt(offset)`, all-bodies-incl-unparsed, `graphicalBodies()`; replace 7 ST and 6 graphical
      copies; delete `stBodies`; `forEachExpr`/`forEachDecl` to `symbols/bodies.ts`.
- [ ] C3 Network-shared rules out of `checks/`: `analysis/resolution.ts` (`_identifier-resolution`), `analysis/rules/`
      (assignment/narrowing/binary pair rules); stop re-exporting check files; `inheritance.ts:16` cross-group import.
- [ ] C4 Syntax-owned helpers: `syntax/print.ts` (`exprText`, `renderTypeExpr`, statement printing from formatting),
      `spanContains`, `tokenAtOffset`, `nameKey`/`sameName`/`isSelfRef`, tokens kept on `ParseResult`; a network statement
      walker in `network/text/ast.ts` replacing 7 recursions; `collectBareRefs` onto `ast-walk`.
- [ ] C5 `libraryOf(uri)` in symbols; `lower.ts` Standard gate uses it; drop the `_shared.ts:95` shim.
- [ ] C6 Declarative vendor gating in the check list (8 early returns, `activeVendor`), rule gates in a `config.ts` table.
- [ ] C7 `test/support/project.ts`: `diagnose`, `codesOf`, `docSetup`, `libraryFile`; migrate the 76 check tests + 5
      service tests.
- [ ] C8 Dead code: `isNumeric`, `isEnumIsolated`, `networkScopeAt`, `CHECK_TIMING`, `activeVendor`, `stBodies`,
      `resolveAnywhere` export, test-only exports; decide `detectVendor`/`installCorpus`; `reference/error-codes.ts` to test.
- [ ] C9 Split monoliths: `lower.ts` (frame · expr · calls table · literals), `server.ts` `runServer`,
      `network-analysis.ts` → `network/checks/`; `interp` values module.
- [ ] C10 Placement: `network/text` to a syntax-tier folder, `reference/error-code-map.ts` next to `analysis/config`,
      `reachability.ts` incremental half to `server/`, top-level app files to `src/workspace/`.
