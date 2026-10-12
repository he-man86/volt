/**
 * Cross-object combinations — features that are each already implemented, met TOGETHER and split across the objects a
 * real project keeps them in (user request 2026-09-16: "multifile codesnippets instead of all single file").
 *
 * Every other catalog file pins ONE construct in ONE object. Real code is not shaped like that, and neither the LSP nor
 * the transpiler is exercised by it: a global reached through VAR_EXTERNAL from two different FBs, a three-deep EXTENDS
 * chain whose every level overrides and calls SUPER^, an interface implemented in two objects and dispatched from an
 * array, a DUT of DUTs written through a FUNCTION's VAR_IN_OUT — each is only interesting where the pieces are separate
 * objects that must resolve against each other. Recorded like every other fixture: built and RUN in CODESYS SP21, then
 * replayed by the LSP and by both transpiler backends.
 */
import type { LanguageTest } from "../../types.js"
import { CROSS_OBJECT_TESTS_A } from "./cross-object-a.js"
import { CROSS_OBJECT_TESTS_B } from "./cross-object-b.js"

export const CROSS_OBJECT_TESTS: readonly LanguageTest[] = [...CROSS_OBJECT_TESTS_A, ...CROSS_OBJECT_TESTS_B]
