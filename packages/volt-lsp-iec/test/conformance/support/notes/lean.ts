/**
 * How a note is made of review items: one item (`note`) or several, each with its own owner (`merged`) — the
 * constructors `notes.data.ts` is written with (split out of the confidence module, transpile-restructure 1.8.3).
 */
import type { ShapeNote } from "../../fixtures/map-row.js"

/** What one review item said, before a note names the task that owns it. */
export type ReviewItem = Omit<ShapeNote, "tasks">

/** One construct's note made of ONE review item, owned by `task` (a transpile-restructure task id, or `keep:<reason>`). */
export function note(task: string, item: ReviewItem): ShapeNote {
  return { ...item, tasks: [task] }
}

/** A review item with the task that owns it. */
type Owned = readonly [task: string, item: ReviewItem]

/**
 * One construct's note made of the items several reviewers reported against it, merged — every improvement, every
 * option, the first choice — EACH ITEM WITH ITS OWN OWNER, in item order (`tasks[i]` owns the i-th improvement). An
 * item never rides on another's owner: the task that lands removes its own items, so one owner landing cannot take
 * another item's text with it (transpile-restructure 0b).
 */
export function merged(...owned: readonly [Owned, Owned, ...Owned[]]): ShapeNote {
  const items = owned.map(([, item]) => item)
  const alternatives = items.flatMap((n) => n.alternatives ?? [])
  const choice = items.find((n) => n.chosen !== undefined)
  return {
    improvement: items.flatMap((n) => (n.improvement === undefined ? [] : [n.improvement])).join(" Also: "),
    ...(alternatives.length > 0 ? { alternatives } : {}),
    ...(choice?.chosen === undefined ? {} : { chosen: choice.chosen }),
    ...(choice?.why === undefined ? {} : { why: choice.why }),
    tasks: owned.map(([task]) => task),
  }
}
