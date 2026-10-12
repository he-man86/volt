/**
 * WHAT THE REVIEW SAID, once per item — the lean items the overnight review's agents returned
 * (transpile-review-2026-09-29, grouped in `openspec/changes/transpile-lean-candidates`), keyed by the agent that
 * reported it: `shapesN_k` is batch N of the construct review, `linesN_k` a line-by-line unit that named a
 * construct. `alternatives`, `chosen` and `why` are the reviewer's own words; an item with no construct id the
 * corpus still emits is not here (it has nothing to be keyed by), and neither is one about the transpiler's source.
 *
 * AUTHORED, NOT GENERATED. The seed came out of the review's transcripts once; from here an entry changes when a
 * person decides — the lean item landed (delete it), the reasoning changed (edit it), a new review (add one).
 *
 * An item carries no `task`: one item can sit on constructs that different tasks resolve, so the owner is named per
 * NOTE (`note` below), not per item.
 */
import type { ReviewItem } from "./lean.js"
import { LEAN_A } from "./lean-a.data.js"
import { LEAN_B } from "./lean-b.data.js"
import { LEAN_C } from "./lean-c.data.js"
import { LEAN_D } from "./lean-d.data.js"

export const LEAN = { ...LEAN_A, ...LEAN_B, ...LEAN_C, ...LEAN_D } satisfies Record<string, ReviewItem>
