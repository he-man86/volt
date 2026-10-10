/**
 * The refusal registry is only worth having if it is COMPLETE, and completeness is not something a hand-written
 * table stays at. Two gates keep it honest:
 *
 *   1. every code the lowering actually emits resolves in the registry — a new `bail` with a new slug fails
 *      here rather than quietly becoming an unregistered 99th code;
 *   2. the `unclassified` count only ever goes DOWN.
 *
 * The second is a ratchet rather than a demand for zero, because classifying all 98 in one sitting would mean
 * reading each call site and deciding what it means to a user — which is the confident guessing this component
 * has already paid for twice today. A wrong `kind` is worse than an absent one: it sends someone to fix ST that
 * is already correct, or to wait for a release that will never mention their case.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { FAMILY_EXCEPTIONS, LOWER_CODES, LOWER_CODE_PREFIXES, lowerCodeKind } from "./codes.js"
import { lowerDiagnostic } from "./diagnostic.js"
import { Lowering } from "../core/lowering.js"
import { LoweringBug } from "../../semantics/faults.js"
import type { Scope } from "../../../frontend/symbols/index.js"

const LOWER_DIR = join(import.meta.dir, "..")

/**
 * Every literal code that appears in a `bail(…)` / `fail(…)` / `code:` position under `lower/`.
 *
 * The code ARGUMENT is read whole, not just a literal sitting immediately after the paren, because it does not have
 * to be one: `bail(wide ? "wstring-surrogate" : "string-non-ascii", …)` is two codes, and a pattern anchored at `(`
 * saw neither. Both were unregistered, and this gate — whose entire job is to catch that — passed. A computed code is
 * exactly the kind that gets forgotten, so it is the kind this must read.
 */
function lowerSources(dir: string = LOWER_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return lowerSources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [readFileSync(path, "utf8")] : []
  })
}

function emittedCodes(): string[] {
  const found = new Set<string>()
  for (const src of lowerSources()) {
    // the first argument of each call, up to the comma that ends it — then every quoted slug inside it
    for (const m of src.matchAll(/(?:bail|fail|lowerDiagnostic)\(\s*(?:pending,\s*)?([^,\n]*)/g))
      for (const lit of m[1]!.matchAll(/"([a-z0-9_-]+)"/g)) found.add(lit[1]!)
    for (const m of src.matchAll(/code:\s*"([a-z0-9_-]+)"/g)) found.add(m[1]!)
  }
  return [...found].sort()
}

/** Every TEMPLATED code, as its prefix — `bail(\`expr-${e.kind}\`, …)` is a family, not a code. */
function emittedPrefixes(): string[] {
  const found = new Set<string>()
  for (const src of lowerSources()) {
    for (const m of src.matchAll(/(?:bail|fail|lowerDiagnostic)\(\s*(?:pending,\s*)?`([a-z0-9-]+?)-\$\{/g)) found.add(`${m[1]!}-`)
    for (const m of src.matchAll(/code:\s*`([a-z0-9-]+?)-\$\{/g)) found.add(`${m[1]!}-`)
  }
  return [...found].sort()
}

describe("the refusal registry covers what lowering emits", () => {
  test("every literal code is registered", () => {
    const unregistered = emittedCodes().filter((c) => lowerCodeKind(c) === undefined)
    // the names, not a count — an unregistered code is one line of work and the message should say which
    expect(unregistered).toEqual([])
  })

  test("every templated family is registered as a prefix", () => {
    const known = LOWER_CODE_PREFIXES.map((p) => p.prefix)
    expect(emittedPrefixes().filter((p) => !known.includes(p))).toEqual([])
  })

  test("the registry holds no code lowering no longer emits", () => {
    // a dead entry is how a registry stops describing the thing it registers
    const emitted = new Set(emittedCodes())
    expect(Object.keys(LOWER_CODES).filter((c) => !emitted.has(c))).toEqual([])
  })

  /**
   * THE RATCHET. Lower it when codes are classified; it may never rise. A new code that arrives unclassified
   * fails here, which is the point — the moment to decide what a refusal MEANS is when it is written, while the
   * person who wrote it still knows.
   */
  test("the unclassified count only goes down", () => {
    const unclassified = Object.values(LOWER_CODES).filter((k) => k === "unclassified").length
    expect(unclassified).toBeLessThanOrEqual(83)
  })
})

describe("an unregistered code is a lowering bug, never a kind (1.7.16, design P8)", () => {
  test("bail and lowerDiagnostic throw LoweringBug on a code the registry does not hold", () => {
    const lw = new Lowering({} as Scope, {} as Scope)
    const span = undefined as never
    expect(() => lw.bail("no-such-refusal", "m", span)).toThrow(LoweringBug)
    expect(() => lowerDiagnostic("no-such-refusal", "m", span)).toThrow(LoweringBug)
    expect(lw.diagnostics).toEqual([])
    // a registered code and a templated family answer their kind
    lw.bail("parse", "m", span)
    lw.bail("stmt-not_a_kind", "m", span)
    expect(lw.diagnostics.map((d) => d.kind)).toEqual([lowerCodeKind("parse")!, "not-modelled"])
  })
})

describe("an exact code agrees with its prefix family, or says why not (transpile-restructure 6.A.8)", () => {
  // `routine-var_output` was `unclassified` beside the `routine-` family's `not-measured`, and `layout-recursive` `invalid`
  // beside `layout-`'s `not-modelled`: a user reading the family's note was told the opposite of what the code meant.
  const familyOf = (code: string) => LOWER_CODE_PREFIXES.find((p) => code.startsWith(p.prefix))

  test("every exact code inside a family has the family's kind, or a written reason in FAMILY_EXCEPTIONS", () => {
    const disagreeing = Object.entries(LOWER_CODES)
      .filter(([code, kind]) => familyOf(code) !== undefined && familyOf(code)!.kind !== kind)
      .map(([code]) => code)
    expect(disagreeing.filter((code) => FAMILY_EXCEPTIONS[code] === undefined)).toEqual([])
  })

  test("every exception names a registered code that still differs from its family", () => {
    const stale = Object.keys(FAMILY_EXCEPTIONS).filter((code) => {
      const kind = LOWER_CODES[code]
      const family = familyOf(code)
      return kind === undefined || family === undefined || family.kind === kind
    })
    expect(stale).toEqual([])
  })
})
