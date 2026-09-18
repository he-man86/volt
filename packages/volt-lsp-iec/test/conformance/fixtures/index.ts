/**
 * Conformance test catalog — single source of truth.
 *
 * Each per-topic file exports a `LanguageTest[]`. This file aggregates
 * them into `CATEGORIES` so the recorder, replay test, and report
 * iterate one list. Adding a new category: write `<name>.ts` here,
 * import + add one row to the `CATEGORIES` array below.
 */
import type { LanguageTest } from "../types.js"
import { FIXTURE_EVIDENCE } from "./evidence.generated.js"
import { ADVANCED_TYPE_TESTS } from "./types/advanced-type.js"
import { CONDITIONAL_PRAGMA_TESTS } from "./pragmas/conditional-pragma.js"
import { CONVERSION_TESTS } from "./conversions/conversion.js"
import { REAL_TO_INTEGER_LADDER_TESTS } from "./conversions/real-to-integer-ladder.js"
import { REAL_TO_INTEGER_TESTS } from "./conversions/real-to-integer.js"
import { DATA_TYPE_TESTS } from "./types/data-type.js"
import { PRIMITIVE_BOUNDS_TESTS } from "./types/primitive-bounds.js"
import { ARITHMETIC_EDGE_TESTS } from "./operators/arithmetic-edges.js"
import { BITWISE_TESTS } from "./operators/bitwise.js"
import { COMPARISON_TESTS } from "./operators/comparison.js"
import { MIXED_TYPE_TESTS } from "./operators/mixed-type.js"
import { MATH_DOMAIN_TESTS } from "./operators/math-domain.js"
import { REAL_OVERFLOW_TESTS } from "./operators/real-overflow.js"
import { PRIMITIVE_DEFAULT_TESTS } from "./types/primitive-default.js"
import { IDENTIFIER_TESTS } from "./declarations/identifier.js"
import { CORPUS_STANDARD_TESTS } from "./semantics/corpus-standard.js"
import { IL_CALC_SHAPE_TESTS, INTERFACE_VAR_TESTS } from "./calls/il-calc-shapes.js"
import { SIGNATURE_NAME_TESTS } from "./cross-object/signature-name.js"
import { NETWORK_GRAPHICAL_TESTS } from "./graphical/network-graphical.js"
import { NETWORK_UNRESOLVED_TESTS } from "./graphical/network-unresolved.js"
import { INIT_SLOT_TESTS } from "./declarations/init-slot.js"
import { IMPLICIT_CHECK_TESTS } from "./conversions/implicit-checks.js"
import { INTERFACE_TESTS } from "./oop/interface.js"
import { KEYWORD_TESTS } from "./declarations/keyword.js"
import { LIFECYCLE_TESTS } from "./oop/lifecycle.js"
import { LITERAL_TESTS } from "./types/literal.js"
import { OOP_TESTS } from "./oop/oop.js"
import { OPERANDS_TESTS } from "./operators/operands.js"
import { OPERATOR_TESTS } from "./operators/operator.js"
import { OVERFLOW_TESTS } from "./operators/overflow.js"
import { RANGE_BOUNDS_TESTS } from "./types/range-bounds.js"
import { PRAGMA_TESTS } from "./pragmas/pragma.js"
import { PRAGMA_TC_TESTS } from "./pragmas/pragma-tc.js"
import { SEMANTIC_TESTS } from "./semantics/semantic.js"
import { UNARY_OPERAND_TESTS } from "./operators/unary-operand.js"
import { SHADOWING_TESTS } from "./declarations/shadowing.js"
import { USAGE_PATTERN_TESTS } from "./cross-object/usage-pattern.js"
import { VARIABLE_SECTION_TESTS } from "./declarations/variable-section.js"
import { CHECK_COVERAGE_TESTS } from "./batches/check-coverage.js"
import { ERROR_CATALOG_TESTS } from "./semantics/error-catalog.js"
import { EXECUTION_TESTS } from "./semantics/execution.js"
import { MEMORY_MODEL_TESTS } from "./memory/memory-model.js"
import { FB_CALL_TESTS } from "./calls/fb-call.js"
import { INHERITANCE_TESTS } from "./oop/inheritance.js"
import { ROUTINE_STATE_TESTS } from "./calls/routine-state.js"
import { INITIALIZER_TESTS } from "./declarations/initializers.js"
import { INTERFACE_CALL_TESTS } from "./calls/interface-calls.js"
import { DECLARATION_LIFETIME_TESTS } from "./declarations/declaration-lifetimes.js"
import { INOUT_CONSTANT_TESTS } from "./calls/inout-constant.js"
import { CALL_SHAPE_TESTS } from "./calls/call-shapes.js"
import { CROSS_OBJECT_TESTS } from "./cross-object/cross-object.js"
import { CROSS_OBJECT_TWO_TESTS } from "./cross-object/cross-object-two.js"
import { CROSS_OBJECT_THREE_TESTS } from "./cross-object/cross-object-three.js"
import { CROSS_OBJECT_FOUR_TESTS } from "./cross-object/cross-object-four.js"
import { CORPUS_TYPE_TESTS } from "./types/corpus-types.js"
import { CORPUS_PRAGMA_TESTS } from "./pragmas/corpus-pragmas.js"
import { CORPUS_OPERATOR_TESTS } from "./operators/corpus-operators.js"
import { CORPUS_ADDRESS_TESTS } from "./memory/corpus-addresses.js"
import { CHECK_COVERAGE_TWO_TESTS } from "./batches/check-coverage-two.js"
import { CHECK_COVERAGE_THREE_TESTS } from "./batches/check-coverage-three.js"
import { CHECK_COVERAGE_FOUR_TESTS } from "./batches/check-coverage-four.js"
import { CHECK_COVERAGE_FIVE_TESTS } from "./batches/check-coverage-five.js"
import { CHECK_COVERAGE_SIX_TESTS } from "./batches/check-coverage-six.js"
import { INITIALIZER_REPEAT_TESTS } from "./declarations/initializer-repeat.js"

export interface CategoryGroup {
  name: string
  tests: readonly LanguageTest[]
}

const RAW_CATEGORIES: readonly CategoryGroup[] = [
  { name: "cross-object", tests: CROSS_OBJECT_TESTS },
  { name: "cross-object-two", tests: CROSS_OBJECT_TWO_TESTS },
  { name: "cross-object-three", tests: CROSS_OBJECT_THREE_TESTS },
  { name: "cross-object-four", tests: CROSS_OBJECT_FOUR_TESTS },
  { name: "corpus-types", tests: CORPUS_TYPE_TESTS },
  { name: "corpus-pragmas", tests: CORPUS_PRAGMA_TESTS },
  { name: "corpus-operators", tests: CORPUS_OPERATOR_TESTS },
  { name: "corpus-addresses", tests: CORPUS_ADDRESS_TESTS },
  { name: "check-coverage-two", tests: CHECK_COVERAGE_TWO_TESTS },
  { name: "check-coverage-three", tests: CHECK_COVERAGE_THREE_TESTS },
  { name: "check-coverage-four", tests: CHECK_COVERAGE_FOUR_TESTS },
  { name: "check-coverage-five", tests: CHECK_COVERAGE_FIVE_TESTS },
  { name: "check-coverage-six", tests: CHECK_COVERAGE_SIX_TESTS },
  { name: "initializer-repeat", tests: INITIALIZER_REPEAT_TESTS },
  { name: "pragma", tests: PRAGMA_TESTS },
  { name: "pragma-tc", tests: PRAGMA_TC_TESTS },
  { name: "lifecycle", tests: LIFECYCLE_TESTS },
  { name: "identifier", tests: IDENTIFIER_TESTS },
  { name: "network-unresolved", tests: NETWORK_UNRESOLVED_TESTS },
  { name: "network-graphical", tests: NETWORK_GRAPHICAL_TESTS },
  { name: "corpus-standard", tests: CORPUS_STANDARD_TESTS },
  { name: "il-calc-shapes", tests: IL_CALC_SHAPE_TESTS },
  { name: "interface-var", tests: INTERFACE_VAR_TESTS },
  { name: "signature-name", tests: SIGNATURE_NAME_TESTS },
  { name: "init-slot", tests: INIT_SLOT_TESTS },
  { name: "shadowing", tests: SHADOWING_TESTS },
  { name: "conversion", tests: CONVERSION_TESTS },
  { name: "real-to-integer", tests: REAL_TO_INTEGER_TESTS },
  { name: "real-to-integer-ladder", tests: REAL_TO_INTEGER_LADDER_TESTS },
  { name: "semantic", tests: SEMANTIC_TESTS },
  { name: "unary-operand", tests: UNARY_OPERAND_TESTS },
  { name: "conditional-pragma", tests: CONDITIONAL_PRAGMA_TESTS },
  { name: "operator", tests: OPERATOR_TESTS },
  { name: "literal", tests: LITERAL_TESTS },
  { name: "interface", tests: INTERFACE_TESTS },
  { name: "oop", tests: OOP_TESTS },
  { name: "advanced-type", tests: ADVANCED_TYPE_TESTS },
  { name: "data-type", tests: DATA_TYPE_TESTS },
  { name: "primitive-default", tests: PRIMITIVE_DEFAULT_TESTS },
  { name: "primitive-bounds", tests: PRIMITIVE_BOUNDS_TESTS },
  { name: "real-overflow", tests: REAL_OVERFLOW_TESTS },
  { name: "math-domain", tests: MATH_DOMAIN_TESTS },
  { name: "arithmetic-edges", tests: ARITHMETIC_EDGE_TESTS },
  { name: "comparison", tests: COMPARISON_TESTS },
  { name: "bitwise", tests: BITWISE_TESTS },
  { name: "mixed-type", tests: MIXED_TYPE_TESTS },
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

/**
 * Every fixture, each carrying its EVIDENCE rating.
 *
 * The rating is derived — from the recordings and the fixture's own flags — so it is generated into
 * `evidence.generated.ts` and merged HERE rather than written into each entry: 458 of these fixtures come from
 * factory helpers or template-literal names, where a per-entry field cannot reach. `confidence.test.ts` recomputes
 * every value so it cannot go stale.
 *
 * MERGED ONTO THE CATEGORIES, not onto a flattened copy. Both `CATEGORIES` and `ALL_TESTS` are exported and hold the
 * same fixtures; merging into only one gave two views that disagreed, and a per-category report read every rating as
 * absent. A fixture's OWN `evidence`, if one is ever written by hand, is left alone — the generated value only fills
 * a gap.
 */
export const CATEGORIES: readonly CategoryGroup[] = RAW_CATEGORIES.map((c) => ({
  ...c,
  tests: c.tests.map((t) =>
    t.evidence === undefined && FIXTURE_EVIDENCE[t.name] !== undefined ? { ...t, evidence: FIXTURE_EVIDENCE[t.name] } : t,
  ),
}))

export const ALL_TESTS: readonly LanguageTest[] = CATEGORIES.flatMap((c) => c.tests)
