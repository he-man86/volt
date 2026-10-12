/**
 * THE RULE CATALOGUE AS DATA — design.md §4 of openspec `frontend-conformance`, one row per rule, checked by
 * `rules.test.ts`. Transcribed mechanically from the design's tables (the `design` field keeps each row's Fixtures cell
 * verbatim), then re-checked in task 0.5: every fixture a row lists must exist and be recorded, every unit test it names
 * must exist; a row left with nothing that decides it is a GAP. `recheck` says what 0.5 changed about a row and why.
 *
 * A fixture reference is a fixture NAME, a GLOB over names (`meet_*`, `cc_ld*_literal_into_*`), or a fixture FILE under
 * `test/conformance/fixtures/` (`types/data-type.ts`, `memory/*`) — the file's fixtures. A row's `gap` is the design's
 * GAP mark: a GAP row may still list the partial coverage the design names, and a non-GAP row must list something.
 *
 * Adding coverage is adding a recorded fixture to a row and flipping its `gap`; the pinned GAP counts in
 * `rules.test.ts` (and tasks.md 0.5) fall in the same commit. They may only fall.
 */
import { Rule } from "./rules-shared.js"
import { RULES_A } from "./rules-a.js"
import { RULES_B } from "./rules-b.js"
import { RULES_C } from "./rules-c.js"
import { RULES_D } from "./rules-d.js"
import { RULES_E } from "./rules-e.js"
import { RULES_F } from "./rules-f.js"
import { RULES_G } from "./rules-g.js"
import { RULES_H } from "./rules-h.js"
import { RULES_I } from "./rules-i.js"
import { RULES_J } from "./rules-j.js"
import { RULES_K } from "./rules-k.js"
import { RULES_L } from "./rules-l.js"
import { RULES_M } from "./rules-m.js"
import { RULES_N } from "./rules-n.js"
import { RULES_O } from "./rules-o.js"
import { RULES_P } from "./rules-p.js"

export const RULES: readonly Rule[] = [...RULES_A, ...RULES_B, ...RULES_C, ...RULES_D, ...RULES_E, ...RULES_F, ...RULES_G, ...RULES_H, ...RULES_I, ...RULES_J, ...RULES_K, ...RULES_L, ...RULES_M, ...RULES_N, ...RULES_O, ...RULES_P]
