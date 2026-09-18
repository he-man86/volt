/**
 * DOES EVERY CONSTRUCT HAVE A FIXTURE? — asked of two independent authorities.
 *
 * The replay gate fails only on a FALSE POSITIVE, and its agreement ratchet counts only fixtures that already exist.
 * A construct with no fixture is therefore invisible to both, and the corpus cannot help: real projects do not
 * contain invalid code, and they contain only the constructs their authors happened to use. So the denominator has
 * to come from somewhere that is not the suite itself, and there are exactly two such places:
 *
 *   OUR GRAMMAR — `BINARY_PRECEDENCE` plus the operators that sit outside it. A new operator added to the parser
 *                 fails this until a fixture exercises it. That is how `**` (not an operator in CODESYS) and chained
 *                 `S=`/`R=` (valid, and rejected by our parser) stayed unnoticed until the execution oracle compiled
 *                 them; when first measured, 2026-09-14, `/`, `<=`, `&`, `XOR`, `AND_THEN` and `OR_ELSE` had none.
 *   THE VENDOR   — `docs/codesys-reference/03-operators.md`, the vendor's own list, embedded in this package. This
 *                 is IEC-as-INDEX rather than IEC-as-oracle: it says what EXISTS, never what it means. It is the one
 *                 coverage question whose denominator nobody here chose.
 *
 * The two were separate files that each hand-rolled "is this mentioned in a fixture?" — one by lexing, one by a
 * regex with a word-boundary workaround. They share the lexer now, which is exact where the regex was approximate:
 * `<=` is one token, and `SIZEOF` does not match inside `XSIZEOF`.
 *
 * Neither asserts semantics. What CODESYS does with a construct is the recordings' business; this asks only whether
 * anybody has put the question.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BINARY_PRECEDENCE } from "../../src/syntax/expression.js"
import { lex } from "../../src/syntax/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { plcPrgSource } from "./support/plc-prg.js"

const REFERENCE = join(import.meta.dir, "..", "..", "docs", "codesys-reference", "03-operators.md")

/** Operators outside the binary table — unary, assignment (`statements.ts` `assignOpOf`), output binding, deref. */
const OTHER_OPERATORS = ["NOT", ":=", "S=", "R=", "REF=", "=>", "^"]

/**
 * Constructs the reference lists that NO fixture exercises, each with why. Shrinking this is coverage work; naming
 * them is so a reader sees the SHAPE of what is missing rather than a number.
 *
 * The operator CALL forms (`ADD(a, b)`) and the eight operands added 2026-09-18 are NOT here: lowering refuses them,
 * but `operator_call_form_*` and `operand_*` exercise them, so the vendor's answers are recorded and they are
 * covered in this file's sense. Refused and UNEXAMINED are different states, and only the second belongs below.
 */
const NOT_COVERED: Readonly<Record<string, string>> = {
  __POOL:
    "disambiguates the POUs view from the Devices view, so exercising it needs a device tree a single-source fixture has no way to build (see 09-shadowing.md)",
}

/** Every token any fixture's ST contains, upper-cased — its source and the PLC_PRG that reaches it. */
let cachedTokens: Set<string> | undefined
function fixtureTokens(): Set<string> {
  if (cachedTokens !== undefined) return cachedTokens
  const seen = new Set<string>()
  for (const fixture of ALL_TESTS)
    for (const source of [fixture.source, plcPrgSource(fixture)])
      for (const token of lex(source)) seen.add((token.kind === "keyword" ? (token.keyword ?? token.text) : token.text).toUpperCase())
  cachedTokens = seen
  return seen
}

/** Every `| \`NAME\` |` row of the reference's operator tables — the vendor's own closed list. */
function referenceConstructs(): string[] {
  const doc = readFileSync(REFERENCE, "utf8")
  return [...new Set([...doc.matchAll(/^\|\s*`([A-Z_][A-Z0-9_]*)`/gm)].map((m) => m[1]!))]
}

describe("every construct has a fixture", () => {
  test("OUR GRAMMAR — every operator the parser accepts is exercised by one", () => {
    const operators = [...BINARY_PRECEDENCE.flatMap((row) => row.ops), ...OTHER_OPERATORS]
    const seen = fixtureTokens()
    expect(operators.filter((op) => !seen.has(op))).toEqual([])
  })

  test("THE VENDOR — every operator and standard function the reference lists resolves to a fixture or a stated gap", () => {
    const constructs = referenceConstructs()
    const seen = fixtureTokens()
    const covered = constructs.filter((op) => seen.has(op))
    const undecided = constructs.filter((op) => !seen.has(op) && NOT_COVERED[op] === undefined)

    console.log(`  [index] ${covered.length}/${constructs.length} of the reference's constructs are exercised by a fixture`)
    console.log(`  [index] ${constructs.length - covered.length} are not, and each says why`)

    // The gate: nothing may be simply unconsidered.
    expect(undecided).toEqual([])
    // and the other direction — an entry that becomes covered should leave NOT_COVERED rather than rot there
    expect(Object.keys(NOT_COVERED).filter((op) => seen.has(op))).toEqual([])
  })

  test("the reference index is actually being read", () => {
    // a guard on the gate itself: a renamed heading or a changed table format would silently empty it
    expect(referenceConstructs().length).toBeGreaterThan(50)
  })
})
