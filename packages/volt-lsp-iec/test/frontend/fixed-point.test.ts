/**
 * 0.2 THE PRINTER'S FIXED POINT — does printing change nothing, and does printing twice print the same?
 *
 * Over everything 0.1 parses (every corpus file, every fixture's own item and PLC_PRG, every library body), two printers:
 *
 *   the FORMATTER   `format(x)` re-parses, as the same source object (its uri), with no parse error `x` does not
 *                   already carry, to the same AST (spans and tokens aside, bodies compared as statements), and
 *                   `format(format(x)) === format(x)`;
 *   `exprText`      every maximal expression prints to a text that parses back as an expression printing the same —
 *                   save one holding its source's own parse error (`dumps.ts` `refusedIn`), which has no fixed point.
 *
 * The printer is Volt's, not the vendor's, so there is no recording to hold it to: a fixed point is the whole rule
 * (design.md §4 2.9, PR1). Each non-fixed-point is a finding pinned in `baselines/fixed-point.json`; PR1 stays a GAP
 * until that list is empty.
 */
import { describe, expect, test } from "bun:test"
import { checkBaseline, tally, type Baseline } from "./baseline.js"
import { parse, printFindings, type Parsed } from "./dumps.js"
import { corpusProjects, fixtureSources, libraryRepoFiles } from "./sources.js"

const clip = (s: string): string => (s.length > 140 ? `${s.slice(0, 140)}…` : s)

function census(): Baseline {
  const counts: Record<string, number> = {}
  const findings: string[] = []
  const measure = (group: string, p: Parsed): void => {
    tally(counts, `${group}: files`)
    const found = printFindings(p)
    if (found.length > 0) tally(counts, `${group}: files not a fixed point`)
    for (const f of found) {
      tally(counts, `${group}: ${f.kind}`)
      findings.push(`${p.id} ${f.kind} ${f.at} ${clip(f.detail)}`)
    }
  }
  for (const project of corpusProjects())
    for (const file of project.files) measure("corpus", parse(file, project.vendor))
  for (const f of fixtureSources()) for (const s of [f.own, f.plc]) measure("fixtures", parse(s, "codesys"))
  for (const file of libraryRepoFiles()) measure("library", parse(file, "codesys"))
  return { counts, findings }
}

const fixture = (name: string): Parsed => {
  const f = fixtureSources().find((x) => x.test.name === name)
  if (f === undefined) throw new Error(`no fixture ${name}`)
  return parse(f.own, "codesys")
}

describe("0.2 what counts as a printer finding", () => {
  test("the re-parse reads the formatted text as the same source object — a byte-identical .struct is no finding", () => {
    // `.struct` reads the IMPLEMENTATION-named member as written; a bare `parseSource` does not know the object.
    const p = fixture("pwh_struct_member_implementation")
    expect(printFindings(p)).toEqual([])
  })
  test("a source's own parse error, reproduced by the formatter, is not a printer failure", () => {
    const p = fixture("cc_decl_init_trailing_ident")
    expect(p.parseResult.errors.length).toBeGreaterThan(0)
    expect(printFindings(p).filter((f) => f.kind === "format-reparse-errors")).toEqual([])
  })
})

describe("0.2 the printer's fixed point", () => {
  test("every file prints to itself — the non-fixed points are the baseline's", () => {
    const measured = census()
    console.log(
      [
        "",
        "printer fixed point (0.2)",
        ...Object.entries(measured.counts).map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`),
      ].join("\n"),
    )
    checkBaseline("fixed-point", measured)
  }, 60_000)
})
