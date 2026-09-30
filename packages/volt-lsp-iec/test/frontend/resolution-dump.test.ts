/**
 * 0.3 RESOLUTION — does every identifier bind to a declaration, and does the LSP say "not defined", "ambiguous" and
 * "no component" exactly where the vendor does?
 *
 * The dump (`dumps.ts` `resolutionDump`) binds every identifier occurrence of every corpus file, fixture and library body
 * to its declaration, or to NONE (nothing binds it), NOSCOPE (its unit binds no scope) or NO-CALLEE (a named argument
 * whose callee does not resolve). The corpus builds, so every NONE there is a finding; they are pinned as counts per
 * shape. The fixtures' are pinned one by one.
 *
 * The fixtures are bound once per vendor, parsed as that vendor. Then the messages, both directions: every resolution
 * message the LSP gives for a fixture (`support/evidence.ts` `lspErrors`, the replay's own walk, once per vendor
 * against that vendor's build) or a corpus project (`corpus/support/diagnostics.ts`, the server's own pass) that the
 * vendor's build did not record, and every one the build recorded that the LSP does not give.
 */
import { describe, expect, test } from "bun:test"
import { lspErrors } from "../conformance/support/evidence.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { projectDocuments } from "../corpus/support/diagnostics.js"
import { checkBaseline, tally } from "./baseline.js"
import { boundCensus } from "./bound-census.js"
import { corpusProjects, fixtureSources, normMessage } from "./sources.js"

/** The resolution messages: "Identifier 'x' not defined", "Ambiguous use of name 'x'", "'m' is no component of 'T'". */
const RESOLUTION_MESSAGE = /Identifier '.*' not defined|[Aa]mbiguous use of name '|' is no component of '/

/** Both directions of one source's resolution messages, as multisets of normalized text. */
function compare(
  vendor: string,
  where: string,
  lsp: readonly string[],
  recorded: readonly string[],
  counts: Record<string, number>,
  findings: string[],
): void {
  const left = lsp.filter((m) => RESOLUTION_MESSAGE.test(m)).map(normMessage)
  const right = recorded.filter((m) => RESOLUTION_MESSAGE.test(m)).map(normMessage)
  const key = (what: string): string => `messages ${vendor}: ${what}`
  tally(counts, key("LSP"), left.length)
  tally(counts, key("recorded"), right.length)
  const pending = [...right]
  for (const m of left) {
    const i = pending.indexOf(m)
    if (i >= 0) {
      pending.splice(i, 1)
      tally(counts, key("both"))
    } else {
      tally(counts, key("LSP only"))
      findings.push(`${where}: LSP only ${JSON.stringify(m)}`)
    }
  }
  for (const m of pending) {
    tally(counts, key("recorded only"))
    findings.push(`${where}: recorded only ${JSON.stringify(m)}`)
  }
}

describe("0.3 resolution", () => {
  test("the fixtures are bound and measured on both vendors", () => {
    const keys = Object.keys(boundCensus().resolution)
    expect(keys.some((k) => k.startsWith("fixtures codesys: "))).toBe(true)
    expect(keys.some((k) => k.startsWith("fixtures twincat: "))).toBe(true)
  }, 240_000)

  test("every identifier binds; resolution messages agree with the recordings both ways — the rest is the baseline's", () => {
    const census = boundCensus()
    const counts: Record<string, number> = { ...census.resolution }
    const findings = [...census.fixtureUnresolved]
    for (const vendor of ["codesys", "twincat"] as const)
      for (const f of fixtureSources()) {
        const build = vendor === "codesys" ? f.codesys : f.twincat
        if (build === undefined) continue
        compare(
          vendor,
          `fixture ${vendor} ${f.test.name}`,
          lspErrors(f.test, ALL_TESTS, vendor),
          build.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
          counts,
          findings,
        )
      }
    for (const p of corpusProjects()) {
      if (p.build === undefined) continue
      const lsp = projectDocuments(p.dir, p.vendor).flatMap((d) => d.diagnostics.map((x) => x.message))
      compare(
        p.vendor,
        `corpus ${p.name}`,
        lsp,
        p.build.diagnostics.map((d) => d.message),
        counts,
        findings,
      )
    }
    console.log(
      ["", "resolution (0.3)", ...Object.entries(counts).map(([k, v]) => `  ${String(v).padStart(7)}  ${k}`)].join(
        "\n",
      ),
    )
    checkBaseline("resolution-dump", { counts, findings })
  }, 240_000)
})
