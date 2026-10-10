# Design: transpile-restructure

Paths are relative to `packages/volt-lsp-iec/`. "RC n" is root cause n in `openspec/changes/transpile-review-2026-09-29/tasks.md`
("Appendix A/B" is that change's `proposal.md`). "Lean g.i" is item g.i in `openspec/changes/transpile-lean-candidates/tasks.md`.
A ten-hex id such as `5d9850550d` is a construct in the `NOTES` section of `test/conformance/fixtures/map.generated.ts` (776 notes
on 2026-09-29).

This document describes the **target** structure and how to get there. It does not describe the code as it is today. The file list,
symbol names and line numbers below were read on 2026-09-29 while `transpile-fix-all` was still editing `src/`; line numbers are
therefore approximate (±15) and name the code, not a contract. Task 0.1 re-reads them before any move, and every move is
checked by the snapshot (task 0.3), not by line numbers.

**Order.** `openspec/changes/frontend-conformance` runs FIRST and must be archived before this change starts (the executor
`.claude/workflows/execute-change.js` refuses otherwise). It restructures and conforms `src/syntax`, `src/symbols` and `src/types`,
possibly under a `frontend/` root. Every front-end path in this document (`types/predicates.ts`, `symbols/scope-nav.ts`, …) therefore
means "that concern's home in the front-end structure frontend-conformance's archived design.md defines". Section 6 lists what the
transpiler needs from the front-end; task 0.9 checks each against what frontend-conformance delivered, and phase 1.1 builds only
what is still missing, in that structure.

Contents:

1. Principles
2. Target structure (the full tree, then one table per folder)
3. The four models
4. Old → new map (every top-level symbol of `src/transpile/**`)
5. Test structure
6. Scope beyond `src/transpile/`
7. Hand-offs and accepted divergences
8. Tooling definitions
9. Gap register (every gap the design critic raised, and where it is closed)

---

## 1. Principles

### P1. One home per concern

Every rule, fact and walk has exactly one module that owns it. Today the same rule is often written in several places, and the
copies have already drifted:

| Rule | Copies today | Home | Task |
|---|---|---|---|
| EXTENDS walks | 13 sites (12 FB, 1 interface: `interfaceChain`), 3 mechanisms, plus `types/infer` `fbChainSections` | `symbols/scope-nav.extendsChain`, used through `lower/core/chain.ts` | 1.1.2, 1.1.13, 1.7.3 |
| Hand-written IR walkers | 9 | `transpile/ir/walk.ts` | 1.2.3, 1.7.4 |
| The body-lowering pipeline | 5 | `lower/calls/routines.bodyOf` | 1.7.7 |
| The PROGRAM-reentrancy test | 5 inlined + 2 in the init step | `lower/calls/reentrancy.programReentrant` | 1.7.12 |
| The integer store wrap | 4 (`stored`, `fit`, `heldAs`, rotate) | `types/width.storeInteger` (on `wrapToWidth`) for `stored` and `fit`; `heldAs` keeps its integer-only guard, the rotate is no store (6.B.2) | 1.1.6, 6.B.2 |
| BIT-is-BOOL | 7 | `types/predicates.isBoolValued` | 1.1.5, 6.9, 6.B.1 |
| The operand meet | 3 | `lower/values/promote.meet` | 1.7.15 |
| Constant folding | 3 mechanisms (two AST folds, one IR fold) | AST: `types/const/fold` (one typed fold after lean 10.2); IR: `transpile/semantics/fold`; the one lowering entry `lower/values/fold.foldExpr`. The two folds stay two **by design** (§1 P3a) and are held together by `test/conformance/fold-agreement.test.ts`. | 1.8.9, 7.10.2 |
| Nested-lowering diagnostic drain | 12 | `lower/core/nested.ts` | 1.7.6 |
| Field lookup by upper-cased name | about 15 | `lower/places/path.fieldOf` | 1.7.10 |
| Place / instance identity | 5 static-place keys + `pointerKey` + `interfaceKey` + `instanceKey` | `lower/places/path.staticKey` — `sameStep`/`sameTarget` compare through it since 4.15 (`SAME_STEP` folded into `KEY_STEP`); `SUFFIX_STEP` stays (a Rust name, not a key); `pointerKey` (residual tagged pointers, a UNION's members, the ANY holder) and `interfaceKey` (the handle's key) stay | 1.7.11, 4.15 |
| Tag encodings | 3 (pointer tags, interface instance tags, `__inout_binding`) | `lower/core/tags.ts` owns the encoding (0 = none, k+1 numbering). Final homes (4.14): the INSTANCE HANDLE `interfaces/tags.instanceHandle` (interfaces and pointers/references to a whole instance, one table); the residual DATA TAG `pointers/state.recordTarget`/`targetTag` (targets the image cannot hold); `__inout_binding` `calls/last-binding.ts` (the image would make every in-out target escape) | 1.7.19, 4.14 |
| Text formatters | 2, hand-mirrored (TS and Rust) | `semantics/text.ts`, mirrored by `emit/rust/runtime/text.ts`, held by `text.cases.ts` | 1.3.2, 1.5.15 |
| `initOf` | 2 in the emitter | `emit/rust/values.initOf` | 1.5.5, 5.4 |
| The globals parameter list | 4 renderings | `emit/rust/names.globalsParams`/`globalsArgs` | 1.5.3, 7.7.5 |
| Call → callee + parameters | `types/infer` `resolveCallee`, and lowering's `positionalParameters`, `inOutSections`, `positionalOf`, `chainNames` | `lower/calls/parameters.ts`, delegating to `types/infer/callee` where the answer is identical | 1.7.18, 6.B.4 |
| Enum numbering and enum default | `lower/constants.ts` `defaultOfValues`, `enumConstant`, `enumDefault`, `inlineEnumDefault` | `types/enums.ts` (numbering, default value); `lower/values/enums.ts` only turns them into IR | 1.7.14, 5.3 |
| String capacity default | `lower/storage.withStringCapacity`, `commonType`'s `length ?? 0` | `lower/core/lowering.resolve` (the transpiler applies the vendor default; §3.2) | 3.3 |
| Fault messages | literals in interp.ts, values.ts, emit.ts | `transpile/ir/faults.ts` | 1.2.4 |

### P2. Layer rules

Data flows `syntax → symbols → types → lower → ir → {interp, emit/rust}`. `transpile/` as a whole may import only `syntax`,
`symbols` and `types` (today's rule 3). Inside `transpile/` (the amended rule 4 of `scripts/check-layering.ts`):

| Folder | May import (transpile folders) | May import (frontend) | Owns |
|---|---|---|---|
| `ir/` | itself | `syntax` (Span, VarSectionKind), `types` (Type) | The node contract, the generic walkers, the IDE path grammar, fault kinds and texts. No semantics. |
| `semantics/` (NEW) | `ir/`, itself | `types`, `syntax` | What a node means on values: store, convert, arithmetic, builtins, text, the string and memory models, the IR constant fold, instantiation. What lowering's IR fold and the interpreter run, and what the Rust runtime mirrors. |
| `lower/` | `ir/`, `semantics/`, itself | `syntax`, `symbols`, `types` | Every ST decision: types, order, evaluation strategy, defaults, refusals. |
| `interp/` | `ir/`, `semantics/`, itself | `types` | Nothing. It executes. |
| `emit/rust/` | `ir/`, itself | `types` | Nothing. It prints. Its `runtime/` mirrors `semantics/`, and twin tests hold the two together. |
| `pipeline/` | everything in `transpile/` | — | The composition root (lower, then run or emit) for tests and scripts. Nothing in `src/` imports it except the barrel. |
| `index.ts` | everything | — | The public barrel, with explicit named exports. |

Rule 6 (new, all of `src/`, test files included): a file under `src/` may not import from `test/`.

Inside `lower/` the recursion of ST lowering is real (an expression lowers a call, a call lowers its argument expressions), so
most `lower/` folders import each other. Rule 4b fixes the part that must stay acyclic — the **leaves**:

- `lower/diagnostics/` imports no other `lower/` folder;
- `lower/core/` imports only `diagnostics/`;
- `lower/values/` imports only `core/` and `diagnostics/`;
- `lower/project/` imports only `diagnostics/`;
- every other `lower/` folder may import any `lower/` folder, and `entry/` is the only one that imports `project/`.
- a LEAF FILE (`LOWER_LEAF_FILES`: `builtins/arity.ts`, `lower/conditions.ts`) imports no `lower/` folder, and any `lower/`
  file may import it. Amended by 6.B.6 for the three edges the design placed against this rule: `AttributeLookup` is
  declared in `core/shared.ts` (the state that holds it; `project/prepare.ts` hands in a `Map` of that shape, no import);
  the exec oracle's world stays `lower/conditions.ts` as a leaf file (as `project/conditions.ts` it would make `calls/`
  and `expressions/` import `project/`); `foldedCall` lives in `init/initial-values.ts`, its one caller (it lowers through
  `expressions/`, which `values/` may not import).

Why `semantics/` is a separate folder and not part of `ir/`:
- Today the value model hides in `ir/values.ts` and `ir/evaluate.ts` only because rule 4 made `ir/` the one shareable folder.
- The emitter must not import it. A printer that can evaluate starts deciding things.
- The rule becomes checkable: `emit → semantics` is a lint failure.

### P3. The same model, defined once

The interpreter and the Rust implement the same model:
- The TypeScript definition lives in `semantics/`, one file per model.
- The interpreter calls it.
- The Rust runtime snippet in `emit/rust/runtime/<model>.ts` is its mirror, not a second definition.
- Each mirrored model ships a shared case table, `semantics/<model>.cases.ts`, typed by `semantics/cases.ts`
  (`{ name, input, expected, recording?: { fixture, variable } }`). The table is data only.
  - `semantics/<model>.test.ts` runs it against `semantics/`.
  - `test/conformance/runtime-twins.test.ts` (created in phase 1, task 1.5.15) compiles the runtime snippet and runs the same
    table, and checks every case that names a recording against that recording — so a case table cannot drift from the oracle,
    and `src/` never imports `test/`.
  - The "line for line" comments between `prelude.ts` and `values.ts` become an executable check.

**P3a. The two constant folds.** The AST fold (`types/const/fold.constEval`) serves the LSP on code that is never lowered
(declarations, CASE labels, array bounds, diagnostics), and the lowering before any IR exists. The IR fold
(`semantics/fold.constantValue`) serves lowering after conversions were inserted, and is the interpreter's own arithmetic. They
cannot be one function without making `types/` depend on the IR. They are held together like the backends are:
`test/conformance/fold-agreement.test.ts` folds every constant expression the fixtures lower with both, and requires the same value
and type (task 1.8.9). `lower/values/fold.foldExpr` is the one entry lowering calls.

### P4. Nothing downstream re-decides

Lowering resolves every type, element default, initialization order and evaluation strategy into the IR.
- A backend `if` on a type family that changes meaning is a defect of the RC 31 class.
- The emitter maps IR types to Rust through `emit/rust/types.ts`, which consumes only the predicates in `types/predicates.ts`
  (it defines none of its own).
- Evaluation strategy (MUX/SEL laziness, the LIMIT order) is a property of the IR node's contract, not a backend choice (RC 41).
- "Narrow arithmetic" (lean 3) is a lowering rule that produces narrow IR. It is not an emitter peephole, so the interpreter
  runs the same narrow node.

### P5. Size by concern, not by history

- A `src/transpile/**` file stays at 400 lines or less; a test file at 600 or less.
- The oversize files that remain carry ceilings in `scripts/check-size.ts`, and the list may only shrink. On 2026-09-29 it has
  12 entries: `lower/calls.ts` 1629, `emit/rust/emit.ts` 1323, `lower/lower.ts` 777, `lower/storage.ts` 590, `ir/ir.ts` 575,
  `lower/pointers.ts` 495, `lower/interfaces.ts` 475, `ir/values.ts` 462, `lower/builtins.ts` 461; tests `lower/lower.test.ts`
  2155, `interp/interp.test.ts` 1222, `emit/rust/emit.test.ts` 810.
- At the end of phase 1 the list is empty (task 1.9.4).
- Giant single functions are split before files move (§4.0): `lowerInvoke` (~333 lines), `initStep` (~350, with closures),
  `lowerExpr` (~275), `Printer.expr` (~270), `lowerBuiltin` (~185), `lowerStmt` (~175), `emitRust` (~160),
  `lowerCallStatement` (~140), `Printer.stmt` (~140). A function stays at 80 lines or less in the target tree.

### P6. Structure first, and output-neutral

Phase 1 changes no byte of the canonical IR, the emitted Rust, the source map, or any program output. The snapshot tool (task 0.3)
proves it.
- Only the model phases (2-5) and the root-cause phase (6) change values.
- The lean phase (7) changes Rust but not values.
- A consolidation that would change behaviour is not a structure move. It is filed under the root cause or lean item it belongs to,
  and phase 1 keeps the old behaviour behind an explicit, named parameter. **Every such parameter has a removal task** (6.B, 4.15,
  6.A.18); none is left open-ended.
- The public surface changes only by listed, deliberate edits (§2.1.1).

### P7. Tests

- Unit tests sit next to the module they test.
- Cross-backend truth lives in `test/conformance/`.
- A `src` test never imports from `test/` (lint rule 6).
- A test changes only when its premise is wrong on grounds independent of the code. The standard example: the loop-cap test is
  contradicted by the `tr_27_*` recordings. Every changed expectation cites its recording in the commit.
- A test move keeps every title: `scripts/suite-snapshot.ts` (extended to `src/transpile`, task 0.4) is the gate, not a count.

### P8. No fallbacks

- `lowerCodeKind(...) ?? "unclassified"` throws on an unregistered code instead.
- The backends never call a family-zero `typeZero` to invent an element default (after model 4).
- `resolveNamedType` requires an asker (RC 21).
- No barrel re-export kept alive only for an old deep import path: the consumer is changed in the same commit.

### P9. Work that leaves this change is filed, not dropped

A finding that belongs elsewhere (an LSP gap, a transpile-st-to-rust feature) is written into a named openspec change in the same
commit that discovers it (§7). "Filed for the LSP plan" always means a line in `openspec/changes/lsp-transpile-review-gaps/tasks.md`,
created by task 0.7.

---

## 2. Target structure

### 2.0 The whole tree

```
packages/volt-lsp-iec/
  src/
    syntax/
      identifier.ts               NEW   sameName (ST identifier equality)
      literal-value.ts            +     calendarNanoseconds (calendar literal valuation)
    symbols/
      scope-nav.ts                +     extendsChain(scope) — FB and interface EXTENDS, base first, cycle guarded
      index.ts                    +     re-exports precedence.ts
    types/
      index.ts                    +     re-exports every module below
      predicates.ts               NEW   isBit, isBoolValued, isIntegral, holdsIntegerBits, stringKind, isReal, floatBits, hasTextFormat
      width.ts                    NEW   integerOfWidth, wrapToWidth, widthOf, the literal ladder order
      arrays.ts                   NEW   peelArray, elementOf
      defaults.ts                 NEW   typeZero, typeDefault
      enums.ts                    NEW   numberEnumerators, enumDefaultValue
      literal.ts                  NEW   literalType, literalCheckType, literalErrorType, integerLiteralType, contextLiteralType
      conversion-name.ts          NEW   parseConversionName
      arith/  index.ts runtime.ts checked.ts temporal.ts          (from arith.ts + infer.ts result-type rules)
      const/  index.ts constancy.ts fold.ts                       (from const-eval.ts)
      infer/  index.ts expr.ts member.ts callee.ts                (from infer.ts)
      resolve.ts compat.ts elementary.ts type.ts render.ts        (stay; resolve gains qualifiers/asker, elementary loses moved parts)
    transpile/
      index.ts                          the barrel (§2.1.1)
      pipeline/   index.ts  arith|control|calls|aggregates|pointers|time|strings .test.ts
      ir/         index.ts expr.ts stmt.ts program.ts walk.ts path.ts faults.ts
      semantics/  index.ts cases.ts value.ts store.ts convert.ts text.ts parse.ts string.ts arith.ts math.ts
                  builtins.ts operators.ts fold.ts instantiate.ts faults.ts
                  text.cases.ts string.cases.ts numeric.cases.ts
                  memory.ts                                        (only if model 3 chooses the byte arena)
      lower/
        index.ts
        entry/        lower-unit.ts lower-source.ts checks.ts finish.ts
        project/      prepare.ts library-base.ts
        diagnostics/  codes.ts diagnostic.ts
        core/         lowering.ts shared.ts temps.ts nested.ts build.ts chain.ts ast-walk.ts tags.ts
        values/       literals.ts fold.ts enums.ts convert.ts promote.ts
        storage/      layout.ts declare.ts statics.ts addresses.ts bytes.ts unions.ts
        init/         state.ts step.ts sequence.ts fb-init.ts instance-init.ts initial-values.ts temp-resets.ts attributes.ts
        places/       places.ts names.ts self.ts globals.ts bounds.ts path.ts access-guards.ts
        pointers/     state.ts address.ts store.ts deref.ts borrowed.ts cursor.ts any.ts
        expressions/  expressions.ts operators.ts calendar.ts partial-access.ts
        builtins/     arity.ts builtins.ts value-functions.ts system.ts clock.ts conversions.ts sizeof.ts
        statements/   statements.ts assign.ts loops.ts case.ts
        calls/        routines.ts facts.ts variants.ts parameters.ts invoke.ts fb-call.ts outputs.ts binding.ts super.ts
                      property.ts specialize.ts last-binding.ts reentrancy.ts namespace.ts
        interfaces/   state.ts tags.ts lend.ts dispatch.ts query.ts
      interp/     index.ts machine.ts frame.ts calls.ts runner.ts
      emit/rust/  index.ts module.ts structs.ts names.ts types.ts values.ts printer.ts place.ts expr.ts convert.ts
                  builtins.ts calls.ts stmt.ts loops.ts routine.ts
                  precedence.ts                                    (lean 3, task 7.3.8)
                  runtime/  index.ts string.ts text.ts parse.ts numeric.ts pointer.ts
  test/conformance/
    transpile-replay.test.ts map.test.ts lsp-replay.test.ts       (from fixtures.test.ts)
    emit-build.test.ts runtime-twins.test.ts fold-agreement.test.ts backends.test.ts (stays) …
    support/
      recordings.ts display.ts differential.ts rust-access.ts snapshot.ts
      transpile/  tier.ts correctness.ts lint-policy.ts shape.ts edge.ts row.ts   (from transpile-confidence.ts)
      notes/      lean.ts notes.ts render.ts notes.data.ts lean.data.ts
      rustc.ts expected-failure.ts evidence.ts divergences.ts project-libraries.ts … (stay)
    .snapshot/                                                     (gitignored)
  scripts/
    transpile-snapshot.ts  NEW    check-size.ts  NEW    check-citations.ts  NEW
    suite-snapshot.ts      +      (--dirs, src/transpile included)
    dead-exports.ts        +      (--scope, the IR-union exclusion)
    check-layering.ts      +      (rules 4, 4b, 6)
```

Every test file of `src/transpile/**` sits next to its module (`<file>.test.ts`); they are listed in §5, not in the tree.

### 2.1 `src/transpile/` top level

```
src/transpile/
  index.ts            barrel: explicit named exports (2.1.1)
  pipeline/
    index.ts          load(source, name?, libraries) -> Runner   (moved unchanged from transpile/index.ts)
                      lowerAndEmit(source, name?, libraries) -> { pou, emitted }  (NEW helper; replaces the
                      lowerSource+emitRust pair repeated in tests; additive, so phase-1 neutral)
    *.test.ts         end-to-end ST -> lower -> interp tests (from interp.test.ts, split by topic)
  ir/  semantics/  lower/  interp/  emit/rust/   (2.2 - 2.6)
```

`load` keeps its signature and return type in phase 1. A later signature change is not planned; if one is wanted it is its own
task with its consumers listed.

#### 2.1.1 The barrel's exports

- **From `lower`:** `lowerSource`, `lowerPrepared`, `lowerUnit`, `prepareProject`, `libraryBase`, `LibraryBase`, `LibraryFile`,
  `ParsedFile`, `LoweredPou`, `LowerDiagnostic`, `LOWER_CODES`, `LOWER_CODE_PREFIXES`, `lowerCodeKind`, `CLOCK`.
- **From `ir`:** its types (including `IrValue`).
- **From `interp`:** `run`, `Runner`.
- **From `emit/rust`:** `emitRust`, `Emitted`, `rustType`.
- **From `pipeline`:** `load`, `lowerAndEmit`.

`fieldNames`, `snake`, `rustAccess`, `sameName`, `holdsCall`, `peelArray`, `elementOf`, `isBit` and `defaultValueOf` leave the
surface. `index.test.ts` is edited deliberately, one task per removal. Their consumers outside `src/transpile` are changed in the
same task:

| Name | Consumers today | New import |
|---|---|---|
| `rustAccess` | `test/conformance/fixtures.test.ts:47`, `backends.test.ts:31`, `support/transpile-confidence.ts:23`, `test/libraries/{standard,stringutils,util}.test.ts` | `test/conformance/support/rust-access.ts` |
| `isBit` | `fixtures.test.ts:47`, `support/transpile-confidence.ts:23` | `src/types` (`isBit` / `isBoolValued`) |
| `lowerCodeKind` (deep path `transpile/ir/codes.js`) | `fixtures.test.ts:48` | the transpile barrel |
| `LOWER_CODES`, `LOWER_CODE_PREFIXES` (deep path) | `test/corpus/corpus.test.ts:55` | the transpile barrel |
| `STRING_PRELUDE` (deep path `emit/rust/prelude.js`) | `fixtures.test.ts:80`, `support/transpile-confidence.ts:24` | `emit/rust/runtime/index.js` (`runtimeText("string")`) — deep path allowed only for test support, listed in `support/README` |

**The doc comment** keeps the input and reach rule. It points at `test/corpus/corpus.test.ts` for the numbers and at
`lower/diagnostics/codes.ts` for the refusal taxonomy, and no longer copies either (task 7.10.3).

### 2.2 `ir/`: the contract

| File | Single responsibility | From |
|---|---|---|
| `index.ts` | barrel of the files below | ir/index.ts |
| `expr.ts` | `Access`, `Place` (+`guard`), `IrExpr` and every expression node, `IrBuiltinName`/`IrMathName`/`IrBinOp`/`IrUnOp`, and the evaluation contract of each builtin (strict or selected-only, argument order) | ir.ts 97-366 |
| `stmt.ts` | `IrStmt` and every statement node, including `IrLoop` with the contract "one iteration = one body entry". `LOOP_ITERATION_CAP`/`LOOP_CAP_MESSAGE` stay here only until task 2.3 deletes them. | ir.ts 23-40, 368-448 |
| `program.ts` | `IrValue`, `IrSlot`, `IrInit` (fully resolved; no family-zero holes after model 4), `IrLayout`, `IrRoutine`, `IrPou` (with a corrected `init` doc) | ir.ts 47, 450-546 |
| `walk.ts` | `childrenOf(node)` as an exhaustive switch over node kinds (no reflection); `forEachExpr`, `forEachStmt`, `somePlace`, `holdsCall`, `mapPlaces` (the one rewriter), `blocksOf`, `exitsAfter` (the old `hasStatementAfterReturn`; `diverges` / `divergesAll` since 7.5.11, EXIT/CONTINUE/all-return-IF aware), `loopUses` (labels needed); the predicates `touchesOnlyItsOwn`, `writesOnlyLocals`, `reachesDispatch`, `writesGlobal`, `callsIn`, and the init-sequence `reads` with its skip option | ir.ts 83-95; specialize.ts 69-86; emit.ts 140-164; calls.ts 929-946, 1338-1358; lower.ts 308-323; interfaces.ts 465-475; init-sequence.ts 86-132 |
| `path.ts` | the IDE path grammar (`inst.a[3].b`) as segments | interp.ts 296-330; emit.ts 1116-1150 |
| `faults.ts` | `FaultKind` and the one message text per kind (null dereference, division by zero, no dispatch arm, unbound in-out (its own kind, 6.A.28), LN/LOG domain, EXPT domain, index out of range) that both backends print | literals in interp.ts, values.ts, emit.ts |

`LowerDiagnostic`, `LoweredPou` and `codes.ts` leave `ir/` for `lower/diagnostics/`. `defaultValueOf`, `isBit`, `peelArray` and
`elementOf` leave for `types/`.

### 2.3 `semantics/`: the value model

| File | Single responsibility | From |
|---|---|---|
| `index.ts` | barrel | new |
| `cases.ts` | the case-table contract `Case<I, O>` shared by every `*.cases.ts` | new |
| `value.ts` | `Val`, `num`, `bool`, `copy`, `storeAs(value, type)` (the interpreter's four ternaries) | values.ts 17-20, 176-185, 459-462; interp.ts 81/108/161/354 |
| `store.ts` | `fit`: a value as its type holds it (integer width via `types/width.storeInteger`, BIT and BOOL via `types/predicates.isBoolValued`, REAL fround, string via `string.ts`); private `elemName`, `isInt` | values.ts 265-320 |
| `convert.ts` | `convertValue(v, to, from)` = fit∘coerce; `constValue`; `coerce` split into `toBool`, `toReal` (single rounding, RC 47), `realToInt` (the 192-cell table; `I64_MIN`, `I32_MIN`), `toText`, `fromText` | values.ts 358-439; evaluate.ts 182-187; interp.ts 172-173/196-197 |
| `text.ts` | `civilDate`, `calendarText` (+ LDT/LDATE/LTOD, RC 12), `timeText`, `ltimeText`, `durationText`, `lrealText`; private `pad`, `ladder`, `trim` | values.ts 106-174, 337-356 |
| `text.cases.ts` | the formatter case table (recorded `fmt_*` cells, RC 12/32/33 cells) | new; lreal-text.test.ts data |
| `parse.ts` | STRING → number | values.ts 373-395 |
| `string.ts` | the string buffer model (model 2): representation, `len`, `charAt`, `setChar`, assign between capacities, from literal | values.ts 92-104, 300-301 |
| `string.cases.ts` | string-model case table (`tr_34`, `tr_45`, `lib_prim_char_past_length`, M1-M5 of §3.2) | new (phase 3) |
| `arith.ts` | `arith`, `logic`, `eq`, `ord`, `shortCircuit` | values.ts 187-263; evaluate.ts 196-198; interp.ts 208-209 |
| `math.ts` | `MATH`, `logarithm`, `expt` with domain faults (RC 46) | values.ts 22-74; evaluate.ts 90-92 |
| `numeric.cases.ts` | the 192 REAL→int cells (from `fixtures/conversions/real-to-integer-ladder.ts` recordings), then EXPT/LN domain cells (RC 46), MAX/MIN/LIMIT NaN/±0 cells (RC 28), TRUNC cells, int→REAL rounding (RC 47) | new (1.3.8), grown by 6.7, 6.18, 6.19 |
| `builtins.ts` | `builtinValue`: MAX/MIN/LIMIT (compare-select per RC 28), SEL/MUX (per the IR evaluation contract, RC 41), TRUNC, shifts and rotates (BigInt counts, 6.A.4), ABS, char/setchar | evaluate.ts 36-124 |
| `operators.ts` | `unaryValue`, `binaryValue(op: IrBinOp)` | evaluate.ts 127-168 |
| `fold.ts` | `constantValue(expr)`: THE IR constant fold lowering uses (lean 2); private `evaluate`. It answers "not constant" only on a fault — a `RangeError`, as every fault the interpreter throws is (`IecFault` and the index / character-position faults) — and re-throws anything else, a `LoweringBug` included (6.A.9). | evaluate.ts 170-213 |
| `instantiate.ts` | `instantiate(type, init)` over a fully resolved `IrInit` (no `typeZero` hole after model 4) | values.ts 443-458 |
| `memory.ts` | the byte-image model (model 3); only if 4.2 chooses the arena | new |
| `faults.ts` | `IecFault(kind)` (message from `ir/faults.ts`), `LoweringBug`, `HarnessBudget` (loop guard, model 1) | evaluate.ts 28-35 |

`widthOf` (evaluate.ts 23) goes to `types/width.ts`.

### 2.4 `lower/`: every decision

Every file imports `syntax`, `symbols`, `types`, `ir/` and `semantics/` as needed; the `lower/` folder imports follow rule 4b (P2).

| Folder/file | Single responsibility | From |
|---|---|---|
| `index.ts` | explicit exports (the `lower` row of §2.1.1) | lower/index.ts |
| **entry/** | | |
| `entry/lower-unit.ts` | `lowerUnit` (the per-POU pipeline: layout, body, init step, finish, checks), `rootInstance`; the helpers that were closures of `lowerUnit` (`ownMembers`, `asInstance`, `open`) as module functions | lower.ts 64-150, 582-605 |
| `entry/lower-source.ts` | `lowerSource`, `lowerPrepared` (thin over project/) | lower.ts 715-777 |
| `entry/checks.ts` | `representable` | lower.ts 53-61 |
| `entry/finish.ts` | the post-POU fix-point: dispatch arms (interfaces and in-out bindings), `lendToCallees` driving `interfaces/lend.ts`, `bodiesOf`, `onEachTag`, `finishInterfaces` (it is here, not in `core/`, because it imports `interfaces/` and `calls/`, which rule 4b forbids to `core/`) | interfaces.ts 175-187, 405-465; bindings.ts 81-130 |
| **project/** | | |
| `project/prepare.ts` | `prepareProject`, `readFiles`, `ParsedFile`, `LibraryFile`, `LoweringProject`, the `attributesOf` cache (`AttributeLookup` is `core/shared.ts`'s, 6.B.6) | lower.ts 609-715; lowering.ts 23-27 |
| `project/library-base.ts` | `LibraryBase`, `libraryBase`, `bindOnBase`/`unbindFromBase`/`relink` (also used by the LSP replay) | lower.ts 678-700; fixtures.test.ts 1708-1740 |
| **diagnostics/** | | |
| `diagnostics/codes.ts` | `LOWER_CODES`, `LOWER_CODE_PREFIXES`, `LowerCodeKind`, `lowerCodeKind` (throws on unregistered, 1.7.16) | ir/codes.ts 30-194 |
| `diagnostics/diagnostic.ts` | `LowerDiagnostic`, `LoweredPou`, `lowerDiagnostic` | ir.ts 548-575; codes.ts 184-186 |
| **core/** | | |
| `core/lowering.ts` | the `Lowering` frame: `bail`, slot declaration (`slot`, `declared`, `holds`, `inherit`), mode flags (routine, global, conditional depth, loop depth after 2.7), `resolve` (always with an asker; applies the string capacity default after 3.3); the shared type aliases `FbType`, `RoutineSymbol` | lowering.ts 140-370; calls.ts 55-56 |
| `core/shared.ts` | `Shared`, `newShared`, `PendingBody`, `CalledRoutine`: layouts, bodies, the routine cache, the dispatch queue. Model state is held by reference to each model's `state.ts`. | lowering.ts 36-130 |
| `core/temps.ts` | the one temp policy `temp(lw, type, purpose)` (from `tempPlace`/`temp`): a field today (neutral); a statement-scoped local after lean 6 | lowering.ts 259-263, 327-332 |
| `core/nested.ts` | `nested(lw, scope, mode, fn)`: a scratch Lowering plus exactly one diagnostic drain; `declareGlobals(lw, section, prefix)` | 12 drains; places.ts 47-53, storage.ts 139-154, calls.ts 228-229 |
| `core/build.ts` | IR builders `cast`, `binaryOf`, `load`, `constOf`, `ZERO_SPAN` | convert.ts 102-109; lowering.ts 372; lower.ts 766 |
| `core/chain.ts` | `chainUnits(lw, fb)` (base first, cycle safe, over `symbols.extendsChain`), `interfaceChainOf(lw, itf)`, `implementsOf(unit)`, `baseOf`, `chainNames` | 13 EXTENDS walks; lowering.ts 46; calls.ts 93-117; interfaces.ts 47-70 |
| `core/ast-walk.ts` | AST visitors: `exprHoldsCall` (renamed from storage's `holdsCall`), `namesRead`, `callsMade`, `leadingQuery`, `overridesCalled`, `reachedNames`, `borrowedPointerNames` | calls.ts 119-135, 288-328; storage.ts 451-464; interfaces.ts 384-388 |
| `core/tags.ts` | the one tag encoding: `NO_TAG = 0`, `tagOfIndex(k) = k + 1`, `indexOfTag`, the tag key type. The three schemes (pointers, interface instances, `__inout_binding`) number through it. | lowering.ts 131-138; interfaces.ts 72-95; bindings.ts 20-21 |
| **values/** | | |
| `values/literals.ts` | IR constants from literal tokens: `durationOf`, `calendarOf`, `typedRealOf`, `stringLiteralText`, `inTicks`, `TEMPORAL_LITERAL_KINDS` (valuation in `syntax/literal-value`, typing in `types/literal`) | constants.ts 133-148, 243-293 |
| `values/fold.ts` | the ONE lowering fold entry `foldExpr(lw, ast)`: `foldConstant`, `foldsToConstant`, `integerFoldType` (`foldedCall` is `init/initial-values.ts`'s, 6.B.6) (+`LINT_MAX`), `convertedConstant`, `enumValueOf`, over `types/const` (AST) and `semantics/fold` (IR) | constants.ts 157-241; storage.ts 433-445; convert.ts 41-57 |
| `values/enums.ts` | `enumStorage`, `enumConstant` — IR only; numbering and the default value come from `types/enums.ts` | constants.ts 28-128 |
| `values/convert.ts` | `convert`, `retype`, `adopt`, `valueAs` (value rule from `semantics/convert`) | convert.ts 10-40, 59-98 |
| `values/promote.ts` | the ONE operand meet `meet(lw, operands, context)` for binary operators, N-ary builtins and the FOR compare, over `types/arith/runtime`; later the narrow-arithmetic rule (lean 3) | expressions.ts 61-67/253-279; builtins.ts 452-461; statements.ts 321-323 |
| **storage/** | | |
| `storage/layout.ts` | `storageOf`, `buildLayout`, private `INSTANCE_STORAGE`, `holdsInstance`; `withStringCapacity` until 3.3 deletes it | storage.ts 29-123, 575-584 |
| `storage/declare.ts` | `declareVars`, `declareInOuts`, `declareOpenBounds`, duplicate-name refusal | storage.ts 191-294, 550-574 |
| `storage/statics.ts` | `declareStatics` (via `core/nested.declareGlobals`) | storage.ts 139-161 |
| `storage/addresses.ts` | AT and `%` addresses: `parseAddress`, `addressClash`, `claimAddress`, `addressPlace`, `addressBits`, `reserveAddress`, `bindAddress`, `addressSharedByInstances` | storage.ts 295-432; lower.ts 155-175 |
| `storage/bytes.ts` | `byteSize`, `fieldBytes` (RC 26), `byteOffset`, `alignUp` | bytes.ts 34-144, 188 |
| `storage/unions.ts` | `overlayBytes`, `unionOf`, `refuseUnionWrite`, `unionCopies` | unions.ts |
| **init/** (model 4) | | |
| `init/state.ts` | `pendingInits`, the init sequence under construction | lowering.ts 285-303 |
| `init/step.ts` | orchestration of a POU's ordered init step (instance tree, program visits, final order; the old `initStep` body with `rootsOwn`, `layoutFields`, the globals clear) | lower.ts 229-580 (orchestration 468-580) |
| `init/sequence.ts` | `buildInitSequence`: declaration-ordered initializer statements and their refusals; private `laterThan`; `insideInstance` goes to `places/path.typeAlong` | init-sequence.ts |
| `init/fb-init.ts` | `fbInits`, `reachesFbInit` (holdsFbInit + reaches merged), `fbInitHeld`, FB_Init arguments (`declaredArgs`, `recordedArgument`, `globalArguments`), `unreached`, `visit`, reapplied structured initializers (`fbInitCalls`, `reapplied`, `slotCalls`, `declaredInits`) | lower.ts 259-470 |
| `init/instance-init.ts` | the per-FB-type `__INIT` routine (via `calls/routines.once`) | lower.ts 197-228 |
| `init/initial-values.ts` | `scalarInit`, `aggregateInit`, `aliasInit`, `runnableInit`, enum start, element defaults (from `types/defaults`) | storage.ts 446-449, 474-549, 585-590 |
| `init/temp-resets.ts` | `resetTemps(lw)`: VAR_TEMP per-call reset (RC 24/30); the one call site | storage.ts 162-190; lower.ts 117; calls.ts 821, 1313 |
| `init/attributes.ts` | `INIT_ATTRIBUTE`, instance-path strings (`pathFields`), `call_after_global_init_slot` methods (`initMethod`) | lower.ts 176, 229-258 |
| **places/** | | |
| `places/places.ts` | `lowerPlace`, `lowerAccess`, `bitPlace`, `Indexed` | places.ts 128-281 |
| `places/names.ts` | name precedence: local, the routine's in-outs, statics, fields, globals, enum, property (RC 19). The one resolver; `methodOf`, `ownMember`. | places.ts 164-187; lowering.ts 229-232; calls.ts 85-90, 667-676 |
| `places/self.ts` | `selfFb`, `thisPlace`, `instancePlace` (the current instance as a place) | calls.ts 59-76 |
| `places/globals.ts` | `globalPlace`, `qualifiedGlobal`, `declareGlobal`, `listVariableShadows` | places.ts 19-87 |
| `places/bounds.ts` | `boundOf`, `refuseOpenArray`, `openDims`, `boundName` | places.ts 88-127; lowering.ts 375-380 |
| `places/path.ts` | `rootType`, `typeAlong(lw, place, visit)` (also `insideInstance`), `fieldOf(lw, typeName, name)` (the one field lookup), `staticKey(place, options)` (the one place identity: `stringIdentity`, `staticPath`, `placeKey`, `instanceKey`, `suffixOf`/`sameStep`, `sameTarget`, `sameStorage`; `pointerKey` and `interfaceKey` built on it), `throughInstance` | bytes.ts 13-33, 118-139; unions.ts 26-39; interfaces.ts 102-118; bindings.ts 25-51; init-sequence.ts 149-172; calls.ts 484-495, 1361-1366; specialize.ts 35-44, 97-110; pointers.ts 477-495; about 15 field lookups |
| `places/access-guards.ts` | `guardWrite(place, checks)` (through-reference, VAR_IN_OUT CONSTANT, union, ARRAY[*]): `through`, `refuseConstantWrite`; `loadValue` | pointers.ts 436-476; unions.ts 42-49; places.ts 112-116 |
| **pointers/** (model 3) | | |
| `pointers/state.ts` | `PointerTarget`, `Cursor`, the representation contract (tag encoding via `core/tags.ts` today; replaced by the model-3 decision), `pointerKey`, `recordTarget`, the pointer maps (`boundPointers`, `anyInputs`, `anyTargets`, `borrowedPointers`, `cursors`) | lowering.ts 29-35, 126-215; pointers.ts 17-54 |
| `pointers/address.ts` | `adrOperand` (the one ADR recognizer), `addressOf`, `pointerValue` | pointers.ts 55-160; calls.ts 337-350; bytes.ts 173-174 |
| `pointers/store.ts` | `storePointer`, `bindReference` | pointers.ts 340-386, 411-435 |
| `pointers/deref.ts` | `pointeePlace`, `pointerArms`, `selectThrough`, `nullDeref`, `throughReference`, `describePointer`, `unsuppliedInput`, `storeThrough` (RC 14) | pointers.ts 161-234, 246-283, 387-410; places.ts 128-132; statements.ts 18-53 |
| `pointers/borrowed.ts` | form 2 (a pointer to a borrowed in-out): `borrowedInOut`, `BORROWED`, `borrowedInputsOf`, `borrowedPointerSlots`, the form-2 part of `lowerInvoke` | calls.ts 190-193, 334, 351-361, 609-617, 1126-1150; pointers.ts 235-245 |
| `pointers/cursor.ts` | STRING cursors: `CURSOR`, `TEXT_OF`, `CursorArgument`, `cursorArgumentTypes`, `cursorArgument`, `pointedString`, `cursorInputsOf`, `cursorOf`, `cursorChar`, `cursorStringChar`, `cursorCharAt`, `cursorString`, cursor indexing, the cursor part of `lowerInvoke` | pointers.ts 284-339; calls.ts 194-196, 416-519, 598-608, 1084-1125; places.ts 212-221 |
| `pointers/any.ts` | ANY inputs: `ANY_TARGET`, `anyInputsOf`, `anyArgumentTypes`, `diSize`, `pValue` (RC 17), the ANY part of `lowerInvoke` | calls.ts 186-189, 331, 390-415, 589-592, 1064-1083, 1217-1224; expressions.ts 286-292; pointers.ts 101-106 |
| **expressions/** | | |
| `expressions/expressions.ts` | `lowerExpr` dispatch (literal, name, deref, call) | expressions.ts 78-160 |
| `expressions/operators.ts` | unary and binary operators (`BIN_OPS`, `COMPARISONS`, `LIFTED` private), pointer and interface null compares, STRING compare (RC 38 via `types/compat`), duration scaling | expressions.ts 40-77, 160-292 |
| `expressions/calendar.ts` | `calendarArithmetic` (RC 40) | expressions.ts 352-375 |
| `expressions/partial-access.ts` | `.%X`/`.%B`/`.%W` reads | expressions.ts 299-321 |
| **builtins/** | | |
| `builtins/arity.ts` | `BUILTIN_ARITY`, `isConstantCallee`, `oneArgument(call)` (a leaf, which breaks the constants↔builtins cycle) | builtins.ts 57-74; constants.ts 224-229; 5 arg checks |
| `builtins/builtins.ts` | `lowerBuiltin` dispatch | builtins.ts 87-160 |
| `builtins/value-functions.ts` | MAX/MIN/LIMIT/SEL/MUX (RC 41 contract), TRUNC, ABS, shifts, rotates (`checkedBits`), EXPT, `UNARY_MATH` | builtins.ts 41-56, 75-86, 160-262 |
| `builtins/system.ts` | MOVE, `__POUNAME`, `__ISVALIDREF`, LOWER_BOUND/UPPER_BOUND, the `__QUERYINTERFACE` entry | builtins.ts 100-150 |
| `builtins/clock.ts` | `CLOCK`, `CLOCK_KEY`, TIME(), LTIME() | builtins.ts 36-40 + clock arms |
| `builtins/conversions.ts` | `lowerConversion`, `DATE_PART`, the text gate (RC 11/12/31) | builtins.ts 271-451 |
| `builtins/sizeof.ts` | `sizeOf`, `adrDifference` (SIZEOF, ADR(a)-ADR(b)) | bytes.ts 145-187 |
| **statements/** | | |
| `statements/statements.ts` | `lowerStmt` dispatch, `lowerBlock` (conditional depth), IF/ELSIF, RETURN | statements.ts 54-77, 114-290 (dispatch part) |
| `statements/assign.ts` | the assign dispatcher, `lowerChain`, latch S=/R=, `refuseImplicitString` (implicit-conversion refusal via `types/compat`) | statements.ts 78-113 + assign arm |
| `statements/loops.ts` | `lowerFor`, WHILE/REPEAT, loop depth, EXIT/CONTINUE (model 1) | statements.ts 228-246, 290-348 |
| `statements/case.ts` | CASE selector and labels (RC 37) | statements.ts 203-226 |
| **calls/** | | |
| `calls/routines.ts` | `bodyOf(unit)` (the one body pipeline), `once` (the one routine cache), `routineLowering`, `calledRoutine`, `keptVariables`, `declareOutputs`, `calledLayout`, `baseBody`, `isBodylessLibrary`, `fail` | calls.ts 148-168, 197-287, 520-666, 796-834, 1288-1337; lowering.ts 280-305 |
| `calls/facts.ts` | `routineFacts` | calls.ts 169-178 |
| `calls/variants.ts` | routine identity by symbol (RC 21), `typeKey` (RC 42), variant key (lean 4.5) | calls.ts 362-376, 530-542 |
| `calls/parameters.ts` | `positionalParameters`, `inOutSections`, `prefixed`, `positionalOf` — lowering's parameter view, delegating to `types/infer/callee` where identical (6.B.4) | calls.ts 104-106, 138-147, 183-185, 377-389 |
| `calls/invoke.ts` | `lowerInvoke` (a call expression), after its ANY/cursor/borrowed parts were extracted (1.6.1) | calls.ts 955-1288 |
| `calls/fb-call.ts` | `lowerCallStatement`, `storeOpenBounds` | calls.ts 1443-1600 |
| `calls/outputs.ts` | output bindings: the type rule (RC 43), copy-out after the call (RC 20) | calls.ts 1042-1051, 1226-1232, 1526-1550 |
| `calls/binding.ts` | `bindInOut`, `bindPlace`, `lendGuards`, `aliases`, `holding`, freeze, `movedInOut`, the shadowed in-outs | calls.ts 77-81, 835-920, 1197-1272, 1601-1625; lowering.ts (shadowed in-outs) |
| `calls/super.ts` | `lowerSuperCall`, `isSuper` | calls.ts 82-84, 1376-1442 |
| `calls/property.ts` | `propertyRoutine`, `propertyAccess`, `lowerPropertyGet`, `lowerPropertySet` | calls.ts 677-795 |
| `calls/specialize.ts` | `InFrame`, `inFramePlace`, `specializeRoutine` (caches via `once`); private `isInFrame`, `fieldStep`, `isPlace` | specialize.ts |
| `calls/last-binding.ts` | `registerBodyCall`, `lastBinding` (RC 16); private `FIELD` (`__inout_binding`, numbered through `core/tags.ts`), `DINT` | bindings.ts |
| `calls/reentrancy.ts` | `programReentrant` (the one test), `touchesOf` (the touched set), `inGlobals`, `ownProgram` | calls.ts 159-182, 760-764, 921-928, 990-998, 1316-1318, 1367-1375, 1502-1509; lowering.ts 221; lower.ts 286-293 |
| `calls/namespace.ts` | library namespaces (`namespaceOf`) | calls.ts 1626-1629 |
| **interfaces/** | | |
| `interfaces/state.ts` | lends, query hoisting | lowering.ts 174, 224 |
| `interfaces/tags.ts` | `tagOf`, `interfaceKey` (on `places/path.staticKey`), `elementOfArray`, `heldBy`, `tagsOf`, `storeInterface`, `interfaceArgument`, `implementsInterface` (over `core/chain`) | interfaces.ts 47-128, 155-228 |
| `interfaces/lend.ts` | `heldAt`, `instanceRelative`, `lendPlace`, `refusedLends`, the per-callee lend step `entry/finish.ts` drives | interfaces.ts 129-154, 429-464 |
| `interfaces/dispatch.ts` | `dispatch`, `interfaceCall`, `interfaceProperty`, `accessorCall`, `interfacePropertyGet`/`Set` | interfaces.ts 229-337 |
| `interfaces/query.ts` | `lowerQueryInterface`, `isQuery`, `queryInto`, `queryCondition` (RC 18) | interfaces.ts 338-404 |

### 2.5 `interp/`

| File | Responsibility | From |
|---|---|---|
| `index.ts` | barrel (no longer re-exports `Val`) | interp/index.ts |
| `machine.ts` | `Machine.expr`, `stmt`, `block`; `Signal` | interp.ts 39-43, 170-275 |
| `frame.ts` | `locate`, `read`, `write`, `bind`, `writeBack`: the place and pointer runtime; `Cell` | interp.ts 44-45, 96-168 |
| `calls.ts` | one frame builder for routine invoke and FB call | interp.ts 66-95, 251-263 |
| `runner.ts` | `run`, `Runner`, `resolvePath` (on `ir/path` + `frame.locate`, no second walker), and harness options (the loop budget from model 1) | interp.ts 278-358 |

`sameName` (interp.ts 289-292) goes to `syntax/identifier.ts`.

### 2.6 `emit/rust/`

| File | Responsibility | From |
|---|---|---|
| `index.ts` | the emitted-surface contract doc (the temp list derived from `names.ts` purposes, 7.10.3) plus narrow exports | index.ts |
| `module.ts` | `emitRust`, `Emitted`: assembles structs, init/scan, routines and the runtime closure; the source-map shift | emit.ts 27-38, 1158-1323 |
| `structs.ts` | `printStruct(name, slots, names, derives, span?)` for the four blocks, plus `defaultImpl` | emit.ts 334-343, 1170-1250 |
| `names.ts` | `snake`, `RUST_KEYWORDS`, `RESERVED_FN_NAMES` (new, call, scan, clone, to_owned, clone_into, into, try_into — RC 29, landed upstream in 3dd773b9d7), `fieldNames`, `rustName`, `routineFnNames`, `baseFnName`, `tmp(purpose, n)`, `globalsParams`/`globalsArgs` (one list) | emit.ts 96-100, 116-137, 166-188, 1007-1050, 1167-1176 |
| `types.ts` | `rustType`, `inoutType`, `genericList`, `isCopy` (which also drives the derives), `stringType`, `isString`, `isReal32` — all built on `types/predicates` (`stringKind`, `floatBits` are consumed, not defined, here) | emit.ts 41-95, 190-215, 223-226, 316-320 |
| `values.ts` | `literal`, `shortestF32`, `byteString`, `unitsLiteral`, the ONE `initOf(type, init)` (two until 5.4) | emit.ts 101-115, 196-222, 227-271, 415-435 |
| `printer.ts` | the `Printer` state (lines, indent, `withUri`, source map, `Frame`, `inFrame`, `push`, the `tmp` counter, `loopCount`), `guarded`/`guardLine` (one style), `lend`, `lendMut`, `copiesBack`, `lentCopies` | emit.ts 377-480, 545-554, 989-1006 |
| `place.ts` | `place` (index minus lower bound, one form), `movedOut`, `stringPath` | emit.ts 211-216, 481-544 |
| `expr.ts` | the `expr` dispatch, const, fresh, load, unary, binary, `negated`, `WRAPPING`, `INFIX`, `INVERSE`, `unparen`/`unparenHead` (until 7.3.8 replaces them with `precedence.ts`) | emit.ts 272-308, 358-376, 555-660, 798-841 |
| `convert.ts` | every conversion (RC 31/12/32 in one place): the convert arm, `castTo`, `fromF64` | emit.ts 309-315, 321-333, 661-715 |
| `builtins.ts` | a table from builtin name to printer (RC 28/41/46), `RUST_MATH` | emit.ts 344-357, 716-797 |
| `calls.ts` | invoke, dispatch, select, the call statement, one `callArguments`, one `moveOutProgram` | emit.ts 582-648, 960-988 |
| `stmt.ts` | the `stmt`/`block` dispatch, assign, if/elsif, switch, return, eval | emit.ts 842-904, 955-959 |
| `loops.ts` | loop, break, continue; labels from `ir/walk.loopUses` (model 1, lean 5) | emit.ts 905-954 |
| `routine.ts` | `printRoutine`, FB `call()`, one parameter builder, the allow attributes | emit.ts 1051-1115, 1208-1236 |
| `runtime/index.ts` | the helper registry `{ id, deps, rust }`; `runtimeText(id)`; in phase 1 it reproduces today's gating exactly; from 7.1.2 the printer calls `use(id)` and `module.ts` appends the dependency closure (lean 1) | emit.ts 1263-1313 |
| `runtime/string.ts` | IecStr (model 2), mirrors `semantics/string.ts` | prelude.ts 15-75 |
| `runtime/text.ts` | `iec_*_text`, mirrors `semantics/text.ts` | prelude.ts 77-111 |
| `runtime/parse.ts` | `iec_parse_real`, `iec_parse_int`, mirrors `semantics/parse.ts` | prelude.ts 113-157 |
| `runtime/numeric.ts` | `iec_r2i32/64`, `iec_div`, `iec_log`, `iec_expt` (RC 46), `iec_trunc_i32` (lean 9.2), `iec_max`/`iec_min` | emit.ts 1268-1301; prelude.ts 74-75 |
| `runtime/pointer.ts` | `iec_deref` (model 3 may add more) | emit.ts 1264-1267 |

`prelude.ts` is deleted, and so is `emit.ts`. `rustAccess` moves to `test/conformance/support/rust-access.ts`.

### 2.7 `types/`, `symbols/` and `syntax/` changes the transpiler needs

The front-end homes below are what the transpiler needs (§6). frontend-conformance put the front-end under `src/frontend/`, so every
path here is `src/frontend/<layer>/…` (task 0.9, 2026-10-07: rewritten to the real files; "exists" = the file is in the tree today,
"planned" = the 1.1 task that creates it). Where frontend-conformance already gives a concern a home, that home wins and the row
reads as "use it".

| File | Responsibility | From |
|---|---|---|
| `frontend/types/index.ts` (exists) | re-exports every module below (architecture.md mechanism 2: consumers import `from "../types"`, never a deep path) | types/index.ts |
| `frontend/types/predicates.ts` (exists; the transpiler's set planned, 1.1.5) | `isBit(t)`, `isBoolValued(t)` (BIT or BOOL), `isIntegral(t)`, `holdsIntegerBits(t)`, `stringKind(t)`, `isReal(t)`/`floatBits(t)`, `hasTextFormat(t)` (split from `isTemporal`, RC 12). The one home; `emit/rust/types.ts` consumes them. | elementary.ts 287-332; ir.ts 60-64; inline copies |
| `frontend/types/width.ts` (exists; `widthOf` planned, 1.1.6) | `integerOfWidth`, `wrapToWidth(value, elem)` (the one store wrap), `widthOf`, the literal ladder order | arith.ts 84-87; const-eval.ts 182-186; convert.ts 87-98; values.ts 302-305; evaluate.ts 23; infer.ts 95/426/471; elementary.ts 238 |
| `frontend/types/arrays.ts` (planned, 1.1.3) | `peelArray`, `elementOf` | ir.ts 66-81 |
| `frontend/types/defaults.ts` (exists; `typeZero`/`typeDefault` planned, 1.1.4) | `typeZero` (was `defaultValueOf`), `typeDefault(type)` (enum default via `types/enums`, alias initializer, alias arrays, element defaults: RC 25) | ir.ts 49-58; resolve.ts 118-131; storage.ts 201-217 |
| `frontend/types/enums.ts` (exists: `enumMemberValue`, `enumDefault`, `inlineEnumDefault`) | `numberEnumerators(enum)` (the one numbering; was `defaultOfValues` + `enumConstant`'s numbering) and `enumDefaultValue(enum)` (was `enumDefault`/`inlineEnumDefault`'s value part). An enum's numbering is a type fact: the LSP's CASE-label and range checks read it too. | constants.ts 50-128 |
| `frontend/types/literal.ts` (exists; `contextLiteralType` open, H5) | `literalType`, `literalCheckType`, `literalErrorType`, `integerLiteralType`, `contextLiteralType` (with the range rule: RC 6/36) | infer.ts 323-374; elementary.ts 245; constants.ts 316-329 |
| `frontend/types/conversion-name.ts` (exists) | `parseConversionName` | elementary.ts 260 |
| `frontend/types/arith/runtime.ts` (exists) | `commonType`, `promoteForRuntime`, the constant-fold meet type | arith.ts 17-41, 97-101 |
| `frontend/types/arith/checked.ts` (exists; NOT and bitwise result types are in `arith/operators.ts`, `exptResultType` in `frontend/types/builtins.ts`) | `checkedMeetType`, `checkedNegationType`, NOT and bitwise result types, typed-literal sum, `exptResultType` | arith.ts 63-120; infer.ts 87-96, 420-429, 465-497 |
| `frontend/types/arith/temporal.ts` (exists) | `temporalResultType`, `durationFor` (RC 40) | arith.ts 130-154 |
| `frontend/types/const/constancy.ts` (exists) | `constancyOf` | const-eval.ts 26-53 |
| `frontend/types/const/fold.ts` (exists; `declaredValue` is what `heldAs` was) | `constEval`, `heldAs` (on `width.wrapToWidth`); one typed fold after lean 10.2; `**`, `&` and REAL MOD removed (6.A.20); a constant read in its type's run-time width, an initializer folded in its declared type's context (6.A.29) | const-eval.ts 64-284 |
| `frontend/types/layout.ts` (NEW, 6.A.31) | the measured byte layout: `typeBytes` (the front-end's SIZEOF), `packFields` (the field-packing rule lowering's `storage/bytes` packs with) | lower/storage/bytes.ts's loop |
| `frontend/types/resolve.ts` (exists) | asker required (RC 21); qualifiers (6.A.26); subranges (6.A.25); alias default. It does **not** apply the string default capacity (type.ts:36-38 stands; §3.2). | resolve.ts |
| `frontend/types/infer/expr.ts`, `member.ts`, `callee.ts` (exist) | inference split; `fbChainSections` on `symbols.extendsChain`; the orphan doc at infer.ts:258 (lean 10.4) deleted in the move | infer.ts |
| `frontend/symbols/extends.ts` (exists; "incomplete" is `frontend/symbols/scope-nav.ts` `hasUnresolvedBase`) | `extendsChain(scope)`: base first, cycle guarded, reports incomplete; for FBs and interfaces. `precedence.ts` is re-exported from the barrel. | scope-nav.ts 32-42, 74-83 |
| `frontend/syntax/identifier.ts` (exists) | `sameName` | interp.ts 289-292; compat.ts 107 |
| `frontend/syntax/literal/calendar.ts` (exists) | `calendarNanoseconds` (calendar literal valuation). `inTicks` does **not** move here: it reads `elemOf(type).tickNs` from `types/`, which `syntax/` may not import; it goes to `lower/values/literals.ts`. | constants.ts 294-313 |

### 2.8 Rows added to architecture.md's ownership map

- the value semantics (`transpile/semantics`)
- the IR walk (`transpile/ir/walk`)
- the integer store wrap (`types/width`)
- BIT-as-BOOL and the type predicates (`types/predicates`)
- literal typing (`types/literal`)
- type defaults (`types/defaults`)
- enum numbering and enum default (`types/enums`)
- arithmetic result types (`types/arith/*`)
- the EXTENDS chain, FB and interface (`symbols/scope-nav.extendsChain`)
- the transpiler input assembly (`lower/project`)
- the lowering's call parameter view (`lower/calls/parameters`, over `types/infer/callee`)
- place identity (`lower/places/path.staticKey`) and the tag encoding (`lower/core/tags`)
- the Rust runtime (`emit/rust/runtime`, mirrored by `semantics` through `*.cases.ts`)
- fault messages (`transpile/ir/faults`)
- the two constant folds and their agreement test (§1 P3a)

---

## 3. The four models

Each model's decision section is written after its measurement task (2.1, 3.1, 4.1, 5.1) and committed before any code (2.2, 3.2,
4.2, 5.2), appended to this file as "§3.n Decision". The questions, the options and the deciding fixtures below are fixed now. The
choice is not.

### 3.1 Loops (model 1): RC 27, 35, 36, 39; RC 13's transpiler half; RC 13 as regression

**Home.**

| Part | File |
|---|---|
| Lowering | `lower/statements/loops.ts` |
| IR contract | `ir/stmt.ts` `IrLoop` |
| Interpreter | `interp/machine.ts` (loop), `interp/runner.ts` (harness budget), `semantics/faults.ts` (`HarnessBudget`) |
| Rust | `emit/rust/loops.ts` |
| Walker | `ir/walk.ts` `loopUses` |

**Questions and options.**

1. **Is there a cap in the semantics?** CODESYS has none (`tr_27_loop_cap_for_1000000`, `_for_1000001`, `_repeat_1000001`,
   `_while_5000000`).
   - (a) Delete the cap from `ir/`, the interpreter and the Rust. The harness relies on a process timeout (Rust) and a
     `run(…, { loopBudget })` option (interpreter) that raises `HarnessBudget`, which is not an `IecFault`.
   - (b) Keep a guard in the emitted Rust behind `#[cfg(volt_loop_guard)]`, counting one iteration per body entry in both backends.
   - Measure first: the interpreter's wall time on `tr_27_loop_cap_while_5000000` with no cap. Also which fixtures and tests reach
     `LOOP_CAP_MESSAGE` today (a grep over recordings, `emit.test.ts:398-439`, `index.test.ts:10-15`), and how the harness tells a
     CODESYS stop (for example `tr_46_exptdom_zero_pow_minus_one`, recorded as a timeout) from a runaway loop.
   - Lean 5.1 (`manual_assert` 1502, notes `02b031c773`, `5ba97e5557`, `d9d57311e3`, `6bf6856d37`) prefers (a).
2. **Counting rule if any guard survives:** one iteration = one body entry, the same in both backends, tested at CAP and CAP+1.
3. **FOR step (RC 35).** What the recordings already decide:
   - A folded constant step is wrapped to the counter width, and its direction comes from the signed literal:
     `tr_35_for_byte_step_minus_one`, `tr_35_for_uint_step_minus_two`; `tr_35_for_byte_step_255` = 0 passes.
   - A step whose type does not convert implicitly to the counter's is refused by CODESYS: `tr_35_for_byte_runtime_int_step`
     (an INT variable step on a BYTE counter) and `tr_35_for_sint_step_300` (a folded 300 on SINT) are build errors.
   - **A runtime step of a convertible type is NOT refused.** `callshape_for_runtime_step` is recorded and lowers today, and
     `lower.test.ts:278` ("a FOR step decided at run time") and `lower.test.ts:1076` ("a FOR reads its limit and its step on every
     pass — a runtime step decides the direction") pin it. The rule is therefore **"refuse a step whose type does not convert
     implicitly to the counter type (`types/compat.isAssignable`)"**, not "refuse every runtime step".
   - Measure (2.1): whether CODESYS re-evaluates a runtime step expression every pass — record `for_runtime_step_changed_in_body`
     (the body changes the step variable) and `for_runtime_step_same_type` (an INT variable step on an INT counter). The existing
     `callshape_for_bounds_changed_in_body` covers the limit only. The answer decides whether the two tests above keep their
     premise, and whether lean 7.5.9 may hoist the step.
4. **FOR limit (RC 36 and RC 13).** Two cases that must be told apart:
   - A **literal** limit is lowered in its own type, not with the counter as the expected type, and the compare runs in the meet
     (`tr_36_for_literal_limit_beyond_counter`: n = 300, small = 44). CODESYS accepts it.
   - A **typed** limit wider than the counter (a DINT variable, a DINT expression, `UPPER_BOUND`) over an INT counter is refused by
     CODESYS ("Cannot convert type 'DINT' to type 'INT'": `for_limit_wider_than_counter_dint_var`, `_dint_expr`,
     `_upper_bound`, rated `lsp-gap`). The transpiler lowers them today (RC 13's fix made them compile). The transpiler must refuse
     them with the implicit-conversion code (task 2.6); the LSP half is handed off (§7.1).
   - `for_limit_wider_than_counter_uint_n_minus_1` (3 passes, u = 3) and the `5 TO -5 BY -1` case (11 passes, sc = -6) stay
     confirmed.
   - Measure: FOR to the counter type's maximum (`FOR i := 0 TO 32767` on INT with an EXIT guard): does the counter wrap and the
     loop never end? Unrecorded; it decides whether the loop may be emitted as a Rust `for` range (lean 5.4).
5. **EXIT/CONTINUE outside a loop (RC 39).** Lowering tracks loop depth beside `conditional` and refuses at depth 0 with a registered
   code (`cc2_exit_outside_loop`; CODESYS: "No enclosing loop of which to exit"). The fixture is rated edge `not-run`, rust
   `rejected` today; after the fix the transpiler refuses it and its `rust`/`tier` columns disappear.
6. **Labels.** Whether a loop needs `'loop_N`/`'body_N` is decided by an IR pre-scan (`ir/walk.loopUses`), not by rewriting printed
   lines (`emit.ts:934-935`). Output-neutral if the text is identical; the prerequisite for lean 5.2.

**What changes in tests.**
- `emit.test.ts:398-439` pins the cap text. Its premise is contradicted by the `tr_27` recordings, so it is deleted and replaced by
  `emit/rust/loops.test.ts` plus a CAP/CAP+1 conformance boundary test.
- `LOOP_ITERATION_CAP` and `LOOP_CAP_MESSAGE` leave `index.test.ts`.
- `lower.test.ts:278` and `:1076` (then in `places/bounds.test.ts` and `statements/loops.test.ts`) stay unless
  `for_runtime_step_changed_in_body` contradicts "reads its step on every pass"; then the expectation changes citing that
  recording.
- `emit.test.ts:696` ("a FOR whose limit is a different type", then `loops.test.ts`) changes for the typed-limit refusal, citing
  the `for_limit_wider_than_counter_*` recordings.

### §3.1 Decision: loops (task 2.2, 2026-10-08, on 2.1's measurements)

**Target.** No loop bound in the semantics; FOR step and limit judged as CODESYS judges them; labels from the IR. Most of it
already exists (2.1: RC 27 landed in f052467157, RC 35/36/39 in `lower/statements/loops.ts`); what is left is one refusal, one
replay hole and one printer rewrite.

**The cap: option (a), as built, under the names that exist.** `run(pou, { loopGuard })` throws `LoopGuardError` (a
`RangeError`, not an `IecFault`); `emitRust(pou, { loopGuard })` prints the assert; the user's emission (`rate:fixtures` `shown`)
carries none. Deciding measure: no cap is needed for speed (`tr_27_*` with no guard: 141–662 ms).
- Rejected: (b) `#[cfg(volt_loop_guard)]` (the guard is already an emit option; a cfg is a second switch); renaming to
  `loopBudget`/`HarnessBudget` (task 2.3's wording: 17 files of churn, no behaviour).
- **Counting rule:** one body entry after a head test = one pass, both backends; already pinned at N and N+1 for FOR/WHILE/REPEAT
  (`pipeline/control.test.ts`, `emit-build.test.ts` guard 3 vs 2). It stays.
- **The hole 2.1(c) found:** `compareFault` runs `run()` unguarded, and only `execSkip` keeps a runaway out (the error text cannot:
  `arithedge_uint_div_by_zero` carries the done-flag text). `compareFault` runs under `HARNESS_LOOP_GUARD`; a `LoopGuardError`
  there FAILS the case by name ("runs past the harness guard") — it is never a refusal and never a fault match.

**Step (RC 35): kept as built.** Folded step asked by value (wrapped to the counter, direction from the signed literal); a
variable step asked by type (`classifyConversion(counter, step) === "incompatible"` → `for-step-type`). A runtime step is read
every pass (`for_runtime_step_changed_in_body`: 4 passes, not 20), so `statements/loops.test.ts` ("reads its limit and its step on
every pass") and `places/bounds.test.ts` keep their premise, unchanged; lean 7.5.9 may bind the step once per pass, never hoist it.
- **Open (gate 2b): a typed step that is not a bare variable.** The type rule fires only on IR `by.kind === "load"`
  (`lower/statements/loops.ts`), so `BY k - 1` (`k : DINT`) and `BY UPPER_BOUND(a, 1)` on an INT counter lower and run (a probe:
  n = 10 and n = 3), while `BY k` and `BY (k)` are refused. That is the IR-shape judgement this section rejects for the limit, and
  the limit recordings (`for_limit_wider_than_counter_dint_expr`, `_upper_bound`: "Cannot convert type 'DINT' to type 'INT'")
  show CODESYS judging a bound by its type. Unrecorded for the step: 2.6 records `for_step_wider_than_counter_dint_expr` and
  `_upper_bound` in its batch. If CODESYS refuses them, the step is judged by its FRONT-END type (`inferExprType` +
  `classifyConversion`), the limit's rule, under the same code `for-step-type`; an expression of untyped literals
  (`SEL(b, 2, -2)`, `callshape_for_runtime_step`) stays asked by value, as it is today. If CODESYS accepts them, the rule stays
  as built and the recordings say why.
  **Settled (2.6, record:exec 2026-10-08): CODESYS refuses them**, so the step is judged by its front-end type under
  `for-step-type` (`lower/statements/loops.ts` `typedIncompatible`, the limit's rule). `BY UPPER_BOUND(a, 1)` and
  `BY (k - 1)` are "Cannot convert type 'DINT' to type 'INT'" (`for_step_wider_than_counter_upper_bound`, `_dint_paren`).
  `BY k - 1` unparenthesised answered a different question: a PARSE error, "'DO' expected instead of '-'"
  (`for_step_wider_than_counter_dint_expr`), so a seventh fixture, `_dint_paren`, was recorded in a second one-fixture run
  to ask the type question the sixth could not — a deviation from "one batch of six", forced by the answer.

**Literal limit (RC 36) and loop depth (RC 39): kept as built** — `beside` (a constant the counter cannot hold keeps its own
type, compared in the `for-compare` meet; `tr_36_*` confirmed) and `lw.loops` → `exit-outside-loop` (`cc2_exit_outside_loop`
rated `refused`, no rust column). Tasks 2.5 and 2.7 are checks, not code.

**Typed limit wider than the counter (RC 13's transpiler half): the one new refusal.** A limit whose FRONT-END type is a named
type that does not convert implicitly into the counter (`classifyConversion(counter, limit) === "incompatible"`) is refused with a
new code `for-limit-type` ("invalid"). Asked by the front-end type, not the IR shape: `UPPER_BOUND(arr, 1)` may fold to a DINT
const, and an expression of untyped literals (`TO (100 + 100)`) must stay asked by value. Refused: `for_limit_wider_than_counter_
dint_var`, `_dint_expr`, `_upper_bound` (rated `lsp-gap`; their `rust`/`tier` columns go). Stay confirmed: `_uint_expr`,
`_negative_step`, `tr_36_*`. `emit/rust/loops.test.ts` "a FOR whose limit is a different type" changes to the refusal, citing
those three recordings. A named DINT CONSTANT limit is unrecorded: 2.6 records `for_limit_wider_than_counter_dint_constant`
in its batch before trusting the rule there.
- **FOR-limit conversion is not plain assignment conversion (gate 2b).** An untyped 200 is accepted as a SINT counter's limit
  (`tr_36_*`) where 300 as a CASE label on a SINT is "Cannot convert type 'INT' to type 'SINT'" (`tr_37_case_label_wraps_300`),
  and the only `incompatible` pair recorded is DINT into INT. So every class the rule decides needs its own recording, not the
  relation's word for it. 2.6's batch also records `for_limit_wider_than_counter_typed_literal` (`TO DINT#5` on an INT counter:
  `classifyConversion` says `incompatible`, the DINT CONSTANT's open question) and the same-width sign-change pair
  `for_limit_sign_change_int_on_uint` (an INT variable limit on a UINT counter) and `for_limit_sign_change_uint_on_int` (UINT on
  INT), both rated `sign-change` and so KEPT by the rule as written — a guess. The recordings decide: a refused sign-change pair
  widens `for-limit-type` to `sign-change`; an accepted typed literal is asked by value like an untyped one. A REAL limit
  (`incompatible`) is refused unrecorded — refusing loses nothing, so it is not recorded.
  **Settled (2.6, record:exec 2026-10-08):** the sign-change pair compiles and runs 3 passes each (counter left at 4), so
  `for-limit-type` stays at `incompatible`; the DINT CONSTANT and `DINT#5` limits are refused ("Cannot convert type
  'DINT' to type 'INT'"), as the rule as written refuses them.
- Rejected "refuse every non-literal limit": `_uint_expr` (UINT `n - 1` on UINT) is recorded as accepted.

**Labels.** `emit/rust/loops.ts` asks `ir/walk.loopUses` before printing `'loop_N`/`'body_N`, and stops rewriting printed lines
(`lines[…].replace`). Accept: S on the rust layer identical.

**Stays refused, by code:** `for-step-type`, `for-bound-call` (a call in the step, or in a limit tested on both arms of a runtime
step — its run count is unrecorded), `exit-outside-loop`, new `for-limit-type`. A FOR to the counter's maximum is NOT refused: it
wraps and runs until an EXIT (`for_counter_at_type_max`), so lean 5.4/7.5.4 may not print it as a Rust range.

**Migration.** 2.3 = `compareFault` under the guard (red first: a runaway fixture without `execSkip` hangs today); no renames.
2.5, 2.7 = verify the F/refusal lists above, no code. 2.4 = verify the folded and variable step; its typed non-variable step
is decided in 2.6. 2.6 = ONE `record:exec` batch of six (`for_limit_wider_than_counter_dint_constant`, `_typed_literal`,
`for_limit_sign_change_int_on_uint`, `_uint_on_int`, `for_step_wider_than_counter_dint_expr`, `_upper_bound`), then
`for-limit-type` and the step rule as those recordings say, and the two product comments that call a DINT limit on an INT
counter "ordinary ST that CODESYS compiles" (`lower/statements/loops.ts` above `compareIn`; the header of
`emit/rust/loops.test.ts`'s "a FOR whose limit is a different type") rewritten to `for_limit_wider_than_counter_dint_var`'s
recording. 2.8 = labels. 2.9 as written.

### §3.1 Decision (step 2d): labels, RC 13 guard, model delta (tasks 2.8-2.10, 2026-10-08)

**Target.** `emit/rust/loops.ts` knows before it prints whether `'loop_N`/`'body_N` are named; RC 13's compile fix is guarded
by a test that turns red on the old E0308; the loop model is written down once in architecture.md.

**Labels (2.8): pre-scan with `ir/walk.loopUses`.** `stmtLoop` calls `loopUses(s)` and prints each label only when used; the
printer's `loops` frames keep only `n` (the number `break 'loop_N`/`'body_N` names), and `exits`/`continues` and the two
`p.lines[…].replace` rewrites go. Deciding measure: equivalence by construction — `loopUses` and the printer's flags see the
same thing (an IR `break`/`continue` in the body, not in `init`/`step`, a nested loop's own excluded), and `blocksOf` is
exhaustive over the three statement kinds that hold blocks (`if`, `switch`, `loop`; `ir/stmt.ts`). Accept: S on the rust
layer identical (no fixture's Rust changes).
- Rejected: keep the post-print rewrite (a printer re-deciding text it already emitted; blocks lean 5.2); always print both
  labels under `#[allow(unused_labels)]` (changes every loop's output and hides a warning the crate builds without).

**RC 13 guard (2.9): the conformance fixture, not a rustc call in a colocated test.** The task's name
`for_limit_wider_than_counter_uint_n_minus_1` does not exist; the fixture is `for_limit_wider_than_counter_uint_expr`
(confirmed, rust `vendor`), with `for_limit_wider_than_counter_negative_step` beside it. `transpile-replay.test.ts` compiles
every lowering case with rustc, so a return of E0308 fails that fixture by name; `emit/rust/loops.test.ts` already pins the
text (`self.u = self.u.wrapping_add(1u16);`). 2.9 is a red check: in a scratch edit the step reuses the widened read → the
replay of `_uint_expr` fails (and the text pin fails) → revert. No new test.
- Rejected: rustc in `emit/rust/loops.test.ts` (layering rule 6: a colocated test may not import `test/` support; it would be a
  second compile of the same text); a new case in `emit-build.test.ts` (duplicates the fixture's compile).

**Model delta (2.10).** architecture.md's IR paragraph gains the loop rule in three sentences: no bound in the semantics (a
harness-only `loopGuard`, one body entry = one pass, both backends; `LoopGuardError` never a fault match); FOR step and limit
judged by their front-end type (`for-step-type`, `for-limit-type`), an untyped literal expression by value; labels from
`loopUses`. tasks.md 2.10 gets the map delta (counts before 2a vs after 2.9, from `rate:fixtures`).

**Stays refused, by code:** `for-step-type`, `for-limit-type`, `for-bound-call`, `exit-outside-loop` — unchanged by 2d.

**Migration.** 2.8 one commit (printer + `loops.ts`, `walk.test.ts` untouched; S identical). 2.9 the red check, tasks.md's
fixture name corrected. 2.10 docs only. Then the gate.

### 3.2 Strings (model 2): RC 11, 34, 45; appendix string items

**Home.**

| Part | File |
|---|---|
| Value model | `semantics/string.ts` + `string.cases.ts` |
| Rust | `emit/rust/runtime/string.ts` |
| Capacity | `lower/core/lowering.resolve`: every STRING/WSTRING Type the transpiler holds carries its capacity, `DEFAULT_STRING_LENGTH` applied there. `types/resolve.ts` is **not** changed: `src/types/type.ts:36-38` records the decision "the default capacity is a vendor fact the transpiler applies, not a resolution fact", and changing it would change the LSP's rendered Type and message text for every sizeless STRING. |
| Literal decoding | `syntax/literal-value.ts` |
| Literals | `lower/values/literals.ts` |
| `s[i]` | `lower/places/places.ts` |
| Conversions | `lower/builtins/conversions.ts` |
| Cursors | `lower/pointers/cursor.ts` |

**What the recordings already fix.**
- STRING(n) is n+1 bytes, and `s[i]` is a byte access (`lib_prim_char_past_length`, `tr_34_lib_prim_char_behind`: u = 'abcBC',
  lenU = 5).
- LEN is the position of the first 0.
- Assignment copies bytes behind a NUL (RC 45 LIVE: uc3 = 99).
- Conversions do not cut at 80 (`tr_11_string_conversion_beyond_80`: namedInt = 5, crossNamed = 12345, narrowLen = 91).

**Measure before choosing (3.1).**
- **M1.** RC 45's LIVE text (c3 = 99, uc3 = 99) and the `tr_45_string_embedded_nul` note ("bytes behind the NUL are 0") disagree
  about the bytes behind a `$00` inside a literal. Re-read the recording cell by cell; record `string_literal_nul_tail` if it
  cannot settle it.
- **M2.** Assignment between capacities with a tail: STRING(10) := STRING(20) whose bytes behind `len` are non-zero, and
  STRING(20) := STRING(10). Does the copy move min(n,m)+1 bytes, len+1 bytes, or the whole source buffer?
- **M3.** The WSTRING twins of M1 and M2.
- **M4.** Comparing two strings whose bytes differ only behind the terminator.
- **M5.** The capacity of a conversion result (STRING_TO_WSTRING of STRING(200)), and of CONCAT and the Standard functions (the 255
  cut is in the library bodies).
- **M6.** Interpreter cost of the chosen representation on the `string_*` fixtures (they are the size tops).
- **M7.** The LSP side of a sizeless STRING: grep `test/conformance/recordings/**/codesys.build.json` for how CODESYS prints a
  sizeless STRING in messages ('STRING' vs 'STRING(80)'), and list every LSP message and hover that renders one today. It confirms
  that the default stays transpile-side, and decides the appendix item "commonType treats a sizeless STRING as capacity 0": in
  lowering it disappears (every type carries a capacity); if M7 finds an LSP-visible consequence, `types/arith/runtime.commonType`
  compares a sizeless STRING as `DEFAULT_STRING_LENGTH` (a comparison, not a stored capacity), else the item is closed with M7 as
  the reason.

**Representation options.**

| | TS (`semantics/string.ts`) | Rust (`runtime/string.ts`) |
|---|---|---|
| (a) | A fixed `Uint8Array`/`Uint16Array` of n+1 units; `len` found by scan when read | `IecStr<const B: usize>` holding `[u8; B]` with B = n+1 emitted as the type parameter (`IecString<81>` for STRING(80)); stable Rust has no `N+1` in const generics |
| (b) | As (a), plus a cached `len` rescanned on any store at or past `len` | `[u8; N]` plus a separate terminator byte |
| (c) | Today's JS string plus a tail array (smallest diff, two representations to keep consistent) | today's IecStr plus a tail array |

Decide by M1-M7, the size of the emitted Rust on the `string_*` fixtures, and whether lean 4.3 (in-place `set_char`) and 4.4
(borrowing cursor reads) fall out of it.

**Tests that pin today's model and change on independent grounds** (each change cites the recording):
- `interp/interp.test.ts:1164+` (then `pipeline/strings.test.ts` and `semantics/string.test.ts`)
- `lower/lower.test.ts` describes at 1468, 1818 and 1915 (then `builtins/conversions.test.ts`, `places/places.test.ts`,
  `builtins/value-functions.test.ts`, `pointers/cursor.test.ts`)
- `test/libraries/standard.test.ts` and `stringutils.test.ts`

**Couplings.**
- `tr_34_lib_prim_char_behind` is not lowered today (`pointer-type`, a POINTER TO BYTE over a STRING). Its fixture flips only after
  model 3 (4.12); the string-model half is proven by `semantics/string.cases.ts` and src tests first.

### §3.2 Decision: strings (task 3.2, 2026-10-08, on 3.1's measurements)

**Target.** One rule for every string store, M2's: write `min(n, m)` units of the SOURCE buffer (behind its terminator too),
a 0 at `min(n, m)`, and leave the destination's units behind that alone — `n` the source's capacity (a literal's own unit
count, a library or conversion result 255), `m` the destination's. Comparison (M4) and `s[i]` (RC 34) are already right.

**Representation: keep what landed — option (c) without the tail array.** TS: the IR value stays a JS string holding the whole
buffer, trailing zeros trimmed (`held`), `len` = first 0. Rust: `IecStr<T, N>` with `[T; N]`, the terminator at N implied.
- Deciding measure: M6 — all 197 string fixtures interpret in 11.8 ms; (a)'s 3x on a synthetic mix is not a cost anyone pays,
  and a mutable `Uint8Array` inside the immutable `IrValue` (`bigint | number | boolean | string`) would need a clone at every
  copy site. Rejected (a) `Uint8Array(n+1)` / `IecStr<B = n+1>` for that, and B = n+1 also because byte N can only ever hold 0
  (`setChar`/`with_char` refuse anything else at N, and every store's 0 lands at `min(n, m) <= m`), so it carries nothing.
  Rejected (b): its cached `len` bought nothing (4.0 vs 4.1 ms). Rejected the tail array: one buffer already holds the tail.

**The store reads its destination (3.6).** `semantics/store.ts` `fit` for a string becomes `storeString(dst, m, src, n)` =
`src.padEnd(n, "\0").slice(0, min(n, m)) + "\0" + dst.slice(min(n, m) + 1)`, `held`. Lowering hands it both capacities
(every Type carries one after 3.3). Rust: `IecStr::to` becomes `dst.store(&src)` (`&mut self`, writes in place); lean 4.3
(in-place `set_char`) falls out of the same `&mut` form. A destination with no prior buffer of its own is NOT declared
zero: a function's VAR_INPUT lives in a stack frame, and gate 3a measured stack buffers carrying residue behind a terminator
(`string_conversion_result_tail` recorded different bytes on two runs). M2 left that pass unmeasured, so 3.6 records it
(`string_store_function_input_tail`: a STRING(10) 'abc'+0+'efghij' passed to `VAR_INPUT p : STRING(20)`, `p[11..19]`
read through `p[i]`, recorded twice) and its recording decides: the units behind the stored ones are either a rule (then
modelled) or residue (then `LanguageTest.residue`, held only to being produced, like a conversion result). Until that
recording the model's 0 there is not claimed by any fixture. (A FB instance's or program's VAR is a static buffer with its
declared start, measured by M2's destination kinds.)

**Literal `$00` (3.7, M1/M3).** The literal valuation keeps every decoded unit, `$00` and what follows; its capacity is its
unit count, so storing it into STRING(3) cuts at 3 and into STRING(10) keeps 'cd' behind the 0. No literal is trimmed at its
first 0.

**Conversions (3.8, M5).** STRING<->WSTRING, TO_STRING/TO_WSTRING of a string: the operand is cut to 255 on the way in and
the result Type is STRING(255)/WSTRING(255) — replacing RC 11's "sized by the source" (task 3.8's What is rewritten). The
result's units behind its terminator are stack residue (`string_conversion_result_tail`, `LanguageTest.residue`); the model
writes 0 there and the replay holds those paths only to being produced. Number→STRING conversions keep their current rule
(unmeasured here). M5 measured only CROSS-width conversions (STRING_TO_WSTRING, WSTRING_TO_STRING, TO_WSTRING(STRING(300)),
TO_STRING(WSTRING(300))); two neighbours are unmeasured and 3.8 records them before it writes their rule, the recording
deciding: (1) a SAME-width TO_STRING of a STRING(300) / TO_WSTRING of a WSTRING(300) (`string_conversion_same_width_255`) —
until recorded it keeps today's own-capacity rule, the 255 cut is not applied to it; (2) a string→number parse whose operand
is longer than 255 (`string_parse_beyond_255`: STRING_TO_INT, WSTRING_TO_INT and TO_INT of 290 spaces then '5') — today
the operand keeps its own capacity (the wide one narrowed to a STRING of the operand's capacity, `tr_11`: 85 spaces then
'12345' is 12345), and that rule stays, stated as measured only up to 90 units, until the recording says whether CODESYS
cuts at 255 (5 vs 0).

**Capacity default and `commonType` (3.3, M7).** `DEFAULT_STRING_LENGTH` applied in `lower/core/lowering.resolve`;
`withStringCapacity` goes at 3.3 (its other callers — conversions.ts, system.ts, places.ts, enums.ts — take the resolved
capacity or the default by name). conversions.ts's `sized` does NOT go at 3.3: it is what sizes a STRING<->WSTRING result
and the narrowed STRING of a wide parse by the operand, and the conversion's target is built from the conversion's name, not
resolved — deleting it before its replacement would default that target to 80, the cut RC 11 removed (`tr_11` would
regress: 100 narrowed units become 80, 85 spaces + '12345' parses to 0). It goes at 3.8 together with the 255 rule; `types/resolve.ts` unchanged (564 recorded messages print 'STRING').
The `commonType` appendix item closes with M7 as the reason (no caller outside `src/transpile`).

**Stays refused, by code:** `assign-string` (an implicit conversion the vendor does not make), the unmeasured-escape bail in
`stringLiteralText`. (`tr_34_lib_prim_char_behind` is NOT refused: a POINTER TO BYTE over a STRING already lowers
(`pointers/address.ts`) and the fixture is confirmed; an earlier draft carried the pre-3.1 `pointer-type` claim.)

**Tests that change (3.9), each citing its recording:** a wide store keeping the destination tail
(`string_assign_tail_wide`, `wstring_assign_tail_wide`) in `semantics/string.test.ts`/`pipeline/strings.test.ts`; a
conversion result of 255 (`string_conversion_result_capacity`) in `builtins/conversions.test.ts`; literal NUL tails
(`string_literal_nul_tail`) in `values` tests. The five 3.1 and three gate-3a divergences flip at 3.6 (the four kept
destination tails), 3.7 (the two literal NUL tails) and 3.8 (the two conversion results), each step's Accept naming its own.

**Migration.** 3.3 resolve + `withStringCapacity` deleted (S identical; `sized` kept). 3.4/3.5 = `storeString` and `IecStr::store` with `string.cases.ts`
(M1-M5 cells) run by both backends. 3.6 wires the store, 3.7 the literal, 3.8 the 255 rule and `sized`'s deletion. 3.10-3.12 as written.

### §3.2 Decision (step 3c): capacity, the store, the literal (tasks 3.3-3.7, 2026-10-08)

**Target.** Every string Type the lowering holds is sized; `assign` is the one place a string lands in an EXISTING buffer and
it runs `storeString(dst, m, src, n)` in both backends; `convert` stays the copy into a FRESH buffer (store into zeros =
today's `to`), which is what call arguments and results need. A sizeless string Type reaching a store is an internal error
by name, never defaulted there.

**Capacity (3.3).** `Lowering.resolve` sizes the sizeless STRING/WSTRING it returns, array elements included;
`withStringCapacity`'s four callers (conversions.ts operand, system.ts, places.ts, enums.ts) and `layout.ts:50` read the
resolved length or `DEFAULT_STRING_LENGTH` by name. A string literal's const is typed STRING(k)/WSTRING(k) at 3.3, k its
decoded unit count (`frontend/types/literal.ts` keeps the sizeless type the LSP prints). `sized` stays until 3.8.
- Rejected: sizing in `types/resolve.ts` (M7: 564 recorded messages print 'STRING'); sizing per use (four callers
  re-deciding one fact is what 3.3 removes).

**Where `n` comes from (3.6): the source's own Type, kept by not converting a same-width string at an `assign`.** One IR
constructor `assignTo(target, value)` in `lower/values/convert.ts` replaces the 15 `{ kind: "assign", value: convert(…) }`
literals: it converts as today except a STRING→STRING / WSTRING→WSTRING of another capacity, which passes unconverted.
Interpreter: `compileWrite`'s string branch reads the place, then writes `storeString(prior, m, v, n)` with `n` =
`s.value.type.length` taken at compile time (`storeAs` and the call/runner bindings unchanged: they fill fresh buffers).
Rust: `place = v.to();` becomes `place.store(&v);` (`&mut self`, `store<const M>` — both capacities are const generics, and
a VAR_IN_OUT's generic capacity infers as today); `to` stays only behind a same-width `convert`.
- Deciding measure: the counts — 40 lowering `assign` sites (15 convert their value) against 8 interpreter `storeAs` sites
  and 1 emitter copy (`stmt.ts:55`); the store belongs to `assign`, the one IR kind all 40 share.
- Rejected: an IR `storeString` node (inserted at all 40 sites; a missed one silently keeps the old cut); a value carrying
  its capacity (an object in `IrValue`, the clone-per-copy cost §3.2 rejected for (a)); dropping same-width `convert`
  everywhere (every Rust argument/result position would then need its own store-into-new).

**Model (3.4/3.5).** `semantics/string.ts` `storeString` (§3.2's formula, `held`); `string.cases.ts` one cell per
recorded store/read (M1-M5, `tr_34`, `tr_45`, `lib_prim_char_past_length`), each naming its fixture, run by
`string.test.ts` and through rustc by `runtime-twins.test.ts` — the `numeric.cases.ts` pattern. `IecStr::store` lands with
its twin before any caller (3.4/3.5 unwired, S identical).

**Literal (3.7).** `stringLiteralText` keeps every decoded unit; with k from 3.3 the store cuts a literal at k and keeps the
destination behind its 0. A declaration's folded initial value is `storeString(zero, m, lit, k)`, so it equals today's cut.

**Stays refused, by code:** `assign-string`, `string-escape`, `wstring-surrogate`, `string-non-ascii` — unchanged.

**Migration.** 3.3 one commit (Types only; S-out lists literal consts that now print `IecString::<k>`). 3.4, 3.5 the unwired model
and twin. 3.6: record `string_store_function_input_tail` (twice) first, then `assignTo` + the two backends in one commit.
3.7 the literal. Then the gate.

**As built (step 3c), where reality differed — each a smaller change than the plan, none a different model:**
- The literal half was already there: `lowerLiteral` typed a string const STRING(k)/WSTRING(k) (k its decoded units) and
  `decodeStringLiteral` kept every unit, so 3.3's literal typing and 3.7's lowering needed no code; the two literal NUL tails
  flipped with 3.6's store (their marks already named 3.6).
- Rust prints `place.store(&v)` only where the capacities DIFFER or a STRING VAR_IN_OUT (generic capacity) is on either side;
  at one capacity the store writes every unit, which is exactly the plain copy, so it prints `place = v` — no `.to()` at all.
  The plan's "`place = v.to()` becomes `place.store(&v)`" everywhere would print a `&mut` call where an assignment does.
- A pointee's string type is not one `Lowering.resolve` returns (a `POINTER TO STRING`'s target is resolved with the pointer),
  so `storageOf` sizes it through the same `Lowering.sized` (gate 3c: it had defaulted a pointee's unfolded capacity to 80);
  and a capacity the declaring scope cannot fold (`unfoldedLength`)
  is refused `string-capacity` instead of defaulted (`withStringCapacity` gave it 80): `decl_string_length_variable`, which
  CODESYS refuses, no longer lowers.
- `assignTo` exposed a BOOL stored into a STRING: `__QUERYINTERFACE` into a STRING target (`ar_queryinterface_type`, refused by
  CODESYS) lowered a boolean into the buffer; `queryInto` now refuses it `assign-string`, as every other implicit string
  crossing is.
- `string_store_function_input_tail` (recorded twice, identical): the pass is M2's store (eleven units) and `p[11..19]` read
  the 'Z's the PREVIOUS call left in the same stack frame — residue, so `LanguageTest.residue`; the model writes 0 there.

### §3.2 Decision (step 3d): conversions, old tests, cursor store, StrReplaceA, delta (tasks 3.8-3.12, 2026-10-08)

**Target.** A string conversion's result is a fresh STRING(255)/WSTRING(255) by one named constant, `sized` deleted; a
whole-string store through a cursor is either the plain store or refused by name — never cut at a capacity CODESYS does
not cut at; StrReplaceA reads the bytes model 2 now holds behind the terminator.

**Conversions (3.8).** `stringConversion` builds its target as `{ …to, length: CONVERSION_RESULT }` (255, beside
`DEFAULT_STRING_LENGTH` in `lower/core`) and cuts a cross-width operand with `convert(source, <from>(255))` first; the
result's tail is 0 in the model (residue, `LanguageTest.residue`). The two unmeasured neighbours are recorded in ONE batch
first (`string_conversion_same_width_255`, `string_parse_beyond_255`) and their recording picks between the same two rules
each: the 255 cut, or the operand's own capacity (today's). Whichever wins is written as the rule and `sized` goes either way
(own capacity is then `source.type.length`, read, not re-derived).
- Rejected: a per-function result-capacity table (one number, 255, measured on every cross-width case); keeping `sized`
  as the own-capacity path (it defaults a sizeless target to 80 — the cut RC 11 removed).

**Old-model tests (3.9).** Only the files tasks 3.9 lists; each changed expectation carries the fixture it now equals in a
comment, and the commit body lists them. A test whose change has no recording behind it is not changed.

**Cursor store (3.10): record first, the recording picks.** Today `p^ := s` through `POINTER TO STRING(m_ptr)` stores
into the caller's buffer at the caller's capacity `m_c` (the hidden VAR_IN_OUT's type). Under M2's rule CODESYS writes
`min(n, m_ptr)` units, so the two differ only when `min(n, m_ptr) > m_c` — a write past the caller's variable.
`cursor_whole_store_capacity`: a STRUCT holding a STRING(5) then a 'Z'-filled STRING(10), `p : POINTER TO STRING(20) :=
ADR(st.short)`, `p^ := ten` (a STRING(10) 'abcdefghij'); read the neighbour.
- Neighbour unchanged → today's cut is the vendor's; item closed with the recording, no code.
- Neighbour overwritten → refused `cursor-overrun` where `min(n, m_ptr) > m_c` is known at lowering (both capacities are
  Types after 3.3); below it the store is `storeString(dst, m_c, src, n)`, identical to `m_ptr`'s because the 0 lands at
  `min(n, m_ptr)` either way. Corpus: 11 whole-string cursor stores (pro2193 JSON builders), all literals of <= 5 units
  into larger buffers — 0 would be refused.
- Rejected: writing past the variable (needs model 3's memory, §3.3); cutting silently at `m_ptr` into a buffer of `m_c`.

**StrReplaceA (3.11).** Its `ponytail` assumption ("memory past the terminator need not be zero") is now modelled: the
copy into `buf` reads `cap` units, not up to the first 0, and the move's `cnt` is bounded by `cap - src` as well as
`cap - dst` (the panic: `buf[src + i]` past 255 when `ILENGTHINPUT` > LEN). Recorded first, in `lib_stu_replace`'s
neighbour `lib_stu_replace_past_len` (STRING(20) assigned 'abcdefghijkl' then 'abc', `iLengthInput := 12`); the body
changes only if that recording disagrees with today's answer.

**Stays refused, by code:** `assign-string`, `string-escape`, `wstring-surrogate`, `string-non-ascii`, `string-capacity`;
`cursor-overrun` if 3.10's recording says so; REAL_TO_STRING (`conversion-type`).

**Migration.** 3.8: one recorder batch per vendor (the two conversion fixtures, `cursor_whole_store_capacity`,
`lib_stu_replace_past_len`), then the 255 rule + `sized` deleted in one commit. 3.9 tests. 3.10 / 3.11 as their recording
says. 3.12: architecture.md's string paragraph (one buffer, `storeString`, 255 conversions, refusals) and the map delta in
tasks.md from `rate:fixtures`. Then the gate.

**As built (step 3d), where the recordings chose — reality differed from the plan in one rule and two smaller places:**
- `string_conversion_same_width_255` picked NEITHER of the two rules offered: TO_STRING of a STRING(300) and TO_WSTRING of
  a WSTRING(300) give 80 units — the conversion's NAMED type at the default capacity, the same as a number's text. It
  was refused ("not measured yet") and now lowers to that; the 255 cut belongs to the cross-width conversions and the
  parses only. `string_parse_beyond_255` picked the 255 cut: 290 spaces then '5' parses 0, 250 spaces then '5' parses 5,
  named and bare, both widths.
- No separate operand cut for a cross-width conversion: it maps one code unit to one, so a result Type of 255 cuts exactly
  where cutting the operand would — the extra `convert` node would only print. A parse whose operand is wider than 255 does
  get the cut node (the parse has no string result to cut); one of at most 255 units is converted as it is, so no
  STRING_TO_INT of a short string prints a widening copy. `CONVERSION_RESULT` lives in `builtins/conversions.ts`, its one
  reader, not in `lower/core`.
- `cursor_whole_store_capacity` recorded the overrun (both forms: `head` 'abcdef' with no terminator, the neighbour
  'ghij' + 0 then 'Z'), so `cursor-overrun` (not-modelled) refuses a whole-string store through a cursor where
  `min(n, m_ptr) > m_c` (`pointers/cursor.ts` `refuseCursorOverrun`, asked by `statements/assign.ts` beside
  `refuseImplicitString`); the local-pointer form was already refused `pointer-type`.
- `lib_stu_replace_past_len` disagreed with the body on all three cases (the move and the copy run over the whole buffer,
  behind the terminator too; a copy position past LEN is NOT a no-op). The body now reads and writes back `cap + 1` units
  and drops its `p > LEN` return; `cnt` is bounded by `cap - src` as well. The fixture's TwinCAT build recording was
  withdrawn: the TwinCAT fixture project references no StringUtils ("Identifier 'StrReplaceA' not defined"), which is why
  no library-body fixture carries one.

**Gate 3d review (2026-10-08), what the fixes changed in the above:**
- The same-width rule now rests on six cells, not two: 100, 255 and 300 units in, 80 out, both widths
  (`string_conversion_same_width_255` re-recorded) — it rules out "cut to 80 only above 255" and "kept up to 255".
- The parse cut is separated from "an operand longer than 255 parses 0": a STRING '5' then 290 spaces parses 5 and 253
  spaces then '12345' parses 12, named and bare, both widths for the latter (`string_parse_beyond_255` re-recorded). The
  wide '5' + 290 spaces answered 0 for another reason, measured in `wstring_parse_trailing_spaces`: a WSTRING parse of a
  number followed by spaces is 0 (inside 255 as much as past it) where a STRING parse stops at the spaces. Both backends
  narrow and answer 5 — known divergence, niche: accepted loss (no WSTRING parse and no user WSTRING in the corpora).
- `cursor-overrun` is asked wherever something is written through a cursor's `p^`, not only by `storeValue`: an
  assignment chain's `:=` link (`lowerChain`), an FB output copied out into it (`fbOutputCopy`), and `p^` lent to a
  writable VAR_IN_OUT / VAR_OUTPUT whose capacity would overrun the caller's string (`bindPlace`; 0 such bindings in the
  corpora). A string Type without a capacity there is a `LoweringBug`, not a store let through.
- The TwinCAT build recording of `lib_stu_replace_past_len` is not withdrawn by hand any more: `twincat.build.json` was
  restored and the recorder run on the four string fixtures only, so the library fixture never enters the TwinCAT batch.
- StrReplaceA with a `uiInputBufferSize` larger than the caller's string faults at run time in the model (CODESYS writes
  into the neighbour): niche: accepted loss (0 occurrences — the one corpus caller passes 80 for a STRING(80)), noted in
  `STRREPLACEA.pou`.

### §3.2 Decision (step 7.4c): read-only Standard string inputs, the LEN_INTERNAL primitive (task 7.4.6, 2026-10-10)

**Target.** A Standard string FUNCTION (LEN, CONCAT, LEFT, RIGHT, MID, FIND, INSERT, DELETE, REPLACE) reads a caller's
STRING of capacity N <= 255 where it lies — `len(&self.hello)`, `fn len<const N_STR: usize>(str: &IecString<N_STR>)` —
and LEN_INTERNAL is one IR builtin, `units().len()`, not a loop of `char_at`. Measured on the rust snapshot: 229
`.to::<255>()` copies into these nine in 136 fixtures (LEN 100; 6 more are parse cuts, untouched); the corpora call them
124 times (CONCAT 101).

**Why it is exact, and the proof it rests on.** The 255-copy and a borrow of the caller's N units differ only (a) in a
read `STR[k]` with N < k <= 255 — the copy reads 0, `char_at` on N faults — and (b) in a whole read of STR into a
destination whose units past N are not 0 (the copy zeroes them). Every Standard body reads STR only at k <= LEN_INTERNAL
(STR) <= N (every index is bounded by `n`/`n1`/`n2`, or stops at STR's first 0; FIND's and INSERT's non-short-circuit
`AND` reads the terminator, still <= the length), and reads it whole only into its own fresh result (CONCAT, INSERT,
DELETE). The proof is a test, not prose: `test/libraries/standard.test.ts` runs every Standard FUNCTION with a STRING(255)
input in the interpreter over every buffer of capacity 0-4 over {0, 'a', 'b'} (bytes behind the terminator included)
and every INT argument in -2..6, plus a full 255 case per function, passed as a STRING(N) and as the same buffer in a fresh
STRING(255) (the copy's semantics, and a borrow at 255 is the copy), and requires the two to agree with no fault; a body change that breaks it fails there, and anywhere else faults loudly in both backends (never a quiet 0).
Callers wider than 255 keep the copy — its cut is measured (`string_input_truncation`).

**The choice.** In lowering (`calls/routines.ts` `calledRoutine`, `calls/binding.ts`): for a FUNCTION of the Standard
library (`libraryOf`), a STRING(255) VAR_INPUT bound to an argument of capacity <= 255 is lowered as a VAR_IN_OUT
CONSTANT of the ARGUMENT's type — the read-only in-out both backends already have (`readOnly`, `&IecStr<N>`, variant key
per capacity, merged by `sharedVariants`). A plain place is lent; a literal or other expression is a `copy` binding at its
own capacity (as a VAR_IN_OUT CONSTANT lends a literal); a global, an aliased place, a cursor `p^` or an image place keeps
the input copy — the declared semantics, not a refusal. LEN_INTERNAL: a call to `Standard.LEN_INTERNAL` lowers to the
new builtin `length` (`(s)` → UINT, the units before the first 0); interpreter twin `semantics/string.ts` `lengthOf`
(the buffer's visible length), Rust `units().len()`; `runtime-twins.test.ts` runs it over `string.cases.ts`, and the
repo's ST body (kept, held to its declaration by `repo.test.ts`) is its oracle in `standard.test.ts`. `libraries/index.ts`'s
"only primitives are `s[i]` and `TIME()`" gains LEN_INTERNAL.
- Rejected: a 255-view type over N (exact without a proof, but a second string type with its own read, store and twin
  for nine bodies); intrinsics for every Standard function (re-creates the TS/Rust twin the library repo deleted);
  declaring the inputs or LEN_INTERNAL VAR_IN_OUT CONSTANT in the repo (the declaration is the vendor's, `repo.test.ts`);
  a static index-range analysis over the IR (an analysis to prove nine fixed bodies the exhaustion test covers).

**Stays refused, by name.** A borrowed input the body writes, lends writable or takes the address of: `input-borrow-written`
(a library-repo defect, never a silent copy). LEN_INTERNAL given no variable stays refused as any in-out is; one whose
argument's capacity exceeds 65535 (its UINT count would wrap, the loop would not end): `string-length-width`. Nothing a
copy lowers today is refused after.

**Migration.** (1) The `length` builtin, its twin and the LEN_INTERNAL lowering, alone: S-out identical, `len_internal`
gone from the emission. (2) The proof test (it holds before the borrow and must after). (3) The borrow in `calledRoutine`/`bindPlace`. Accept: S-out (outputs and edge byte-identical over every
fixture), `test/libraries` green, M; the 7.4.6 notes resolved; 7.7.12's parameters unchanged (integers and cursors).

**Built (step 7.4c, 2026-10-10)**, where it differs from or adds to the above:
- The binding lives in `lower/calls/string-inputs.ts` (`stringInputArguments` picks the variant in `calledRoutine`,
  `declareStringInputs` makes the in-outs before `routineInputs`, which skips them, `bindStringInput` binds in
  `bindArgument`), not in `bindPlace`: a read-only `&` has none of `bindPlace`'s alias questions — `CONCAT(x, x)` lends
  `x` twice, which `bindPlace` would have copied or (REPLACE, which calls) refused.
- **No argument keeps a by-value input: every STRING(255) input of the nine is an in-out of the call's variant.** A
  place `lendable` takes, of capacity N <= 255, is lent as it is; a literal, a FUNCTION's result (typed by its
  declaration, as `calledRoutine` types the call — a lowered result of another capacity is a `LoweringBug`) and any
  other STRING(N <= 255) place (a global, a `p^`) are lent as a copy at their own N; everything else — a STRING wider
  than 255, a conversion, a METHOD's result, whose type only lowering it would tell — is lent as a copy converted to
  the declared STRING(255), which IS the input copy, cut and all. One kind of variant is what lets them all print alike:
  a design that kept the input for some arguments printed a second fn wherever both met (`CONCAT(CONCAT(a, b), c)`,
  REPLACE's `INSERT(DELETE(…), …)`, a wide argument beside a narrow one: +1 fn, +1 pedantic, size up), where now
  `sharedVariants` merges every variant of a function into one. Measured on the rust snapshot: `.to::<255>()` 235 -> 20
  (137 fixtures -> 3) — the 20 left are 12 cuts of a STRING(290)/(300) argument (`concat_result_capacity`,
  `string_input_truncation`: measured) and 8 parse cuts (`string_parse_beyond_255`); distinct fns 545 -> 409, and no
  fixture prints two variants of a Standard function.
- **Taken where it is written when the order could show** (`inputWhereWritten`, in `bindWhereWritten`): both backends
  evaluate the inputs in written order and bind the in-outs (and the copies) after them, where the input copy was
  taken at its own position. So a lent place a LATER argument's call could change, and a result whose own call could
  change something, go into a temp at their position: `MID(txt, Shrink(), 1)` with `Shrink` cutting `txt` prints
  `{ let __input_copy = self.txt; mid(self.shrink(), 1, &__input_copy) }`, reading what the copy read and never holding
  `&self.txt` beside the call's `&mut self`. "Could change" is `holdsEffect`: any call but a FUNCTION whose body writes
  only its locals and calls nothing, every in-out read-only, nothing lent — so `MID(txt, LEN(txt) - 1, 2)` lends `txt`
  as it is, and a result or a conversion that changes nothing is lent inline, `&concat(&self.a, &self.b)` (`emit/rust/printer.ts`
  `inline`). The emitter hoists every input written before a freeze that holds a call (`hoistedInputs`), so the freeze's
  call runs after them, as written. A literal is a constant and stays.
- The emitter's plain-copy rule (`emit/rust/types.ts` `plainCopy`, shared by the store, the `let` it folds into and the
  tail it yields): a STRING VAR_IN_OUT's Rust capacity is the generic `N_*` whatever the variant's number says, so a
  store from one is `IecStr::store` even at one capacity — DELETE's variant at STRING(255) (REPLACE hands it its own
  STRING(255) input) printed `let mut delete: IecString<255> = *str;`, E0308 (`concat_result_capacity`).
- Rust's twin is the on-demand helper `string_length` (`IecStr::length`, `self.len as u16`; `runtime-twins.test.ts`).
- The proof runs REPLACE over capacities 0-3 (its two strings and two INTs over 0-4 are 1.2M runs, 38 s); its STR1 is
  DELETE's and its STR2 INSERT's, each held over 0-4. A test there also names every repo FUNCTION with a STRING(255)
  input, so a tenth is not borrowed unproven.

**Gate 7.4c (review, 2026-10-10)**, recorded first (CODESYS `record:exec`; `record:language` on CODESYS and on TwinCAT
Project13, all five build): `string_input_lent_later_call_changes`, `string_input_lent_inout_later_call`,
`string_input_lent_inout_wider`, `string_inout_wider_unit_read`, `string_inout_wider_copies`.
- **The order is CODESYS's, measured.** A later argument's call that changes the string — a FUNCTION through its
  in-out, a METHOD of the FB — does not reach the Standard function's string (`LEFT(txt, Cut(t := txt))` 'hel',
  `MID(txt, 2, Shrink())` 'he', `CONCAT(txt, Grow())` 'helloY'), and named in reverse, `MID(POS := Shrink(), STR := txt,
  LEN := 2)`, the METHOD written first does ('x'): written order, as `inputWhereWritten` takes it. It was inferred from
  the in-out and input recordings; now each shape is a fixture.
- **A STRING VAR_IN_OUT is bound at its CALLER's capacity, and its input copy reads it at its DECLARED one** — a
  STRING(12) 'abcdefghijkl' bound to `io : STRING(10)`: LEN(io) 10, LEFT(io, 20) 'abcdefghij', CONCAT(io, …) frozen
  'abcdefghij1'. HEAD's input copy read the caller's 12 on both backends (LEN 12), and the borrow did too (the
  interpreter, which reads the in-out at the variant's declared capacity, faulted on unit 11 of LEFT's walk); the
  freeze's Rust was `let __input_copy_1: IecString<10> = *io;`, E0308 (`io` is generic over its capacity). So a WHOLE
  STRING VAR_IN_OUT of the routine is not `lendable`: it is lent as a copy at its declared capacity, an explicit
  `convert` even where the two types read alike (`io.to::<10>()`; `callersCapacity`), and a freeze of it is then a plain
  `let` of that copy. A variant's own lent input stays lent as it is: it is always bound at the capacity it declares
  (REPLACE hands DELETE its STR1 by `&`). One existing fixture prints it: `xo4_inout_constant_chain`'s `LEN(text)` of a
  `VAR_IN_OUT CONSTANT text : STRING` is `len(&text.to::<80>())` (outputs unchanged: its caller is a STRING(12)).
- **Faults keep the input copy's order.** A lent place is bound after the inputs, so an index it faults on was reported
  after a later argument's fault (`MID(arr[i], 10 / j, 1)`: 'division by zero', HEAD 'array index 5 is outside its
  bounds'). A lent string that could fault is now taken where it is written when a later argument — an input or an
  in-out binding — could fault too (`ir/faults.ts` `cannotFault`: an allowlist of what never stops the task, so a new
  construct counts as one that could), and the emitter hoists every input that could fault written before such a
  freeze (`hoistedInputs`), as it hoists every input before a freeze that holds a call. A later lent place is now a
  "later argument" for effects too (an index holding a call).
- **Found beside it, not this step's, recorded and marked** (`deferred.transpile`, niche: 0 occurrences in the corpora
  — no STRING VAR_IN_OUT of the six is bound to a wider string): read OUTSIDE a Standard function, a wider-bound STRING
  in-out is read at the caller's capacity by index (`io[11]` is 108 on CODESYS and in Rust; the interpreter faults) and
  at the declared one when copied (a project FUNCTION's STRING(255) input counts 10 on CODESYS, 12 on both backends; a
  store into a STRING(20) holds 'abcdefghij' on CODESYS and the interpreter, 'abcdefghijkl' in Rust).

### 3.3 Pointers and references (model 3): RC 14, 15, 16, 17, 44; 18 and 20

**Prior art this model starts from.** `openspec/changes/transpile-st-to-rust/pointer-model.md` (2026-09-20: a parse-based corpus
census of forms 1/2/3; `pointer-order` 177 POUs, `pointer-value` 81, `pointer-targets` 1) and `memory-sketch.rs` (the "enum of
targets" handle; rule 2, a `&mut` borrow for a pointer that never outlives the call). Its §8 "form 2 first" is built
(`pointers/borrowed.ts`). Its open tasks (the `pointer-targets` handle, "REFERENCE/POINTER inputs as borrows", "a routine's
VAR_OUTPUT copied back after the call" = RC 20) are reconciled by task 0.8 and superseded by this model where they overlap.

**Home.**

| Part | File |
|---|---|
| Lowering | `lower/pointers/*` (`state.ts` holds the representation contract) |
| Tag encoding | `lower/core/tags.ts` |
| In-out binding | `lower/calls/last-binding.ts` |
| Output timing | `lower/calls/outputs.ts` |
| Interface tags | `lower/interfaces/tags.ts` |
| IR | `ir/expr.ts` (`Place.guard`, `IrSelect`; new nodes if the decision needs them) |
| Semantics | `semantics/memory.ts` (if (b)) |
| Interpreter | `interp/frame.ts` |
| Rust | `emit/rust/runtime/pointer.ts`, `emit/rust/types.ts` |

**Today.**
- A pointer is a TAG: 0 = NULL, 1 = the whole target, element k = k+1 (form 1 of pointer-model.md: a static target set).
- It is keyed frame-relative (`pointerKey`) and re-resolved per reading instance.
- A pointer parameter the callee does not keep is lowered as a borrowed in-out (form 2): that one IS a Rust `&mut` for the
  call's duration.
- Three separate tag schemes exist: pointers, interface instance tags, and the in-out binding tag `__inout_binding`.

**Options.**

- **(a) Extended tags.** Keep the usize tag (note `013de1dc6a` leans to it), with these repairs:
  - bias element tags so that no in-range step reaches 0 (RC 44);
  - build the latch inside each arm (RC 14);
  - a foreign-target tag, or a refusal by name, for an FB copy (RC 15);
  - arm every binding tag of the FB type (RC 16);
  - refuse a mismatched pValue dereference and prune arms by constant diSize (RC 17);
  - compute `foreign` in `queryInto` (RC 18).
  - Cheapest in emitted Rust. Byte reinterpretation (RC 17's CODESYS answers, `tr_34`, `tr_28`'s bit readback) stays refused.
- **(b) A flat byte arena per program.** Every variable whose address escapes (the ADR target set, found by an escape pass) lives
  in a little-endian byte image laid out by `storage/bytes.ts`. Pointers are real byte addresses, and loads and stores through
  them are `from_le_bytes`/`to_le_bytes` (the same IR reinterpret node lean 8.3 needs).
  - Answers RC 15, 17, 44, `tr_34` and the bit readback of `tr_28` natively.
  - Needs `storage/bytes.ts` to match CODESYS layout exactly, so RC 26 comes first (task 4.0).
  - Every escaped variable gets heavier Rust, and the interpreter gains a memory model in `semantics/memory.ts`.
- **(c) Stored pointers as Rust references plus an address table.** Rejected for a pointer that is *stored* (outlives a call): the
  borrow checker loses at the first two live aliases, which is architecture.md's "nothing lowers to a Rust reference" in the
  sense it means. It is not rejected for a pointer that never outlives the call: that is form 2, already built, and it stays. It
  is written down so neither half is re-proposed.
- **(d) A per-pointer enum of targets** (`memory-sketch.rs`): each pointer variable's type is an enum with one variant per target in
  its target set (`enum P1 { Null, A(usize), B(usize) }`), matched on dereference. It is (a) with the tag's meaning moved into the
  Rust type: exhaustive matches instead of `_ => panic`, no numeric tag arithmetic, but a new Rust type per pointer and no answer to
  byte reinterpretation or pointer arithmetic across targets. Measured beside (a) and (b).

**Measure (task 4.1).**
1. The census, **starting from pointer-model.md's** (re-run parse-based, diffed against the 2026-09-20 numbers):
   - tier `indirect` (185 lowered);
   - every not-lowered row with a `pointer-*`, `call-fb-inout`, `interface-*` or `any-*` code (`scripts/probe-lowering-refusals.ts`);
   - every `rejects` fixture on pointers.
2. For each fixture, its predicted verdict under (a), (b) and (d).
3. A spike of (a), (b) and (d) on ten representative fixtures (`tr_15`, `tr_17_any_pvalue_dint_via_real`, `tr_44`, `tr_34`,
   `state_any_int_pointer_increment`, a cursor fixture, an interface fixture, an FB-copy fixture, `type_dut_union`, one StringUtils
   body), measuring emitted lines, rustc build and edge agreement.
4. New recordings where the census finds no CODESYS answer: pointer→DWORD conversion and back (`pointer-value`), `<`/`>` on
   pointers, ADR difference across two arrays, POINTER TO BYTE walking a STRUCT with padding, and a pointer step past the end of an
   array.

**Decision criterion, in order.** Fixtures passing (including ones that lower for the first time), then emitted-Rust cost (median
size and pedantic delta on tier `indirect`), then transpiler LOC.

**The decision section (4.2) must also say:**
- whether the three tag schemes unify under the choice; if they stay separate, why each must (task 4.14 implements the answer —
  P1's "one home" is then the shared encoding in `core/tags.ts`, stated as such);
- which `staticKey` named options (1.7.11) the model makes removable (task 4.15);
- what stays refused, each by its registered code;
- which transpile-st-to-rust pointer tasks it supersedes (0.8);
- how architecture.md's "pointers will become indices" paragraph (line 313 at 34c44c3640) is rewritten.

**RC 20 (output timing)** is independent of the representation: routine outputs are copied out after the invoke, as FB outputs
already are (`tr_20_output_index_moved_by_callee`). It lands in `calls/outputs.ts` in this phase, because it shares the binding code.

### §3.3 Decision: pointers (task 4.2, 2026-10-09, on 4.1's measurements)

**Target.** Option (b), narrowed: a DATA pointer is a byte address into one little-endian image per program; a pointer
or reference to an FB INSTANCE is an instance handle (the interface scheme). Form 2 borrows and the cursor stay as built.

**Why, by the criterion.** Fixtures: (b) lowers 45 for the first time plus `pointer_step_past_end` (diverges today);
(a)/(d) 14, 12 of them only with a program-wide lend registry (the interface module's size again). The 13 lowered rows
(b) put at risk do not regress: the 12 `mem_reference_to_fb_*`-style rows point at a whole instance, which is a handle,
not bytes; `lib_stu_wide` waits on one WSTRING layout recording. Rust cost: +12% on the nine spikes all three build
(203 vs 181 lines) plus a 36-line `Mem` runtime, paid only by frames that escape; pedantic 0 in all three. Corpus: every
option unblocks the same 2 POUs; (b) clears pointer codes in 136 POUs, (a)/(d) in 71.
Rejected: (a) tags — a third of (b)'s reach, byte view refused forever, still needs the registry; (d) enum — (a)'s reach
with a Rust type per pointer (186 lines); (c) for a STORED pointer — the borrow checker loses at two live aliases.

**The image.** The escape unit is the declaring FRAME (an instance, a program, a routine's locals, a GVL): when any data
variable in it has its address taken (ADR, REF=, a stored pointer/reference to it), the whole frame's data is laid out by
`storage/bytes.ts` in the image — the neighbour-after-the-array (`pointer_step_past_end`) and contiguous arrays
(`adr_difference_two_arrays`) are measured facts about a frame, not about one variable. An FB-typed field of an escaped
frame keeps its own struct and reserves its measured SIZEOF; loads/stores are `from_le_bytes`/`to_le_bytes` (IR:
load-bytes, store-bytes, reinterpret), the interpreter's twin is `semantics/memory.ts` over a DataView. A difference of
two addresses is 32-bit unsigned (measured, zero-extended); order and difference across two frames are unrecorded and
fault by name at run time, never answer our layout's order.

**Edge agreement (owner item from gate 4b).** Vendor agreement on the recorded paths suffices for the CHOICE: where all
three options build, all agree with CODESYS, so the options differ in reach, not arithmetic. It does not suffice for
reinterpretation: before 4.9/4.12 lower `tr_17`/`tr_28`, one batch records a DINT read as a REAL at a quiet and a
signalling NaN, ±0, a denormal and ±max; from 4.4 the interpreter twin makes edge agreement measurable as for any row.
The owner accepts this choice before 4.3.

**Tag schemes (4.14).** Data pointer tags go (addresses). Pointer-to-instance and interface tags merge into one
instance-handle scheme in `core/tags.ts`. `__inout_binding` stays its own: folding it into the image would make every
VAR_IN_OUT target escape. `instanceRelative` (transpile-st-to-rust) is decided with the merge. `staticKey` options
(4.15): `pointers/state.pointerKey` goes for data (an escaped variable is an offset); `interfaceKey` stays as the handle's
key; `KEY_STEP`/`SUFFIX_STEP`/`SAME_STEP` stay — they write a key, a Rust name suffix and a value-and-type comparison.

**Stays refused, by code:** `pointer-shape` (ADR of a BIT: no byte address measured), `cursor-overrun` (a cursor is form 2,
not the image), `sizeof-unmeasured`, `layout-unmeasured` (new, registered in `diagnostics/codes.ts` by 4.4: a type with no recorded layout — the FB header position
until recorded), `dynamic-memory` (new, `not-measured`, registered by 4.4 and raised on the `__NEW` expression itself and on
`__DELETE`: the recording project has no memory pool, so the `newdel_*` fixtures are unaskable — today `__NEW` is refused only
through `pointer-value`, which (b) clears, and `__DELETE` only by the generic `stmt-call_stmt` "not a callable instance yet", so
without its own code a `p := __NEW(T);` with no `__DELETE` would lower to an image address CODESYS never ran;
`newdel_in_method_with_pragma` lowers today only because its `__NEW` sits in a METHOD nothing calls), `call-inout-alias`, `place-not-local`, the interface codes; a pointer→DWORD
conversion is vendor-refused. Supersedes transpile-st-to-rust "multi-target handle (`pointer-targets`)", "form 2 first"
(built, kept), "REFERENCE/POINTER inputs as borrows" and "`VAR_IN_OUT`, `POINTER TO`, `REFERENCE TO`, `expr-deref`".

**architecture.md (4.16):** "pointers will become indices into that same frame" becomes "a frame whose data address is
taken lives in the program's byte image, laid out as CODESYS lays it out; a data pointer is an address into it, a pointer
to an instance a handle, a pointer that never outlives the call a borrow."

**Migration.** 4.3: ONE recorder batch per vendor first (FB header position with and without IMPLEMENTS, WSTRING layout,
the reinterpretation edge values), then the IR nodes. 4.4: escape pass, frame layout, `Mem` + `memory.ts`; accept = the
83 lowered pointer rows stay lowered and every confirmed `indirect` row stays confirmed. Then 4.5-4.13 per fixture,
4.14 merge, 4.15, 4.16.

### §3.3 Decision (step 4d): IR, both backends, RC 44, RC 14, RC 15 (tasks 4.3-4.7, 2026-10-09)

**Target.** The image is a PLACE, not a family of byte nodes: `Place.root` gains `"image"` with `at: IrExpr` (the byte
address; `path` holds at most a trailing `bit`). A variable of an escaped frame and every data dereference lower to one;
a reinterpretation is a load of an image place at another type. One new expression, `base` (a frame's image address:
`this`, the routine's locals, a program/GVL), and `image?: { size, align }` on `IrLayout` (an escaped FB type),
`IrRoutine` (escaped locals) and the program/GVL frames. `walk.ts` visits `at`. Faults added to `ir/faults.ts`:
`address-outside-image`, `address-across-frames` (order or difference of two regions — unrecorded, never our layout's).
- Deciding measure: ir/ has 12 `Place`-typed fields (load, assign target, in-out binding, `back`, freeze temp, call and
  invoke instance and lent, select arm, guard, bind), all resolved by ONE function per backend (`interp/frame.ts`, `emit/rust/place.ts`).
- Rejected: 4.2's load-bytes / store-bytes / reinterpret nodes — each of those 12 consumers would need a byte twin, and a
  missed one silently keeps the tag path; a `reinterpret` convert node — only an image value is ever reinterpreted.

**Lowering.** `lower/pointers/escape.ts`, a pass over the whole program BEFORE bodies lower (one body's `ADR(inst.x)`
escapes the FB type for every body): a frame escapes when an address of its data is STORED (a pointer/reference
variable, an initializer, `REF=`). Erased forms do not escape: form 2 borrows, the cursor, the ANY `diSize` (4.9 adds the
ANY reinterpretation). The FB TYPE is the escape unit for instances (one body serves all of them). `at` is folded from
`storage/bytes.byteOffset`; an index step folds as `(i - lower)·size` after its existing bound check. A VAR_IN_OUT bound
to an image place is an `IrCopy` with `back` (built); a callee that itself reaches the image during that call is
`call-inout-alias`. Data `pointerTargets`, `pointerKey` and the data tag go; `IrSelect` stays for instance handles only.

**Backends.** `semantics/memory.ts`: one growable buffer, little-endian load/store per elementary type, a region table
(static regions at instantiation: a program/GVL, every instance of an escaped FB type in declaration order — inside its
parent's region at the measured offset when the parent escapes; a stack region per call of an escaped routine). Rust:
`Mem` in `runtime/pointer.ts`, printed on demand, threaded as its own `m: &mut Mem` to the routines that reach it — not
inside `g`, whose global in-outs (`call-inout-global`) would then conflict with it. An escaped instance struct holds its
`__base`. Twin cases `memory.cases.ts` through `runtime-twins.test.ts` (the `string.cases.ts` pattern), before any caller.
Null is 0 and the image starts at IMAGE_BASE = 2^32, so a step below a first element never reaches 0.

**RC 44 (4.5)** is IMAGE_BASE: `ELEMENT_TAG_BIAS` (11 uses) goes, `tr_44` stays confirmed. **RC 14 (4.6)**: a latch
through a pointer is one conditional image store — no arms left to latch in; `tr_14` stays confirmed. **RC 15 (4.7)**:
`b := a` of an escaped FB type copies a's region into b's, so `b.p` keeps `ADR(a.x)` (`sameA` TRUE); `tr_15` lowers.

**Stays refused, by code:** 4.2's list, plus `pointer-outlives` (a pointer read after its stack region is gone reads
residue, unrecorded) and `layout-unmeasured` on any FB field offset a program observes (walk, difference, cross-field
order) until 4.3's FB-header recording lands; equality and dereference need no offset.

**Migration.** Owner acceptance of §3.3 is taken from the go to continue (2026-10-09). 4.3: ONE recorder batch per
vendor (FB header with and without IMPLEMENTS, a WSTRING layout, DINT-as-REAL at qNaN/sNaN/±0/denormal/±max), then the
IR (G, walk totality). 4.4: `dynamic-memory` first (failing `__NEW`-only test); `memory.ts` + `Mem` unwired with twins;
then escape pass, layout and the data-pointer switch in one commit (S-out lists the moved rows; the 83 lowered pointer
rows stay lowered, every confirmed `indirect` row stays confirmed). 4.5-4.7 then verify/lower their fixtures.

### §3.3 Decision (step 4d, as built): where reality moved the plan above (tasks 4.3-4.7, 2026-10-09)

The step-4d plan held: data pointers are byte addresses into one image per program, the image is a `Place` root, both
backends implement it, RC 44/14/15 pass. Seven choices moved while building it; each is the smaller change the
measurements allowed, and each is written down here so the next step does not re-decide it.

- **4.3's recordings settled the layout.** `fb_header_offsets_plain`/`_implements`: an FB's fields sit behind an 8-byte
  header plus 8 per IMPLEMENTS interface, in DECLARATION order across VAR_INPUT, VAR_OUTPUT and VAR (inB 8, outD 12,
  outW 16, offLoc 24, loc 32, SIZEOF 40; +8 each with one interface). `storage/bytes.fieldBytes` now answers FB field
  offsets, so `ADR(inst.f) - ADR(inst)` and `ADR(loc) - ADR(THIS^)` fold (both fixtures lower and are confirmed).
  `wstring_layout_in_struct`: a WSTRING(n) is 2·(n+1) bytes aligned to 2. `reinterpret_dint_as_real_edges`: CODESYS keeps
  every bit of a DINT read as a REAL, the signalling NaN included. `layout-unmeasured` is registered; with the header
  measured, the only layouts left unmeasured fall back to one region per field (below), so it is raised only for an
  escaped type with no layout at all.
- **The escape unit for a PROGRAM's or GVL's variables is the VARIABLE, not the frame.** Where a program places its
  variables is not measured (4.1), so the frame's other variables could never be observed beside an escaped one; putting
  only the escaped variable in the image (a region of its own, `IrSlot.image` its address) answers the same and leaves
  every other variable — and every harness read of it — where it was. An FB TYPE stays the unit for instances (measured).
- **Unmeasured layouts are runs of one.** A derived FB, an FB with a VAR_IN_OUT or a METHOD's VAR_INST, a field after a
  pointer or another field of unmeasured size: each image field is a region of its own, 16 bytes from the next, so a
  dereference and an equality work (they need no offset, §3.3 4d) and a walk, a difference or an order across two
  regions faults by name (`address-outside-image`, `address-across-frames`) instead of answering our layout. A field the
  image does not hold (a pointer, a STRING, an instance) stays in the struct and ends a run. An EXTENDS family escapes
  together, and a derived FB keeps its base's fields at the base's offsets: one body serves both.
- **The escape pass is a lowering, run to a fixed point** (`lower/pointers/escape.ts`, `entry/lower-unit.ts`). A
  syntactic pass would need lowering's place resolution (sections, scopes, references, unions) a second time, a second
  home for each of those rules (P1). The first lowering records every address store and copy; with none it IS the result,
  so a program without one lowers exactly once and exactly as before (S-out). Otherwise the unit lowers again on that
  answer until nothing new is found (4 passes at most; the fixtures and corpus settle in 2).
- **Data TAGS stay where the image cannot hold the target** — a routine's local (no region per call is built), a
  VAR_IN_OUT's target, an ANY's `pValue`, a STRING's characters, a pointer, an FB instance (the handle). A pointer holds
  addresses or tags, never both: a store of a tag's target marks its pointer TAGGED, closed over copies both ways, and a
  tagged pointer lowers exactly as form 1/3 did. So `pointerTargets`, `pointerKey`, the data tag and `ELEMENT_TAG_BIAS`
  remain for those pointers; they go with the targets the later tasks move (4.9 ANY, 4.14 the schemes, 4.15 `staticKey`).
- **`base` is a load, regions are lowering's.** The instance's region address is a hidden `__base` FIELD (the
  `__inout_binding` mechanism), set by its initial value; lowering allocates every static region (`lower/pointers/
  image.ts`) and hands the backends `IrPou.image` — size, initial bytes, regions — so a backend allocates nothing (P4).
  No `image` sizes ride on `IrLayout`/`IrRoutine`; a struct the image holds carries its `size` and field offsets.
  An instance of an escaped type where no static region is — a METHOD's or FUNCTION's local, a VAR_TEMP — is refused
  `image-stack`.
- **One new expression is `address`, not `base`**: `ADR(x)` of an image place, the address its `at` and checked index
  steps reach. An image place keeps its INDEX steps (each with its element `size`): the bounds check is the element
  place's, with its fault text. `address_order` (a builtin) orders two addresses inside one region. A VAR_IN_OUT bound to
  an image place is an `IrCopy` with `back`; its address is frozen where it is written (`callshape_inout_pointer_before_call`),
  and a callee that also reaches the image while holding the copy is `call-inout-alias`. `Mem` is threaded to EVERY
  generated body of a program that has an image (as `g` is), not only to the bodies that reach it.
- **The interpreter's REAL keeps no NaN bits.** A REAL is a JavaScript number, whose NaN is always the positive quiet one:
  a bit-exact readback of a NaN (`tr_28_*`'s sign, the sNaN of `reinterpret_dint_as_real_edges`) diverges in the
  interpreter while the emitted Rust keeps the bits as CODESYS does. Those three fixtures run as expected failures naming
  it; `memory.cases.ts` marks the sNaN case for the TypeScript side. 4.9/4.12 decide the value model's NaN.

`dynamic-memory` (`__NEW`, `__DELETE`) is registered and raised before any of this (failing test first). The refused list
by code is 4.2's plus `image-stack`; `pointer-step`, `pointer-runtime-index` and `pointer-type` are no longer raised for a
pointer that holds addresses (it steps bytes, takes its address where `ADR` is, and reads any type over its target's
bytes); they stay for tagged pointers.

### §3.3 Decision (step 4e): RC 16, 17, 18, 20 and the unblocked fixtures (tasks 4.8-4.12, 2026-10-09)

**Target.** An ANY's `pValue` is an ADDRESS into the image (RC 17); RC 16 is fixed inside `__inout_binding`; RC 18 and the
interpreter's NaN bits are accepted losses by name; RC 20 and `tr_34` are verify-only. No new recordings: the `tr_16`,
`tr_17` and `tr_18` answers are committed, the reinterpretation edges were recorded at 4.3.

**RC 17 (4.9).** Measured: pro2193 stores `in.pValue` into a program-held UNION of pointers (`Increment`, `BitLogic`:
`uInput.p1_Byte := input.pValue`, the arm picked by `diSize`) at 273 call sites in 41 files — not niche. Rule: a STORED
`pValue` is an address store of each call site's argument, so that argument escapes by 4d's units (its FB type, or the
program/GVL variable) and `pValue` lowers to `address` of it; `diSize` stays the call's constant; `pr^` reads the bytes at
the pointer's type, `pb^ := 16#FF` writes one byte of four. A UNION whose members are all address pointers is one address:
reading another arm is that address at the arm's target type. An argument the image cannot hold (a routine local, a
VAR_IN_OUT's target, a STRING's characters) keeps the tag and its `pointer-type` on a mismatched type; an argument that
is no place keeps `any-input`. Rejected: a per-arm bit cast over the tagged `pValue` — a second reinterpretation home
beside the image (P1), with no answer for a narrower write; a refusal — 4.2 chose reach.

**RC 16 (4.8).** Stays in `__inout_binding` (4.2: in the image every in-out target would escape). `w2 := w` already copies
the hidden field, and binding tags are numbered per POU (instance, bound places), so a METHOD dispatch on an FB type in
`copiedWhole` arms EVERY binding tag of that type made in the frame, not only the receiver's; a tag made in another frame
stays `call-fb-inout`. Cheap (the arm set's filter), so fixed although the corpora have 0 copied-whole shapes (their 2
`call-fb-inout` POUs are runtime-indexed receivers and stay refused). Rejected: refusing `w2 := w` — CODESYS runs it.

**RC 18 (4.10).** Stays `interface-instance-relative` — niche: accepted loss (0 occurrences in the corpora; their 35
`__QUERYINTERFACE` write locals). Answering it needs an absolute instance handle lent from any frame (a global's arm
reaching another frame's child), a lend path from `g` to every static instance — not the per-frame lend 4.14 merges.

**RC 20 (4.11).** Verify: the copy-out closed upstream (8ce61e47f8), `tr_20` confirmed, src test in `calls/outputs.test.ts`,
the transpile-st-to-rust task already reads "superseded by 4.11", the LSP false positive is filed in
`lsp-transpile-review-gaps`; `tr_43_output_dint_to_int` stays 6.17's.

**4.12 and the NaN bits (owner item of gate 4b).** `tr_34_lib_prim_char_behind` is confirmed (the chars path): verify. The
interpreter's REAL stays a JavaScript number — niche: accepted loss (1 occurrence in the corpora: bakon-nano
`ReadParametersFromAGM` views a REAL's bytes through a POINTER TO ARRAY OF BYTE). `tr_28_minmax_limit_nan_signed_zero_{real,
lreal}`, `reinterpret_dint_as_real_edges` and `memory.cases.ts`'s sNaN keep their expected-failure marks, with that reason;
the emitted Rust keeps every bit, as CODESYS does. Rejected: NaN-carrying interpreter values — every float operation
would have to reproduce x86's NaN propagation and default NaN (16#FFC00000 from SQRT(-1)) for one occurrence;
canonicalizing a stored NaN to x86's default — fixes `tr_28`, breaks the recorded quiet NaN 16#7FC00000 (a guess).

**Stays refused, by code:** `pointer-type` (tagged pointers, and a form-2 argument of another type: 40 corpus POUs, all
but one — lenze `SafetyPLC_WordsToUDT`, also `pointer-root-input` — blocked by other codes too), `any-input` (a non-place
argument; `TypeClass` unmeasured), `call-fb-inout`, `interface-instance-relative`.

**Migration.** 4.8 (src test red first) → 4.9 (the escape rule, then the union rule; the four `tr_17` lower and confirm;
the pro2193 `any-input`/`pointer-type` POU counts before and after in tasks.md) → 4.10 and 4.12 (reasons on the marks, no
code) → 4.11 (verify).

### §3.3 Decision (step 4e, as built): how a stored `pValue` reaches its call sites (tasks 4.8-4.12, 2026-10-09)

The plan held: RC 16 inside `__inout_binding`, RC 17 by address, RC 18 and the NaN bits accepted losses, RC 20 and `tr_34`
verified. One mechanism the plan left open is fixed here, so 4.14 does not re-decide it.

- **A stored `pValue` is a hidden POINTER input, not the hidden VAR_IN_OUT.** The variant's `__any_<v>` in-out cannot
  carry an address: bound to an image place it is an `IrCopy` with `back`, so a write through the pointer would be undone
  by the copy-back (and is `call-inout-alias`). So a variant whose body stores `v.pValue` into a pointer that holds
  addresses takes `__anyadr_<v>`, a POINTER TO BYTE input, INSTEAD of the in-out; each call site fills it with
  `ADR(argument)`, an address store into the ANY's holder `ROUTINE:<variant>.__any_<v>` — the key a pointer input of a
  routine already uses (`calls/invoke.ts`), so escape, tagging and copies follow 4d's rules unchanged.
- **Which variant is decided by the escape answer** (`Escapes.anyAddresses`), because the in-out is declared before the
  body lowers: the lowering that first sees the store records it, the next one declares the input (and the call sites
  store, so the argument escapes), the one after lowers on the escaped argument — three passes for this shape, within
  `ESCAPE_PASSES` (4). A call site whose argument the image cannot hold tags the holder, the tag closes over the
  `p := v.pValue` copy, and the variant is the in-out one again (`pointer-type` on a mismatched dereference, as before).
- **The union rule is no code**: the members of a UNION of pointers share one `pointerKey`, so they hold addresses or
  tags together, and an arm read is `imageDeref` at that arm's type.
- Rejected: keeping the in-out AND adding the address (the copy-back above); filling the address only where the argument
  is already in the image (the first lowering would then never make it escape).
- **Accepted loss (review of 4e)**: a variable handed to an ANY by address is in the image, so a call that lends it to a
  VAR_IN_OUT of a callee that reaches the image is `call-inout-alias` even where the two do not overlap (`F(v := d, io :=
  e)` once `e` is an ANY argument elsewhere); the tag path lowered it. Niche: accepted loss (0 occurrences in the corpora
  — the only routines storing a pValue, pro2193's `Increment` and `BitLogic`, declare no VAR_IN_OUT).
- **RC 16's arms (review of 4e)**: a copy carries the source's binding, so every binding of a copied FB type is an arm —
  but the tag a frame-relative call writes is the same in every instance of its frame type, so an arm lending a binding
  ANOTHER instance's call made is built only where its places cannot depend on the frame instance (globals, or the root
  PROGRAM's one frame); otherwise `call-fb-inout`. Lending it from the running frame wrote the wrong instance's variable
  (`tr_16_fb_copy_across_frame_instances`: CODESYS x1.a = 11, x2.a = 1). Under a copy an EQUAL instance key proves
  nothing either: the key is frame-relative (`inner` in x1 and in x2 is one key), so a copy into the same-named field of
  another instance is refused by the same rule — every binding of a copied FB type whose places are not global, made in a
  frame that is not single, is `call-fb-inout`, whatever its key.

### §3.3 Decision (step 4f): appendix items, tag schemes, `staticKey`, model delta (tasks 4.13-4.16, 2026-10-09)

**Target.** Tags stay only where 4d's image cannot hold the target, and there are exactly three schemes, each with one
reason: INSTANCE HANDLES (interface variables AND pointers/references to an FB instance, one table in `interfaces/tags.ts`),
the RESIDUAL DATA TAG (a pointer whose target is a routine local, a VAR_IN_OUT's target, a non-image ANY argument or a
STRING's characters — numbered per `pointerKey`), and `__inout_binding` (4.2: in the image every in-out target escapes).
All number through `core/tags.ts` (already true since 1.7.19).
- Deciding measure (corpus probe, `probe-lowering-refusals.ts`, 250 refused POUs): pointer/interface codes are the SOLE
  blockers of 4 POUs (3 `pointer-root-input`, 1 `pointer-order`); the residual-tag codes `pointer-outlives` (42 POUs),
  `pointer-targets` (16), `pointer-order` (48) and `interface-instance` (13, e.g. `itfVacuums[i] := Vacuum[i]`) are
  each co-blocked by other codes in every POU but that one.
- Rejected: stack regions per call so data tags go entirely (`image-stack` for routine locals) — unblocks 0 POUs alone
  and adds per-call allocation to both backends; one table for data and instance tags — a data tag indexes ITS pointer's
  target list, a handle the POU's instances, so merging re-keys every residual pointer for no reach; keeping
  pointer-to-instance on data tags — two numberings of one instance, so `itf := ref^` (refused `interface-instance` today)
  would need a translation select.

**Appendix items (4.13).** ONE recorder batch per vendor for all six fixtures first. (a) a target set read while growing:
the escape loop's fixed point also re-lowers while a residual target set grew after a use read it (inside
`ESCAPE_PASSES`); rejected: building arms at finish, a second home of arm building (P1). (b) a pointer copied into a
multi-target pointer re-maps the source's tag through a select (NO_TAG → NO_TAG), never writes its constant. (c) `0 = p`
/ `0 <> p`: the operator normalizes the zero to the right. (d) `r.3`: the bit step applies to the reference's implicit
dereference. (e) an ANY given a REFERENCE TO: the argument is the referenced place. (f) a GVL instance through an
interface: `lendPlace` answers its `global` place (every body holds `g`); a call that already holds `g` mutably stays
`call-inout-global`. Each lands red-first as F or, where the recording says otherwise, a named refusal.

**Tag schemes (4.14).** The pointer-to-instance arms move into the handle table (`tagOf`); a dereference of an instance
pointer is the handle, dispatched and lent as an interface's. S-out set: the 12 `mem_reference_to_fb_*`-style rows stay
lowered. `instanceRelative` stays with RC 18's reason (niche: accepted loss, 0 occurrences in the corpora: an absolute
handle needs a lend path from `g` to every static instance).

**`staticKey` options (4.15).** Corrects 4.2: `pointerKey` STAYS — it keys the residual tagged pointers, a UNION's members
(4e) and the ANY holder, none a path. `interfaceKey` stays (the handle's key). `SAME_STEP` folds into `KEY_STEP` if a G
check (throw on any constant index that is not a bigint, over the suite) finds no other value type — then `sameTarget` is
`staticKey` equality plus `element`/`chars`; otherwise it stays with that reason. `SUFFIX_STEP` stays: a Rust name, not a key.

**Stays refused, by code:** 4e's list, plus `pointer-outlives`, `pointer-targets` (a pointer holding both a tag and an
index), `interface-instance` (a runtime-indexed instance), `image-stack`.

**Model delta (4.16).** architecture.md line 313 gets 4.2's sentence plus "a pointer the image cannot hold keeps a tag";
the refused list above into docs; the map delta in tasks.md. Migration: 4.13 (record, then a–f) → 4.14 → 4.15 → 4.16.

**As built (step 4f, 2026-10-09) — where reality changed the plan, and why.**
- (a) The re-lowering alone cannot help: the next lowering would read the same partial set at the same use. Each lowering
  is SEEDED with the sets the previous one ended with (`state.grownTargets`/`seedTargets`), in their recorded order, so a
  store finds its target and writes the same tag; a set still growing after `ESCAPE_PASSES` is refused `pointer-targets`
  by name rather than lowered on part of a set. Every read of a set goes through `state.readTargets`.
- (b) Built for a SINGLE-target source (a copy of several stays refused `pointer-targets`, as before): `p := src` into a
  pointer of several targets is `IF src <> 0 THEN p := tag ELSE p := 0`. A copy of an INSTANCE pointer is a plain copy —
  both number through the handle table (4.14).
- (e) A REFERENCE argument is stepped through in the two places that read the argument: `anyArgumentTypes` (the variant
  is lowered for the referenced type — the E0308 was a hidden VAR_IN_OUT of the reference's type) and `bindAnyAddress`.
- (f) `lendPlace` answers the GVL instance's `global` place as planned, and the call then meets the blocker a DIRECT
  `gInst.M()` meets: the METHOD takes `g`, the instance lives in `g` (rustc E0499). The dispatch arm is refused
  `call-global-instance`, the direct call's code — niche: accepted loss (0 occurrences in the corpora:
  no corpus code stores a VAR_GLOBAL FB instance into an interface; tasks.md 4.13 gate review). The fixture records the reason (`deferred.transpile`) and rates `not-lowered`.
- 4.14: the NUMBERING merged (`instanceHandle`; a pointer to a whole instance writes its handle, a copy carries it), which
  is all the 18 instance-pointer fixtures reach — every one single-target, every target a frame variable (census
  2026-10-09). Dispatching and lending a MULTI-target instance pointer as an interface is not built: 0 fixtures and 0
  corpus POUs where it is the sole blocker (the residual codes are co-blocked everywhere but the 4 POUs above, none of
  them this shape), so `p^.M()` over several instances keeps `pointer-targets`. S held: IR, outputs and edge identical
  over all fixtures (the handle of a lone instance is 1, as its tag was).
- 4.15: the G check found no constant index that is not a bigint (every fixture, the six corpora, `bun test src` — only
  a synthetic case in `path.test.ts`), so `SAME_STEP` folded into `KEY_STEP` and `sameTarget` is `staticKey` equality
  plus `element`/`chars`.

### 3.4 Instance initialization (model 4): RC 22, 23, 24, 25, 30

**Home.**

| Part | File |
|---|---|
| Lowering | `lower/init/*` |
| Type defaults | `types/defaults.ts`, `types/enums.ts` |
| IR | `ir/program.ts` (`IrInit` fully resolved; `IrPou.init` as the ordered init step; the VAR_TEMP reset form) |
| Semantics | `semantics/instantiate.ts` |
| Interpreter | `interp/runner.ts` |
| Rust | `emit/rust/values.ts` (the one `initOf`), `emit/rust/module.ts` (`new()`, `init()`) |

**What the recordings fix.**
- An instance's implicit initialization completes before its own FB_Init (RC 22: `tr_22_fb_init_reads_adr_field`, `_call_field`,
  `_this_field`, seen = 7).
- In a containing frame, initializers and FB_Init calls interleave in declaration order (RC 23:
  `tr_23_fb_init_argument_from_pending_init` got = 4, `_reversed` got = 0; `initseq_fb_init_declared_last`, `initseq_after_fb_init`).
- A VAR_TEMP's initializer is re-evaluated on every call, in both FBs and PROGRAMs (RC 24 LIVE; `var_temp_dynamic_init`), including
  arrays and structs (RC 30: `decl_temp_array_init_resets`, `decl_temp_struct_init_resets`; closed upstream in e06405f97c — the
  `fresh` arm prints the init-aware `initOf`; the free `initOf` it left behind is folded in by task 5.4).
- An array element takes its element type's default: an enum's, an alias initializer, an alias array's. A partial initializer's tail
  is the family zero (RC 25: `array_element_type_default`, r_alias_part2 = 0).

**Measure (task 5.1).**
1. The EXTENDS interleaving: base fields, base FB_Init, derived fields, derived FB_Init, or all fields first.
2. The order of a nested instance inside a STRUCT field, and the scope its FB_Init arguments fold in (appendix: `lower.ts:507`).
3. Whether "a structured initializer applies after FB_Init" (`lower.test.ts:463`) is recorded or only asserted. Find the recording,
   or record it.
4. The order across GVL instances, PROGRAM instances and `call_after_global_init_slot` methods.
5. THIS inside an initializer (`tr_22_fb_init_reads_this_field` is `place-not-local` today).
6. The VAR_TEMP reset in a METHOD and a FUNCTION (RC 24 recorded FB and PRG only).
7. A VAR_TEMP array and a VAR_TEMP struct whose initializer is **dynamic** (reads an input, calls a function):
   `var_temp_dynamic_aggregate_init`. This decides the reset form below; without it the choice has no fixture.

**The model to design.**
- One recursive, declaration-ordered walk `init/step.ts`: for each declaration of a frame in order, either run its initializer, or
  run the instance's own full init (fields in order, then FB_Init with arguments evaluated now in the containing frame).
- `IrSlot.init` keeps only folded constants, which both backends apply in `new()`/`instantiate`. Everything dynamic is a statement
  in the ordered step.
- The VAR_TEMP reset is the same declaration-ordered statements run at body entry. `IrFresh` either carries a resolved `IrInit`
  (static) or disappears in favour of statements. Decided by M5.1.7: if `var_temp_dynamic_aggregate_init` shows a dynamic element
  initializer re-evaluated per call, statements; if every aggregate VAR_TEMP initializer in the fixtures folds, `IrFresh` with a
  resolved init.
- `init-reads-instance` (init-sequence.ts 61-71) is lifted where the order makes the read legal, and refused only where CODESYS's
  order still reads an uninitialized field. (§3.4 Decision, below: kept at its present scope, not lifted.)

**Couplings.** Lean 7 (routine signatures) and 8 (derives, aggregate syntax) sit on this model's final `new()`/`init()` shape.

### §3.4 Decision: initialization (task 5.2, 2026-10-09, on 5.1's measurements)

**Target.** ONE declaration-ordered walk, `init/step.ts`, replaces today's three phases (every FB_Init, then the structured
initializers, then the rest of the frame's own initializers, then the slot methods). Frames in the recorded order (M5.1.4):
each GVL, then the POU, then each PROGRAM it calls — recorded for ONE GVL and ONE called PROGRAM only; the order among
several GVLs, and among several called PROGRAMs, is recorded first in 5.7 (one batch: two GVLs and two called PROGRAMs,
each with a stamping initializer, plus a renamed twin), and until it is, `init-frame-order` refuses by name a step
statement in more than one GVL frame or in more than one called-PROGRAM frame. Within a frame, per declaration in order,
exactly one of:
- a CONSTANT initializer: folded into `IrSlot.init`, applied by `new()`/`instantiate`, ONLY while no step statement
  precedes it in its frame's walk. From the frame's first step statement on, every later constant of the frame is a
  statement at its position and its slot starts at its type default (`cfold_non_constant_argument` 0;
  `init_this_in_initializer` reads a later field's default 0). The rule is by POSITION, not by an analysis of what an
  earlier statement reads or writes: a statement reaches a later slot through THIS, a pointer handed to an FB_Init, or a
  called body as easily as by name, and a write after the fold (`pOwner^.later := 1` from an inner FB_Init, then
  `later : INT := 9`) is as wrong as a read (CODESYS's walk gives 9; folding gives 1). By position it is exact for every
  path, so nothing is left to decide. A LATER INSTANCE's fields are the exception: their constants are folded per TYPE
  (`T.__init`, shared by every instance), so an instance has no per-instance "not yet initialized" state to start in,
  and what an earlier statement sees of it is unrecorded. `init-reads-later` (`lower/init/sequence.ts`) is kept and
  refuses it: a step statement that reads or writes a later declaration — by name (today's scope, including `k.v` of a
  later instance `k`), or by passing THIS, `ADR`/`REF=` of the frame or of a later slot, or a pointer into the frame to
  a call or an FB_Init, or by calling a routine whose body reaches the frame's storage (a GVL's variables, `PRG.x`) —
  wherever the target is a later INSTANCE's field; a later scalar or aggregate slot of the frame needs no refusal (the
  position rule sequences it);
- a DYNAMIC initializer: the assignment at its position (aggregates: the static part stays in `init`, each dynamic
  element or field is an assignment after it, in element order — M5.1.7);
- an INSTANCE: its whole init, then the next declaration. Per class of the EXTENDS chain, base first: that class's own
  fields, then that class's FB_Init with its arguments evaluated NOW in the containing frame (M5.1.1, RC 22, RC 23);
  then the instance's structured initializer (M5.1.3). M5.1.1 records only SCALAR fields in an EXTENDS chain; a class of
  a chain holding a field INSTANCE that runs FB_Init (where that FB_Init falls against the base's FB_Init and the
  derived FB_Init) is not recorded, and it is common (about 800 FBs of the six corpora extend a base and hold such a
  field). So 5.6 records it first (one batch per vendor: a base with a stamping FB_Init, a derived class holding a field
  instance whose FB_Init stamps, with and without its own FB_Init, and a twin with the field in the BASE) and lifts
  `fb-init-order` at `fb-init.ts`'s EXTENDS site only to the order recorded; until then that site stays refused.
  Without EXTENDS, nested instances run at their position (`fb_init_nested_in_fb_init`; `T.__init` split at each, as
  today). A STRUCT field instance's arguments resolve in the struct's scope — its earlier fields' runtime values, then
  globals (M5.1.2).
Then every `call_after_global_init_slot` method, after all frames. THIS is legal in an initializer (M5.1.5): it is the
frame's own place, at its current state.

**The VAR_TEMP reset** is the same walk over a routine's VAR_TEMP (METHOD/FUNCTION: VAR) at body entry, every call
(M5.1.6, M5.1.7): `IrFresh` stays, carrying the fully resolved static `IrInit` (5.3/5.4), and the dynamic elements are the
statements after it. `IrPou.init` doc: "the ordered init step: dynamic initializers, FB_Inits, structured initializers,
slot methods"; `IrSlot.init`: "the folded constant, or the type default when the step assigns it".

**Rejected.** All fields first, then FB_Inits — M5.1.1 shows base FB_Init before derived fields. Keeping the three
phases — contradicts M5.1.1/2/5. `IrFresh` with a folded init only — M5.1.7 re-evaluates dynamic elements per call.
Everything a statement (no constant `init`) — moves every fixture's `new()` for no recorded difference (S-out lost).
Arguments of a STRUCT field's FB_Init folded in the declaring POU's scope (today) — refused on both vendors (`_local`).

**Stays refused, by code.** `init-reads-instance` keeps exactly its present scope: a read of an EARLIER instance's field
is legal by the walk's order (that instance is complete), except of an instance with a STRUCTURED initializer — whether
a sibling sees that value is unrecorded (`fb_init_and_structured_initializer` pins it only against its own FB_Init); the
walk applies it right after that FB_Init. A read of a LATER instance's field is `init-reads-later` (above), not a read
"at its defaults". `fb-init-order` is lifted only where recorded: its EXTENDS site (`fb-init.ts`, a chain holding a field
instance that runs FB_Init) stays until 5.6's recording, and its NESTED-structured-initializer site (an instance declared
with FB_Init arguments and a nested structured initializer, or one naming an unknown field) stays — M5.1.3 /
`fb_init_and_structured_initializer` records a FLAT structured initializer only; niche: accepted loss (0 occurrences in
the corpora: no declaration combines FB_Init arguments with any initializer). New `init-slot-order`:
more than one `call_after_global_init_slot` method in the program — in one frame or several, with the same slot number
or different ones (the attribute's value is a priority neither §3.4 nor `init/attributes.ts` models); their order among
themselves is neither declaration nor frame order (M5.1.4, moves with names) and every recording holds one per frame
with the value `'50000'` — niche: accepted loss (0 occurrences in the corpora: no `call_after_global_init_slot`).
`init-frame-order` (above) until 5.7's recording. `fb-init-argument`
for positional / VAR_IN_OUT / VAR_OUTPUT FB_Init arguments and the global-written-while-read case, unchanged.
`attr-init-unreached` for an instance in an array element, a non-PROGRAM global or a routine local, unchanged.

**Migration.** 5.3 element defaults (`typeDefault` complete) → 5.4 one `initOf` → 5.5 VAR_TEMP reset as above → 5.6 the
walk with per-class fields/FB_Init (RC 22, EXTENDS) → 5.7 interleaving across declarations and frames, the constant-
read-early rule (RC 23) → 5.8 the STRUCT field scope and `insideInstance` → 5.9 the read
walk sees `select`/freeze → 5.10 the IR docs above and architecture.md.

### §3.4 Decision (step 5c): element defaults, one `initOf`, VAR_TEMP, per-class init, the position rule (tasks 5.3-5.7, 2026-10-09)

**Measured at 988e96fa94** (lowering each fixture): `array_element_type_default`, `decl_temp_{array,struct}_init_resets`,
`var_temp_dynamic_init`, `tr_22_fb_init_reads_{adr,call}_field`, `tr_23_*` are already confirmed. Refused:
`var_temp_dynamic_init_{method,function}` and `var_temp_dynamic_aggregate_init` (`init-not-constant`: `declare.ts` never defers
in `routineMode`, and an aggregate is not `runnableInit`); `init_extends_interleaving` (`fb-init-order`, `fb-init.ts:320`);
`tr_22_fb_init_reads_this_field` (`place-not-local`, THIS); `init_this_in_initializer` (`expr-member`); `cfold_non_constant_argument`
(`init-reads-later`). The backends still pick an element default: `elements[i] ?? typeZero(element)` (`instantiate.ts:21`,
`values.ts:96`) and `initOfValue`'s `typeZero(array.element)` (`values.ts:21`). The Rust baseline prints 866 uniform `[x; N]`, up
to N = 100000 — which decides 5.3's form.

**5.3 Choice: a complete, compact `IrInit`.** An array's init becomes `{ elements: IrInit[], rest: IrInit }` — the stated
elements, then every remaining one at `rest` — with no `undefined` hole and no scalar placeholder for an array. Lowering states
`rest`: the element type's start for an undeclared array (`elementDefaults`: enum, alias `:=`, alias array, a struct's `{ fields: {} }`
= its layout's fields), the family zero for a partial initializer's tail (r_alias_part2 = 0). Both backends then only read:
`instantiate` and `initOf` lose `typeZero`, and `initOf` prints `rest` as today's `[x; N]` / `from_fn`, so S-out holds. The element
fact stays in `lower/init/initial-values.ts`, not `types/defaults.ts`: it folds an alias initializer and numbers an enum with the
lowering's `enumeratorValue`, which `types/` may not import; `typeDefault` is not built (task text corrected). Rejected: a full
`elements` list (100000-entry IR, Rust text moves); `typeZero` left in the backends (a backend picking a default, undone in 1.1.4).
Batch-recorded first in 5.3 (one run per vendor): an enum array's partial tail and an alias-of-alias element (the `aliasInit`
ponytail) — unrecorded, each refused by name until then.

**5.4.** The free `initOfValue` becomes `initOf`'s leaf case; one `initOf(layouts, t, IrInit)` left (grep).

**5.5 VAR_TEMP / routine locals.** `declare.ts` defers in `routineMode` too: a METHOD/FUNCTION's VAR and VAR_TEMP dynamic
initializer is queued in `tempInits` (keyed by the local slot), and `resetTemps` walks `localSlots` in `routineMode`. An aggregate
with a dynamic leaf splits in `aggregateInit`: the static part is the slot's `IrInit` (the dynamic leaf at its `rest`/type start),
each dynamic leaf an assignment `arr[i] :=` / `rec.f :=` after the `IrFresh`, in element order (M5.1.7) — for VAR_TEMP every run,
for an FB/PROGRAM VAR once at its position in the step. A dynamic leaf reading its own aggregate or a later temp stays
`init-reads-later`. A GVL's dynamic aggregate stays `init-not-constant` until 5.7 walks GVL frames. Rejected: everything a
statement (S-out lost on every array).

**5.6 per class.** `fb-init.ts:320` goes: per class of the chain, base first, `instanceInitRoutine(class, its field range)` then that
class's FB_Init — the existing range split, cut at class boundaries as well as at field instances. THIS in an initializer lowers to
the frame's own place (`[]` in the step, the bound instance in `__INIT`); `tr_22_..._this_field`, `init_this_in_initializer` must
pass, else stay not-lowered with the remaining code written in 5.6. The EXTENDS-with-field-instance site (`fb-init.ts:179`) is lifted
only to 5.6's recording; the nested-structured site (`:204`) stays (niche, 0).

**5.7 position rule.** Decided in `step.ts` after the walk, not in `declare.ts`: from a frame's first step statement on, each later
slot whose `init` is a non-default constant gets `slot := const` at its position and `init` = its type start (the existing `clear`).
The same rule in a type's `__INIT` frame. Rejected: deciding at declaration (whether an earlier instance's init emits anything is
known only once its layout's init is built). `init-reads-later` then narrows to a later INSTANCE's field, by any path (§3.4);
`init-frame-order` and `init-slot-order` as §3.4; `init_gvl_program_slot_order{,_renamed}` lifted only to 5.7's recording.

### §3.4 Decision (step 5c, as built): where reality moved the plan above (tasks 5.3-5.7, 2026-10-09)

**Recorded first** (one batch per vendor: `record:exec`, `record:language` on CODESYS and on TwinCAT Project13; all build
clean on both): `array_element_enum_partial_tail`, `array_element_alias_of_alias` (`declarations/section-semantics.ts`),
`init_extends_field_instance`, `init_extends_field_instance_in_base`, `init_frame_order_several`,
`init_frame_order_several_renamed` (`oop/init-model.ts`).

**5.3.** The tail of a partial array initializer is NOT the family zero: an ENUM array's tail is the enum's default
(`array_element_enum_partial_tail`: `[E.B]` gives B, A, A — 4, 3, 3), an alias-of-INT's is 0 (`r_alias_part2`). The rule:
the element type's start WITHOUT an alias's `:=` (`tailStart`). Storage erases an enum to its integer, so the tail is read
from the element's DECLARED type — the declaration's, a struct or FB field's (`fieldWritten`), through array aliases
(`arrayWritten`); where none is at hand an elementary tail is refused by name (`aggregate-init`) rather than started at a
zero that may be an enum's wrong value. An alias OF an alias takes its own `:=` only (`array_element_alias_of_alias`:
`Plain : Base` with `Base : INT := 5` is 0, `Own : Base := 6` is 6) — `aliasInit`'s ponytail was right, now recorded. Every
array slot's `IrInit` is complete: `lower/core` `zeroInit` (no scalar placeholder for an array) is `lw.slot`'s default.
Found by the fail-loud backends: `arr : ARRAY[0..1] OF INT := 1` (and a struct's, an FB's) lowered with the scalar
dropped in silence — CODESYS refuses it (`litc_*_init_*`); now `init-composite-scalar` (invalid).

**5.4.** As planned; `initOf` prints a stated-nothing array as `[x; N]` / `from_fn`, so an undeclared array of an enum or
alias prints compact (`array_element_type_default`'s shape moved, values not).

**5.5.** As planned, plus: the PARSER read `c := F(g)` in a STRUCT initializer as a repeat with count `F` — the
name-then-group repeat is an ARRAY element's rule only (`frontend/syntax/parse/initializer.ts`; `var_temp_dynamic_aggregate_init`
records the call). A routine's dynamic locals are `routineLocalInits`, after the VAR_OUTPUT resets; one reading its own or a
later local stays `init-reads-later`. A dynamic element inside `n(…)` is refused (how often it is evaluated is unrecorded).

**5.6.** As planned, plus three things the plan did not see: (a) a bare `THIS` is `ADR(THIS^)` (`adrOperand`) — it did not
resolve; (b) a type's init sequence is built AFTER its layout is set (`buildLayout`), so `THIS` / `THIS^.n` in an initializer
find the type laid out (it was `layout-recursive`); (c) a BASE's field initializers run on a derived instance as a routine OF
THE DERIVED TYPE (`instanceInitRoutine`'s `on`), as a base METHOD is lowered per frame — filed under the base, the Rust
called a method the derived struct does not have (or the derived type's own `__init` of that name). `tr_22_fb_init_reads_this_field`,
`initseq_this` and `init_this_in_initializer` pass; `init_this_in_initializer_argument` stays `fb-init-argument` (an FB_Init
argument that is neither a constant nor a variable — `THIS^.n`, `THIS` — is 5.8's scope).

**5.7.** As planned, with these readings: (a) NOT a statement under the position rule: a VAR CONSTANT (a compile-time value,
folded where read — `InitFrame.constants`), a slot already at its type's zero, and an instance's or struct's own field values
(folded per type, `position.ts`); (b) `init-reads-later` refuses a read of a later struct or instance slot of the frame by
name or through `THIS^`, and its address (or a bare `THIS`) handed to a call; a called body reaching the frame's storage is
not checked — the root POU's frame is no global a body can name, and GVL frames are not walked; (c) the structured
initializer an instance is declared with is applied right after THAT instance's init (M5.1.3), not after every FB_Init;
(d) called PROGRAMs initialize in the order the POU's body first CALLS them (`init_frame_order_several`: called b, a →
initialized b, a; `_renamed`: declared Z, A, called A, Z → A, Z; neither declaration nor name order) — more than one with
statements where one is not called by the POU's own body is `init-frame-order`; (e) GVL frames: several GVLs initialize in
the order they were CREATED in the project (`init_frame_order_several`: a, b; `_renamed`: Z before A, created in that
order) — a fact the text does not state. GVL frames are not walked (a GVL's non-constant initializer stays
`init-not-constant`, an instance there `attr-init-unreached`), so neither of the two GVL fixtures lowers; a walk of
several GVLs would need `init-frame-order` for that reason; (f) `init-slot-order` refuses several init-slot METHODs only
where their order could SHOW — one calls anything, writes a global, or touches storage another may write (a called
PROGRAM's, a dereference's, an in-out's) — instead of any two: several that each touch only their own instance run alike
in any order, and refusing them would lose the recorded `state_call_after_global_init_counts` and
`fb_init_before_slot_method_*`. `init_gvl_program_slot_order{,_renamed}` stay refused (their slot methods stamp a global
clock; and the GVL frame).

### §3.4 Decision (step 5d): STRUCT field scope, `insideInstance`, the read walk, model delta (tasks 5.8-5.10, 2026-10-09)

**Measured at b277626431** (lowering each fixture; a census of the six corpora, 1823 distinct STRUCT types). Refused today:
`init_struct_field_fb_init_scope_{sibling,shadow}` and `init_this_in_initializer_argument` `fb-init-argument` (the argument
is lowered in the declaring POU's scope, where a struct field is no name); `init_struct_field_fb_init_scope{,_dynamic}`
`init-not-constant` (a STRUCT field's dynamic initializer — a STRUCT has no init frame, `instance-init.ts`). Corpora: 0
STRUCT fields declaring FB_Init arguments, 0 STRUCT field initializers that are not constant (all 7 candidates are
`SIZEOF(THIS^)`), 0 FB_Init arguments naming THIS — every corpus FB_Init argument is a literal; 74 STRUCT fields are FB
instances, none with arguments.

**5.8 Choice: resolve a STRUCT field's FB_Init argument in the struct's scope, nothing more.** `fbInitInput` gains one
branch for a field instance whose holder is a STRUCT: a bare name is first a field of that struct declared BEFORE the
instance — read as `holder.field`, its runtime value at that point of the walk (recorded by `_dynamic`, 1, though that fixture stays refused below;
`_sibling`: 4) — else a global, looked up in `lw.globals` by name, never through the declaring POU's scope (`_shadow`:
the field's 4, not the global's 11; `_local` stays the vendors' refusal). A later field of the struct is
`init-reads-later`. This lifts `_sibling` and `_shadow`. Rejected: a STRUCT init frame (`STRUCT.__init` like an FB's,
so a dynamic field initializer runs) — new frame kind, routine on a non-FB in both backends, for 0 corpus occurrences;
inlining a struct's dynamic initializers into each declaring frame — the same name-rewrite plus per-instance duplication,
same 0.

**`insideInstance` made consistent: refuse both.** The instance ITSELF is a read of it: a place rooted at an instance
declared with a structured initializer whose path reaches the FB or stops ON it (`holder.Get()`'s instance, `x := holder`)
is `init-reads-instance`, as `holder.started` is. Rejected: lifting both — what a sibling sees after the structured
initializer is unrecorded, and an initializer reading such an instance is not a corpus shape (no corpus declaration combines
an FB instance's structured initializer with a sibling reading it), so no recording is made for it.

**5.9: the read walk is `childrenOf`.** `initReadChildren` loses its `select` and freeze/lent skips; what stays is
semantics, not a skip: `ADR(x)` reads only its indices, and an invoke reads inputs, in-outs, then its instance. A read
inside a select arm or a freeze now reaches `init-reads-later`/`init-reads-instance`. S-out over every fixture; a fixture
that moves to a refusal is a hidden read the old walk let through — kept refused, named in tasks.md.

**Stays refused, by name.** `init-not-constant` for a STRUCT field's dynamic initializer, and `fb-init-argument` for an
FB_Init argument that is neither a constant, a variable nor a struct field (`THIS`, `THIS^.n`, any expression) — both
niche: accepted loss (0 occurrences in the corpora); `init_struct_field_fb_init_scope{,_dynamic}` and
`init_this_in_initializer_argument` get that reason as `deferred.transpile` and stay `not-lowered`. `init-reads-instance`
at its widened scope above. Everything §3.4 and 5c list, unchanged.

**5.10 model delta.** `IrPou.init` doc: "the ordered init step: per frame in recorded order, per declaration a dynamic
initializer, a constant after the first statement (the position rule), or an instance's whole init (per class: fields,
FB_Init; then its structured initializer); then the slot methods". `IrSlot.init`: "the folded constant, or the type's
start when the step assigns it". `IrFresh`: "the complete static `IrInit`; dynamic elements are the statements after it".
architecture.md's initialization paragraph says the same in prose plus the refused list; the map delta in tasks.md.

**Migration.** 5.8 (red src tests for the struct-scope branch and `holder.Get()`, then the two fixtures F) → 5.9 (red src
test: a select and a freeze read in an initializer) → 5.10. No recording: every fact used is recorded (M5.1.2).

### §3.4 Decision (step 7.6b): VAR_TEMP as per-run locals (task 7.6.4, 2026-10-10)

**Target.** An FB's or PROGRAM's VAR_TEMP is a local of the fn that runs its body — `let mut plain: i16 = 0;` at the top
of `call()` / `scan()`, a base's at the top of its `SUPER_` fn — not a `pub` field the struct carries between runs.
Measured (IR of every fixture, 2026-10-10): 22 frame VAR_TEMPs lower, in 16 fixtures; 20 are named only by the body
that declares them, 1 by nothing (`mem_sizeof_fb_with_temp`), 1 through an instance path (`oopa_write_var_temp`
`t.scratch := 2`, which CODESYS refuses: evidence `refused`); none is a base's run by `SUPER^()`, none is PLC_PRG's,
none has a stored address; no recorded path names one (7.6.4's measure). Corpora: 48 VAR_TEMP sections in 16 files.

**The choice: the IR says what a VAR_TEMP is — per-run storage, a METHOD's VAR exactly.** `IrLayout.locals` and
`IrPou.locals` (new) hold a body's VAR_TEMP; its places are `root: "local"`, starting at `init` on every run, as an
`IrRoutine`'s locals do. Lowering declares them as `routines.ts` declares a routine's VAR (`declareVars` per-run, which
already queues dynamic initializers), `layout.ts` drops VAR_TEMP from `INSTANCE_STORAGE`, and `resetTemps` collapses
into `routineLocalInits`: the constant reset IS the local's fresh start, only a dynamic initializer stays a statement
(`init-reads-later` unchanged). `baseBody` declares the base's VAR_TEMP as the `SUPER_` routine's locals, so "not at its
fn's top" (7.6.4) is gone. The interpreter enters an FB / PROGRAM body with fresh locals (`interp/calls.ts` `call`, the
scan) where it passed `[]`. The Rust prints them through the code `printRoutine` already has — one `printLocals` over a
body-shaped view, shared by `printRoutine`, `printCall` and `scan()`: `mut` per variable from `writeSites`, no initial
value where no read can see it (`lateInit`, `storedFirstAtTop`), `mut` on a late one only if `storedTwice`, `_name` for
one never read (`unreadOf`). No allow is added. The written/read sets 7.6.4 asked of `calls/facts.ts` exist since 7.7.1
— read from the IR at emission (`ir/walk.ts` `writtenPlaces`, `emit/rust/locals.ts`); `facts.ts` is not touched.
- Rejected: emitter-only (keep the field slot, print `section === "VAR_TEMP"` fields as `let`s) — one slot kind with two
  storages, a second root test in every `locals.ts` analysis, and the interpreter's frame no longer the Rust's; a blanket
  `#[allow(unused_mut, unused_assignments)]` on `call()`/`scan()` — the allow 7.7.2 deleted; dropping the field only
  from `new()` — still a field.

**Stays refused, by name.** `var-temp-outside-body`: a VAR_TEMP named anywhere but the body that declares it — a path
through an instance (`oopa_write_var_temp`: lowered today, refused by CODESYS, so this refusal agrees with it), a METHOD
or ACTION of the FB, a derived body naming a base's. Lowering keeps each frame's VAR_TEMP names (`IrLayout.statics`'
way) so such a name is refused, never resolved to a global or field of the same name. The METHOD/ACTION shape gets a
fixture, recorded in the step's one CODESYS batch; if CODESYS compiles it, it stays refused with that recording as its
evidence (niche: 0 in the fixtures; corpora counted then). A stored address of a VAR_TEMP follows a routine local's
pointer rules (`pointers/state.ts` `outlives`, `image-rewrite.ts` `stacked` reading the locals) — 0 fixtures today.

**Migration.** (1) IR + lowering + interpreter (locals, `resetTemps` → `routineLocalInits`, the refusal, its fixture):
S-out identical; S-ir moves the field indices after a VAR_TEMP. (2) The emitter's shared `printLocals`. Accept: S-out
(outputs and edge byte-identical over every fixture), `pub` VAR_TEMP fields 22 -> 0, M (`pub_underscore_fields` and
pedantic may only fall); tests `emit/rust/routine.test.ts` ("an FB's VAR_TEMP is a local of `call()`, `mut` only where
stored"), `init/temp-resets.test.ts` (the interpreter starts a VAR_TEMP over without a reset statement).

**Measured in the step (2026-10-10).** The batch (CODESYS and TwinCAT build, CODESYS run) answered the refusal's shapes:
a METHOD and a derived body naming the VAR_TEMP are "Identifier 'scratch' not defined" on both vendors
(`var_temp_named_in_method`, `_in_derived_body`); an ACTION and `THIS^.scratch` in the body COMPILE on both, and read 0
where the body stored 5 (`var_temp_named_in_action`, `_through_this`: seen = 1) — so neither is the run's VAR_TEMP, and
both stay `var-temp-outside-body` with that recording as evidence (niche: 0 occurrences in the corpora, whose 4 ST VAR_TEMP
sections no ACTION, METHOD or `THIS^.` names). The two refused shapes were an LSP gap the step closed in the front-end,
not the transpiler: `symbols/scope-nav.ts` `lookup` reaches no VAR_TEMP from a METHOD and no base's from a derived body
(an ACTION reaches its FB's own; a PROPERTY accessor's reach is unrecorded and kept, as an unrecorded refusal would be a
false positive). And `refuse_var_temp_struct`, whose body only writes `scratch.x`, needed one more rustc fact than the
design named: a store INTO a local (`x.f = v`, `x[i] = v`) is no use of it (`locals.ts` `unreadOf`), so it prints `_scratch`
— no allow. A dead store the ST itself makes (three fixtures zero their VAR_TEMPs on the way out) is the allowed
`unused_assignments` it already was for a routine's local.

**Gate 7.6b's review (2026-10-10), recorded in one more batch** (8 fixtures, `declarations/section-semantics.ts`
`tempReview`; CODESYS and TwinCAT build all eight, CODESYS run): a derived FB may declare a VAR or a VAR_TEMP named like
its base's VAR_TEMP — two variables (`var_temp_base_redeclared_as_var`: sv 20, bs 4; `_as_temp`: ds 110, bs 4), which the
locals model already ran and the LSP's `inherited-variable` check had called a duplicate (fixed: a base VAR_TEMP is not
inherited). A base's VAR_TEMP run by `SUPER^()` starts over at its initializer, a dynamic one evaluated each run
(`var_temp_base_run_by_super_constant_init`: 8; `_dynamic_init`: 40 — 0 before 7.6.4). A field holding a VAR_TEMP's
address, read in the same run, reads it (`var_temp_address_kept_in_pointer_field`, `var_temp_reference_kept_in_field`:
3) — lowered again by the VAR_IN_OUT rule (`recordTarget` `scopedTo`), refused `pointer-outlives` anywhere else. And
where a VAR_TEMP is not visible its name is a global of that name (`var_temp_named_in_method_beside_global`,
`_in_derived_body_beside_global`: 41 over a global 40): the transpiler asks the symbols' `lookup`, which skips it, and
refuses only a VAR_TEMP it still finds (an ACTION's).

---

## 4. Old → new map

"→" names the new home. Items marked (RC n) or (lean g.i) move and are then changed by that task. Everything else moves unchanged in
phase 1. "private" means the name stops being exported. Every top-level declaration of `src/transpile/**` on 2026-09-29 is listed;
task 0.1 re-runs the inventory (`grep` of top-level declarations) and adds any name `transpile-fix-all` introduced to the table of
the file it lives in, before 1.6.

### 4.0 Body refactors that come before the moves

Several functions are too large to move as a whole and hold, inline, code that belongs to other files. Each is split **in place**
first (named module functions in the same file, explicit parameters instead of closure captures), proven by S, and only then moved:

| Function | Today | Extracted pieces | Task |
|---|---|---|---|
| `lowerInvoke` | calls.ts 955-1288 | the ANY binding, the cursor binding, the form-2 borrowed binding, output bindings, the program move-in/out, argument binding | 1.6.1 |
| `lowerCallStatement`, `lowerSuperCall` | calls.ts 1376-1600 | input stores, in-out binding, open-bounds, output copy | 1.6.2 |
| `lowerExpr` | expressions.ts 78-352 | one function per arm (literal, name, deref, member, call, unary, binary, partial access, calendar) | 1.6.3 |
| `lowerStmt` | statements.ts 114-290 | one function per arm (assign, if, case, for, while, repeat, exit, continue, return, call) | 1.6.4 |
| `lowerBuiltin` | builtins.ts 87-271 | one function per builtin group (value functions, system, clock, bounds) | 1.6.5 |
| `initStep` | lower.ts 229-580 | its closures (`initMethod`, `pathFields`, `fbInits`, `holdsFbInit`, `globalArguments`, `ownProgram`, `recordedArgument`, `writesGlobal`, `declaredArgs`, `reaches`, `unreached`, `visit`, …) as module functions taking `lw` | 1.6.6 |
| `lowerUnit`, `lowerSource` | lower.ts 64-150, 715-758 | their closures (`ownMembers`, `asInstance`, `open`, `libraryUnits`, …) | 1.6.7 |
| `Printer.expr`, `Printer.stmt`, `emitRust` | emit.ts 574-842, 850-988, 1158-1323 | one function per node kind / per block | 1.5.2 |

### 4.1 lower/lower.ts
- `representable` → `entry/checks.ts`
- `lowerUnit` (+ closures `ownMembers`, `asInstance`, `open`) → `entry/lower-unit.ts`
- `rootInstance` → `entry/lower-unit.ts`
- `addressSharedByInstances` → `storage/addresses.ts`
- `INIT_ATTRIBUTE` → `init/attributes.ts`
- `extendsChain` → `core/chain.ts` `chainUnits` (1.7.3)
- `instanceInitRoutine` → `init/instance-init.ts` (cache via `calls/routines.once`, 1.7.8)
- `initStep` orchestration and the final order (468-580: `rootsOwn`, `layoutFields`, the globals clear) → `init/step.ts` (RC 22/23)
- `initMethod`, `pathFields` → `init/attributes.ts`
- `fbInits`, `fbInitHeld`, `holdsFbInit`+`reaches` (merged, 1.7.13), `recordedArgument`, `declaredArgs`, `globalArguments`,
  `unreached`, `visit`, `fbInitCalls`, `reapplied`, `slotCalls`, `declaredInits` → `init/fb-init.ts`
- `ownProgram` → `calls/reentrancy.ts`
- `writesGlobal` → `ir/walk.ts` predicate used by `init/step.ts`
- `LibraryFile`, `LoweringProject`, `prepareProject`, `attributeCache`/`attributesOf`, `ParsedFile`, `readFiles` → `project/prepare.ts`
- `LibraryBase`, `libraryBase` → `project/library-base.ts`
- `lowerSource`, `lowerPrepared` → `entry/lower-source.ts`
- The inline `ZERO_SPAN` re-spelling at 766 is deleted (use `core/build.ZERO_SPAN`).
- The header table is deleted; `lower/index.ts` documents the folders.

### 4.2 lower/lowering.ts
- `AttributeLookup` → `project/prepare.ts` (moved to `core/shared.ts` by 6.B.6)
- `Cursor` → `pointers/state.ts`
- `PendingBody`, `CalledRoutine`, `Shared`, `newShared` → `core/shared.ts`
- `baseOf` → `core/chain.ts`
- `PointerTarget`, the 0-is-NULL contract, `boundPointers`, `anyInputs`, `anyTargets`, `borrowedPointers`, `cursors` → `pointers/state.ts`
  (the 0/k+1 numbering → `core/tags.ts`, 1.7.19)
- `Lowering` (bail, `slot`, `declared`, `holds`, `inherit`, `resolve`, modes) → `core/lowering.ts`
- `tempPlace`, `temp` → `core/temps.ts`
- `fail` → `calls/routines.ts`
- interface lends, query hoisting → `interfaces/state.ts`
- `pendingInits`, `initSequence` → `init/state.ts`
- `touched` → `calls/reentrancy.ts`
- shadowed in-outs → `calls/binding.ts`
- `ZERO_SPAN` → `core/build.ts`
- `openDims`, `boundName` → `places/bounds.ts`
- The `frame` getter is deleted (it duplicates `slots`), as are the empty banners at 176-178, 364-368 and 380.

### 4.3 lower/calls.ts
- `FbType`, `RoutineSymbol` (types) → `core/lowering.ts`
- `selfFb`, `thisPlace`, `instancePlace` → `places/self.ts`
- `holding` → `calls/binding.ts`
- `isSuper` → `calls/super.ts`
- `ownMember`, `methodOf` → `places/names.ts`
- `chainOf`, `chainNames` → `core/chain.ts`
- `inOutSections`, `prefixed`, `positionalParameters`, `positionalOf` → `calls/parameters.ts` (6.B.4)
- `overridesCalled`, `reachedNames`, `borrowedPointerNames` → `core/ast-walk.ts`
- `once` → `calls/routines.ts`
- `routineFacts` → `calls/facts.ts`
- `touchesOf` → `calls/reentrancy.ts`
- `anyInputsOf`, `ANY_TARGET`, `anyArgumentTypes` and the ANY binding (589-592, 1064-1083, 1217-1224) → `pointers/any.ts`
- `borrowedInputsOf`, `BORROWED`, `borrowedPointerSlots` and form 2 (609-617, 1126-1150) → `pointers/borrowed.ts`
- `cursorInputsOf`, `CURSOR`, `TEXT_OF`, `cursorArgumentTypes`, `CursorArgument`, `cursorArgument`, `pointedString` and the cursor
  binding (598-608, 1084-1125) → `pointers/cursor.ts`
- `adrArgument` → `pointers/address.ts` `adrOperand` (1.7.9)
- `typeKey`, the variant key, the routine key (538) → `calls/variants.ts` (RC 21/42, lean 4.5)
- `stringIdentity`, `staticPath` → `places/path.ts` `staticKey` (1.7.11)
- `isBodylessLibrary`, `routineLowering`, `keptVariables`, `declareOutputs`, `calledRoutine`, `baseBody`, `calledLayout` → `calls/routines.ts`
  (the five body pipelines become `bodyOf`, 1.7.7)
- `propertyRoutine`, `propertyAccess`, `lowerPropertyGet`, `lowerPropertySet` → `calls/property.ts`
- `bindInOut`, `bindPlace`, `lendGuards`, the freeze loop, `movedInOut`, `aliases` → `calls/binding.ts`
- `programReentrant` and its five inlined copies, `inGlobals` → `calls/reentrancy.ts` (1.7.12)
- `touchesOnlyItsOwn`, `writesOnlyLocals`, `reachesDispatch` → `ir/walk.ts` predicates (1.7.4)
- output bindings (1042-1051, 1226-1232, 1526-1550) → `calls/outputs.ts` (RC 20/43)
- `lowerInvoke` (after 1.6.1) → `calls/invoke.ts`
- `lowerSuperCall` → `calls/super.ts`
- `lowerCallStatement`, `storeOpenBounds` → `calls/fb-call.ts`
- `namespaceOf` → `calls/namespace.ts`
- The orphan docs at 63-65, 364-368 and 948-949 are deleted.

### 4.4 Other lowering files

**lower/expressions.ts.**
- `lowerExpr` (the dispatch part) → `expressions/expressions.ts`
- `BIN_OPS`, `COMPARISONS`, `LIFTED` (private), binary/unary operators, null compares, STRING compare → `expressions/operators.ts`
- the meet → `values/promote.ts` (1.7.15)
- `calendarArithmetic` → `expressions/calendar.ts`
- partial access → `expressions/partial-access.ts`
- the ANY `.diSize` read → `pointers/any.ts`

**lower/statements.ts.**
- `storeThrough` → `pointers/deref.ts`
- `lowerBlock`, `lowerStmt` (dispatch), IF/ELSIF, RETURN → `statements/statements.ts`
- `lowerChain`, `refuseImplicitString`, the assign arm, latch → `statements/assign.ts`
- `lowerFor`, WHILE, REPEAT, EXIT, CONTINUE → `statements/loops.ts`
- CASE → `statements/case.ts`
- The `__TRY` essay (249-271) moves to docs/architecture.md, and the empty banner at 348 is deleted.

**lower/storage.ts.**
- `INSTANCE_STORAGE`, `holdsInstance` → `storage/layout.ts` (private)
- `withStringCapacity`, `storageOf`, `buildLayout` → `storage/layout.ts` (`withStringCapacity` deleted in 3.3)
- `declareStatics` → `storage/statics.ts`
- `tempResets` → `init/temp-resets.ts` `resetTemps`
- `declareVars`, `declareInOuts`, `declareOpenBounds` → `storage/declare.ts`
- `parseAddress`, `addressClash`, `claimAddress`, `addressPlace`, `addressBits`, `reserveAddress`, `bindAddress` → `storage/addresses.ts`
- `foldedCall` → `values/fold.ts` (moved to `init/initial-values.ts` by 6.B.6)
- `runnableInit`, `scalarInit`, `aggregateInit`, `aliasInit`, the enum start → `init/initial-values.ts`
- `holdsCall` (AST) → `core/ast-walk.ts` as `exprHoldsCall`
- The duplicate doc at 300 is deleted.

**lower/pointers.ts.**
- `pointerKey`, `recordTarget` → `pointers/state.ts`
- `addressOf`, `pointerValue` → `pointers/address.ts`
- `describePointer`, `unsuppliedInput`, `pointeePlace`, `pointerArms`, `selectThrough`, `nullDeref` → `pointers/deref.ts`
- `borrowedInOut` → `pointers/borrowed.ts`
- `cursorOf`, `cursorChar`, `cursorStringChar`, `cursorCharAt`, `cursorString` → `pointers/cursor.ts`
- `storePointer`, `bindReference` → `pointers/store.ts`
- `through`, `refuseConstantWrite`, `loadValue` → `places/access-guards.ts`
- `sameStorage`, `sameTarget` → `places/path.ts` (under `staticKey`, 1.7.11)

**lower/places.ts.**
- `globalPlace`, `declareGlobal`, `qualifiedGlobal`, `listVariableShadows` → `places/globals.ts`
- `boundOf`, `refuseOpenArray` → `places/bounds.ts`
- `throughReference` → `pointers/deref.ts`
- `lowerPlace`, `Indexed`, `lowerAccess`, `bitPlace` → `places/places.ts`
- name precedence → `places/names.ts`
- cursor indexing → `pointers/cursor.ts`

**lower/builtins.ts.**
- `CLOCK`, `CLOCK_KEY`, the clock arms → `builtins/clock.ts`
- `checkedBits`, `UNARY_MATH`, the value-function arms → `builtins/value-functions.ts`
- `BUILTIN_ARITY`, the one-argument check → `builtins/arity.ts`
- `lowerBuiltin` (dispatch) → `builtins/builtins.ts`
- MOVE, `__POUNAME`, `__ISVALIDREF`, bounds → `builtins/system.ts`
- `lowerConversion`, `DATE_PART` → `builtins/conversions.ts`
- `meetOperands` → `values/promote.ts`

**lower/constants.ts.**
- `enumStorage`, `enumConstant` (IR part) → `values/enums.ts`
- `enumDefault`, `inlineEnumDefault`, `defaultOfValues`, `enumConstant`'s numbering → `types/enums.ts` (`numberEnumerators`,
  `enumDefaultValue`), 1.7.14
- `stringLiteralText`, `durationOf`, `TEMPORAL_LITERAL_KINDS`, `calendarOf`, `typedRealOf`, `inTicks` → `values/literals.ts`
- `calendarNanoseconds` → `syntax/literal-value.ts`
- `enumValueOf`, `convertedConstant`, `foldsToConstant`, `foldConstant` → `values/fold.ts`
- `isConstantCallee` → `builtins/arity.ts`
- `contextLiteralType` → `types/literal.ts`

**lower/convert.ts.**
- `convert`, `retype`, `adopt`, `valueAs` → `values/convert.ts`
- `LINT_MAX`, `integerFoldType` → `values/fold.ts`
- `stored` → `types/width.ts` `wrapToWidth` (its callers keep their own family guards in phase 1; removed in 6.B.2)
- `cast`, `binaryOf` → `core/build.ts`

**lower/interfaces.ts.**
- `interfaceChain` → `core/chain.ts` `interfaceChainOf` over `symbols.extendsChain` (1.7.3)
- `implementsInterface`, `tagOf`, `elementOfArray`, `interfaceKey`, `heldBy`, `tagsOf`, `storeInterface`, `interfaceArgument` → `interfaces/tags.ts`
- `heldAt`, `instanceRelative`, `lendPlace`, `refusedLends`, `lendToCallees` (per-callee part) → `interfaces/lend.ts`
- `onEachTag`, `finishInterfaces`, `bodiesOf` → `entry/finish.ts`
- `callsIn` → `ir/walk.ts`
- `dispatch`, `interfaceCall`, `interfaceProperty`, `accessorCall`, `interfacePropertyGet`, `interfacePropertySet` → `interfaces/dispatch.ts`
- `lowerQueryInterface`, `isQuery`, `queryInto`, `queryCondition` → `interfaces/query.ts`

**Smaller lowering files.**
- `lower/bytes.ts`: `rootType` → `places/path.ts`; `byteSize`, `fieldBytes`, `byteOffset`, `alignUp` → `storage/bytes.ts`; `sizeOf`,
  `adrDifference` → `builtins/sizeof.ts`.
- `lower/bindings.ts` → `calls/last-binding.ts` (`registerBodyCall`, `lastBinding`; `FIELD`, `DINT` private). `placeKey`,
  `throughInstance`, `instanceKey` → `places/path.ts`.
- `lower/specialize.ts` → `calls/specialize.ts` (`InFrame`, `inFramePlace`, `specializeRoutine`; `isInFrame`, `fieldStep`, `isPlace`
  private). `callsNothing` is replaced by `!holdsCall`; `mapPlaces` → `ir/walk.ts`; `sameStep`, `suffixOf` → `places/path.ts`.
- `lower/unions.ts` → `storage/unions.ts` (`overlayBytes`, `unionOf`, `refuseUnionWrite`, `unionCopies`).
- `lower/init-sequence.ts` → `init/sequence.ts` (`buildInitSequence`, `laterThan` private). `reads`, `readsInvoke`, `readsPlace` →
  `ir/walk.ts`, keeping the current skip set as an option (removed in 5.9). `insideInstance` → `places/path.ts` `typeAlong`.
- `lower/index.ts` → explicit exports.
- `lower/totality.test.ts` → `entry/totality.test.ts`; `lower/calls.test.ts` → `calls/routines.test.ts` + `calls/binding.test.ts`;
  `lower/init-sequence.test.ts` → `init/sequence.test.ts`.

### 4.5 ir/ and interp/

**ir/ir.ts.**
- 23-40 (`LOOP_ITERATION_CAP`, `LOOP_CAP_MESSAGE`) → `ir/stmt.ts` (deleted by model 1)
- 41 import → the top of the file
- `IrValue` → `ir/program.ts`
- `defaultValueOf` → `types/defaults.ts` `typeZero`
- `isBit` → `types/predicates.ts`
- `peelArray`, `elementOf` → `types/arrays.ts`
- `holdsCall` → `ir/walk.ts` (moved verbatim in 1.2.1, rebuilt on `childrenOf` in 1.2.3)
- 97-366 → `ir/expr.ts`; the orphan doc at 252-254 and the abandoned sentence at 320-322 are deleted
- 368-448 → `ir/stmt.ts`
- 450-546 → `ir/program.ts`
- 548-575 (`LowerDiagnostic`, `LoweredPou`) → `lower/diagnostics/diagnostic.ts`

**ir/values.ts** → `semantics/`:
- `Val`, `num`, `bool`, `copy` → `value.ts`
- `logarithm`, `MATH` → `math.ts`
- `charAt`, `setChar` → `string.ts`
- `civilDate`, `pad`, `calendarText`, `ladder`, `timeText`, `ltimeText`, `durationText`, `lrealText`, `trim` → `text.ts`
- `eq`, `ord`, `arith`, `logic` → `arith.ts`
- `fit`, `elemName`, `isInt` → `store.ts`
- `coerce`, `I64_MIN`, `I32_MIN` → `convert.ts` (coerce split in 1.3.7)
- the STRING → number part of `coerce` → `parse.ts`
- `instantiate` → `instantiate.ts`
- The self-import of the ir barrel (lines 7-10) becomes direct imports; the orphan docs at 106 and 309-313 are deleted.

**ir/evaluate.ts.**
- `widthOf` → `types/width.ts`
- `LoweringBug` → `semantics/faults.ts`
- `builtinValue` → `semantics/builtins.ts`
- `unaryValue`, `binaryValue` → `semantics/operators.ts`
- `constantValue`, `evaluate` (private) → `semantics/fold.ts`

**ir/codes.ts** and **codes.test.ts** → `lower/diagnostics/` (`LowerCodeKind`, `LOWER_CODES`, `LOWER_CODE_PREFIXES`, `lowerCodeKind` →
`codes.ts`; `lowerDiagnostic` → `diagnostic.ts`). The stale header (test name, "six families") and the misplaced comment at 127-131
are fixed in the move.

**interp/interp.ts.**
- `Signal` → `machine.ts`; `Cell` → `frame.ts`
- `Machine.expr`, `stmt`, `block` → `machine.ts`
- `locate`, `read`, `write`, `bind`, `writeBack` → `frame.ts`
- `invoke` and the FB call frame → `calls.ts`
- `Runner`, `resolvePath`, `run` → `runner.ts`
- `sameName` → `syntax/identifier.ts`
- The inline `import()` types become named imports; the orphan comment at 41 is deleted.

**Tests.**
- `interp/interp.test.ts` → `pipeline/*.test.ts` (+ the charAt/setChar cases at 1164-1222 → `semantics/string.test.ts`)
- `interp/lreal-text.test.ts` → `semantics/text.test.ts` (data into `text.cases.ts`)

### 4.6 emit/rust/

**emit.ts** (per symbol):
- `Emitted`, `emitRust` → `module.ts`
- `rustType`, `inoutType`, `genericList`, `stringType`, `isString`, `isReal32`, `isCopy` → `types.ts`
- `rustName`, `snake`, `RUST_KEYWORDS`, `fieldNames`, `RESERVED_FN_NAMES`, `baseFnName`, `routineFnNames` → `names.ts`
- `initOf` (both), `byteString`, `unitsLiteral`, `shortestF32`, `literal` → `values.ts`
- `hasStatementAfterReturn`, `nestedBlocks` → `ir/walk.ts` (`exitsAfter`, `blocksOf`)
- `stringPath`, `place`, `movedOut` → `place.ts`
- `unparen`, `unparenHead`, `WRAPPING`, `INFIX`, `INVERSE`, `negated`, the expr arms (const, fresh, load, unary, binary) → `expr.ts`
- `castTo`, `fromF64`, the convert arm → `convert.ts`
- `defaultImpl` → `structs.ts`
- `RUST_MATH`, the builtin arms → `builtins.ts`
- `Printer` state, `inFrame`, `Frame`, `push`, `lend`, `lendMut`, `copiesBack`, `lentCopies`, `guarded`, `guardLine` → `printer.ts`
- invoke/dispatch/select arms, the call statement → `calls.ts`
- `block`, the stmt arms (assign, if, switch, return, eval) → `stmt.ts`
- loop/break/continue arms → `loops.ts`
- `printRoutine` → `routine.ts`
- the inline runtime helpers (1263-1313) → `runtime/numeric.ts`, `runtime/pointer.ts`
- `rustAccess` → `test/conformance/support/rust-access.ts`

**prelude.ts** → `runtime/{string, text, parse, numeric}.ts`; `STRING_PRELUDE` → `runtime/index.ts` `runtimeText("string")`.

**index.ts:** keeps the contract doc; the temp list is derived from `names.ts` (7.10.3).

**emit.test.ts** (per describe):
- 32 "emit/rust" (the text-shape cases) → `names.test.ts`, `values.test.ts`, `expr.test.ts`, `stmt.test.ts`, `calls.test.ts`
- 398 "the iteration cap both backends share" → stays until 2.3 deletes it
- 440 "generated bindings cannot collide" → `names.test.ts`
- the compile suite (497-690) → `test/conformance/emit-build.test.ts`
- 696 "a FOR whose limit is a different type" → `loops.test.ts`
- 726 "routine names are unique within an impl block" → `names.test.ts`
- 781 "a negative constant keeps its sign inside a method call" → `values.test.ts`
- 800 "a VAR_TEMP reset" (added by transpile-fix-all for RC 30) → `values.test.ts` (it pins `initOf` for a VAR_TEMP composite)

### 4.7 transpile/index.ts and index.test.ts
- The doc keeps the rule only (7.10.3).
- `load` → `pipeline/index.ts`, unchanged; `lowerAndEmit` added beside it.
- The surface list in index.test.ts is edited deliberately (§2.1.1).

### 4.8 types/, symbols/, syntax/, libraries/
- See §2.7.
- `libraries/index.ts` takes the manifest's directory instead of slicing the URI (l.70): `LibraryManifest.dir`, the folder
  as its uri writes it (`folder` is the lower-cased name, which would change a body's uri; 1.8.8).

### 4.9 Names added after 2026-09-29 (task 0.1 inventory, 2026-10-07, at 3f42db0e71)

Task 0.1 re-ran the inventory (every top-level `function`/`const`/`let`/`class`/`interface`/`type` of `src/transpile/**`, tests
excluded) against the backticked names of §4.1-§4.8. The IR node types of `ir/ir.ts` (`Access`, `Place`, `IrExpr` … `IrPou`) are
placed by §4.5's line ranges and are not repeated here. Three names §4 lists no longer exist: `LOOP_ITERATION_CAP` and
`LOOP_CAP_MESSAGE` (deleted by RC 27, f052467157 — the cap is a harness-only `loopGuard` now) and `defaultOfValues` (now
`src/frontend/types/enums.ts`, frontend-conformance). Every other name found, by the file it lives in today:

- **emit/rust/emit.ts:** `emittedFamily` (RC 31's one place a BIT becomes "bool") → `types.ts`; `isReal` → `src/frontend/types/predicates.ts`
  `isReal` (1.1.5, the emitter's copy deleted); `EmitOptions` (the harness's `loopGuard`) → `module.ts` beside `emitRust`.
- **interp/interp.ts:** `LoopGuardError`, `RunOptions` → `runner.ts`; the closure compiler `Run`, `exprs`, `blocks`, `compiledExpr`,
  `compiledBlock`, `compileExpr`, `compileBlock`, `compileStmt` → `machine.ts`; `compileRead`, `compileWrite` → `frame.ts`; `shown`
  (a value as the IDE shows it) → `runner.ts`.
- **ir/evaluate.ts:** `selectedArg` (RC 41, the one argument SEL/MUX evaluates) → `semantics/builtins.ts`.
- **ir/values.ts:** `expt`, `integerPower`, `significand`, `Scaled`, `bitLength`, `cut`, `power`, `reciprocal`, `toDouble` (RC 46) →
  `semantics/math.ts`; `visible`, `held` (RC 34/45, the buffer behind the terminator) → `semantics/string.ts`; `longCalendarText`
  (RC 12) → `semantics/text.ts`; `compared` → `semantics/arith.ts` (with `eq`/`ord`); `lowest`, `highest`, `inWidth` →
  `semantics/store.ts` (with `fit`); `toSingle` (RC 47) → `semantics/convert.ts`.
- **lower/bindings.ts:** `registerWholeCopy` (RC 16) → `calls/last-binding.ts`.
- **lower/conditions.ts** (new file, frontend-conformance 2.7.1/4.1.1): `EXEC_ORACLE_DEVICE`, `EXEC_ORACLE_TARGET`,
  `EXEC_ORACLE_PROJECT`, `execWorlds`, `execBodyStatements` → `project/conditions.ts` (the exec oracle's world; `prepare.ts` and
  `entry/lower-unit.ts` read it). Amended by 6.B.6: it stays `lower/conditions.ts`, a leaf file (P2), because `calls/` and
  `expressions/` read it too.
- **lower/constants.ts:** `enumeratorValue` → `values/enums.ts`.
- **lower/convert.ts:** `beside` (RC 6), `ownIntegerType` → `values/promote.ts` (with the meet, 1.7.15).
- **lower/init-sequence.ts:** `lowerPendingInit` (RC 24) → `init/sequence.ts`; `readsLaterTemp` → `init/temp-resets.ts`.
- **lower/interfaces.ts:** `SymbolAst` → `interfaces/dispatch.ts` (private); `foreignWrite` (RC 18) → `interfaces/query.ts`.
- **lower/lower.ts:** `TRANSPILE_PARSE` → `project/prepare.ts`; `reversedArray` → `entry/checks.ts` (with `representable`).
- **lower/pointers.ts:** `ELEMENT_TAG_BIAS` (RC 44) → `core/tags.ts` (1.7.19); `charsOf`, `charsThrough` (RC 34) → `pointers/cursor.ts`.
- **lower/statements.ts:** `loopBody` (RC 39) → `statements/loops.ts`; `anySize` (RC 17) → `pointers/any.ts`; `holdsOwnAddress`
  (RC 15) → `statements/assign.ts`.
- **lower/storage.ts:** `constantSlot` (RC 2.3) → `storage/declare.ts`; `elementDefaults` (RC 25) → `init/initial-values.ts`.

---

## 5. Test structure

**Colocation.**
- Each new file gets `<file>.test.ts` beside it when it has behaviour worth a unit test.
- Folder-level behaviour goes in `<folder>/<folder>.test.ts`.
- `lower/lower.test.ts` (2155 lines, 133 tests) dissolves by topic (line = its `describe`/`test` on 2026-09-29):

| lower.test.ts lines | New file |
|---|---|
| 11 | `init/attributes.test.ts` |
| 23 | `init/initial-values.test.ts` |
| 40, 55, 74 | `pointers/{borrowed,deref,address}.test.ts` |
| 92 | `storage/unions.test.ts` |
| 111 | `interfaces/dispatch.test.ts` |
| 137 | `storage/addresses.test.ts` |
| 161 | `storage/statics.test.ts` + `init/temp-resets.test.ts` |
| 188, 207 | `places/access-guards.test.ts` |
| 232, 251 | `interfaces/tags.test.ts` |
| 278, 844 | `places/bounds.test.ts` (278 names a runtime FOR step; see §3.1) |
| 299, 321, 764 | `calls/invoke.test.ts` / `calls/fb-call.test.ts` |
| 365 | `calls/binding.test.ts` |
| 392, 2050, 2065 | `values/fold.test.ts` |
| 411-489 | `init/fb-init.test.ts` |
| 524 | `calls/specialize.test.ts` |
| 576, 617 | `calls/last-binding.test.ts` |
| 668 | `init/step.test.ts` |
| 704 | `entry/lower-unit.test.ts` |
| 790 | `interfaces/query.test.ts` |
| 819 | `calls/reentrancy.test.ts` |
| 882 | `core/lowering.test.ts` |
| 949, 1603, 2080 | `expressions/operators.test.ts` |
| 1012 + totality.test.ts | `entry/totality.test.ts` |
| 1076 | `statements/loops.test.ts` (a FOR reads its limit and step on every pass) |
| 1468 | split between `builtins/conversions.test.ts` and `places/places.test.ts` |
| 1537, 1582 | `pointers/any.test.ts` |
| 1627 | `calls/routines.test.ts` |
| 1684 | `values/enums.test.ts` |
| 1731 | `project/prepare.test.ts` |
| 1765 | `pointers/deref.test.ts` |
| 1794 | `calls/fb-call.test.ts` |
| 1818, 2096 | `builtins/value-functions.test.ts` |
| 1874 | `values/literals.test.ts` |
| 1886 | `builtins/clock.test.ts` |
| 1915 | `pointers/cursor.test.ts` |
| 2008 | `project/library-base.test.ts` |
| 2114 | `builtins/conversions.test.ts` |

A describe at a line this table does not name (added by `transpile-fix-all` after 2026-09-29) is placed by task 0.1 before 1.8.1.

Placed by task 0.1 (2026-10-07, at 3f42db0e71). The lines are TODAY's `lower.test.ts` (2645 lines); the rows above keep their
2026-09-29 lines. A test nested in an existing describe moves with that describe's row (the REFERENCE-TO-a-struct/array/FB reads
at 1844-1850 with "a reference is stepped THROUGH", the clock key at 1978 with the clock describe, 1315-1348 with "total, never
silently wrong"), except the nested describe at 2073:

| lower.test.ts line (2026-10-07) | Test (RC) | New file |
|---|---|---|
| 276 | `__QUERYINTERFACE` into a global is a foreign write (RC 18) | `interfaces/query.test.ts` |
| 2073 | describe "an implicit string-kind conversion CODESYS refuses is refused while lowering" (RC 38) | `statements/assign.test.ts` |
| 2259 | a METHOD's own VAR_IN_OUT shadows the FB field and VAR_STAT (RC 19) | `places/names.test.ts` |
| 2273 | EXIT and CONTINUE outside a loop are refused (RC 39) | `statements/loops.test.ts` |
| 2286 | S= and R= through a multi-target pointer latch the target (RC 14) | `pointers/deref.test.ts` |
| 2299 | a VAR_TEMP's non-constant initializer re-evaluates every run (RC 24) | `init/temp-resets.test.ts` |
| 2326 | an array's elements start at their element type's default (RC 25) | `init/initial-values.test.ts` |
| 2341 | SIZEOF of an FB skips a replaced VAR CONSTANT, adds a pointer per interface (RC 26) | `builtins/sizeof.test.ts` |
| 2366 | a string conversion keeps the operand's capacity past 80 (RC 11) | `builtins/conversions.test.ts` |
| 2387 | a constant FOR step wraps to the counter's width (RC 35) | `statements/loops.test.ts` |
| 2407 | a whole-value store of an FB whose pointer targets its own member is refused (RC 15) | `statements/assign.test.ts` |
| 2422 | an ANY input's pValue through a pointer of another type is refused (RC 17) | `pointers/any.test.ts` |
| 2437 | an integer literal that does not fit its neighbour meets it wider (RC 6) | `values/promote.test.ts` |
| 2459 | a literal FOR limit the counter cannot hold is compared unnarrowed (RC 36) | `statements/loops.test.ts` |
| 2472 | a CASE label outside the selector's type or an inverted range is refused (RC 37) | `statements/case.test.ts` |
| 2484 | a 32-bit date ± an LTIME is refused (RC 40) | `expressions/calendar.test.ts` |
| 2497, 2514 | an FB output binding converts (RC 43); a routine's output is copied out after the call (RC 20) | `calls/outputs.test.ts` |
| 2535 | a namespace-qualified FUNCTION and a project FUNCTION are two routines (RC 21) | `calls/namespace.test.ts` |
| 2554 | an instance's field initializers run before its FB_Init (RC 22) | `init/fb-init.test.ts` |
| 2569 | initializers and FB_Init interleave in declaration order (RC 23) | `init/step.test.ts` |
| 2590 | a pointer stepped below its array's first element is not NULL (RC 44) | `pointers/address.test.ts` |
| 2604 | the bytes behind a STRING's terminator survive; a POINTER TO BYTE reaches them (RC 34) | `pointers/cursor.test.ts` |
| 2620 | a `to_string` enum's STRING conversion is refused by name | `builtins/conversions.test.ts` |
| 2641 | a compiler struct lowering cannot lay out is refused at its declaration | `storage/layout.test.ts` |

`emit.test.ts` describes §4.6 does not name (2026-10-07 lines): 418 "no iteration cap" (RC 27; it replaced "the iteration cap both
backends share", so 2.3 has nothing left to delete there) → `loops.test.ts`; 426 "no iteration cap, compiled", 912 "LREAL_TO_STRING
rounds a tie half-up" (RC 33) and 941 "LDT/LDATE/LTOD_TO_STRING" (RC 12) → `test/conformance/emit-build.test.ts` (their helper
cells → `text.cases.ts` under the twin harness, 1.5.15); 877 "a BIT converts as a BOOL" (RC 31) and 895 "LTIME_TO_STRING is
unsigned" (RC 32) → `convert.test.ts`; the two RC 28/41 tests inside "emit/rust" (REAL MAX/MIN/LIMIT compare-select, LIMIT/MUX
evaluation order) → `builtins.test.ts`.

- `calls.test.ts` → `calls/routines.test.ts` (self-containing types) and `calls/binding.test.ts` ("what a call may bind").
- `init-sequence.test.ts` → `init/sequence.test.ts`.
- `codes.test.ts` → `lower/diagnostics/codes.test.ts`.

**Other src tests.**
- `pipeline/*.test.ts` holds the ST → lower → interp cases (from interp.test.ts: arith, control, calls, aggregates, pointers,
  strings, time).
- `semantics/*.test.ts` run the `*.cases.ts` tables.
- `ir/walk.test.ts` asserts `childrenOf` is total over every node kind (a table built from the IrExpr/IrStmt unions); `ir/path.test.ts`.
- `types/*.test.ts`:
  - `types.test.ts` dissolves into `resolve.test.ts`, `compat.test.ts`, `elementary.test.ts`, `const/fold.test.ts` (its 103-148
    duplicate of const-eval.test.ts merges there) and `literal.test.ts` (from `literal-check.test.ts`).
  - `arith/{runtime,checked,temporal}.test.ts` gain the missing cases: `promoteForRuntime`, `checkedNegationType`,
    `temporalResultType`, `exptResultType`.
  - `predicates.test.ts`, `width.test.ts`, `enums.test.ts`, `defaults.test.ts` are new.
- `symbols/scope-nav.test.ts` gains `extendsChain` (cycle, unresolved base, interface chain).

**Conformance support that moves** (`test/conformance/support/`):
- `recordings.ts`: the ONE reader of `codesys.run.json` (from fixtures.test.ts:114, evidence.ts:41, transpile-confidence.ts:112).
- `display.ts`: `ideValue`, `asDisplayed`, `interpRender`, `rustRender`.
- `differential.ts`: the one interp↔Rust comparer used by `backends.test.ts` and the edge verdict.
- `rust-access.ts`: from emit.ts.
- `transpile/{tier, correctness (RC 48), lint-policy (ALLOWED), shape, edge, row}.ts` and `notes/{lean, notes, render}.ts`: the split
  of transpile-confidence.ts (4032 lines). The authored LEAN and NOTES tables become data files (`notes.data.ts`, `lean.data.ts`).
- `snapshot.ts`: the canonical serializer used by `scripts/transpile-snapshot.ts`.
- `rustc.ts`, `expected-failure.ts`, `evidence.ts`, `divergences.ts`, `project-libraries.ts` (now on `lower/project/library-base.ts`)
  and the rest stay.

**Conformance tests.**
- `fixtures.test.ts` (1877 lines) splits into `transpile-replay.test.ts` (105-957), `map.test.ts` (958-1613) and `lsp-replay.test.ts`
  (1614-1877, using `library-base` bind/unbind).
- New: `emit-build.test.ts` (from emit.test.ts), `runtime-twins.test.ts` (1.5.15), `fold-agreement.test.ts` (1.8.9).

---

## 6. Scope beyond `src/transpile/`

The proposal's first non-goal read "Syntax/symbols/analysis are out of scope (the LSP review plan covers them)". The plan that covers
syntax/symbols/types is now `frontend-conformance` (committed e06bdeb0d5; archived before this change starts); analysis, services and
server are "the rest of the LSP review", after this change. The proposal is amended (What Changes, Non-goals) to this rule:

- **The front-end's structure and conformance belong to frontend-conformance.** This change does not restructure the front-end.
- **What the transpiler needs from the front-end** (one home per shared fact). Task 0.9 checks each against frontend-conformance's
  archived design and code; a need it already met is "use it" (the 1.1 task becomes a verification), an unmet one is built by the
  1.1 task *inside the front-end structure frontend-conformance defined*, with the LSP gates:
  1. `sameName` (ST identifier equality) — today in `interp.ts` and `types/compat.ts`
  2. `extendsChain(scope)` for FBs and interfaces, base first, cycle guarded — today 13 lowering sites + `types/infer fbChainSections`
  3. `peelArray`, `elementOf` — today in `ir/ir.ts`
  4. `typeZero`, `typeDefault` (RC 25) — today `ir/ir.ts defaultValueOf`, `resolve.ts`, `storage.ts`
  5. the type predicates (`isBit`, `isBoolValued`, `isIntegral`, `holdsIntegerBits`, `stringKind`, `isReal`/`floatBits`, `hasTextFormat`)
  6. `integerOfWidth`, `wrapToWidth`, `widthOf`
  7. literal typing incl. `contextLiteralType` — today split over `infer.ts`, `elementary.ts`, `lower/constants.ts`
  8. `parseConversionName`
  9. arithmetic result types split runtime / checked / temporal
  10. the constant fold split constancy / fold, with `heldAs` on `wrapToWidth`
  11. enum numbering and enum default value — today in `lower/constants.ts`
  12. `calendarNanoseconds` in the literal valuation module (NOT `inTicks`, which needs `types/`)
  13. the infer split (expr / member / callee), `fbChainSections` on `extendsChain`, and `resolveCallee` usable by lowering's
      parameter view (6.B.4)
  14. `resolveNamedType` with a required asker (RC 21)
  15. every one of these exported from its layer's index (architecture.md mechanism 2)
- **Root causes that live in the front-end.** RC 2.3, 6, 21, 45's literal decoding, and appendix items 6.A.20-6.A.26 and 6.A.29 are
  front-end facts. frontend-conformance's task 5.2 records which of them it closed; task 0.1 carries that in. Any still open is fixed
  here, in the front-end structure, with the LSP gates.
- Every front-end step of this change runs G+LSP and leaves every LSP diagnostic, hover and render byte-identical unless the task
  says which LSP answer changes and cites the recording.
- **Out of scope:** `analysis/`, `services/`, `server/`, and any LSP-only diagnostic gap. Those are handed off (§7.1).

### 6.1 What frontend-conformance provides (its task 5.2, read from the code on 2026-10-03)

frontend-conformance moved the front-end under `src/frontend/` (`library/`, `syntax/`, `symbols/`, `types/`, each with a
curated `index.ts`; the transpiler already imports only `frontend/<layer>/index.js`, enforced by `scripts/check-layering.ts`
`TRANSPILE_ALLOWED`). Every front-end path in §2.7 and in tasks.md therefore reads `src/frontend/<that>`. Task 0.9 starts from
this table and re-checks it; "met" makes the matching 1.1 task a verification that the transpiler uses that home and drops its
own copy (the copies are the hand-off list at the end of tasks.md).

| # | Need | Verdict | Front-end path (export) | Transpiler copy still standing |
|---|---|---|---|---|
| 1 | `sameName` | met | `src/frontend/syntax/identifier.ts` `sameName` (syntax index); `types/compat.ts` uses it | `interp/interp.ts` `sameName` (1.1.1) |
| 2 | `extendsChain(scope)`, FBs and interfaces | met | `src/frontend/symbols/extends.ts` `extendsChain` (base first, each scope once — a cycle ends the chain), `baseOf`, `basesOf`/`ancestry` (interface EXTENDS, bound and linked since frontend-conformance 3.2.1), `extendsCycle`; "incomplete" is `src/frontend/symbols/scope-nav.ts` `hasUnresolvedBase` | `lower/lower.ts` `extendsChain(lw, fb)` by NAME and the other EXTENDS walks (hand-off H1) |
| 3 | `peelArray`, `elementOf` | not provided, because no front-end consumer needs them: they are helpers over the transpiler's own array use, and frontend-conformance moved nothing out of `src/transpile/` but the named R tasks | — (1.1.3 builds `src/frontend/types/arrays.ts`) | `ir/ir.ts` |
| 4 | `typeZero`, `typeDefault` (RC 25) | not provided, because the front-end has no value model; it provides the facts `typeDefault` reads: `src/frontend/types/enums.ts` `enumDefault`/`inlineEnumDefault`, `src/frontend/types/defaults.ts` `DEFAULT_STRING_LENGTH` | — (1.1.4 builds them in `src/frontend/types/defaults.ts`) | `ir/ir.ts` `defaultValueOf`, `lower/storage.ts` |
| 5 | type predicates | not provided as named, because no front-end rule asks `isBit`/`isBoolValued`/`isIntegral`/`holdsIntegerBits`/`stringKind`/`isReal`/`floatBits`/`hasTextFormat`; the file exists with the front-end's own: `src/frontend/types/predicates.ts` `numericRank`, `isIntegerType`, `isNumericType`, `isIsolated`, `isDatetime`, `isDuration`, `isTemporal`, `isKnownPrimitive` | `src/frontend/types/predicates.ts` (1.1.5 adds the transpiler's set there) | `ir/ir.ts` `isBit`, `emit/rust/emit.ts` `isReal`, inline copies |
| 6 | `integerOfWidth`, `wrapToWidth`, `widthOf` | met for two, not for `widthOf` (no front-end rule needs it; `ElementaryType.bits` is the fact) | `src/frontend/types/width.ts` `integerOfWidth` (types index), `wrapToWidth` (NOT on the types index yet — 1.1.14 adds it) | `lower/convert.ts` `stored`, `integerFoldType`; `ir/values.ts` `fit`; `ir/evaluate.ts` `widthOf` (hand-off H6) |
| 7 | literal typing incl. `contextLiteralType` | met except `contextLiteralType`, which is not provided because the two rules disagree and only recordings may decide which is right: `test/frontend/literal-agreement.test.ts` (LT14) pins 29 classes, corpus 78 / fixtures 79 / library 0 stores where `contextLiteralType` and `literalCheckType` answer differently (`baselines/literal-agreement.json`) | `src/frontend/types/literal.ts` `literalType`, `literalCheckType`, `literalErrorType`, `integerLiteralType`, `literalOwnType`, `literalCapacityType`, `literalContextConversion`, `typedLiteralSum`, `REAL_LITERAL_TYPE` | `lower/constants.ts` `contextLiteralType` (hand-off H5, with RC 6 / 6.2) |
| 8 | `parseConversionName` | met | `src/frontend/types/conversion-name.ts` `parseConversionName(name, target)` — the target is required since frontend-conformance 4.1.2 (platform names are the target's) | `lower/builtins.ts`, `lower/constants.ts` call it with `undefined` (hand-off H4) |
| 9 | arithmetic result types split runtime / checked / temporal | met | `src/frontend/types/arith/runtime.ts` (`commonType`, `promoteForRuntime`), `arith/checked.ts` (`checkedMeetType`, `checkedNegationType`), `arith/temporal.ts` (`temporalResultType`, `durationScaleResultType`, `temporalArithmeticType`; `durationFor` private), `arith/operators.ts` (`notResultType`, `bitwiseResultType`, `operandConversion`, …); `exptResultType` is in `src/frontend/types/builtins.ts` (frontend-conformance 1.6 put the EXPT rule with the built-ins) | `lower/expressions.ts` NOT and duration × integer (hand-off H4) |
| 10 | constant fold split constancy / fold, `heldAs` on `wrapToWidth` | met | `src/frontend/types/const/constancy.ts` `constancyOf`; `src/frontend/types/const/fold.ts` `constEval`, `constancyIn` (one walk for value and constancy, 4.6.2), `declaredValue` (the fold stored into its declared type — what `heldAs` was), `compileTimeConstant`, `constantSlotType`, `isRecursiveConstant`; the wrap is `wrapToWidth`; `**` and `&` are gone (6.A.20) | `lower/constants.ts` `foldConstant`, `foldsToConstant`, `convertedConstant` (hand-off H7) |
| 11 | enum numbering and default | met | `src/frontend/types/enums.ts` `enumMemberValue` (numbering), `enumDefault`, `inlineEnumDefault`, `enumStorage`/`enumValueStorage`/`enumBase` (storage, recorded DT5–DT6), `strictEnum`; the transpiler already imports `enumDefault`/`inlineEnumDefault` (frontend-conformance 1.37) | `lower/constants.ts` `enumStorage` (hand-off H7) |
| 12 | `calendarNanoseconds` | met | `src/frontend/syntax/literal/calendar.ts` (syntax index); `lower/constants.ts` already imports it (frontend-conformance 1.22) — 1.1.12 is a verification | none |
| 13 | infer split, `fbChainSections` on `extendsChain`, `resolveCallee` for lowering | met | `src/frontend/types/infer/expr.ts`, `infer/member.ts`, `infer/callee.ts`; `fbChainSections` (callee.ts, private) runs on `extendsChain`; `resolveCallee` is on the types index | lowering's parameter view (6.B.4) |
| 14 | `resolveNamedType` with a required asker (RC 21) | not provided, because frontend-conformance kept the asker optional (`resolveNamedType(name, project, depth = 0, askerUri = undefined)`): callers without a file (the compiler's own structs in `types/system.ts`, tests) and the library precedence rules it recorded (3.4) did not need it required. 6.5 makes it required | `src/frontend/types/resolve.ts` `resolveNamedType`, `namespaceOf` (qualified types resolve in their namespace, 3.4.2) | the callers 6.5 lists. **Met by 6.5 (2026-10-09):** `resolveNamedType(name, project, askerUri, depth = 0)`, the asker required (a caller with no file says `undefined`); every caller passes one — lowering (`entry/lower-unit`, `places/globals`, `storage/layout`, `builtins/sizeof`, `pointers/image`), `types/infer` (`enumValueType` asks as the value's own file), and the analysis checks through `ctx.uri` |
| 15 | every one exported from its layer's index | met, two exceptions | `src/frontend/{syntax,symbols,types}/index.ts` (curated named exports); `src/frontend/index.ts` re-exports them. Not on an index: `wrapToWidth` (1.1.14), `fbChainSections` (private; nothing outside infer needs it) | — |

### 6.2 Root causes that live in the front-end: status (frontend-conformance task 5.2)

Every front-end root cause the review found was closed UPSTREAM, by the review's own fixes (`transpile-review-2026-09-29`,
archived 2026-09-30, before frontend-conformance's first code step); frontend-conformance closed none of the RCs and
closed or halved five appendix items. Its F-back snapshot (emitted Rust and interpreter values of every fixture that existed at
its start, 1b03f0e55c → the 4e tree) is byte-identical for every fixture still lowered, so it changed no transpiler output.

| Item | Status | By |
|---|---|---|
| RC 1 (meet of mixed signs), RC 2 / 2.3 (named constant fold, `constantSlotType`), RC 3 (REAL fold width), RC 4 (VAR_INPUT CONSTANT default) | closed upstream | review tasks 1.2, 2.2, 2.3 (cf95980537), 3.2, 4.2; fixtures `meet_mixed_sign_wider_unsigned`, `named_const_*`, `real_constant_fold_width`, `var_input_constant_default_as_step` confirmed at frontend-conformance's start and still |
| RC 6 (out-of-range literal keeps its type) | closed upstream (lowering's `beside`, review 6.2); the shared `contextLiteralType` home is NOT provided (§6.1 row 7) | `tr_6_literal_beyond_dint_neighbour` confirmed |
| RC 21 (FUNCTION keyed by identity) | closed upstream (review 21.2); the required asker is open (§6.1 row 14, task 6.5) | `tr_21_namespace_*` confirmed |
| RC 45, literal decoding | closed upstream (review 45.2, landed with task 34, 5c1e7e00df) | `tr_45_string_embedded_nul` confirmed |
| 6.A.20 `**`, `&`, REAL MOD in the fold | `**` and `&` closed by frontend-conformance 2.5a (58de5afeb0: the parser refuses them, the fold has no case); REAL MOD closed by transpile-restructure 6.A.20 (`foldNumber` folds no MOD; the LSP names an untyped real literal LREAL for MOD, `tr_a20_real_mod_in_initializer` refused) | 6.A.20 |
| 6.A.21 REAL_MAX_MAGNITUDE below f32::MAX, two constants | closed by transpile-restructure 6.A.21: ONE constant, `REAL_MAX_MAGNITUDE` REAL = f32's largest exactly (`tr_a21_typed_real_*`: REAL#3.4028234E38 builds, 3.4028235E38 is too large), read by the real-literal rule too, which is the untyped literal's only | 6.A.21 |
| 6.A.22 inferred STRING(N)/ARRAY[1..N] folded in project scope | closed by frontend-conformance 4.6.2 (62bcb30d65, rule CE8: `infer/expr` resolves a variable's type in its declaring scope; `ce_string_length_constant_*`) | — |
| 6.A.23 negated/parenthesised real literal in SIN/SQRT infers UNKNOWN | closed by transpile-restructure 6.A.23 (`types/literal` `isUntypedNumber`: a negated or parenthesised literal is a literal to `mathResultType`; `tr_a23_*`) | 6.A.23 |
| 6.A.24 member access does not walk EXTENDS | closed by frontend-conformance 3.2.3 (461b70fc4d, H2: `infer/member` uses `lookupMember`; the 42 UNKNOWN run paths of 0.4 fell to 2) | — |
| 6.A.25 subrange bounds dropped | closed in the front-end by frontend-conformance 4.7.1 (62bcb30d65: `Type.subrange`, rule DT3); its default by transpile-restructure 6.A.25 (`types/typeZero`: 0 inside the range, else the lower bound — `tr_a25_subrange_defaults`, `decl_subrange_unsigned` confirmed) | 6.A.25 |
| 6.A.26 qualified `Lib.T` by its bare name | closed by frontend-conformance 3.4.2 (1bdaf58172: `types/resolve` `namespaceOf`, `resolveQualifiedType`) | — |
| 6.A.29 named DINT/LINT constant folds unbounded in an initializer | front-end half closed by frontend-conformance 4.6.1 (62bcb30d65: `const/fold` `declaredValue` holds the fold at the declared width; the 20 CE2 fold disagreements of its 0.4 fell to 0); closed by transpile-restructure 6.A.29: a constant EXPRESSION is held unwrapped (the monitor) and READ in its type's run-time width (`const/fold` `read`, `IrSlot.readAs`: `D : DINT := K + 1` reads -2147483648, a SINT's 128 survives in DINT; `tr_a29_*`), one past 64 bits refused `constant-overflow`; an initializer folds with its declared type as the context (`constEval(…, declared)`: `ce_fold_untyped_in_context_values` confirmed) | 6.A.29 |
| 6.A.31 the AST fold sizes no STRUCT / FB / ARRAY / packed DUT (SIZEOF) | closed by transpile-restructure 6.A.31: the measured layout's home is `frontend/types/layout` (`typeBytes`; the packing rule `packFields`, which lowering's `storage/bytes` packs with); the fold-agreement SIZEOF marks gone (the one left is a library enum, `LIBRARY_ENUM_BASE_NOT_MATERIALIZED`); `tr_a31_sizeof_bound_*` refused | 6.A.31 |

---

## 7. Hand-offs and accepted divergences

### 7.1 `lsp-transpile-review-gaps` (created by task 0.7)

A new openspec change that receives every LSP-only finding of this work, one task each. Its initial list:

| From | Finding | Fixtures |
|---|---|---|
| RC 13 | the LSP accepts a FOR limit wider than the counter (CODESYS: "Cannot convert type 'DINT' to type 'INT'") | `for_limit_wider_than_counter_{dint_var,dint_expr,upper_bound}` (`lsp-gap`) |
| RC 35 | the LSP accepts a non-converting FOR step | `tr_35_for_byte_runtime_int_step`, `tr_35_for_sint_step_300` (`MEASURED_SILENT`) |
| RC 37 | the LSP accepts CASE labels outside the selector type and inverted ranges | `tr_37_case_label_wraps_300`, `_wraps_minus_212`, `tr_37_case_range_inverted`, `_beyond_type` |
| RC 20 | the LSP false positive exposed by `tr_20_output_index_moved_by_callee` | the fixture's entry in `KNOWN_DIVERGENCES.codesys` |
| RC 38 | the LSP half of implicit STRING↔WSTRING refusals, if 6.13 finds one | `string_wstring_mixing`, `uop_*` |

Created by 0.7 on 2026-10-07 as tasks 1.1–1.5 in this order; the RC 37 row was already met then (the four `tr_37_*` rate
`refused`), so its task is ticked there with that reason, and RC 38 has no known LSP half (6.13 decides). Every later task that says "filed" appends a line there in the same commit. Task 8.4 checks the change exists and every hand-off in
this file has a line in it.

### 7.2 Accepted vendor-routine divergences

The trig family `op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large` (their reasons are `test/conformance/support/divergences.ts` `X87_TRIG_DIVERGENCES` since 6.21): CODESYS's SIN/COS/TAN run on
the x87 FPU, whose 66-bit argument reduction and few-ULP kernel are named at `ir/values.ts` (then `semantics/math.ts`) and
deliberately not emulated. They stay as named expected failures, each with that reason in `support/divergences.ts`, and are the only
open marks besides the refusals the model decisions name (task 6.21; 8.2's target).

### 7.3 `transpile-st-to-rust` (reconciled by task 0.8)

That change has 39 open tasks. Those this change covers are ticked there with "superseded by transpile-restructure <task>":
- "A routine's VAR_OUTPUT as a local copied back after the call" → 4.11 (RC 20)
- "A multi-target handle for stored POINTER/REFERENCE (`pointer-targets`)", "Form 2 first", "REFERENCE/POINTER inputs of a routine as
  borrows" → 4.2 (model 3 decision) and its tasks
- "`instanceRelative` treats the root FB's own frame as multi-instance" → 4.14 (tag schemes) if 4.2 touches it, else stays
- the rest (`stmt-try`, `place-not-local`, library bodies, `enum-value`, bridge execution, TwinCAT build pass, …) stays in
  transpile-st-to-rust: it is feature growth, a non-goal here.

---

## 8. Tooling definitions

- **S** (`bun run snapshot:transpile check`, `scripts/transpile-snapshot.ts` + `support/snapshot.ts`, task 0.3): for each lowered
  fixture, the canonical IR (Types rendered with `types/render`, Spans as `uri:line:col-line:col`, keys sorted, scope references
  never followed), the emitted Rust and source map, the interpreter's outputs on recorded plus edge inputs, the Rust outputs (built by
  the batch path `support/rustc.ts` that `fixtures.test.ts` uses today, and `transpile-replay.test.ts` after 1.8.7), and the edge
  verdict. Written to `test/conformance/.snapshot/` (gitignored); `check` compares against `.snapshot/baseline/` and prints the first
  difference per fixture. `--layers` selects layers (S-out = outputs + edge).
- **T** (`bun scripts/suite-snapshot.ts --compare <before>`, extended by task 0.4 with `--dirs` and `src/transpile`, `src/types`,
  `test/libraries` in its default set): a test move keeps every `status describe › title` line. This, not a test count, is the gate
  for 1.1.11, 1.4.3, 1.5.13, 1.8.1, 1.8.2, 1.8.7.
- **Size ratchet** (`scripts/check-size.ts`, in `bun run lint`): 400 lines per `src/transpile/**` file, 600 per test file; the
  listed ceilings may only fall; a new oversize file fails. Also reports functions over 80 lines under `src/transpile/**` as a
  warning list that must be empty at 1.9.4.
- **Dead exports** (`scripts/dead-exports.ts --scope src/transpile`): the NOBODY list, excluding (a) the members of the IR unions
  (`IrExpr`, `IrStmt` and their node interfaces, which the union beside them uses by design) and (b) names re-exported through the
  transpile barrel on purpose (§2.1.1). "No finding" means that filtered list is empty.
- **Citations** (`scripts/check-citations.ts`, task 1.0.3): finds `path.ts:NNN` and `path.ts` citations in `src/**` comments,
  `test/conformance/fixtures/**` comments, the authored NOTES and LEAN texts, `docs/*.md` and the open openspec changes'
  `tasks.md`, and reports each whose file no longer exists. Warning-only until 1.9.3, an error after.
- **size metric** (map header `size`): "emitted Rust lines per ST line, the string prelude not counted". Kept byte-identical through
  phase 1 (the registry reports the string blob's lines exactly as the prelude did). Redefined in 7.1.4 as "runtime registry lines
  not counted", re-baselined in that commit with both medians recorded, so every later size delta compares like with like.
- **The twin harness** (`test/conformance/runtime-twins.test.ts`, task 1.5.15): for each `semantics/*.cases.ts`, builds one Rust
  program from the runtime snippet plus a generated `main` that prints every case, compiles it through `support/rustc.ts`, and
  requires each output to equal `expected`; a case naming a recording is also checked against the recording.

---

## 9. Gap register

Every gap the design critic raised on 2026-09-29, and where it is closed.

| # | Gap | Closed by |
|---|---|---|
| 1 | RC 29 already closed; name is `RESERVED_FN_NAMES` incl. `clone_into` | §2.6 names row; task 6.8 is "verify in the new home"; 0.1 records RC 29 closed (3dd773b9d7) |
| 2 | RC 13's LSP half open; typed wider limit must be refused; 2.7's acceptance wrong | §3.1 Q4; tasks 2.5 (literal), 2.6 (typed refused), 2.9 (fixed acceptance); §7.1 hand-off |
| 3 | appendix "named DINT/LINT constant folds unbounded in an initializer" has no task | 6.A.29 |
| 4 | appendix B rotate-in-promoted-width has no task | 6.A.30 |
| 5 | trig divergences have no task and contradict 8.2 | §7.2; 6.21; 8.2's target |
| 6 | "filed for the LSP plan" points at nothing | P9, §7.1, task 0.7, 8.4 check |
| 7 | 2.6 (EXIT) acceptance wrong | §3.1 Q5; task 2.7 |
| 8 | RC 35 blanket runtime-step refusal contradicts pinned tests | §3.1 Q3; tasks 2.1, 2.4 |
| 9 | VAR_TEMP reset form has no deciding fixture | §3.4 measure 7; task 5.1 |
| 10 | `DEFAULT_STRING_LENGTH` into `types/resolve` contradicts type.ts:38 | §3.2 Home/M7; tasks 3.1, 3.3 |
| 11 | model 3 ignores pointer-model.md / memory-sketch.rs; (c) misstated; transpile-st-to-rust open tasks | §3.3 prior art, options (c) and (d); tasks 0.8, 4.1, 4.2; §7.3; 8.4 |
| 12 | tag encodings keep three owners | `core/tags.ts` (1.7.19); decision 4.2; 4.14 |
| 13 | place identity still split; 1.7.9 options have no removal | `staticKey` covers `pointerKey`/`interfaceKey`/`instanceKey` (1.7.11); 4.15 |
| 14 | enum defaults in two places | `types/enums.ts` owns numbering + default; `values/enums.ts` IR only (1.7.14) |
| 15 | `stringKind`/`floatBits` in two tables | §2.6 types row consumes, §2.7 predicates owns |
| 16 | two constant folds with no merge or agreement test | P3a; `fold-agreement.test.ts` (1.8.9); 7.10.2 |
| 17 | `interfaceChain` and `fbChainSections` missed; 6.A.22-24 on an optional file | 1.1.2 (interfaces), 1.1.13 mandatory, 1.7.3 (13 sites); 6.A.22-24 depend on 1.1.13 |
| 18 | call/parameter resolution duplicated | `calls/parameters.ts` (1.7.18); 6.B.4 |
| 19 | neutral consolidations' leftovers have no follow-up | 6.B.1 (BIT), 6.B.2 (wrap guards), 6.B.3 (EXTENDS parameters), 4.15 (staticKey), 6.A.18 (guards) |
| 20 | calls.ts names without a home; stale line ranges; lowerInvoke body refactor | §4.3 (every name); §4.0 and tasks 1.6.1-1.6.2 |
| 21 | lowering.ts / lower.ts / storage / pointers / interfaces / expressions / places / bindings / specialize / init-sequence / convert names without a home | §4.1-§4.4 (every name) |
| 22 | ir/values/evaluate/interp/emit names without a home | §4.5, §4.6 (every name) |
| 23 | emit.test.ts VAR_TEMP reset describe missing | §4.6 (→ `values.test.ts`); task 1.5.13 |
| 24 | `inTicks` cannot go to syntax | §2.7 syntax row; `values/literals.ts`; task 1.1.12 moves `calendarNanoseconds` only |
| 25 | rule "semantics imports ir only" would fail at 1.3.1 | P2 table (transpile folders vs frontend); task 1.0.1 |
| 26 | deep imports of codes.js; `LOWER_CODE_PREFIXES` missing from barrel | §2.1.1 table; task 1.2.2 |
| 27 | STRING_PRELUDE / isBit / rustAccess consumers | §2.1.1 table; tasks 1.5.11, 1.5.12 |
| 28 | 1.2.1 depends too early (isBit, holdsCall) | task 1.2.1 depends on 1.1.5 and moves `holdsCall` verbatim into `ir/walk.ts` |
| 29 | new `types/` modules not in the barrel | §2.7 index row; task 1.1.14 |
| 30 | ratchet count 11 → 12 (builtins.ts) | P5; task 1.0.2 |
| 31 | 1.9.2 acceptance malformed | task 1.9.4 |
| 32 | dead-exports criterion unmeetable | §8 exclusion; tasks 1.0.4, 1.7.20, 7.10.4 |
| 33 | snapshot vs suite-snapshot; count vs titles; batch build; .gitignore | §8 S and T; tasks 0.3, 0.4 |
| 34 | twin harness created only in 3.5 | task 1.5.15 (phase 1) |
| 35 | the 192-cell numeric table has no creating task | task 1.3.8 |
| 36 | `coerce` split has no task | task 1.3.7 |
| 37 | `size` metric undefined after the registry | §8; tasks 1.5.11 (identical), 7.1.4 (redefined) |
| 38 | ~188 stale path citations | §8 citations; tasks 1.0.3, 1.9.3 |
| 39 | 520 notes cited by no task; themes (a)-(g) | task 0.6 (every note tagged, generator refuses a tag naming no task); 7.6.5 (a), 7.6.6 (b), 7.3.12 (c), 7.4.9 (d), 7.2.14 (e), 7.7.11 (f), 7.3.13 (g) |
| 40 | `collapsible_if`, `too_many_arguments` | 7.5.12, 7.7.12 |
| 41 | other ALLOWED lints not re-checked | 7.11.3 |
| 42 | `missing_panics_doc`, `must_use_candidate` beyond `new()` | 7.7.13 |
| 43 | `keep` notes: ea53989ac8 conflict; "13" double-counted | 0.6 counts `keep` exactly; 7.8.9 moves ea53989ac8's text into the ALLOWED reason before 7.11.1 deletes the note; 7.2.13/7.7.10 delete subsets, 7.11.1 the rest |
| 44 | infer.ts:258 orphan doc only on an optional task | 1.1.13 (mandatory) deletes it |
| 45 | scope conflict with the proposal's non-goal | §6 (frontend-conformance, e06bdeb0d5, owns the front-end and runs first; this change lists its needs and builds only unmet ones); task 0.9; proposal amended |
| 46 | `load` signature change is not neutral | §2.1 (signature kept; `lowerAndEmit` additive) |
| 47 | (found while writing) RC 30 closed upstream after the critic ran (e06405f97c) | 0.1 records it; 5.4 becomes "verify + fold the free `initOf`" |
| 48 | (found while writing) frontend-conformance now runs first and owns syntax/symbols/types | header "Order"; §6; tasks 0.9, 1.1.* |
| 49 | (found while writing) giant functions (`lowerExpr`, `lowerStmt`, `lowerBuiltin`, `initStep` closures, `Printer.expr/stmt`, `emitRust`) cannot move as files | §4.0; tasks 1.5.2, 1.6.1-1.6.7; P5 function limit |
| 50 | (found while writing) task order vs dependencies: RC 26 (6.6) was needed by 4.1; 6.A.7 needed 7.1.2 | RC 26 is task 4.0; 6.A.7 is task 7.1.5 |
