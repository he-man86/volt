/**
 * THE CENSUS'S FIXTURE RUN — every fixture × vendor with a build recording, analysed as the replay analyses it, its
 * findings matched against the recording as a multiset and counted per check and per builder. One concern of `census.ts`
 * (openspec lsp-same-standard 4.4).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Vendor,
  resolveConfig,
  type CheckContext,
  type DiagnosticItem,
  runRegistry,
  networkDiagnostics,
  messagesFor,
} from "../../src/analysis/index.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { comparable } from "../conformance/support/compare-message.js"
import { TWINCAT_TRIAGE, CODESYS_TRIAGE } from "../conformance/support/divergences-triage.js"
import { KNOWN_DIVERGENCES } from "../conformance/support/divergences.js"
import { withReplayFixture, replayDocuments, networkDocuments } from "../conformance/support/replay.js"
import { PACKAGE } from "../frontend/sources.js"
import { recordingMessages, PARSER, INLINE, NETWORK_ROW, registryRows, builderNames, shapeOf } from "./census-owners.js"

// ─── counting ────────────────────────────────────────────────────────────────────────────────────────────────

export interface Tally {
  /** Fixtures (or, for a corpus code, documents) it fired on. */
  fired: number
  items: number
  TP: number
  SEV: number
  FP: number
  div: number
  GAP: number
}
export const zero = (): Tally => ({ fired: 0, items: 0, TP: 0, SEV: 0, FP: 0, div: 0, GAP: 0 })

interface Finding {
  severity: "error" | "warning"
  message: string
  row: string
  builder: string
}

interface Residue {
  where: string
  severity: string
  message: string
}

/** One vendor's IDE-only messages, by where they were recorded — attributed once every builder's shapes are known. */
export interface Gaps {
  vendor: Vendor
  residue: Residue[]
}

export const matchMultiset = <L extends { severity: string; message: string }>(
  lsp: readonly L[],
  ide: readonly { severity: string; message: string }[],
  norm: (m: string) => string,
): { tp: L[]; sev: L[]; fp: L[]; gap: { severity: string; message: string }[] } => {
  const left = new Map<string, number>()
  const key = (s: string, m: string) => `${s}\u0000${norm(m)}`
  for (const d of ide) left.set(key(d.severity, d.message), (left.get(key(d.severity, d.message)) ?? 0) + 1)
  const take = (k: string): boolean => {
    const n = left.get(k) ?? 0
    if (n === 0) return false
    left.set(k, n - 1)
    return true
  }
  const tp: L[] = []
  const rest: L[] = []
  for (const f of lsp) (take(key(f.severity, f.message)) ? tp : rest).push(f)
  const sev: L[] = []
  const fp: L[] = []
  for (const f of rest) (take(key(f.severity === "error" ? "warning" : "error", f.message)) ? sev : fp).push(f)
  const gap: { severity: string; message: string }[] = []
  for (const d of ide) {
    const k = key(d.severity, d.message)
    if ((left.get(k) ?? 0) > 0) {
      left.set(k, left.get(k)! - 1)
      gap.push(d)
    }
  }
  return { tp, sev, fp, gap }
}

export const line = (m: string): string => comparable(m).replace(/\n/g, "\\n")

/** Identical lines folded into one, with how often it occurred. */
export function folded(lines: readonly string[]): string[] {
  const n = new Map<string, number>()
  for (const l of lines) n.set(l, (n.get(l) ?? 0) + 1)
  return [...n].map(([l, k]) => (k === 1 ? l : `${l} ×${k}`))
}

// ─── the fixture run ─────────────────────────────────────────────────────────────────────────────────────────

interface RecordedBuild {
  tests: Record<string, { diagnostics: { severity: string; message: string }[] }>
}
const RECORDINGS = join(PACKAGE, "test", "conformance", "recordings")
const recording = (vendor: Vendor): RecordedBuild =>
  JSON.parse(readFileSync(join(RECORDINGS, `${vendor}.build.json`), "utf8")) as RecordedBuild

export const isReported = (d: { severity: string }): d is { severity: "error" | "warning" } =>
  d.severity === "error" || d.severity === "warning"

/** Every finding the analysis emits for fixture `i`, attributed — the replay's documents, the replay's project. */
function fixtureFindings(i: number, vendor: Vendor, rec: ReturnType<typeof recordingMessages>): Finding[] {
  const config = resolveConfig({ vendor })
  return withReplayFixture(i, vendor, (files, project) => {
    const out: Finding[] = []
    for (const doc of replayDocuments(files)) {
      const ctx: CheckContext = {
        parseResult: doc.parseResult,
        source: doc.source,
        uri: doc.uri,
        project,
        config,
        messages: rec.messages,
        tokens: () => doc.parseResult.tokens,
      }
      // the policy may copy a finding (a forced severity), so it is found again by its key as well
      const byItem = new Map<DiagnosticItem, { row: string; builder: string }>()
      const byKey = new Map<string, { row: string; builder: string }>()
      const itemKey = (it: DiagnosticItem) => `${it.code}\u0000${it.span.start}\u0000${it.span.end}\u0000${it.message}`
      rec.take() // what was produced before the first check is no check's
      const items = runRegistry(ctx, (check, emitted) => {
        const window = rec.take()
        for (const it of emitted) {
          const who = { row: check.name, builder: window.get(it.message) ?? (check.name === "checkParseErrors" ? PARSER : INLINE) }
          byItem.set(it, who)
          byKey.set(itemKey(it), who)
        }
      })
      for (const it of items) {
        if (!isReported(it)) continue
        const who = byItem.get(it) ?? byKey.get(itemKey(it))
        if (who === undefined) throw new Error(`a finding no check emitted: ${it.code} ${it.message}`)
        out.push({ severity: it.severity, message: it.message, ...who })
      }
    }
    for (const doc of networkDocuments(files)) {
      rec.take()
      const network = networkDiagnostics(doc.parseResult, project)
      const window = rec.take()
      for (const it of network)
        if (isReported(it)) out.push({ severity: it.severity, message: it.message, row: NETWORK_ROW, builder: window.get(it.message) ?? INLINE })
    }
    return out
  })
}

export interface VendorCensus {
  vendor: Vendor
  rows: Map<string, Tally>
  builders: Map<string, Tally>
  /** Every builder seen producing a finding, with the shapes it produced and the rows that emitted it. */
  seen: Map<string, { shapes: Set<string>; rows: Set<string> }>
  /** Every shape a finding had, with the rows that emitted it. */
  shapeRows: Map<string, Set<string>>
  findings: string[]
  /** Fixtures held, and fixtures that ran (a check's vendor scope means a row can run on fewer). */
  measured: number
  ran: Set<string>
}

export function fixtureCensus(vendor: Vendor, gaps: Gaps): VendorCensus {
  const builds = recording(vendor)
  const rec = recordingMessages(vendor)
  const diverging = new Set([...KNOWN_DIVERGENCES[vendor], ...(vendor === "twincat" ? TWINCAT_TRIAGE : CODESYS_TRIAGE)])
  const rows = new Map(registryRows().map((r) => [r.check, zero()]))
  const builders = new Map([...builderNames(), PARSER, INLINE].map((b) => [b, zero()]))
  const seen = new Map<string, { shapes: Set<string>; rows: Set<string> }>()
  const shapeRows = new Map<string, Set<string>>()
  const findings: string[] = []
  const ran = new Set<string>()
  let measured = 0
  // which registry checks run for this vendor: one probe on an empty document
  const probe = withReplayFixture(0, vendor, (_, project) => {
    const names = new Set<string>()
    runRegistry(
      { parseResult: { units: [], errors: [], failedDeclarations: [], tokens: [], dialect: vendor }, source: "", uri: "probe.st", project, config: resolveConfig({ vendor }), messages: messagesFor(vendor), tokens: () => [] },
      (check) => names.add(check.name),
    )
    return names
  })
  for (const n of probe) ran.add(n)
  ran.add(NETWORK_ROW)
  for (let i = 0; i < ALL_TESTS.length; i++) {
    const t = ALL_TESTS[i]!
    const recorded = builds.tests[t.name]
    // a fixture whose code sits only in the synthesized PLC_PRG (`inProgram`) has an empty own source and is measured
    // like any other: the replay compares it, so the census does
    if (recorded === undefined) continue
    // the replay skips a fixture whose push this vendor now refuses (`vendorRefuses`): its row predates the refusal
    if (t.vendorRefuses?.[vendor] !== undefined) continue
    measured++
    const lsp = fixtureFindings(i, vendor, rec)
    const ide = recorded.diagnostics.filter(isReported)
    const { tp, sev, fp, gap } = matchMultiset(lsp, ide, comparable)
    const div = diverging.has(t.name)
    const firedRows = new Set<string>()
    const lines: string[] = []
    const bump = (f: Finding, k: "TP" | "SEV" | "FP") => {
      for (const tally of [rows.get(f.row)!, builders.get(f.builder)!]) {
        tally.items++
        tally[k]++
        if (k === "FP" && div) tally.div++
      }
      firedRows.add(f.row)
      const s = seen.get(f.builder) ?? { shapes: new Set<string>(), rows: new Set<string>() }
      s.shapes.add(shapeOf(f.message))
      s.rows.add(f.row)
      seen.set(f.builder, s)
      shapeRows.set(shapeOf(f.message), (shapeRows.get(shapeOf(f.message)) ?? new Set<string>()).add(f.row))
    }
    for (const f of tp) bump(f, "TP")
    for (const f of sev) {
      bump(f, "SEV")
      lines.push(`${t.name} ${f.row} ${f.builder} SEV [${f.severity}] ${line(f.message)}`)
    }
    for (const f of fp) {
      bump(f, "FP")
      lines.push(`${t.name} ${f.row} ${f.builder} ${div ? "FP(div)" : "FP"} [${f.severity}] ${line(f.message)}`)
    }
    for (const r of firedRows) rows.get(r)!.fired++
    const firedBuilders = new Set([...tp, ...sev, ...fp].map((f) => f.builder))
    for (const b of firedBuilders) builders.get(b)!.fired++
    for (const g of gap) gaps.residue.push({ where: t.name, severity: g.severity, message: g.message })
    findings.push(...folded(lines))
  }
  return { vendor, rows, builders, seen, shapeRows, findings, measured, ran }
}
