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
 * A fixture `support/divergences.ts` pins for a vendor is counted, not measured, for that vendor (it is held there).
 * A fixture whose PUSH a vendor refuses (`vendorRefuses`) has no build recording there. On CODESYS `record:exec` loads
 * it without the push, and its refusal ("does not compile: a | b") is CODESYS's answer — measured like a build
 * (`unit_method_override`). With no such answer the push's refusal is all there is, and the fixture is counted, not
 * measured: a parse error there is neither a finding a recording could remove nor one the parser could.
 *
 * The counts are the census table (openspec frontend-conformance 0.1); the findings are pinned in
 * `baselines/parse-census.json` and may only be removed by fixing the parser — or, where a vendor's recording is
 * missing, by recording it.
 */
import { describe, expect, test } from "bun:test"
import type { Dialect } from "../../src/frontend/syntax/index.js"
import { KNOWN_DIVERGENCES } from "../conformance/support/divergences.js"
import { checkBaseline, tally, type Baseline } from "./baseline.js"
import { parse, parseErrors } from "./dumps.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { corpusProjects, fixtureSources, libraryRepoFiles, messagePool, type RecordedBuild } from "./sources.js"

/** CODESYS's `record:exec` refusals ("does not compile: a | b"), by fixture — the answer to a fixture whose push is refused. */
const EXEC_REFUSALS: ReadonlyMap<string, RecordedBuild> = new Map(
  Object.entries(
    (JSON.parse(readFileSync(join(import.meta.dir, "..", "conformance", "recordings", "codesys.run.json"), "utf8")) as {
      tests: Record<string, { error?: string }>
    }).tests,
  ).flatMap(([name, r]) =>
    r.error?.startsWith("does not compile: ") === true
      ? [[name, { buildSuccess: false, diagnostics: r.error.slice("does not compile: ".length).split(" | ").map((message) => ({ severity: "error", message })) }] as const]
      : [],
  ),
)

/**
 * A recorded message that reads as a syntax refusal — to count the refusals the parser does not share (the other direction).
 * Not C0035, "Program name, function or function block instance expected instead of 'X'": it says "expected" and is no
 * syntax refusal — the vendor goes on analysing the body beside it (`expr_super_without_base` reports four messages,
 * `cc_conv_spelled_*` the undefined name too), and the LSP answers it in the analysis (`invalid-call-target`), where the
 * conformance suite holds it (frontend-conformance 2.5.6).
 */
const SYNTAX_MESSAGE = /expected|unexpected token/i
const isSyntaxMessage = (message: string): boolean =>
  SYNTAX_MESSAGE.test(message) && !message.startsWith("Program name, function or function block instance expected")

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
      const rec =
        f[vendor] ?? (vendor === "codesys" && f.test.vendorRefuses?.codesys !== undefined ? EXEC_REFUSALS.get(f.test.name) : undefined)
      // A fixture `support/divergences.ts` pins as disagreeing with this vendor's build is held there — the suite replays
      // it as an expected failure and fails the day it agrees — so it is counted here, not measured twice.
      if (rec !== undefined && KNOWN_DIVERGENCES[vendor].has(f.test.name)) {
        tally(counts, `${key}: known divergence (support/divergences.ts), not measured`)
        continue
      }
      const errors = [f.own, f.plc].flatMap((s) =>
        parseErrors(parse(s, vendor), vendor).map((e) => ({ ...e, id: s.id })),
      )
      const lsp = errors.length > 0 ? "LSP parse error" : "no LSP parse error"
      if (rec === undefined && f.test.vendorRefuses?.[vendor] !== undefined) {
        tally(counts, `${key}: the push refuses it, ${lsp}`)
        continue
      }
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
      const syntax = rec.diagnostics.find((d) => d.severity === "error" && isSyntaxMessage(d.message))
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
