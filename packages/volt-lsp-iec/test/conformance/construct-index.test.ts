/**
 * THE CONSTRUCT INDEX — axis (c) of the coverage measurement, and IEC-as-INDEX rather than IEC-as-oracle.
 *
 * `docs/codesys-reference/03-operators.md` is the vendor's own list of operators and standard functions, embedded in
 * this package. It is a closed set someone else wrote, which makes it the one place a coverage question has a
 * denominator that is not of our choosing: every other measurement here counts what the suite happens to contain.
 *
 * The rule is that every entry RESOLVES — to a fixture that exercises it, or to an entry in `NOT_COVERED` with a
 * reason. A construct in neither is one nobody has decided about, and that is the only outcome this fails on.
 *
 * It does NOT assert semantics. What CODESYS does with a construct is the recordings' business; this asks only
 * whether we have looked at it.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "./fixtures/index.js"
import { plcPrgSource } from "./support/plc-prg.js"

const REFERENCE = join(import.meta.dir, "..", "..", "docs", "codesys-reference", "03-operators.md")

/**
 * Constructs the reference lists that NO fixture exercises, each with why. Shrinking this is coverage work; the point
 * of naming them is that a reader can see the shape of what is missing rather than a number.
 */
const NOT_COVERED: Readonly<Record<string, string>> = {
  // NOTE on the operator CALL forms (ADD, SUB, MUL, DIV, GT, LT, LE, GE, EQ, NE) and the eight operands added
  // 2026-09-18: they are NOT here. Lowering refuses them — a generic `expr-call` for the call forms — but
  // `operator_call_form_*` and `operand_*` exercise them, so the vendor's answers will be recorded and they are
  // covered in this index's sense. Refused and UNEXAMINED are different states, and only the second belongs here.
  __POOL: "disambiguates the POUs view from the Devices view, so exercising it needs a device tree a single-source fixture has no way to build (see 09-shadowing.md)",
}

/** Every `| \`NAME\` |` row of the reference's operator tables — the vendor's own closed list. */
function referenceConstructs(): string[] {
  const doc = readFileSync(REFERENCE, "utf8")
  return [...new Set([...doc.matchAll(/^\|\s*`([A-Z_][A-Z0-9_]*)`/gm)].map((m) => m[1]!))]
}

/** Everything the fixtures' ST says, upper-cased — the sources plus each fixture's PLC_PRG. */
function fixtureText(): string {
  let all = ""
  for (const t of ALL_TESTS) all += `${t.source ?? ""}\n${plcPrgSource(t)}\n`
  return all.toUpperCase()
}

describe("the CODESYS construct index", () => {
  test("every operator and standard function the reference lists resolves to a fixture or a stated gap", () => {
    const constructs = referenceConstructs()
    const text = fixtureText()
    // a word-boundary match written without `\\b`, so SIZEOF does not count XSIZEOF and AND does not count AND_THEN
    const mentions = (op: string): boolean => new RegExp(String.raw`(^|[^A-Z0-9_])${op}([^A-Z0-9_]|$)`).test(text)

    const covered = constructs.filter(mentions)
    const undecided = constructs.filter((op) => !mentions(op) && NOT_COVERED[op] === undefined)

    console.log(`  [index] ${covered.length}/${constructs.length} of the reference's constructs are exercised by a fixture`)
    console.log(`  [index] ${constructs.length - covered.length} are not, and each says why`)

    // The gate: nothing may be simply unconsidered.
    expect(undecided).toEqual([])
    // and the other direction — an entry that becomes covered should leave NOT_COVERED rather than rot there
    expect(Object.keys(NOT_COVERED).filter(mentions)).toEqual([])
  })

  test("the reference index is actually being read", () => {
    // a guard on the gate itself: a renamed heading or changed table format would silently empty it
    expect(referenceConstructs().length).toBeGreaterThan(50)
  })
})
