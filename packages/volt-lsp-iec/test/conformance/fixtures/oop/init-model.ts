/**
 * Instance-initialization measurements — openspec transpile-restructure task 5.1 (design.md §3.4, Measure items 1, 2, 4
 * and 5): the orders the init model has to reproduce and no recording showed yet, asked of CODESYS BEFORE §3.4 decides
 * the one ordered walk.
 *
 * Most cells read a STAMP: a FUNCTION that bumps a fixture-own global counter and returns it, called from field
 * initializers, FB_Init bodies and `call_after_global_init_slot` methods. The stamps put every initialization event of a
 * fixture on one line, so "fields first", "FB_Init first" and "interleaved" are different numbers rather than a guess
 * from one value.
 *
 * Measure item 3 (a structured initializer applies after FB_Init) is NOT asked again: `fb_init_and_structured_initializer`
 * (`oop/lifecycle.ts`) records it — FB_Init saw 0 and the structured 9 stayed.
 */
import type { LanguageTest } from "../../types.js"
import { INIT_MODEL_TESTS_A } from "./init-model-a.js"
import { INIT_MODEL_TESTS_B } from "./init-model-b.js"

export const INIT_MODEL_TESTS: readonly LanguageTest[] = [...INIT_MODEL_TESTS_A, ...INIT_MODEL_TESTS_B]
