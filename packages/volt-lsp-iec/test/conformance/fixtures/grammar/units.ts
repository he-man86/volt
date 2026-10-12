/**
 * THE UNITS, RULE BY RULE — design.md §4 2.4 of openspec `frontend-conformance` (U1–U27, tasks 2.4.1–2.4.5), each rule
 * put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec`
 * for the VALUE the unit computes (every FB fixture below that builds copies what its unit under test gives into `out`,
 * a variable of the FB, so the run recording holds `inst_<name>.out`; a PROGRAM's or FUNCTION's lands in PLC_PRG's
 * `seen_<name>`). Rows already decided by a recorded fixture elsewhere keep those fixtures; what is here is the cells
 * that separate a rule's readings: each header clause in each position, each modifier on each unit kind, alone, stacked,
 * reordered and repeated.
 *
 * ONE QUESTION PER FIXTURE, as in `declarations.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule. An INTERFACE is compiled only when something implements it, so every
 * interface below is implemented by the fixture's FB.
 */
import type { LanguageTest } from "../../types.js"
import { UNIT_RULE_TESTS_A } from "./units-a.js"

export const UNIT_RULE_TESTS: readonly LanguageTest[] = [...UNIT_RULE_TESTS_A]
