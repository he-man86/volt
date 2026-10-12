/**
 * Cross-object combinations, batch three — chains.
 *
 * Batches one and two took pairs of features in separate objects. This one takes CHAINS: a VAR_IN_OUT handed from a
 * PROGRAM through an FB through a METHOD into a FUNCTION, an override calling another override through THIS^, a FUNCTION
 * calling a FUNCTION, an ACTION calling a METHOD calling an ACTION — plus the declaration shapes nothing pins yet: an
 * ALIAS type, a SUBRANGE, a bit reached through a struct field, a WSTRING, SEL/MUX over another object's values, and a
 * METHOD local shadowing an inherited field. Recorded like every other fixture: built and RUN in CODESYS SP21.
 */
import type { LanguageTest } from "../../types.js"
import { CROSS_OBJECT_THREE_TESTS_A } from "./cross-object-three-a.js"
import { CROSS_OBJECT_THREE_TESTS_B } from "./cross-object-three-b.js"

export const CROSS_OBJECT_THREE_TESTS: readonly LanguageTest[] = [...CROSS_OBJECT_THREE_TESTS_A, ...CROSS_OBJECT_THREE_TESTS_B]
