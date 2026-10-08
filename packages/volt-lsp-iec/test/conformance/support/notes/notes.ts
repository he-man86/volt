/**
 * The notes' gate and their reads: every note well-formed and tagged with a task of transpile-restructure's
 * `tasks.md`, how many each task owes, which a fixture carries (split out of the confidence module,
 * transpile-restructure 1.8.3).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { FixtureMapRow, ShapeNote } from "../../fixtures/map-row.js"
import { NOTES } from "./notes.data.js"

/**
 * A note with nothing in it, or an id that cannot be a construct id — refused, like an allowed lint with no reason. And
 * a note whose `task` is missing or names no task of transpile-restructure's `tasks.md` (`noteTagProblems`): a tag is
 * the promise that some task deletes the note, so one that points nowhere is refused like an untagged one.
 */
export function assertNotes(): void {
  const bad = Object.entries(NOTES).filter(
    ([id, n]) => !/^[0-9a-f]{10}$/.test(id) || (n.improvement ?? "").trim() === "" && (n.alternatives ?? []).length === 0,
  )
  if (bad.length > 0) throw new Error(`notes with no id or no content: ${bad.map(([id]) => id).join(", ")}`)
  // a `keep:` tag names no task, so only a table with a task tag in it needs the task list to exist
  if (Object.values(NOTES).every((n) => n.tasks.every((t) => typeof t === "string" && t.startsWith("keep:")))) {
    const untagged = noteTagProblems(NOTES, new Map())
    if (untagged.length > 0) throw new Error(`notes with a bad task tag:\n  ${untagged.join("\n  ")}`)
    return
  }
  if (!existsSync(RESTRUCTURE_TASKS))
    throw new Error(
      `the notes' task tags name tasks of ${RESTRUCTURE_TASKS}, which does not exist (archived?) — retag the notes or delete them`,
    )
  const problems = noteTagProblems(NOTES, taskIdsOf(readFileSync(RESTRUCTURE_TASKS, "utf8")))
  if (problems.length > 0) throw new Error(`notes with a bad task tag:\n  ${problems.join("\n  ")}`)
}

/** The task list every note's `task` names an id of: openspec `transpile-restructure` (its task 0.6 tagged the notes). */
export const RESTRUCTURE_TASKS = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "openspec", "changes", "transpile-restructure", "tasks.md")

/**
 * The ids of a `tasks.md`'s task lines (`- [ ] 7.3.1 …`, `- [x] 0a …`), each with whether it is ticked — a line of
 * prose that mentions one is not one.
 */
export function taskIdsOf(tasksMd: string): ReadonlyMap<string, boolean> {
  return new Map([...tasksMd.matchAll(/^- \[([ x])\] (\S+) /gm)].map((m) => [m[2]!, m[1] === "x"] as const))
}

/**
 * Each note with no owner, and each item of a note whose owner is missing, a `keep:` with no reason, a task id `tasks`
 * does not hold, or a task already TICKED — the task that lands removes its items, so a ticked owner means it did not
 * (transpile-restructure 7.11.2) — by note id, then item (1-based).
 */
export function noteTagProblems(notes: Readonly<Record<string, ShapeNote>>, tasks: ReadonlyMap<string, boolean>): string[] {
  return Object.keys(notes)
    .sort()
    .flatMap((id) => {
      const owners: unknown = notes[id]!.tasks
      if (!Array.isArray(owners) || owners.length === 0) return [`${id}: no task`]
      return owners.flatMap((task: unknown, i) => {
        const item = `${id}: item ${i + 1}`
        if (typeof task !== "string" || task.trim() === "") return [`${item} has no task`]
        if (task.startsWith("keep:"))
          return task.slice("keep:".length).trim() === "" ? [`${item} is \`keep:\` without a reason`] : []
        const done = tasks.get(task)
        if (done === undefined) return [`${item}'s task ${task} is not in transpile-restructure's tasks.md`]
        return done ? [`${item}'s task ${task} is ticked — the task that lands removes its items from the note`] : []
      })
    })
}

/**
 * How many notes each task still owes — a note counted once under each of its owners, every `keep:<reason>` as one
 * `keep` — by count, then by id.
 */
export function notesByTask(notes: Readonly<Record<string, ShapeNote>>): [string, number][] {
  const count = new Map<string, number>()
  for (const n of Object.values(notes))
    for (const owner of new Set(n.tasks.map((t) => (t.startsWith("keep:") ? "keep" : t))))
      count.set(owner, (count.get(owner) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en", { numeric: true }))
}

/** The notes whose construct no fixture emits any more — each one a judgement about Rust nobody produces. */
export function deadNotes(emitted: ReadonlySet<string>): string[] {
  return Object.keys(NOTES).filter((id) => !emitted.has(id)).sort()
}

/** Which of a fixture's constructs `NOTES` judged — the ids its row carries, deduplicated and sorted. */
export function notesOf(constructs: readonly string[]): Pick<FixtureMapRow, "notes"> {
  const noted = [...new Set(constructs)].filter((id) => NOTES[id] !== undefined).sort()
  return noted.length === 0 ? {} : { notes: noted }
}
