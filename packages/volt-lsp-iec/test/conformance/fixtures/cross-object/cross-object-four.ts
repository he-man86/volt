/**
 * Cross-object combinations, batch four — state, lifetimes and control flow.
 *
 * Batches one to three took features in separate objects, then chains of them. This one takes what a body CARRIES across
 * objects: an FB_init argument chain, a METHOD's VAR_INST and VAR_STAT, a GVL of an ARRAY of structs written from two
 * places, an array of STRINGs, a member chain four deep, a CASE over a PROPERTY read, an early RETURN in each kind of
 * routine, two interfaces on one FB told apart by `__QUERYINTERFACE`, and REAL arithmetic that has to stay float32.
 * Recorded like every other fixture: built and RUN in CODESYS SP21.
 */
import type { LanguageTest } from "../../types.js"
import { CROSS_OBJECT_FOUR_TESTS_A } from "./cross-object-four-a.js"
import { CROSS_OBJECT_FOUR_TESTS_B } from "./cross-object-four-b.js"

export const CROSS_OBJECT_FOUR_TESTS: readonly LanguageTest[] = [...CROSS_OBJECT_FOUR_TESTS_A, ...CROSS_OBJECT_FOUR_TESTS_B]
