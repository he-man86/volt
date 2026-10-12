/**
 * Check-coverage fixtures — deliberately target diagnostic CHECKS that lacked conformance coverage, plus a
 * battery of FP-BAIT: compiler-ACCEPTED near-miss code where a type check is most likely to over-fire. The
 * FP-bait is the permanent guard against the class of bug that was `constant-overflow` (it errored on code
 * CODESYS accepts). Recorded against live CODESYS/TwinCAT like every other fixture — the replay then proves
 * the LSP emits ⊆ what the compiler emits (no false positives).
 */
import type { LanguageTest } from "../../types.js"
import { CHECK_COVERAGE_TESTS_A } from "./check-coverage-a.js"
import { CHECK_COVERAGE_TESTS_B } from "./check-coverage-b.js"

export const CHECK_COVERAGE_TESTS: readonly LanguageTest[] = [...CHECK_COVERAGE_TESTS_A, ...CHECK_COVERAGE_TESTS_B]
