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
| The integer store wrap | 4 (`stored`, `fit`, `heldAs`, rotate) | `types/width.wrapToWidth` | 1.1.6, 6.B.2 |
| BIT-is-BOOL | 7 | `types/predicates.isBoolValued` | 1.1.5, 6.9, 6.B.1 |
| The operand meet | 3 | `lower/values/promote.meet` | 1.7.15 |
| Constant folding | 3 mechanisms (two AST folds, one IR fold) | AST: `types/const/fold` (one typed fold after lean 10.2); IR: `transpile/semantics/fold`; the one lowering entry `lower/values/fold.foldExpr`. The two folds stay two **by design** (§1 P3a) and are held together by `test/conformance/fold-agreement.test.ts`. | 1.8.9, 7.10.2 |
| Nested-lowering diagnostic drain | 12 | `lower/core/nested.ts` | 1.7.6 |
| Field lookup by upper-cased name | about 15 | `lower/places/path.fieldOf` | 1.7.10 |
| Place / instance identity | 5 static-place keys + `pointerKey` + `interfaceKey` + `instanceKey` | `lower/places/path.staticKey` (with named options until model 3) | 1.7.11, 4.15 |
| Tag encodings | 3 (pointer tags, interface instance tags, `__inout_binding`) | `lower/core/tags.ts` owns the encoding (0 = none, k+1 numbering, the key); whether the three *schemes* merge is model 3's decision | 1.7.19, 4.14 |
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
| `walk.ts` | `childrenOf(node)` as an exhaustive switch over node kinds (no reflection); `forEachExpr`, `forEachStmt`, `somePlace`, `holdsCall`, `mapPlaces` (the one rewriter), `blocksOf`, `exitsAfter` (the old `hasStatementAfterReturn`, EXIT/CONTINUE-aware from 7.5.11), `loopUses` (labels needed); the predicates `touchesOnlyItsOwn`, `writesOnlyLocals`, `reachesDispatch`, `writesGlobal`, `callsIn`, and the init-sequence `reads` with its skip option | ir.ts 83-95; specialize.ts 69-86; emit.ts 140-164; calls.ts 929-946, 1338-1358; lower.ts 308-323; interfaces.ts 465-475; init-sequence.ts 86-132 |
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
| `store.ts` | `fit`: a value as its type holds it (integer width via `types/width.wrapToWidth`, BIT via `types/predicates.isBoolValued`, REAL fround, string via `string.ts`); private `elemName`, `isInt` | values.ts 265-320 |
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
| `fold.ts` | `constantValue(expr)`: THE IR constant fold lowering uses (lean 2); private `evaluate`. It throws `LoweringBug`, answers "not constant" only on an `IecFault`, and never swallows anything else (6.A.9). | evaluate.ts 170-213 |
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
| `project/prepare.ts` | `prepareProject`, `readFiles`, `ParsedFile`, `LibraryFile`, `LoweringProject`, `AttributeLookup`, the `attributesOf` cache | lower.ts 609-715; lowering.ts 23-27 |
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
| `values/fold.ts` | the ONE lowering fold entry `foldExpr(lw, ast)`: `foldConstant`, `foldsToConstant`, `foldedCall`, `integerFoldType` (+`LINT_MAX`), `convertedConstant`, `enumValueOf`, over `types/const` (AST) and `semantics/fold` (IR) | constants.ts 157-241; storage.ts 433-445; convert.ts 41-57 |
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
| `frontend/types/const/fold.ts` (exists; `declaredValue` is what `heldAs` was) | `constEval`, `heldAs` (on `width.wrapToWidth`); one typed fold after lean 10.2; `**`, `&` and REAL MOD removed (6.A.20) | const-eval.ts 64-284 |
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
- how architecture.md's "pointers will become indices" paragraph (line 132) is rewritten.

**RC 20 (output timing)** is independent of the representation: routine outputs are copied out after the invoke, as FB outputs
already are (`tr_20_output_index_moved_by_callee`). It lands in `calls/outputs.ts` in this phase, because it shares the binding code.

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
  order still reads an uninitialized field.

**Couplings.** Lean 7 (routine signatures) and 8 (derives, aggregate syntax) sit on this model's final `new()`/`init()` shape.

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
- `AttributeLookup` → `project/prepare.ts`
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
- `foldedCall` → `values/fold.ts`
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
- `libraries/index.ts` takes the manifest's `folder` instead of slicing the URI (l.70).

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
  `entry/lower-unit.ts` read it).
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
| 14 | `resolveNamedType` with a required asker (RC 21) | not provided, because frontend-conformance kept the asker optional (`resolveNamedType(name, project, depth = 0, askerUri = undefined)`): callers without a file (the compiler's own structs in `types/system.ts`, tests) and the library precedence rules it recorded (3.4) did not need it required. 6.5 makes it required | `src/frontend/types/resolve.ts` `resolveNamedType`, `namespaceOf` (qualified types resolve in their namespace, 3.4.2) | the callers 6.5 lists |
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
| 6.A.20 `**`, `&`, REAL MOD in the fold | `**` and `&` closed by frontend-conformance 2.5a (58de5afeb0: the parser refuses them, the fold has no case); **REAL MOD open** (`const/fold.ts` `foldNumber` still folds `MOD` on two reals) | — |
| 6.A.21 REAL_MAX_MAGNITUDE below f32::MAX, two constants | open: both constants now sit in one file, `src/frontend/types/literal.ts` (`REAL_MAX_MAGNITUDE` 3.402823e38 and the `3.4028234663852886e38` in the real-literal rule) | — |
| 6.A.22 inferred STRING(N)/ARRAY[1..N] folded in project scope | closed by frontend-conformance 4.6.2 (62bcb30d65, rule CE8: `infer/expr` resolves a variable's type in its declaring scope; `ce_string_length_constant_*`) | — |
| 6.A.23 negated/parenthesised real literal in SIN/SQRT infers UNKNOWN | open (probed 2026-10-03: `SIN(1.5)` LREAL, `SIN(-1.5)` and `SQRT((2.0))` UNKNOWN — `infer/expr` passes "is a literal" only for a bare literal to `mathResultType`) | — |
| 6.A.24 member access does not walk EXTENDS | closed by frontend-conformance 3.2.3 (461b70fc4d, H2: `infer/member` uses `lookupMember`; the 42 UNKNOWN run paths of 0.4 fell to 2) | — |
| 6.A.25 subrange bounds dropped | closed in the front-end by frontend-conformance 4.7.1 (62bcb30d65: `Type.subrange`, rule DT3); lowering's use of it is its own | — |
| 6.A.26 qualified `Lib.T` by its bare name | closed by frontend-conformance 3.4.2 (1bdaf58172: `types/resolve` `namespaceOf`, `resolveQualifiedType`) | — |
| 6.A.29 named DINT/LINT constant folds unbounded in an initializer | front-end half closed by frontend-conformance 4.6.1 (62bcb30d65: `const/fold` `declaredValue` holds the fold at the declared width; the 20 CE2 fold disagreements of its 0.4 fell to 0); the lowering half (`lower/constants.ts` folds an initializer by itself, `ce_fold_untyped_in_context_values` not-lowered "init-not-constant") open | — |

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

The trig family `op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large` (fixtures.test.ts:1211-1219): CODESYS's SIN/COS/TAN run on
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
