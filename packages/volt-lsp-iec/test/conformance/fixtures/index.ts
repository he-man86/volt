/**
 * Conformance test catalog — single source of truth.
 *
 * Each per-topic file exports a `LanguageTest[]`. This file aggregates
 * them into `CATEGORIES` so the recorder, replay test, and report
 * iterate one list. Adding a new category: write `<name>.ts` here,
 * import + add one row to the `CATEGORIES` array below.
 */
import type { LanguageTest } from "../types.js"
import { FIXTURE_MAP } from "./map.generated.js"
import { ADVANCED_TYPE_TESTS } from "./types/advanced-type.js"
import { CONDITIONAL_PRAGMA_TESTS } from "./pragmas/conditional-pragma.js"
import { CONVERSION_TESTS } from "./conversions/conversion.js"
import { INTEGER_TO_INTEGER_TESTS } from "./conversions/integer-to-integer.js"
import { CROSS_FAMILY_TESTS } from "./conversions/cross-family.js"
import { TO_STRING_FORMAT_TESTS, TRANSPILE_REVIEW_TO_STRING_TESTS } from "./conversions/to-string-format.js"
import { INTEGER_TO_REAL_TESTS } from "./conversions/integer-to-real.js"
import { REAL_TO_INTEGER_LADDER_TESTS } from "./conversions/real-to-integer-ladder.js"
import { REAL_TO_INTEGER_TESTS } from "./conversions/real-to-integer.js"
import { DATA_TYPE_TESTS } from "./types/data-type.js"
import { PLATFORM_INTEGER_TESTS } from "./types/platform-integers.js"
import { PRIMITIVE_BOUNDS_TESTS } from "./types/primitive-bounds.js"
import { ARITHMETIC_EDGE_TESTS } from "./operators/arithmetic-edges.js"
import { BITWISE_TESTS } from "./operators/bitwise.js"
import { SELECTION_TESTS } from "./operators/selection.js"
import { ESCAPE_TESTS } from "./strings/escapes.js"
import { STRING_EDGE_TESTS, TRANSPILE_REVIEW_STRING_TESTS } from "./strings/string-edges.js"
import { COMPARISON_TESTS } from "./operators/comparison.js"
import { COMPARISON_OPERAND_TESTS } from "./operators/comparison-operands.js"
import { MIXED_TYPE_TESTS } from "./operators/mixed-type.js"
import { MATH_DOMAIN_TESTS } from "./operators/math-domain.js"
import { REAL_OVERFLOW_TESTS } from "./operators/real-overflow.js"
import { PRIMITIVE_DEFAULT_TESTS } from "./types/primitive-default.js"
import { IDENTIFIER_TESTS } from "./declarations/identifier.js"
import { CORPUS_STANDARD_TESTS } from "./semantics/corpus-standard.js"
import { LIBRARY_BODY_TESTS } from "./libraries/library-bodies.js"
import { IL_CALC_SHAPE_TESTS, INTERFACE_VAR_TESTS } from "./calls/il-calc-shapes.js"
import { SIGNATURE_NAME_TESTS } from "./cross-object/signature-name.js"
import { WRITTEN_AS_SENT_TESTS } from "./objects/written-as-sent.js"
import { HEADER_RULE_TESTS } from "./oop/header-rules.js"
import { REMOVED_PUSH_CHECK_TESTS } from "./objects/removed-push-checks.js"
import { NETWORK_GRAPHICAL_TESTS } from "./graphical/network-graphical.js"
import { NETWORK_UNRESOLVED_TESTS } from "./graphical/network-unresolved.js"
import { INIT_SLOT_TESTS } from "./declarations/init-slot.js"
import { IMPLICIT_CHECK_TESTS } from "./conversions/implicit-checks.js"
import { INTERFACE_TESTS } from "./oop/interface.js"
import { KEYWORD_TESTS } from "./declarations/keyword.js"
import { LIFECYCLE_TESTS } from "./oop/lifecycle.js"
import { LITERAL_TESTS } from "./types/literal.js"
import { OOP_TESTS } from "./oop/oop.js"
import { CONSTANT_FOLDING_TESTS } from "./declarations/constant-folding.js"
import { TRY_CATCH_TESTS } from "./semantics/try-catch.js"
import { INIT_SEQUENCE_TESTS } from "./declarations/init-sequence.js"
import { REFERENCE_BINDING_TESTS } from "./declarations/reference-binding.js"
import { OPERANDS_TESTS } from "./operators/operands.js"
import { STRING_ORDER_TESTS } from "./strings/ordering.js"
import { SYSTEM_OPERAND_TESTS } from "./operators/system-operands.js"
import { OPERATOR_TESTS } from "./operators/operator.js"
import { OVERFLOW_TESTS } from "./operators/overflow.js"
import { RANGE_BOUNDS_TESTS } from "./types/range-bounds.js"
import { PRAGMA_TESTS } from "./pragmas/pragma.js"
import { PRAGMA_TC_TESTS } from "./pragmas/pragma-tc.js"
import { SEMANTIC_TESTS } from "./semantics/semantic.js"
import { STATEMENT_EDGE_TESTS } from "./semantics/statement-edges.js"
import { UNARY_OPERAND_TESTS } from "./operators/unary-operand.js"
import { SHADOWING_TESTS } from "./declarations/shadowing.js"
import { USAGE_PATTERN_TESTS } from "./cross-object/usage-pattern.js"
import { ADDRESS_TESTS } from "./declarations/addresses.js"
import { SECTION_SEMANTICS_TESTS } from "./declarations/section-semantics.js"
import { VARIABLE_SECTION_TESTS } from "./declarations/variable-section.js"
import { CHECK_COVERAGE_TESTS } from "./batches/check-coverage.js"
import { ERROR_CATALOG_TESTS } from "./semantics/error-catalog.js"
import { EXECUTION_TESTS } from "./semantics/execution.js"
import { MEMORY_MODEL_TESTS } from "./memory/memory-model.js"
import { POINTER_PARAMETER_TESTS } from "./memory/pointer-parameters.js"
import { POINTER_INTO_SCALAR_TESTS } from "./memory/pointer-into-scalar.js"
import { FB_CALL_TESTS } from "./calls/fb-call.js"
import { INHERITANCE_TESTS } from "./oop/inheritance.js"
import { ROUTINE_STATE_TESTS } from "./calls/routine-state.js"
import { INITIALIZER_TESTS } from "./declarations/initializers.js"
import { ARRAY_INIT_SHAPE_TESTS } from "./declarations/array-init-shapes.js"
import { DECLARATION_CHECK_TESTS } from "./declarations/declaration-rules.js"
import { ENUM_INIT_VALUE_TESTS } from "./types/enum-init-values.js"
import { INTERFACE_CALL_TESTS } from "./calls/interface-calls.js"
import { DECLARATION_LIFETIME_TESTS } from "./declarations/declaration-lifetimes.js"
import { INOUT_CONSTANT_TESTS } from "./calls/inout-constant.js"
import { ATOMIC_OPERAND_TESTS } from "./calls/atomic-operands.js"
import { CALL_GRID_TESTS } from "./calls/call-grid.js"
import { CALL_SHAPE_TESTS } from "./calls/call-shapes.js"
import { ARGUMENT_COUNT_TESTS } from "./calls/argument-count.js"
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
import { LEXER_TESTS } from "./grammar/lexer.js"
import { LITERAL_RULE_TESTS } from "./grammar/literals.js"
import { DECLARATION_RULE_TESTS } from "./grammar/declarations.js"
import { TYPE_EXPRESSION_RULE_TESTS } from "./grammar/type-expressions.js"
import { UNIT_RULE_TESTS } from "./grammar/units.js"
import { EXPRESSION_RULE_TESTS } from "./grammar/expressions.js"
import { STATEMENT_RULE_TESTS } from "./grammar/statements.js"
import { PRAGMA_RULE_TESTS } from "./grammar/pragmas.js"
import { RECOVERY_TESTS } from "./grammar/recovery.js"
import { DEAD_CODE_TESTS } from "./grammar/dead-code.js"
import { SCOPE_RULE_TESTS } from "./names/scopes.js"
import { INHERITANCE_RULE_TESTS } from "./names/inheritance.js"
import { ENUM_RULE_TESTS } from "./names/enums.js"
import { LIBRARY_RULE_TESTS } from "./names/libraries.js"
import { MEMBER_RULE_TESTS } from "./names/members.js"
import { SFC_STEP_TESTS } from "./names/sfc-steps.js"
import { ELEMENTARY_RULE_TESTS } from "./types/elementary-rules.js"
import { LITERAL_CONTEXT_TESTS } from "./types/literal-contexts.js"
import { LITERAL_INTO_COMPOSITE_TESTS } from "./types/literal-into-composite.js"
import { ARITHMETIC_RESULT_TESTS } from "./types/arithmetic-results.js"
import { COMPARISON_BOOL_TESTS } from "./types/comparisons-bool.js"
import { ENUM_CONVERSION_TESTS } from "./types/enum-conversions.js"
import { POINTER_REFERENCE_TESTS } from "./types/pointer-reference.js"
import { CONSTANT_EVALUATION_TESTS } from "./types/constant-evaluation.js"
import { DERIVED_TYPE_TESTS } from "./types/derived-types.js"
import { EXPLICIT_PAIR_TESTS } from "./conversions/explicit-pairs.js"

export interface CategoryGroup {
  name: string
  tests: readonly LanguageTest[]
}

const RAW_CATEGORIES: readonly CategoryGroup[] = [
  { name: "cross-object", tests: CROSS_OBJECT_TESTS },
  { name: "library-bodies", tests: LIBRARY_BODY_TESTS },
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
  { name: "written-as-sent", tests: WRITTEN_AS_SENT_TESTS },
  { name: "header-rules", tests: HEADER_RULE_TESTS },
  { name: "removed-push-checks", tests: REMOVED_PUSH_CHECK_TESTS },
  { name: "init-slot", tests: INIT_SLOT_TESTS },
  { name: "shadowing", tests: SHADOWING_TESTS },
  { name: "conversion", tests: CONVERSION_TESTS },
  { name: "real-to-integer", tests: REAL_TO_INTEGER_TESTS },
  { name: "real-to-integer-ladder", tests: REAL_TO_INTEGER_LADDER_TESTS },
  { name: "integer-to-integer", tests: INTEGER_TO_INTEGER_TESTS },
  { name: "integer-to-real", tests: INTEGER_TO_REAL_TESTS },
  { name: "cross-family", tests: CROSS_FAMILY_TESTS },
  { name: "to-string-format", tests: [...TO_STRING_FORMAT_TESTS, ...TRANSPILE_REVIEW_TO_STRING_TESTS] },
  { name: "semantic", tests: SEMANTIC_TESTS },
  { name: "statement-edges", tests: STATEMENT_EDGE_TESTS },
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
  { name: "platform-integers", tests: PLATFORM_INTEGER_TESTS },
  { name: "real-overflow", tests: REAL_OVERFLOW_TESTS },
  { name: "math-domain", tests: MATH_DOMAIN_TESTS },
  { name: "arithmetic-edges", tests: ARITHMETIC_EDGE_TESTS },
  { name: "comparison", tests: COMPARISON_TESTS },
  { name: "comparison-operands", tests: COMPARISON_OPERAND_TESTS },
  { name: "bitwise", tests: BITWISE_TESTS },
  { name: "selection", tests: SELECTION_TESTS },
  { name: "string-edges", tests: [...STRING_EDGE_TESTS, ...TRANSPILE_REVIEW_STRING_TESTS] },
  { name: "escapes", tests: ESCAPE_TESTS },
  { name: "mixed-type", tests: MIXED_TYPE_TESTS },
  { name: "variable-section", tests: VARIABLE_SECTION_TESTS },
  { name: "section-semantics", tests: SECTION_SEMANTICS_TESTS },
  { name: "addresses", tests: ADDRESS_TESTS },
  { name: "keyword", tests: KEYWORD_TESTS },
  { name: "constant-folding", tests: CONSTANT_FOLDING_TESTS },
  { name: "try-catch", tests: TRY_CATCH_TESTS },
  { name: "init-sequence", tests: INIT_SEQUENCE_TESTS },
  { name: "reference-binding", tests: REFERENCE_BINDING_TESTS },
  { name: "operands", tests: OPERANDS_TESTS },
  { name: "string-ordering", tests: STRING_ORDER_TESTS },
  { name: "system-operands", tests: SYSTEM_OPERAND_TESTS },
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
  { name: "pointer-parameters", tests: POINTER_PARAMETER_TESTS },
  { name: "pointer-into-scalar", tests: POINTER_INTO_SCALAR_TESTS },
  // ── call semantics: FB instances, methods, actions, functions, a program and a global (phase 3) ──
  { name: "fb-call", tests: FB_CALL_TESTS },
  // ── inheritance: which bodies and methods EXTENDS and SUPER^ run (phase 3½) ──
  { name: "inheritance", tests: INHERITANCE_TESTS },
  // ── routine state and call edges: VAR_INST, VAR_STAT, properties, empty arguments, programs from FBs (phase 3½) ──
  { name: "routine-state", tests: ROUTINE_STATE_TESTS },
  // ── aggregate initializers: structs by field, nested, arrays of structs, FB instances (phase 3½) ──
  { name: "initializers", tests: INITIALIZER_TESTS },
  { name: "array-init-shapes", tests: ARRAY_INIT_SHAPE_TESTS },
  { name: "declaration-rules", tests: DECLARATION_CHECK_TESTS },
  { name: "types-enum-init-values", tests: ENUM_INIT_VALUE_TESTS },
  { name: "interface-calls", tests: INTERFACE_CALL_TESTS },
  { name: "declaration-lifetimes", tests: DECLARATION_LIFETIME_TESTS },
  { name: "inout-constant", tests: INOUT_CONSTANT_TESTS },
  { name: "call-shapes", tests: CALL_SHAPE_TESTS },
  { name: "argument-count", tests: ARGUMENT_COUNT_TESTS },
  { name: "call-grid", tests: CALL_GRID_TESTS },
  { name: "atomic-operands", tests: ATOMIC_OPERAND_TESTS },
  // ── implicit check functions a project defines (CheckBounds, CheckDiv…): what CODESYS calls, with what ──
  { name: "implicit-checks", tests: IMPLICIT_CHECK_TESTS },
  // ── the front-end's grammar, rule by rule (openspec frontend-conformance design.md §4 area 2) ──
  { name: "grammar-lexer", tests: LEXER_TESTS },
  { name: "grammar-literals", tests: LITERAL_RULE_TESTS },
  { name: "grammar-declarations", tests: DECLARATION_RULE_TESTS },
  { name: "grammar-type-expressions", tests: TYPE_EXPRESSION_RULE_TESTS },
  { name: "grammar-units", tests: UNIT_RULE_TESTS },
  { name: "grammar-expressions", tests: EXPRESSION_RULE_TESTS },
  { name: "grammar-statements", tests: STATEMENT_RULE_TESTS },
  { name: "grammar-pragmas", tests: PRAGMA_RULE_TESTS },
  { name: "grammar-recovery", tests: RECOVERY_TESTS },
  { name: "grammar-dead-code", tests: DEAD_CODE_TESTS },
  { name: "names-scopes", tests: SCOPE_RULE_TESTS },
  { name: "names-inheritance", tests: INHERITANCE_RULE_TESTS },
  { name: "names-enums", tests: ENUM_RULE_TESTS },
  { name: "names-libraries", tests: LIBRARY_RULE_TESTS },
  { name: "names-members", tests: MEMBER_RULE_TESTS },
  { name: "names-sfc-steps", tests: SFC_STEP_TESTS },
  { name: "types-elementary-rules", tests: ELEMENTARY_RULE_TESTS },
  { name: "types-literal-contexts", tests: LITERAL_CONTEXT_TESTS },
  { name: "types-literal-into-composite", tests: LITERAL_INTO_COMPOSITE_TESTS },
  { name: "types-arithmetic-results", tests: ARITHMETIC_RESULT_TESTS },
  { name: "types-comparisons-bool", tests: COMPARISON_BOOL_TESTS },
  { name: "types-enum-conversions", tests: ENUM_CONVERSION_TESTS },
  { name: "types-pointer-reference", tests: POINTER_REFERENCE_TESTS },
  { name: "types-constant-evaluation", tests: CONSTANT_EVALUATION_TESTS },
  { name: "types-derived-types", tests: DERIVED_TYPE_TESTS },
  { name: "conversions-explicit-pairs", tests: EXPLICIT_PAIR_TESTS },
]

/**
 * Every fixture, each carrying EVERYTHING KNOWN ABOUT IT — one row, from one file.
 *
 * All of it is derived — from the recordings, the fixture's own flags, the lowered IR and the Rust linter — so it is
 * generated into `map.generated.ts` and merged HERE rather than written into each entry: 458 of these fixtures come
 * from factory helpers or template-literal names, where a per-entry field cannot reach. `fixtures.test.ts`
 * recomputes every value so none of it can go stale.
 *
 * THERE USED TO BE TWO GENERATED MODULES and a plan for a third: `evidence.generated.ts` beside a transpile map
 * beside the divergence sets. Same question, three files, and a reader asking "what do we know about this fixture?"
 * opening all of them. They are one row now. What did NOT move is the ground truth: `recordings/*.json` is the
 * vendor's own answer and only a recorder writes it, and `support/divergences.ts` keeps the paragraph explaining
 * each divergence — the row carries the membership, that file carries the reason.
 *
 * MERGED ONTO THE CATEGORIES, not onto a flattened copy. Both `CATEGORIES` and `ALL_TESTS` are exported and hold the
 * same fixtures; merging into only one gave two views that disagreed, and a per-category report read every rating as
 * absent. A fixture's OWN `evidence`, if one is ever written by hand, is left alone — the generated value only fills
 * a gap.
 */
export const CATEGORIES: readonly CategoryGroup[] = RAW_CATEGORIES.map((c) => ({
  ...c,
  tests: c.tests.map((t) => {
    const row = FIXTURE_MAP[t.name]
    if (row === undefined) return t
    const { evidence, ...transpile } = row
    return {
      ...t,
      ...(t.evidence === undefined ? { evidence } : {}),
      ...(transpile.tier === undefined && transpile.diverges === undefined ? {} : { transpile }),
    }
  }),
}))

export const ALL_TESTS: readonly LanguageTest[] = CATEGORIES.flatMap((c) => c.tests)
