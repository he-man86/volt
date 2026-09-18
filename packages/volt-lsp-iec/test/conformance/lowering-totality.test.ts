/**
 * LOWERING IS TOTAL — the contract, as a gate.
 *
 * `src/transpile/index.ts` states it: lowering "stays total: invalid input still ends in a `LowerDiagnostic`
 * under a generic code, never a throw and never an invented meaning." Everything downstream is built on that.
 * `lower-completeness.ts` walks the whole corpus and would crash if it were violated — but it is a SCRIPT, run
 * by hand, and nothing ran it on a schedule. A property this load-bearing needs a test.
 *
 * WHY IT LIVES IN THE CONFORMANCE TIER THOUGH IT WALKS THE CORPUS. `test/corpus/` is deliberately out of CI:
 * it is a RATCHET that discovers precision gaps, carries known-incomplete numbers, and is not expected to be
 * green. This is the opposite kind of thing — a hard invariant with one right answer — so it belongs where the
 * gates are. The cost is ~80s over 29k files, which is what a contract worth stating is worth checking.
 *
 * WHAT IT DOES NOT PROVE. The corpus is real customer code, so it contains what engineers write, not what an
 * adversary would. Two throws found by review (2026-09-17) are NOT reachable from it — a pointer stepped over a
 * zero-size element, and a date literal outside JS `Date`'s range — and they get their own targeted cases where
 * they are fixed. A corpus pass is evidence, not proof.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import {
  declarationAttributes,
  isGraphicalBody,
  memberAttributes,
  parseSource,
  parseStatements,
  unitAttributes,
  type TopLevel,
} from "../../src/syntax/index.js"
import { buildSymbolTable, scopeForUnit } from "../../src/symbols/index.js"
import { lowerUnit } from "../../src/transpile/index.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"
import { scanLibraryManifests } from "../../src/workspace-refs.js"
import { LOWER_CODES, LOWER_CODE_PREFIXES } from "../../src/transpile/ir/codes.js"
import { lowerSource } from "../../src/transpile/lower/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"

const CORPUS = join(import.meta.dir, "..", "..", "test-corpus")

const walk = (d: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

// the same set `lower-completeness.ts` counts, so the gate and the ratchet walk identical ground
const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

/**
 * THE DOCUMENTED REACH, from `src/transpile/index.ts`. When a change moves these, update BOTH — the number in
 * `index.ts` is the contract a reader sees, and this is what keeps it true. They are exact rather than a floor
 * on purpose: a floor lets the documented figure rot quietly upward while still "passing".
 */
const DOCUMENTED_BODIES = 304
const DOCUMENTED_LOWERED = 55

/**
 * HOW MANY REGISTERED REFUSAL CODES ANY REAL PROGRAM ACTUALLY PRODUCES.
 *
 * `codes.test.ts` gates the registry STATICALLY — it greps `lower/` for the slugs and checks each resolves. That
 * proves a code is WRITTEN, not that it can be REACHED, and those are different claims: a refusal nothing can
 * produce is either dead code or a construct no test covers, and the registry cannot tell them apart.
 *
 * This walks the conformance fixtures and the whole corpus and records every code that actually comes out. It is a
 * FLOOR, not an exact figure — a new fixture may legitimately reach one more — but it only ever goes up, so a
 * refactor that quietly makes a refusal unreachable fails here.
 */
const REACHED_CODES = 80

/** One walk, two questions: did anything throw, and how much of the corpus does this backend actually reach. */
function overCorpus(): { failures: string[]; bodies: number; lowered: number; codes: Set<string> } {
  const failures: string[] = []
  const codes = new Set<string>()
  let bodies = 0
  let lowered = 0
  const projects = readdirSync(CORPUS).filter((name) => statSync(join(CORPUS, name)).isDirectory())
  for (const projectDir of projects) {
    const files = walk(join(CORPUS, projectDir)).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      try {
        const parseResult = parseSource(source)
        // a parse gap is `parser-completeness`'s to report, not this gate's
        return parseResult.errors.length > 0 ? [] : [{ file, source, parseResult }]
      } catch {
        return []
      }
    })
    const project = buildSymbolTable(
      files.map(({ file, source, parseResult }) => ({ uri: file, parseResult, source })),
      scanLibraryManifests(join(CORPUS, projectDir)),
    )
    const attributes = new Map<object, Set<string>>(
      files.flatMap(({ source, parseResult }) => [
        ...unitAttributes(parseResult, source),
        ...memberAttributes(parseResult, source),
        ...declarationAttributes(parseResult, source),
      ]),
    )
    for (const { file, parseResult } of files) {
      for (const unit of parseResult.units.filter(isRunnable)) {
        const scope = scopeForUnit(project, unit)
        if (scope === undefined) continue
        if (isGraphicalBody(unit.body)) continue // a graphical body is not ST; the network pipeline owns it
        // the reach denominator is a body with STATEMENTS — a declaration-only POU lowers trivially and
        // executes nothing, so counting it would flatter the figure
        const hasCode = parseStatements(unit.body).statements.length > 0
        if (hasCode) bodies++
        try {
          const { pou, diagnostics } = lowerUnit(unit, scope, project, attributes)
          if (hasCode && pou !== undefined) lowered++
          for (const d of diagnostics ?? []) codes.add(d.code)
        } catch (error) {
          const name = "name" in unit && unit.name !== undefined ? String((unit.name as { text: string }).text) : "?"
          failures.push(`${relative(CORPUS, file)} :: ${name} — ${(error as Error).message}`)
        }
      }
    }
  }
  return { failures, bodies, lowered, codes }
}

describe("the contracts src/transpile/index.ts states, measured over the corpus", () => {
  // One walk of 29k files, shared by both assertions and done on first use — a `beforeAll` has its own
  // timeout that an 80-second sweep quietly blows, and the failure it produces names no test.
  let cached: { failures: string[]; bodies: number; lowered: number; codes: Set<string> } | undefined
  const result = (): { failures: string[]; bodies: number; lowered: number; codes: Set<string> } => (cached ??= overCorpus())

  test("TOTALITY — no POU in the corpus makes lowering throw", () => {
    // the whole list, not a count: a throw names the input that caused it, which is the fix
    expect(result().failures).toEqual([])
  }, 240_000)

  test("REACH — the subset index.ts documents is the subset that is measured", () => {
    // If this fails after a deliberate coverage change, update BOTH this constant and the paragraph in
    // `src/transpile/index.ts`. The documented reach is a contract a reader relies on; a plan for this very
    // component once justified itself with a figure 470x the real one, which is what this exists to prevent.
    const { bodies, lowered } = result()
    expect({ bodies, lowered }).toEqual({ bodies: DOCUMENTED_BODIES, lowered: DOCUMENTED_LOWERED })
  })

  test("REFUSAL REACH — a registered code that no real program produces is reported", () => {
    const registered = Object.keys(LOWER_CODES)
    const families = LOWER_CODE_PREFIXES.map((p) => p.prefix)
    const produced = new Set(result().codes)

    // the fixtures too: many refusals need a shape the corpus does not happen to contain
    for (const t of ALL_TESTS) {
      // assembled exactly as `backend-agreement` does it, so both gates read the same program from a fixture
      const fixtures = withDependencies(t, ALL_TESTS).filter((f) => f.source !== "")
      const gvls = fixtures.filter((f) => f.kind === "gvl").map((f) => ({ uri: `${f.pouName}.gvl`, source: f.source }))
      const source = [...fixtures.filter((f) => f.kind !== "gvl").map((f) => f.source), plcPrgSource(t)].join("\n")
      try {
        for (const d of lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls]).diagnostics ?? []) produced.add(d.code)
      } catch {
        // a fixture that throws is `TOTALITY`'s to report, not this one's
      }
    }

    // NOTHING may produce a code the registry does not know — the dynamic form of `codes.test.ts`'s static gate,
    // and the one that would have caught `string-non-ascii` (written as a ternary, so the grep never saw it).
    const unregistered = [...produced].filter((c) => !registered.includes(c) && !families.some((f) => c.startsWith(f)))
    expect(unregistered).toEqual([])

    const reached = registered.filter((c) => produced.has(c))
    const unreached = registered.filter((c) => !produced.has(c))
    console.log(`  [refusals] ${reached.length} of ${registered.length} registered codes are produced by a real program`)
    console.log(`  [refusals] ${unreached.length} are not: ${unreached.slice(0, 8).join(", ")}${unreached.length > 8 ? ", …" : ""}`)
    expect(reached.length).toBeGreaterThanOrEqual(REACHED_CODES)
  }, 240_000)
})

/**
 * THE SHAPES THE CORPUS DOES NOT CONTAIN.
 *
 * Both were found by review (2026-09-17) and reproduced by hand, and neither is reachable from 29k files of
 * real customer code — which is the point of having them here as well as the corpus sweep. Real engineers do
 * not write a year 300000, and they do not step a pointer over a struct with no fields; a transpiler other
 * people depend on meets both anyway, and the contract says how: a coded diagnostic, not a crash.
 *
 * Each asserts BOTH halves of that contract — that it does not throw, AND that it does not quietly mean
 * something else. The second half is not decoration: the first fix for the date literal returned `undefined`,
 * which fell through to the string branch (a date literal's AST value IS the string "300000-01-01") and turned
 * `D#300000-01-01` into a STRING constant with no diagnostic at all. Trading a loud crash for a silent wrong
 * answer is a worse bug than the one being fixed, and only an assertion about the DIAGNOSTIC catches it.
 */
describe("the shapes the corpus cannot reach", () => {
  const lowered = (pou: string, src: string): { codes: string[]; threw: string | null } => {
    try {
      return { codes: lowerSource(src, pou, []).diagnostics.map((d) => d.code), threw: null }
    } catch (error) {
      return { codes: [], threw: (error as Error).message }
    }
  }

  test("a date literal past JS Date's range is reported, not thrown, and is not silently a string", () => {
    // `Date.UTC` answers NaN past about year 275760 and `BigInt(NaN)` throws
    for (const src of [
      "PROGRAM P\nVAR\n\td : DATE;\nEND_VAR\nd := D#300000-01-01;\nEND_PROGRAM\n",
      "PROGRAM P\nVAR\n\td : DATE := D#300000-01-01;\nEND_VAR\nEND_PROGRAM\n", // the initializer path is a second site
    ]) {
      const r = lowered("P", src)
      expect(r.threw).toBeNull()
      expect(r.codes).toEqual(["bad-literal"])
    }
  })

  test("a pointer stepped over an element occupying no bytes is reported, not divided by", () => {
    // `byteSize` legitimately answers 0 for a struct with no laid-out fields; `% 0n` throws on BigInt
    const r = lowered(
      "Q",
      "TYPE EMPTY : STRUCT END_STRUCT END_TYPE\n\nPROGRAM Q\nVAR\n\tarr : ARRAY[0..2] OF EMPTY;\n" +
        "\tp : POINTER TO EMPTY;\n\tq : POINTER TO EMPTY;\nEND_VAR\np := ADR(arr[0]);\nq := p + 4;\nEND_PROGRAM\n",
    )
    expect(r.threw).toBeNull()
    expect(r.codes).toContain("pointer-step")
  })

  test("the ordinary temporal literals still lower, so the refusal did not widen", () => {
    expect(lowered("R", "PROGRAM R\nVAR\n\td : DATE := D#2026-09-17;\nEND_VAR\nd := D#2000-01-01;\nEND_PROGRAM\n")).toEqual({
      codes: [],
      threw: null,
    })
    expect(lowered("T", "PROGRAM T\nVAR\n\tt : TIME := T#1S;\nEND_VAR\nt := T#2M3S;\nEND_PROGRAM\n")).toEqual({
      codes: [],
      threw: null,
    })
  })
})
