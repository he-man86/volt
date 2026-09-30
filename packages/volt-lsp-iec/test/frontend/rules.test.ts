/**
 * 0.5 THE RULE INVENTORY — is every front-end rule asked, and is every answer the catalogue claims actually recorded?
 *
 * `rules.ts` is design.md §4 as data. This file holds it to what exists: each fixture a row lists exists and has a
 * CODESYS recording (build or run), each unit test it names exists under that title, a row that is not a GAP lists
 * something, and the GAP count per area — the rules nobody has asked CODESYS yet — is the pinned number below, which is
 * tasks.md 0.5's and may only fall. CV7's own count is the explicit-conversion pairs no recorded fixture calls
 * (`conversion-pairs.ts`); it is pinned here too.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { LanguageTest } from "../conformance/types.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { explicitConversionPairs, recordedFixtures } from "./conversion-pairs.js"
import { RULES } from "./rules.js"

/** THE PINNED GAP COUNTS (tasks.md 0.5). They may only fall, and fall in the commit that closes a row. */
const GAPS = { 2: 79, 3: 26, 4: 28 } as const
const TOTAL_GAPS = 133
/** Explicit `X_TO_Y` pairs no recorded fixture calls (CV7). May only fall. */
const MISSING_CONVERSION_PAIRS = 327

const PACKAGE = join(import.meta.dir, "..", "..")
const FIXTURES = join(PACKAGE, "test", "conformance", "fixtures")

/** Every fixture a fixture FILE declares, by the name `ALL_TESTS` knows it by — the file's exported arrays. */
async function fixturesOfFile(pattern: string): Promise<string[]> {
  const files =
    pattern.endsWith("/*") || pattern.endsWith("/*.ts")
      ? [...new Bun.Glob(`${pattern.replace(/\/\*(\.ts)?$/, "")}/*.ts`).scanSync(FIXTURES)]
      : [pattern]
  const names: string[] = []
  for (const file of files) {
    const path = join(FIXTURES, file)
    if (!existsSync(path)) continue
    const mod = (await import(path)) as Record<string, unknown>
    for (const value of Object.values(mod))
      if (Array.isArray(value))
        for (const t of value)
          if (
            typeof (t as Partial<LanguageTest>)?.name === "string" &&
            typeof (t as Partial<LanguageTest>).source === "string"
          )
            names.push((t as LanguageTest).name)
  }
  return names
}

const glob = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)

/** What one fixture reference names, and which of those are recorded. */
async function resolveRef(
  ref: string,
  known: ReadonlySet<string>,
  recorded: ReadonlySet<string>,
): Promise<{ named: string[]; recorded: string[] }> {
  const named =
    ref.includes("/") || ref.endsWith(".ts")
      ? await fixturesOfFile(ref)
      : ref.includes("*")
        ? [...known].filter((n) => glob(ref).test(n))
        : known.has(ref)
          ? [ref]
          : []
  return { named, recorded: named.filter((n) => recorded.has(n)) }
}

describe("0.5 the rule inventory", () => {
  const known = new Set(ALL_TESTS.map((t) => t.name))
  const recorded = recordedFixtures()

  test("a run entry that holds only the recorder's own failure is not a recording", () => {
    // `ptrparam_unsupplied` has no build recording and a run entry "The operation has timed out." — CODESYS said nothing
    expect(recorded.has("ptrparam_unsupplied")).toBe(false)
    // a refusal is an answer: `tr_37_case_label_wraps_minus_212`'s run entry is the compiler's "does not compile: …"
    expect(recorded.has("tr_37_case_label_wraps_minus_212")).toBe(true)
  })

  test("every id is unique", () => {
    const ids = RULES.map((r) => r.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  test("every listed fixture exists and is recorded; a name is itself recorded, a glob or a file has a recorded fixture", async () => {
    const problems: string[] = []
    for (const rule of RULES)
      for (const ref of rule.fixtures) {
        const r = await resolveRef(ref, known, recorded)
        if (r.named.length === 0) problems.push(`${rule.id}: ${ref} names no fixture`)
        else if (!ref.includes("*") && !ref.includes("/") && r.recorded.length === 0)
          problems.push(`${rule.id}: ${ref} is unrecorded`)
        else if (r.recorded.length === 0) problems.push(`${rule.id}: nothing ${ref} names is recorded`)
      }
    expect(problems).toEqual([])
  })

  test("every listed unit test exists under its title", () => {
    const problems: string[] = []
    for (const rule of RULES)
      for (const t of rule.tests ?? []) {
        const path = join(PACKAGE, t.file)
        if (!existsSync(path)) problems.push(`${rule.id}: ${t.file} does not exist`)
        else if (
          !readFileSync(path, "utf8").includes(JSON.stringify(t.title).slice(1, -1)) &&
          !readFileSync(path, "utf8").includes(t.title)
        )
          problems.push(`${rule.id}: ${t.file} has no test "${t.title}"`)
      }
    expect(problems).toEqual([])
  })

  test("a row that is not a GAP lists what decides it", () => {
    expect(
      RULES.filter((r) => !r.gap && r.fixtures.length === 0 && (r.tests ?? []).length === 0).map((r) => r.id),
    ).toEqual([])
  })

  test("the GAP count per area is the pinned one", () => {
    const counts = { 2: 0, 3: 0, 4: 0 }
    for (const r of RULES) if (r.gap) counts[r.area]++
    console.log(
      `\nrule inventory (0.5): ${RULES.length} rules, GAP area 2: ${counts[2]}, area 3: ${counts[3]}, area 4: ${counts[4]}, total ${counts[2] + counts[3] + counts[4]}`,
    )
    expect(counts).toEqual({ ...GAPS })
    expect(counts[2] + counts[3] + counts[4]).toBe(TOTAL_GAPS)
  })

  test("CV7: the explicit-conversion pairs no recorded fixture calls are the pinned count", () => {
    const { pairs, missing } = explicitConversionPairs()
    console.log(`explicit conversions (CV7): ${pairs.length} pairs, ${missing.length} called by no recorded fixture`)
    expect(missing.length).toBe(MISSING_CONVERSION_PAIRS)
    expect(RULES.find((r) => r.id === "CV7")?.gap).toBe(missing.length > 0)
  })
})
