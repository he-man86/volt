/**
 * THE NEAR-MISS ENGINE (openspec lsp-quick-fixes design.md §4 F3): one answer for every "not found" finding — "Change to
 * '<name>'" for each name the reporting check looked the written one up among that is within two edits of it, best first,
 * at most three. An identifier (C0046), a type (C0077), a member (C0004), a struct initializer's field, a base class
 * (C0090), a named input (C0037) and output (C0038), a jump label (C0117), an interface (C0086), the global a
 * VAR_EXTERNAL names (C0237) and an attribute (C0351) all ask it with the names their own lookup had in reach.
 *
 * Every option is a choice — the written name may be a typo for any of them, or the declaration may be what is missing —
 * so none is `preferred`.
 */
import type { Fix, FixEdit } from "./diagnostic-item.js"
import { fixOf, replaceText } from "./fixes.js"

/** How far a name may be from the written one and still be offered: two edits (case is no edit — ST names ignore it). */
const MAX_DISTANCE = 2
/** How many names are offered at most. */
const MAX_OFFERED = 3

/**
 * The names among `candidates` within `MAX_DISTANCE` edits of `written` (insert, delete, substitute, or swap two adjacent
 * characters; case-insensitive), nearest first, then in the order `candidates` gives them (a caller lists the nearest scope
 * first, so a local beats a global of the same distance) — at most `MAX_OFFERED`, each once, the written name
 * itself never; `accept` drops a near name the caller knows would not answer (one that does not resolve where written).
 */
export function nearMisses(written: string, candidates: Iterable<string>, accept: (name: string) => boolean = () => true): string[] {
  const w = written.toLowerCase()
  const best = new Map<string, { name: string; d: number }>()
  for (const name of candidates) {
    const key = name.toLowerCase()
    if (key === w || best.has(key) || Math.abs(key.length - w.length) > MAX_DISTANCE) continue
    const d = distance(w, key)
    if (d <= MAX_DISTANCE && accept(name)) best.set(key, { name, d })
  }
  return [...best.values()]
    .sort((a, b) => a.d - b.d) // stable: at one distance, the order the candidates came in — the nearest scope first
    .slice(0, MAX_OFFERED)
    .map((c) => c.name)
}

/** The optimal-string-alignment distance of `a` and `b` (Levenshtein plus the swap of two adjacent characters). */
function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_row, i) => Array.from({ length: cols }, (_col, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++)
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  return d[a.length]![b.length]!
}

/**
 * "Change to '<name>'" for each near miss of the text at `[start, end)` among `candidates` (`accept` as `nearMisses`); `more(name)`
 * adds the edits a rename needs beyond that one (C0237 renames the uses of the external too).
 */
export function changeToFixes(
  source: string,
  start: number,
  end: number,
  candidates: Iterable<string>,
  options: { accept?: (name: string) => boolean; more?: (name: string) => readonly FixEdit[] } = {},
): Fix[] {
  const more = options.more ?? (() => [])
  return nearMisses(source.slice(start, end), candidates, options.accept).map((name) =>
    fixOf(`Change to '${name}'`, [replaceText(source, start, end, name), ...more(name)]),
  )
}
