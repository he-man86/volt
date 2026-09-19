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
 *
 * ONE WALK, SEVERAL QUESTIONS. Walking the corpus costs about a minute, and `ir-coverage.test.ts` used to walk it a
 * second time to ask which IR the suite builds — the same files, the same symbol tables, the same `lowerUnit` call,
 * for a different tally. Both tallies ride this walk now. Two walks is not only slow: under load the second one blew
 * its own 240s timeout while passing in 66s alone, which reads as a failure in whatever test happened to be running.
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
import type { IrPou, IrRoutine, IrStmt } from "../../src/transpile/ir/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture, withDependencies } from "./support/fixture-units.js"
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
/** Every node kind the IR defines — `IrExpr` and `IrStmt`, from `ir.ts`. Kept by hand so ADDING one shows up here. */
const EXPR_KINDS = ["const", "load", "binary", "unary", "convert", "builtin", "invoke", "dispatch"] as const
const STMT_KINDS = ["assign", "if", "switch", "loop", "break", "continue", "return", "call", "eval"] as const
const BUILTINS = [
  "max", "min", "limit", "sel", "trunc", "abs", "expt", "shl", "shr", "rol", "ror", "mux",
  "sqrt", "ln", "log", "exp", "sin", "cos", "tan", "asin", "acos", "atan",
  "len", "left", "right", "mid", "concat", "insert", "delete", "replace", "find",
] as const

/**
 * Floors, measured 2026-09-18: EVERY node kind and EVERY builtin is built by something. That is the good outcome and
 * it is worth pinning at full — there is no arm of either backend's `switch` that no test has ever reached.
 */
const COVERED_EXPR_KINDS = 8
const COVERED_STMT_KINDS = 9
const COVERED_BUILTINS = 31

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
// 80 -> 79 because a refusal was RETIRED, not because one became unreachable: `var-temp-composite` refused a
// composite VAR_TEMP as "starting it over is not built", and `declarations/section-semantics.ts` measured that it
// behaves exactly as a scalar does (an ARRAY in VAR_TEMP counts 1 after three scans, a VAR one counts 3). The code
// is gone from the registry, so both totals drop by one. The floor only ever goes UP for a code that stops being
// produced; it comes down only when a code stops existing.
// 79 -> 78 for the same reason again: `value-string-order` refused MAX/MIN/LIMIT over a STRING because nothing
// recorded what the vendor orders two strings by. `strings/ordering.ts` recorded it — UNSIGNED, byte by byte, a
// prefix losing — so the refusal is retired and both totals drop by one.
const REACHED_CODES = 78

/** Every `kind` and every builtin `name` anywhere in a value, however nested. */
function collect(node: unknown, kinds: Set<string>, builtins: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, kinds, builtins)
    return
  }
  if (node === null || typeof node !== "object") return
  const record = node as Record<string, unknown>
  if (typeof record.kind === "string") kinds.add(record.kind)
  if (record.kind === "builtin" && typeof record.name === "string") builtins.add(record.name)
  for (const [key, child] of Object.entries(record)) {
    if (key === "type" || key === "span") continue // a Type has its own `kind`, which is not an IR node's
    collect(child, kinds, builtins)
  }
}

function fromPou(pou: IrPou, kinds: Set<string>, builtins: Set<string>): void {
  collect(pou.body as readonly IrStmt[], kinds, builtins)
  collect((pou.init ?? []) as readonly IrStmt[], kinds, builtins)
  for (const r of (pou.routines ?? []) as readonly IrRoutine[]) collect(r.body, kinds, builtins)
  for (const l of pou.layouts ?? []) collect(l.body ?? [], kinds, builtins)
}

/** ONE walk, every question: did anything throw, how much is reached, which refusals fire, and which IR is built. */
function overCorpus(): { failures: string[]; bodies: number; lowered: number; codes: Set<string>; kinds: Set<string>; builtins: Set<string> } {
  const failures: string[] = []
  const codes = new Set<string>()
  const kinds = new Set<string>()
  const builtins = new Set<string>()
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
          if (pou !== undefined) fromPou(pou, kinds, builtins)
        } catch (error) {
          const name = "name" in unit && unit.name !== undefined ? String((unit.name as { text: string }).text) : "?"
          failures.push(`${relative(CORPUS, file)} :: ${name} — ${(error as Error).message}`)
        }
      }
    }
  }
  return { failures, bodies, lowered, codes, kinds, builtins }
}

describe("the contracts src/transpile/index.ts states, measured over the corpus", () => {
  // One walk of 29k files, shared by both assertions and done on first use — a `beforeAll` has its own
  // timeout that an 80-second sweep quietly blows, and the failure it produces names no test.
  let cached: ReturnType<typeof overCorpus> | undefined
  const result = (): ReturnType<typeof overCorpus> => (cached ??= overCorpus())

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
      const { source: source, gvls } = assembleFixture(t, ALL_TESTS)
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

  /**
   * The corpus walk's IR, plus the FIXTURES'. Both are needed and neither is enough: `dispatch` (a call through an
   * interface), `break` and `continue` appear in fixtures the corpus has no equivalent of, and the corpus reaches
   * shapes no fixture was written for. Memoized, so the fixtures are lowered once for all three tests below.
   */
  let irCache: { kinds: Set<string>; builtins: Set<string> } | undefined
  const builtIr = (): { kinds: Set<string>; builtins: Set<string> } => {
    if (irCache !== undefined) return irCache
    const kinds = new Set(result().kinds)
    const builtins = new Set(result().builtins)
    for (const t of ALL_TESTS) {
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      try {
        const { pou } = lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls])
        if (pou !== undefined) fromPou(pou, kinds, builtins)
      } catch {
        // a fixture that throws is `TOTALITY`'s to report, not this one's
      }
    }
    irCache = { kinds, builtins }
    return irCache
  }

  test("EXPRESSION kinds — an arm no test reaches is an arm free to be wrong", () => {
    const { kinds } = builtIr()
    const missing = EXPR_KINDS.filter((k) => !kinds.has(k))
    console.log(`  [ir] expressions ${EXPR_KINDS.length - missing.length}/${EXPR_KINDS.length}${missing.length ? ` — never built: ${missing.join(", ")}` : ""}`)
    expect(EXPR_KINDS.length - missing.length).toBeGreaterThanOrEqual(COVERED_EXPR_KINDS)
  }, 240_000)

  test("STATEMENT kinds", () => {
    const { kinds } = builtIr()
    const missing = STMT_KINDS.filter((k) => !kinds.has(k))
    console.log(`  [ir] statements ${STMT_KINDS.length - missing.length}/${STMT_KINDS.length}${missing.length ? ` — never built: ${missing.join(", ")}` : ""}`)
    expect(STMT_KINDS.length - missing.length).toBeGreaterThanOrEqual(COVERED_STMT_KINDS)
  }, 240_000)

  test("BUILTINS — each is a switch arm in BOTH backends", () => {
    const { builtins } = builtIr()
    const missing = BUILTINS.filter((b) => !builtins.has(b))
    console.log(`  [ir] builtins ${BUILTINS.length - missing.length}/${BUILTINS.length}${missing.length ? ` — never built: ${missing.join(", ")}` : ""}`)
    expect(BUILTINS.length - missing.length).toBeGreaterThanOrEqual(COVERED_BUILTINS)
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
