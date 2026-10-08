/**
 * WHAT A FIXTURE TRANSPILES TO, AND HOW MUCH THAT IS WORTH — the one implementation, used by the generator and by
 * the gate, exactly as `evidence.ts` is.
 *
 * `evidence` answers *how well is this fixture EVIDENCED* — whether the vendor was asked and whether we match. It
 * says nothing about the code that comes out, and for a long time nothing needed it to: the emitted Rust was an
 * oracle, and the fixture gate compiled it with `-A unused_parens` under the reason "generated code is not read
 * for style". That stopped being true when `emit/rust/index.ts` declared an emitted SURFACE a user's harness reaches
 * into by name. Somebody reads it now.
 *
 * So this adds the second half, and keeps both halves MEASURED rather than judged:
 *
 *   `tier`         which band of the language the fixture's own body reaches — the simplest-first ladder (`tier.ts`).
 *   `correctness`  which oracle reached its emitted Rust (`correctness.ts`).
 *   `lints`        what the Rust linter says about that Rust, after a policy that names its own reasons (`lint-policy.ts`).
 *
 * There is no score. A number invites tuning; these three say where the evidence is and what is wrong with the
 * output, and all three are recomputed from the recordings and the compiler on every run. The emission's shape
 * (`shape.ts`), the edge differential (`edge.ts`) and the review's notes (`../notes/`) complete a row; this file
 * writes one.
 */
import { CODESYS_TRIAGE, KNOWN_DIVERGENCES, TWINCAT_TRIAGE } from "../divergences.js"
import type { FixtureMapRow } from "../../fixtures/map-row.js"

/** Which vendors this fixture is recorded as not matching — derived from the authored sets in `divergences.ts`. */
export function divergesOf(name: string): FixtureMapRow["diverges"] {
  const found = new Map<string, "triage" | "known">()
  if (CODESYS_TRIAGE.has(name)) found.set("codesys", "triage")
  if (TWINCAT_TRIAGE.has(name)) found.set("twincat", "triage")
  for (const [vendor, set] of Object.entries(KNOWN_DIVERGENCES)) if (set.has(name)) found.set(vendor, "known")
  if (found.size === 0) return undefined
  // BY VENDOR NAME, always. The sets are walked in their own order, so a fixture in both vendors' known-divergence
  // lists came out `{twincat, codesys}` here and `{codesys, twincat}` in the generated file — the same fact, and
  // the gate compared them as JSON and called six rows stale.
  return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)))
}

/** One row as it is written — the key order is fixed so a regeneration diffs against the last one. */
export function printRow(name: string, row: FixtureMapRow): string {
  const parts = [`evidence: ${JSON.stringify(row.evidence)}`]
  if (row.tier !== undefined) parts.push(`tier: ${JSON.stringify(row.tier)}`)
  if (row.rust !== undefined) parts.push(`rust: ${JSON.stringify(row.rust)}`)
  if (row.lints !== undefined && row.lints.length > 0)
    parts.push(`lints: [${row.lints.map((l) => JSON.stringify(l)).join(", ")}]`)
  if (row.pedantic !== undefined) parts.push(`pedantic: ${row.pedantic}`)
  if (row.edge !== undefined) parts.push(`edge: ${JSON.stringify(row.edge)}`)
  if (row.edgeUnanswered !== undefined) parts.push(`edgeUnanswered: ${row.edgeUnanswered}`)
  if (row.size !== undefined) parts.push(`size: ${row.size}`)
  if (row.shape !== undefined) parts.push(`shape: ${JSON.stringify(row.shape)}`)
  if (row.notes !== undefined) parts.push(`notes: [${row.notes.map((id) => JSON.stringify(id)).join(", ")}]`)
  if (row.diverges !== undefined)
    parts.push(
      `diverges: { ${Object.entries(row.diverges)
        .sort()
        .map(([v, how]) => `${v}: ${JSON.stringify(how)}`)
        .join(", ")} }`,
    )
  return `  ${/^[A-Za-z_]\w*$/.test(name) ? name : JSON.stringify(name)}: { ${parts.join(", ")} },`
}
