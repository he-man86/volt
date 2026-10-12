/**
 * Operator conformance tests.
 *
 * Source: 03-operators.md. Tests how TwinCAT handles arithmetic,
 * comparison, logical, and bitwise operators on various type combinations.
 * Surfaces auto-promotion rules and type-strictness behavior.
 *
 * Most are positive cases (expected to compile). Negative cases test
 * type-mixing TC rejects (e.g. arithmetic between BOOL and INT).
 *
 * Same LanguageTest shape as pragmas — see `test/conformance/types.ts` (`LanguageTest`) for field docs.
 */
import type { LanguageTest } from "../../types.js"
import { OPERATOR_TESTS_A } from "./operator-a.js"
import { OPERATOR_TESTS_B } from "./operator-b.js"
import { OPERATOR_TESTS_C } from "./operator-c.js"

export const OPERATOR_TESTS: readonly LanguageTest[] = [...OPERATOR_TESTS_A, ...OPERATOR_TESTS_B, ...OPERATOR_TESTS_C]
