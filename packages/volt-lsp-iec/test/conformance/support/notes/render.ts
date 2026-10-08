/**
 * The map's NOTES section, rendered from the authored table (split out of the confidence module,
 * transpile-restructure 1.8.3).
 */
import type { ShapeNote } from "../../fixtures/map-row.js"

/**
 * THE MAP'S `NOTES` SECTION — every note's full text, by construct id, with the construct as `normalizeRustLine`
 * prints it in a comment above. Written at the END of `map.generated.ts`, so the ids a row's `notes` names resolve in
 * the same file. A COPY of the authored table, never the source: edit `NOTES` here and regenerate.
 *
 * `lines` maps each construct id some fixture emits to its normalized line. A note with no line is a note about a
 * construct nobody emits — refused, never printed without the construct it is about.
 */
export function renderNotes(
  notes: Readonly<Record<string, ShapeNote>>,
  lines: ReadonlyMap<string, string>,
): string {
  const ids = Object.keys(notes).sort()
  const lineless = ids.filter((id) => !lines.has(id))
  if (lineless.length > 0) throw new Error(`these notes name a construct no fixture emits: ${lineless.join(", ")}`)
  const q = (s: string): string => JSON.stringify(s)
  const entries = ids.map((id) => {
    const n = notes[id]!
    return [
      `  // ${lines.get(id)}`,
      `  ${q(id)}: {`,
      ...(n.improvement === undefined ? [] : [`    improvement: ${q(n.improvement)},`]),
      ...(n.alternatives === undefined ? [] : ["    alternatives: [", ...n.alternatives.map((a) => `      ${q(a)},`), "    ],"]),
      ...(n.chosen === undefined ? [] : [`    chosen: ${q(n.chosen)},`]),
      ...(n.why === undefined ? [] : [`    why: ${q(n.why)},`]),
      `    tasks: [${n.tasks.map(q).join(", ")}],`,
      "  },",
    ].join("\n")
  })
  return `
/**
 * THE REVIEW'S NOTES — the full text behind every row's \`notes\`, keyed by construct id, the construct as
 * \`normalizeRustLine\` prints it in the comment above each. GENERATED from the authored \`NOTES\` in
 * \`support/notes/notes.data.ts\`: edit it there and regenerate, never here.
 *
 *   \`improvement\`   what a Rust engineer would write instead
 *   \`alternatives\`  when several emissions are CORRECT: each option, as the reviewer put it
 *   \`chosen\`        the option the reviewer would pick, when one was named
 *   \`why\`           the reviewer's reason for it
 *   \`tasks\`         per merged item, in order: the transpile-restructure task that resolves it, or \`keep:<reason>\`
 */
export const NOTES: Readonly<Record<string, ShapeNote>> = {
${entries.join("\n")}
}
`
}
