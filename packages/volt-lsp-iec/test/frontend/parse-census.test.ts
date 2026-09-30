/**
 * 0.1 THE PARSE CENSUS — does the parser read what the IDEs build, and refuse only what they refuse?
 *
 * Every corpus file, every fixture's own item and PLC_PRG (once as CODESYS, once as TwinCAT) and every library body is
 * parsed as the LSP parses it, and each parse error — both passes, worded for the vendor (`dumps.ts` `parseErrors`) — is
 * held against the build that vendor recorded for it:
 *
 *   a file whose build SUCCEEDED has no parse error to match, so any is a finding;
 *   a build that FAILED matches a parse error when it recorded the same message, each recorded copy matching one
 *   parse error (a multiset, as 0.3 compares); one it did not record, or recorded fewer times, is a finding;
 *   a source nothing recorded (a library body, a fixture never put to that vendor) has no oracle, so any is a finding;
 *   a build that FAILED with a syntax-shaped message ("expected", "Unexpected token") where the LSP reports no parse
 *   error at all is a finding the other way — the parser accepting what the vendor refuses.
 *
 * The counts are the census table (openspec frontend-conformance 0.1); the findings are pinned in
 * `baselines/parse-census.json` and may only be removed by fixing the parser — or, where a vendor's recording is
 * missing, by recording it.
 */
import { describe, expect, test } from "bun:test"
import type { Dialect } from "../../src/syntax/index.js"
import { checkBaseline, tally, type Baseline } from "./baseline.js"
import { parse, parseErrors } from "./dumps.js"
import { corpusProjects, fixtureSources, libraryRepoFiles, messagePool, type RecordedBuild } from "./sources.js"

/** A recorded message that reads as a syntax refusal — to count the refusals the parser does not share (the other direction). */
const SYNTAX_MESSAGE = /expected|unexpected token/i

/** The build's messages as a multiset: each recorded copy matches ONE LSP parse error. */
const recordedPool = (b: RecordedBuild | undefined) => messagePool((b?.diagnostics ?? []).map((d) => d.message))

function census(): Baseline {
  const counts: Record<string, number> = {}
  const findings: string[] = []

  for (const project of corpusProjects()) {
    const recorded = recordedPool(project.build)
    const key = `corpus ${project.name} (${project.vendor}, build ${project.build === undefined ? "unrecorded" : project.build.buildSuccess ? "succeeded" : "failed"})`
    for (const file of project.files) {
      tally(counts, `${key}: files`)
      const errors = parseErrors(parse(file, project.vendor), project.vendor)
      if (errors.length > 0) tally(counts, `${key}: files with an LSP parse error`)
      for (const e of errors) {
        if (project.build !== undefined && recorded.take(e.message))
          tally(counts, `${key}: parse errors the build recorded`)
        else
          findings.push(
            `${file.id} ${e.pass} ${e.at} ${e.message} — ${project.build === undefined ? "no recording" : "not in the recorded build"}`,
          )
      }
    }
  }

  for (const vendor of ["codesys", "twincat"] as const satisfies readonly Dialect[]) {
    const key = `fixtures ${vendor}`
    for (const f of fixtureSources()) {
      const rec = f[vendor]
      const errors = [f.own, f.plc].flatMap((s) =>
        parseErrors(parse(s, vendor), vendor).map((e) => ({ ...e, id: s.id })),
      )
      const lsp = errors.length > 0 ? "LSP parse error" : "no LSP parse error"
      if (rec === undefined) {
        tally(counts, `${key}: unrecorded, ${lsp}`)
        for (const e of errors)
          findings.push(`${vendor} ${e.id} ${e.pass} ${e.at} ${e.message} — no ${vendor} recording`)
        continue
      }
      if (rec.buildSuccess) {
        tally(counts, `${key}: builds, ${lsp}`)
        for (const e of errors) findings.push(`${vendor} ${e.id} ${e.pass} ${e.at} ${e.message} — ${vendor} builds it`)
        continue
      }
      tally(counts, `${key}: refused, ${lsp}`)
      const syntax = rec.diagnostics.find((d) => d.severity === "error" && SYNTAX_MESSAGE.test(d.message))
      if (errors.length === 0 && syntax !== undefined) {
        // the other direction: the vendor refuses what the parser accepts — a different answer, pinned line by line
        tally(counts, `${key}: refused with a syntax message, no LSP parse error`)
        findings.push(`${vendor} fixture/${f.test.name} — ${vendor} refuses it with "${syntax.message}", the LSP reports no parse error`)
      }
      const recorded = recordedPool(rec)
      for (const e of errors) {
        if (recorded.take(e.message)) tally(counts, `${key}: parse errors ${vendor} recorded`)
        else findings.push(`${vendor} ${e.id} ${e.pass} ${e.at} ${e.message} — not among ${vendor}'s recorded messages`)
      }
    }
  }

  for (const file of libraryRepoFiles()) {
    tally(counts, "library: bodies")
    const errors = parseErrors(parse(file, "codesys"), "codesys")
    if (errors.length > 0) tally(counts, "library: bodies with an LSP parse error")
    for (const e of errors) findings.push(`${file.id} ${e.pass} ${e.at} ${e.message} — no recording (Volt's own body)`)
  }

  return { counts, findings }
}

describe("0.1 the parse census", () => {
  test("a recorded message matches one LSP parse error, not every copy of it", () => {
    const pool = messagePool(["';' expected", "';'  expected"])
    expect([pool.take("';' expected"), pool.take("';' expected"), pool.take("';' expected")]).toEqual([true, true, false])
  })

  test("every LSP parse error is one the vendor recorded — the findings are the baseline's", () => {
    const measured = census()
    console.log(
      [
        "",
        "parse census (0.1)",
        ...Object.entries(measured.counts).map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`),
        `  ${String(measured.findings.length).padStart(6)}  findings`,
      ].join("\n"),
    )
    checkBaseline("parse-census", measured)
  }, 60_000)
})
