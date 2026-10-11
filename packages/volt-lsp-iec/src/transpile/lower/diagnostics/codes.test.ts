/**
 * The refusal registry is only worth having if it is COMPLETE, and completeness is not something a hand-written
 * table stays at. Two gates keep it honest:
 *
 *   1. every code the lowering actually emits resolves in the registry — a new `bail` with a new slug fails
 *      here rather than quietly becoming an unregistered 99th code;
 *   2. every code has one of the three kinds.
 *
 * The second was a RATCHET on an `unclassified` kind, from 83 down, while each code got its kind from evidence rather
 * than from reading its call sites (openspec transpile-refusal-classification): a wrong `kind` is worse than an absent
 * one — it sends someone to fix ST that is already correct, or to wait for a release that will never mention their
 * case. It reached 0 and the kind is gone from `LowerCodeKind`; a new code is classified when it is written.
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

/**
 * The CODE ARGUMENT of every `bail(…)` / `fail(…)` / `lowerDiagnostic(…)` call in `src`: the first argument that is not a
 * bare name (`fail(lw, pending, code, …)` passes two first), read to the comma that ENDS it at its own depth — a code chosen
 * by a call, `bail(brokenAtLibrary(lw, unit) ? "call-library" : "base-unresolved", …)`, has commas of its own, and reading
 * to the first comma saw neither slug (transpile-refusal-classification 2.1).
 */
export function codeArguments(src: string): string[] {
  const found: string[] = []
  for (const m of src.matchAll(/\b(?:bail|fail|lowerDiagnostic)\(/g)) {
    const args: string[] = []
    let depth = 0
    let quote: string | undefined
    let start = m.index + m[0].length
    for (let i = start; i < src.length; i++) {
      const c = src[i]!
      if (quote !== undefined) {
        if (c === "\\") i++
        else if (c === quote) quote = undefined
        continue
      }
      if (c === '"' || c === "'" || c === "`") quote = c
      else if (c === "(" || c === "[" || c === "{") depth++
      else if ((c === ")" || c === "]" || c === "}") && depth > 0) depth--
      else if ((c === "," || c === ")") && depth === 0) {
        args.push(src.slice(start, i).trim())
        if (c === ")") break
        start = i + 1
      }
    }
    const code = args.find((a) => !/^[A-Za-z_$][\w$]*$/.test(a))
    if (code !== undefined) found.push(code)
  }
  return found
}

function emittedCodes(): string[] {
  const found = new Set<string>()
  for (const src of lowerSources()) {
    // the code argument of each call, whole — then every quoted slug inside it
    for (const arg of codeArguments(src)) for (const lit of arg.matchAll(/"([a-z0-9_-]+)"/g)) found.add(lit[1]!)
    for (const m of src.matchAll(/code:\s*"([a-z0-9_-]+)"/g)) found.add(m[1]!)
  }
  return [...found].sort()
}

test("the code argument is read whole, past the commas of a call that chooses it", () => {
  const src = 'lw.bail(brokenAtLibrary(lw, unit) ? "call-library" : "base-unresolved", `a ${x}, b`, span)\n' + 'fail(lw, pending, f(a, b) ? "p-one" : "p-two", "m", span)\n' + 'lw.bail("plain", "m, with a comma", span)'
  expect(codeArguments(src)).toEqual(['brokenAtLibrary(lw, unit) ? "call-library" : "base-unresolved"', 'f(a, b) ? "p-one" : "p-two"', '"plain"'])
})

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
   * The ratchet that stood here counted the `unclassified` kind down to 0 (transpile-refusal-classification 2.2) — the
   * moment to decide what a refusal MEANS is when it is written, while the person who wrote it still knows.
   */
  test("every code has one of the three kinds", () => {
    const kinds = new Set(["invalid", "not-modelled", "not-measured"])
    expect(Object.entries(LOWER_CODES).filter(([, k]) => !kinds.has(k)).map(([c]) => c)).toEqual([])
    expect(LOWER_CODE_PREFIXES.filter((p) => !kinds.has(p.kind)).map((p) => p.prefix)).toEqual([])
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
