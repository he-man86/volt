/**
 * Cross-object combinations, batch two — the shapes the catalog is THINNEST on, each split across objects.
 *
 * The first batch (`cross-object.ts`) took globals, inheritance, interfaces and in-outs. This one takes what the census
 * showed almost nothing pins: PROPERTY (9 fixtures in 705), ACTION (4), arrays of FB INSTANCES (none), an FB instance
 * inside a STRUCT (none), an interface EXTENDS another (none), a FUNCTION returning a STRUCT (none), and durations and
 * loop control met inside a METHOD of another object. Recorded like every other fixture: built and RUN in CODESYS SP21.
 */
import type { LanguageTest } from "../../types.js"
import { CROSS_OBJECT_TWO_TESTS_A } from "./cross-object-two-a.js"
import { CROSS_OBJECT_TWO_TESTS_B } from "./cross-object-two-b.js"

export const CROSS_OBJECT_TWO_TESTS: readonly LanguageTest[] = [...CROSS_OBJECT_TWO_TESTS_A, ...CROSS_OBJECT_TWO_TESTS_B]
