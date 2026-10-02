/**
 * `VOLT_FIXTURES=<name,name,…>` — run the fixture contract (`fixtures.test.ts`) for the NAMED fixtures only: the inner
 * loop of a step that touched a handful of them. `-t` cannot do this: it filters which tests RUN, after every fixture
 * was registered, lowered and Rust-built in the before-all phase (~62 s for three fixtures, measured 2026-10-02).
 *
 * The named fixtures go through exactly the code the full run gives them; only the SELECTION is smaller. What a
 * partial run cannot answer — the project-wide totals (the evidence ceilings, the agreement floors, the map's NOTES
 * section) — it skips, and says so on one loud line. It is never how a step closes: a gate, a close and CI run the
 * whole suite, and `CI` / `VOLT_REQUIRE_FULL=1` refuse a partial run so it cannot slip into one.
 *
 * Exact names; an unknown one THROWS — a typo must not be a run of zero fixtures that reads green.
 */

export interface Selection<T> {
  /** True when `VOLT_FIXTURES` narrowed the run. */
  partial: boolean
  /** The fixtures this run covers, in suite order. */
  selected: readonly T[]
  has(name: string): boolean
}

export function selectFixtures<T extends { name: string }>(
  all: readonly T[],
  env: Record<string, string | undefined> = process.env,
  out: { warn(message: string): void } = console,
): Selection<T> {
  const raw = env.VOLT_FIXTURES
  if (raw === undefined) return { partial: false, selected: all, has: () => true }
  for (const [name, set] of [
    ["CI", env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI !== "false"],
    ["VOLT_REQUIRE_FULL=1", env.VOLT_REQUIRE_FULL === "1"],
  ] as const)
    if (set) throw new Error(`VOLT_FIXTURES is set and ${name} requires the whole suite — unset VOLT_FIXTURES`)
  const names = new Set(
    raw
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n !== ""),
  )
  if (names.size === 0) throw new Error(`VOLT_FIXTURES=${JSON.stringify(raw)} names no fixture`)
  const known = new Set(all.map((t) => t.name))
  const unknown = [...names].filter((n) => !known.has(n))
  if (unknown.length > 0) throw new Error(`VOLT_FIXTURES names no such fixture: ${unknown.join(", ")}`)
  const selected = all.filter((t) => names.has(t.name))
  out.warn(
    `  [fixtures] PARTIAL RUN (VOLT_FIXTURES): ${selected.length} of ${all.length} fixtures — the project-wide totals are ` +
      `skipped; a gate runs the whole suite`,
  )
  return { partial: true, selected, has: (name) => names.has(name) }
}
