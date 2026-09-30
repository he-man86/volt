/**
 * THE EXPLICIT-CONVERSION MATRIX, AGAINST THE FIXTURES (design.md §4 CV7) — which `X_TO_Y` a recorded fixture calls, and
 * which it does not.
 *
 * The pairs are every ordered pair of distinct elementary types the front-end knows (`ELEMENTARY_TYPES`, BIT aside: it is
 * a field type and converts as BOOL), which is every name `parseConversionName` accepts — the front-end's own table, not
 * the vendor's. A pair is covered when a RECORDED fixture (`recordedFixtures`: one CODESYS answered) writes the call in
 * its source or its PLC_PRG, under either spelling of a type (`TOD` / `TIME_OF_DAY`). Read by `rules.test.ts`, which pins
 * the count, and printed by `scripts/conversion-matrix.ts --explicit`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ELEMENTARY_TYPES, parseConversionName } from "../../src/frontend/types/index.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"

const RECORDINGS = join(import.meta.dir, "..", "conformance", "recordings")
const tests = <T>(file: string): Record<string, T> =>
  (JSON.parse(readFileSync(join(RECORDINGS, file), "utf8")) as { tests: Record<string, T> }).tests

/**
 * Every fixture CODESYS answered: a build recording, or a run entry that holds values or the compiler's refusal
 * (`does not compile: …`, as `scripts/record-exec.py` writes it and `support/evidence.ts` reads it). A run entry that
 * holds only the recorder's own failure — a timeout, a program whose done flag never rose — is not an answer.
 */
export function recordedFixtures(): Set<string> {
  const run = Object.entries(tests<{ values?: object; error?: string }>("codesys.run.json"))
    .filter(([, r]) => r.values !== undefined || r.error?.startsWith("does not compile: ") === true)
    .map(([name]) => name)
  return new Set([...Object.keys(tests("codesys.build.json")), ...run])
}

export interface ConversionPairs {
  pairs: string[]
  covered: string[]
  missing: string[]
}

export function explicitConversionPairs(): ConversionPairs {
  const types = [...ELEMENTARY_TYPES.keys()].filter((t) => t !== "BIT")
  const pairs = types.flatMap((from) => types.filter((to) => to !== from).map((to) => `${from}_TO_${to}`))
  const seen = new Set<string>()
  const names = recordedFixtures()
  for (const t of ALL_TESTS) {
    if (!names.has(t.name)) continue
    for (const m of `${t.source}\n${t.plcPrgVar ?? ""}\n${t.plcPrgBody ?? ""}`.matchAll(
      /\b[A-Za-z_]+_TO_[A-Za-z_]+\b/g,
    )) {
      const c = parseConversionName(m[0])
      if (c?.from !== undefined) seen.add(`${c.from.name}_TO_${c.to.name}`)
    }
  }
  return { pairs, covered: pairs.filter((p) => seen.has(p)), missing: pairs.filter((p) => !seen.has(p)) }
}
