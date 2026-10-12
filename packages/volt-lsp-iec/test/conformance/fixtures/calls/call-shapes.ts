/**
 * Call shapes the corpus leans on and no recording answers — the oracle for the transpiler's `call-program-method`,
 * VAR_IN_OUT-in-METHOD (`place-not-local`), `call-nested` and `call-input-missing` blockers, recorded BEFORE any is built.
 * One question each: a METHOD run on a PROGRAM's one instance, from PLC_PRG and from an FB; an FB's VAR_IN_OUT read and
 * written inside its METHOD, when the body calls the METHOD and when a caller does after the FB was called; the order
 * a call's arguments are evaluated in when they hold calls and PROPERTY reads; what an input left out of a METHOD or
 * FUNCTION call holds.
 */
import type { LanguageTest } from "../../types.js"
import { CALL_SHAPE_TESTS_A } from "./call-shapes-a.js"
import { CALL_SHAPE_TESTS_B } from "./call-shapes-b.js"
import { CALL_SHAPE_TESTS_C } from "./call-shapes-c.js"
import { CALL_SHAPE_TESTS_D } from "./call-shapes-d.js"

export const CALL_SHAPE_TESTS: readonly LanguageTest[] = [...CALL_SHAPE_TESTS_A, ...CALL_SHAPE_TESTS_B, ...CALL_SHAPE_TESTS_C, ...CALL_SHAPE_TESTS_D]
