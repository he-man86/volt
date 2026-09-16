/**
 * Conformance test catalog — single source of truth.
 *
 * Each per-topic file exports a `LanguageTest[]`. This file aggregates
 * them into `CATEGORIES` so the recorder, replay test, and report
 * iterate one list. Adding a new category: write `<name>.ts` here,
 * import + add one row to the `CATEGORIES` array below.
 */
import type { LanguageTest } from "../types.js"
import { ADVANCED_TYPE_TESTS } from "./advanced-type.js"
import { CONDITIONAL_PRAGMA_TESTS } from "./conditional-pragma.js"
import { CONVERSION_TESTS } from "./conversion.js"
import { DATA_TYPE_TESTS } from "./data-type.js"
import { IDENTIFIER_TESTS } from "./identifier.js"
import { NETWORK_UNRESOLVED_TESTS } from "./network-unresolved.js"
import { INIT_SLOT_TESTS } from "./init-slot.js"
import { IMPLICIT_CHECK_TESTS } from "./implicit-checks.js"
import { INTERFACE_TESTS } from "./interface.js"
import { KEYWORD_TESTS } from "./keyword.js"
import { LIFECYCLE_TESTS } from "./lifecycle.js"
import { LITERAL_TESTS } from "./literal.js"
import { OOP_TESTS } from "./oop.js"
import { OPERANDS_TESTS } from "./operands.js"
import { OPERATOR_TESTS } from "./operator.js"
import { OVERFLOW_TESTS } from "./overflow.js"
import { RANGE_BOUNDS_TESTS } from "./range-bounds.js"
import { PRAGMA_TESTS } from "./pragma.js"
import { PRAGMA_TC_TESTS } from "./pragma-tc.js"
import { SEMANTIC_TESTS } from "./semantic.js"
import { SHADOWING_TESTS } from "./shadowing.js"
import { USAGE_PATTERN_TESTS } from "./usage-pattern.js"
import { VARIABLE_SECTION_TESTS } from "./variable-section.js"
import { CHECK_COVERAGE_TESTS } from "./check-coverage.js"
import { ERROR_CATALOG_TESTS } from "./error-catalog.js"
import { EXECUTION_TESTS } from "./execution.js"
import { MEMORY_MODEL_TESTS } from "./memory-model.js"
import { FB_CALL_TESTS } from "./fb-call.js"
import { INHERITANCE_TESTS } from "./inheritance.js"
import { ROUTINE_STATE_TESTS } from "./routine-state.js"
import { INITIALIZER_TESTS } from "./initializers.js"
import { INTERFACE_CALL_TESTS } from "./interface-calls.js"
import { DECLARATION_LIFETIME_TESTS } from "./declaration-lifetimes.js"
import { INOUT_CONSTANT_TESTS } from "./inout-constant.js"
import { CALL_SHAPE_TESTS } from "./call-shapes.js"
import { CROSS_OBJECT_TESTS } from "./cross-object.js"
import { CROSS_OBJECT_TWO_TESTS } from "./cross-object-two.js"
import { CROSS_OBJECT_THREE_TESTS } from "./cross-object-three.js"
import { CROSS_OBJECT_FOUR_TESTS } from "./cross-object-four.js"
import { CORPUS_TYPE_TESTS } from "./corpus-types.js"
import { CORPUS_PRAGMA_TESTS } from "./corpus-pragmas.js"
import { CORPUS_OPERATOR_TESTS } from "./corpus-operators.js"
import { CORPUS_ADDRESS_TESTS } from "./corpus-addresses.js"

export interface CategoryGroup {
  name: string
  tests: readonly LanguageTest[]
}

export const CATEGORIES: readonly CategoryGroup[] = [
  { name: "cross-object", tests: CROSS_OBJECT_TESTS },
  { name: "cross-object-two", tests: CROSS_OBJECT_TWO_TESTS },
  { name: "cross-object-three", tests: CROSS_OBJECT_THREE_TESTS },
  { name: "cross-object-four", tests: CROSS_OBJECT_FOUR_TESTS },
  { name: "corpus-types", tests: CORPUS_TYPE_TESTS },
  { name: "corpus-pragmas", tests: CORPUS_PRAGMA_TESTS },
  { name: "corpus-operators", tests: CORPUS_OPERATOR_TESTS },
  { name: "corpus-addresses", tests: CORPUS_ADDRESS_TESTS },
  { name: "pragma", tests: PRAGMA_TESTS },
  { name: "pragma-tc", tests: PRAGMA_TC_TESTS },
  { name: "lifecycle", tests: LIFECYCLE_TESTS },
  { name: "identifier", tests: IDENTIFIER_TESTS },
  { name: "network-unresolved", tests: NETWORK_UNRESOLVED_TESTS },
  { name: "init-slot", tests: INIT_SLOT_TESTS },
  { name: "shadowing", tests: SHADOWING_TESTS },
  { name: "conversion", tests: CONVERSION_TESTS },
  { name: "semantic", tests: SEMANTIC_TESTS },
  { name: "conditional-pragma", tests: CONDITIONAL_PRAGMA_TESTS },
  { name: "operator", tests: OPERATOR_TESTS },
  { name: "literal", tests: LITERAL_TESTS },
  { name: "interface", tests: INTERFACE_TESTS },
  { name: "oop", tests: OOP_TESTS },
  { name: "advanced-type", tests: ADVANCED_TYPE_TESTS },
  { name: "data-type", tests: DATA_TYPE_TESTS },
  { name: "variable-section", tests: VARIABLE_SECTION_TESTS },
  { name: "keyword", tests: KEYWORD_TESTS },
  { name: "operands", tests: OPERANDS_TESTS },
  { name: "usage-pattern", tests: USAGE_PATTERN_TESTS },
  // ── Theoretical-gap catalog (coverage-matrix.md rows D3/D9/D10 …) — awaiting oracle recording ──
  { name: "range-bounds", tests: RANGE_BOUNDS_TESTS },
  { name: "overflow", tests: OVERFLOW_TESTS },
  // ── deliberate per-check coverage + FP-bait (compiler-accepted near-miss code) ──
  { name: "check-coverage", tests: CHECK_COVERAGE_TESTS },
  // ── CODESYS error-catalog codes (Cnnnn) — awaiting live recording, see error-catalog.ts ──
  { name: "error-catalog", tests: ERROR_CATALOG_TESTS },
  // ── programs that are also RUN in the simulator — the transpiler's cases (was test/exec, unify-conformance-suite) ──
  { name: "execution", tests: EXECUTION_TESTS },
  // ── the facts the transpiler's memory model is built on (transpile-st-to-rust design §9) — run in the simulator ──
  { name: "memory-model", tests: MEMORY_MODEL_TESTS },
  // ── call semantics: FB instances, methods, actions, functions, a program and a global (phase 3) ──
  { name: "fb-call", tests: FB_CALL_TESTS },
  // ── inheritance: which bodies and methods EXTENDS and SUPER^ run (phase 3½) ──
  { name: "inheritance", tests: INHERITANCE_TESTS },
  // ── routine state and call edges: VAR_INST, VAR_STAT, properties, empty arguments, programs from FBs (phase 3½) ──
  { name: "routine-state", tests: ROUTINE_STATE_TESTS },
  // ── aggregate initializers: structs by field, nested, arrays of structs, FB instances (phase 3½) ──
  { name: "initializers", tests: INITIALIZER_TESTS },
  { name: "interface-calls", tests: INTERFACE_CALL_TESTS },
  { name: "declaration-lifetimes", tests: DECLARATION_LIFETIME_TESTS },
  { name: "inout-constant", tests: INOUT_CONSTANT_TESTS },
  { name: "call-shapes", tests: CALL_SHAPE_TESTS },
  // ── implicit check functions a project defines (CheckBounds, CheckDiv…): what CODESYS calls, with what ──
  { name: "implicit-checks", tests: IMPLICIT_CHECK_TESTS },
]

export const ALL_TESTS: readonly LanguageTest[] = CATEGORIES.flatMap((c) => c.tests)
