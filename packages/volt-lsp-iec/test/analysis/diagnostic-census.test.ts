/**
 * THE ANALYSIS MEASURED — does every diagnostic the LSP's analysis gives say what the vendor's build said, per check and
 * per message builder? (openspec analysis-conformance, tasks 0.1–0.3; design.md §6.)
 *
 * `census.ts` runs every registry check over every conformance fixture as the replay binds it, on both vendors, and
 * over the six corpora as the server analyses them, and matches each finding against the recorded build: TP, SEV
 * (right message, other severity), FP (LSP-only; `div` where the replay pins the fixture as a divergence) and GAP
 * (IDE-only, attributed to the builder whose shape it has, or `unowned`). What it counts is pinned in `baselines/`:
 *
 *   fixtures.codesys.json / fixtures.twincat.json   per check, per builder, per group; the FP / SEV / GAP lines
 *   corpus.json                                     per project and per code; the FP / SEV / GAP lines
 *   coverage.json                                   the builders with no TP on a vendor, the checks firing on no fixture
 *   ceilings.json                                   open FP, GAP, unowned GAP and never-fired builders, per vendor and
 *                                                   per group — they may only fall (`test/frontend/baseline.test.ts`
 *                                                   holds this file to its history too)
 *
 * A new finding fails, and so does one that vanished, until the baseline says so: `VOLT_WRITE_BASELINE=1` rewrites them
 * (refusing a ceiling that rose). `VOLT_CENSUS_REPORT=1` prints the per-row table.
 *
 * Network text is ON (the test preload) and the network-text pass, which is outside the registry while design.md §3 is
 * parked, is the census's one row with no registry entry.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { CHECK_REGISTRY } from "../../src/analysis/index.js"
import { checkBaseline } from "../frontend/baseline.js"
import { readFileSync } from "node:fs"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import {
  builderOwners,
  corpusCode,
  corpusSeverity,
  matchMultiset,
  NETWORK_ROW,
  recordingMessages,
  registryRows,
  runCensus,
  shapeOf,
  unownedClass,
  VENDORS,
} from "./census.js"

const DIR = join(import.meta.dir, "baselines")
/** The whole census walks ~4,600 fixtures twice and the six corpora once (the corpus pass is shared with `corpus.test.ts`). */
const CENSUS_TIMEOUT = 600_000

describe("the census's own rules", () => {
  test("matching is a multiset: a repeat beyond what was recorded is FP, a severity mismatch is SEV, the rest of the recording is GAP", () => {
    const lsp = [
      { severity: "error", message: "a" },
      { severity: "error", message: "a" },
      { severity: "warning", message: "b" },
      { severity: "error", message: "c" },
    ]
    const ide = [
      { severity: "error", message: "a" },
      { severity: "error", message: "b" },
      { severity: "warning", message: "d" },
    ]
    const r = matchMultiset(lsp, ide, (m) => m)
    expect(r.tp.map((f) => f.message)).toEqual(["a"])
    expect(r.sev.map((f) => f.message)).toEqual(["b"])
    expect(r.fp.map((f) => f.message)).toEqual(["a", "c"])
    expect(r.gap.map((f) => f.message)).toEqual(["d"])
  })

  test("a shape is the normalized message with every quoted part elided", () => {
    expect(shapeOf("Cannot convert type 'INT' to type 'BOOL'")).toBe("Cannot convert type '…' to type '…'")
    expect(shapeOf("The code 'x\t\t;\r\n' has no effect")).toBe("The code '…' has no effect")
  })

  test("an unowned shape lands in exactly one class", () => {
    expect(unownedClass("';' expected instead of '…'")).toBe("owned-by-frontend")
    expect(unownedClass("No memory for dynamic object creation")).toBe("project-config")
    expect(unownedClass("Some rule nobody wrote a check for")).toBe("missing-rule")
    // the device's memory segment (task 3.11 reclassified it from missing-rule)
    expect(unownedClass("The variable '…' is too large. (variable size: 2147483647, segment size: 2147483647)")).toBe("project-config")
  })
})

describe("attribution is a fact, never a guess", () => {
  test("a builder a shared helper calls is owned by every check that calls the helper (rules.ts conversionWarning)", () => {
    const owners = builderOwners().get("narrowing")!
    for (const check of ["checkCallArguments", "checkIntrinsicOperands", "checkNarrowingConversion"]) expect(owners.has(check)).toBe(true)
  })

  test("a builder's text is remembered only for the window it was produced in: no later finding inherits it", () => {
    const rec = recordingMessages("codesys")
    const text = rec.messages.parenExpectedInsteadOf(":")
    expect(rec.take().get(text)).toBe("parenExpectedInsteadOf")
    // the next window — another check, another document, another fixture — did not call it: the same wording there is not its
    expect(rec.take().get(text)).toBeUndefined()
  })

  test("a corpus finding with no severity, or a codeless one the server is not known to give, is refused by name", () => {
    expect(() => corpusSeverity(undefined)).toThrow(/no severity/)
    expect(corpusSeverity(1)).toBe("error")
    expect(corpusSeverity(2)).toBe("warning")
    const noCode = (message: string) => ({ message })
    expect(
      corpusCode(noCode("'FB_X' states no language: its body opens with no 'IMPLEMENTATION <ST|LD|FBD>' line, so the file …")),
    ).toBe("server:missing-language")
    // a parse error reaches the server's output with its code only (2.5): a codeless one is no longer a known finding
    expect(() => corpusCode(noCode("';' expected instead of 'x'"))).toThrow(/codeless server finding/)
    expect(() => corpusCode(noCode("a quiet-body note nobody named"))).toThrow(/codeless server finding/)
    expect(corpusCode({ message: "anything", code: "C0032" })).toBe("C0032")
  })
})

describe("the census rows are exactly the registry's entries", () => {
  test("every registry check is one row, defined in one file of a group folder; the network-text pass is the one extra row", () => {
    const rows = registryRows()
    const names = rows.map((r) => r.check)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((n) => n !== NETWORK_ROW).sort()).toEqual(CHECK_REGISTRY.map((c) => c.name).sort())
    expect(rows.filter((r) => r.check !== NETWORK_ROW && !/^src\/analysis\/checks\/[a-z-]+\/[a-z-]+\.ts$/.test(r.file))).toEqual([])
  })

  test(
    "the census measures every fixture the replay compares — a fixture whose code sits only in PLC_PRG among them",
    () => {
      const census = runCensus()
      for (const vendor of VENDORS) {
        const build = JSON.parse(readFileSync(join(import.meta.dir, "..", "conformance", "recordings", `${vendor}.build.json`), "utf8")) as {
          tests: Record<string, unknown>
        }
        expect(census.report.measured[vendor]).toBe(ALL_TESTS.filter((t) => build.tests[t.name] !== undefined).length)
      }
    },
    CENSUS_TIMEOUT,
  )

  test(
    "every row the census counts is a registry row, on both vendors",
    () => {
      const census = runCensus()
      for (const vendor of VENDORS)
        expect([...census.report.rows[vendor].keys()].sort()).toEqual(registryRows().map((r) => r.check).sort())
    },
    CENSUS_TIMEOUT,
  )
})

describe("the census against its baselines", () => {
  for (const vendor of VENDORS)
    test(`fixtures, ${vendor}`, () => checkBaseline(`fixtures.${vendor}`, runCensus().fixtures[vendor], DIR), CENSUS_TIMEOUT)
  test("corpora", () => checkBaseline("corpus", runCensus().corpus, DIR), CENSUS_TIMEOUT)
  test("coverage", () => checkBaseline("coverage", runCensus().coverage, DIR), CENSUS_TIMEOUT)
})

if (process.env.VOLT_CENSUS_REPORT === "1")
  test(
    "report",
    () => {
      const census = runCensus()
      const rows = registryRows()
      for (const vendor of VENDORS) {
        console.log(`\n[${vendor}] ${census.report.measured[vendor]} fixtures measured`)
        console.log("group\tcheck\tfired\tTP\tSEV\tFP\tdiv\tGAP")
        for (const r of rows) {
          const t = census.report.rows[vendor].get(r.check)!
          console.log(`${r.group}\t${r.check}\t${t.fired}\t${t.TP}\t${t.SEV}\t${t.FP}\t${t.div}\t${t.GAP}`)
        }
      }
    },
    CENSUS_TIMEOUT,
  )
