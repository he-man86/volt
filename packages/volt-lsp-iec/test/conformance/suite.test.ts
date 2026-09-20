/**
 * IS ENOUGH BEING ASKED? — the one question the suite cannot answer about itself.
 *
 * Every other gate in this tier checks an ANSWER: replay compares a fixture against the vendor, transpile asks
 * whether it lowers, backends asks whether two implementations agree. All of them iterate the fixtures, so a
 * question nobody wrote is invisible to every one of them — there is no row for it to fail in. The corpus does not
 * help either: real projects contain no invalid code, and only the constructs their authors happened to use.
 *
 * So the denominator has to come from somewhere that is NOT the suite. There are exactly three such authorities,
 * and this file is all three:
 *
 *   THE LANGUAGE  `support/census.ts` derives CELLS from the elementary-type table, the operator table and the
 *                 vendor's reference — a grid of questions that exists whether or not anyone answered it.
 *   OUR GRAMMAR   `BINARY_PRECEDENCE` plus the operators outside it. An operator the parser accepts and no fixture
 *                 exercises fails here. That is how `**` (not an operator in CODESYS) and chained `S=`/`R=` (valid,
 *                 and rejected by our parser) stayed unnoticed until the execution oracle compiled them; when first
 *                 measured, 2026-09-14, `/`, `<=`, `&`, `XOR`, `AND_THEN` and `OR_ELSE` had none.
 *   THE VENDOR    `docs/codesys-reference/03-operators.md`, the vendor's own closed list, embedded here. This is
 *                 IEC-as-INDEX rather than IEC-as-oracle: it says what EXISTS, never what it means. It is the one
 *                 coverage question whose denominator nobody here chose.
 *
 * NONE OF THEM ASSERTS SEMANTICS. What CODESYS does with a construct is the recordings' business; this asks only
 * whether anybody has put the question.
 *
 * These were two files (`census.test.ts`, `construct-coverage.test.ts`) that had never been filed as the one
 * concern they are. The grammar and vendor halves had each hand-rolled "is this mentioned in a fixture?" — one by
 * lexing, one by a regex with a word-boundary workaround; they share the lexer, which is exact where the regex was
 * approximate: `<=` is one token, and `SIZEOF` does not match inside `XSIZEOF`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BINARY_PRECEDENCE } from "../../src/syntax/expression.js"
import { lex } from "../../src/syntax/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { CELLS, PLANNED, closure } from "./support/census.js"

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

describe("OUR GRAMMAR and THE VENDOR — every construct either list names", () => {
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

/**
 * A RATCHET, not a wish list. A cell is only defined once its family is built, so this is green today and stays
 * green; what keeps the UNBUILT topics honest is `PLANNED`, which the report prints beside the closed count. A
 * topic in NEITHER list is the failure this exists to prevent, and `openspec/changes/fixture-census/operations.md`
 * is the long form of that list.
 */
describe("THE LANGUAGE — every cell the topic tree defines", () => {
  test("every defined cell has a fixture", () => {
    const { missing } = closure(ALL_TESTS)
    expect(missing.map((c) => `${c.topic}/${c.subtopic}: ${c.slug}`)).toEqual([])
  })

  test("every defined cell has an answer from the vendor", () => {
    const { unanswered } = closure(ALL_TESTS)
    expect(unanswered.map((c) => `${c.topic}/${c.subtopic}: ${c.slug}`)).toEqual([])
  })

  test("the report — what is measured, and what is not even asked yet", () => {
    const { closed } = closure(ALL_TESTS)
    const byTopic = new Map<string, Map<string, number>>()
    for (const c of closed) {
      const subs = byTopic.get(c.topic) ?? new Map<string, number>()
      subs.set(c.subtopic, (subs.get(c.subtopic) ?? 0) + 1)
      byTopic.set(c.topic, subs)
    }
    /* eslint-disable no-console */
    console.log(`  [census] ${closed.length} cells closed across ${byTopic.size} topics`)
    for (const [topic, subs] of byTopic) {
      console.log(`  [census]   ${topic}`)
      for (const [sub, n] of subs) console.log(`  [census]     ${String(n).padStart(4)}  ${sub}`)
    }
    console.log(`  [census] ${PLANNED.length} topics have no cells defined at all:`)
    for (const p of PLANNED) console.log(`  [census]     ${p}`)
    /* eslint-enable no-console */
    // The ratchet: cells only ever get added. A drop means a family stopped generating, which the two tests above
    // name precisely — this one keeps the total from drifting down quietly while both of them stay green.
    expect(CELLS.length).toBeGreaterThanOrEqual(1307)
  })
})
