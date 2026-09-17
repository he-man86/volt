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
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { LOWER_CODES, LOWER_CODE_PREFIXES, lowerCodeKind } from "./codes.js"

const LOWER_DIR = join(import.meta.dir, "..", "lower")

/** Every literal code that appears in a `bail(…)` / `fail(…)` / `code:` position under `lower/`. */
function emittedCodes(): string[] {
  const found = new Set<string>()
  for (const name of readdirSync(LOWER_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue
    const src = readFileSync(join(LOWER_DIR, name), "utf8")
    for (const m of src.matchAll(/(?:bail|fail|lowerDiagnostic)\(\s*(?:pending,\s*)?"([a-z0-9_-]+)"/g)) found.add(m[1]!)
    for (const m of src.matchAll(/code:\s*"([a-z0-9_-]+)"/g)) found.add(m[1]!)
  }
  return [...found].sort()
}

/** Every TEMPLATED code, as its prefix — `bail(\`expr-${e.kind}\`, …)` is a family, not a code. */
function emittedPrefixes(): string[] {
  const found = new Set<string>()
  for (const name of readdirSync(LOWER_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue
    const src = readFileSync(join(LOWER_DIR, name), "utf8")
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
    expect(unclassified).toBeLessThanOrEqual(84)
  })
})
