/**
 * THE DIAGNOSTIC CENSUS — every diagnostic the LSP's analysis emits, held against the builds both vendors recorded, per
 * check and per message builder (openspec analysis-conformance design.md §6, tasks 0.1–0.3). Measurement only: it
 * judges nothing and fixes nothing; `diagnostic-census.test.ts` pins what it counts in `baselines/`.
 *
 * FIXTURES (0.1). Every conformance fixture × vendor with a build recording, bound exactly as the replay binds it
 * (`conformance/support/replay.ts`, the composition `fixtures.test.ts` gates) with network text ON (the test preload).
 * Each analysed document runs the registry through `runRegistry` with an `onCheck` hook, so every finding is attributed
 * to the check whose slice of `out` it is in; the messages are a wrapped `messagesFor(vendor)` that remembers which
 * builder produced each text, so every finding is attributed to its builder too. A text no builder produced is the
 * parser's own wording (`(parser)`, in `parse-errors`) or a check's inline text (`(inline)`). The network-text pass sits
 * outside the registry (design.md §3 is parked), so its findings are the one row with no registry entry: `network-text`.
 *
 * MATCHING, a multiset per fixture, compared as the replay compares (`[severity] message`, CRLF read as LF), errors and
 * warnings only:
 *   TP   an LSP finding the recording holds, same severity;
 *   SEV  the same message recorded at the other severity;
 *   FP   LSP-only — `div` counts those on a fixture the replay pins as a known divergence or triages, `open` = FP − div;
 *   GAP  IDE-only, attributed to the builder whose shape it has (quoted parts as `'…'`: first the shapes the builder was
 *        seen producing, then its text with every argument a wildcard) and, when one check calls that builder, to that
 *        check; a shape no builder has is `unowned:<shape>`.
 *
 * CORPORA (0.2). The six projects through the server's own function (`corpus/support/diagnostics.ts` `projectDocuments`)
 * against each project's recorded build, matched as above on the corpus gate's normalizer. The server path carries no
 * trace, so a finding is counted by its CODE; the server's own findings, which carry none, are `server:<what>`.
 *
 * COVERAGE (0.3). The builders with no TP on a vendor, and the registry checks that fire on no fixture.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import {
  CHECK_REGISTRY,
  messagesFor,
  resolveConfig,
  runRegistry,
  type CheckContext,
  type DiagnosticItem,
  type Messages,
  type Vendor,
} from "../../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../../src/network/index.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { comparable } from "../conformance/support/compare-message.js"
import { CODESYS_TRIAGE, KNOWN_DIVERGENCES, TWINCAT_TRIAGE } from "../conformance/support/divergences.js"
import { withReplayFixture } from "../conformance/support/replay.js"
import { projectDocuments } from "../corpus/support/diagnostics.js"
import { corpusProjects, normMessage, PACKAGE } from "../frontend/sources.js"
import type { Baseline } from "../frontend/baseline.js"

export const VENDORS: readonly Vendor[] = ["codesys", "twincat"]
/** The network-text pass — outside the registry while design.md §3 is parked, and the one census row with no entry. */
export const NETWORK_ROW = "network-text"
/** A finding whose text no builder produced: the parser's own wording (in `parse-errors`) or a check's inline text. */
const PARSER = "(parser)"
const INLINE = "(inline)"

// ─── the registry, by file ───────────────────────────────────────────────────────────────────────────────────

export interface RegistryRow {
  /** The check function's name — the registry entry. */
  check: string
  /** Its folder under `src/analysis/checks/` (`network` for the network-text row). */
  group: string
  /** Package-relative, slash-separated. */
  file: string
}

const CHECKS_DIR = join(PACKAGE, "src", "analysis", "checks")
const NETWORK_FILE = join(PACKAGE, "src", "network", "network-analysis.ts")
const portable = (path: string): string => relative(PACKAGE, path).split(sep).join("/")
const walkTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walkTs(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : []
  })

let rowsCache: RegistryRow[] | undefined
/** Every registry entry with the file that defines it, plus the network-text row. A check defined in no file, or in two, throws. */
export function registryRows(): RegistryRow[] {
  if (rowsCache !== undefined) return rowsCache
  const files = walkTs(CHECKS_DIR).map((path) => ({ path, text: readFileSync(path, "utf8") }))
  const rows = CHECK_REGISTRY.map((check): RegistryRow => {
    const where = files.filter((f) => new RegExp(`export function ${check.name}\\(`).test(f.text))
    if (where.length !== 1) throw new Error(`registry check ${check.name} is defined in ${where.length} files under src/analysis/checks`)
    const file = portable(where[0]!.path)
    return { check: check.name, group: file.split("/")[3]!, file }
  })
  rowsCache = [...rows, { check: NETWORK_ROW, group: "network", file: portable(NETWORK_FILE) }]
  return rowsCache
}

/**
 * One top-level declaration of a source file (a declaration starts at column 0) — the unit a call is resolved to. The
 * file's preamble (its imports) is no segment.
 */
interface Segment {
  file: string
  name: string
  text: string
}
const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|class\s+|interface\s+|type\s+|enum\s+)([A-Za-z_$][\w$]*)/
function segmentsOf(file: string, text: string): Segment[] {
  const out: Segment[] = []
  let current: Segment | undefined
  for (const l of text.split("\n")) {
    const m = DECLARATION.exec(l)
    if (m !== null) {
      current = { file, name: m[1], text: "" }
      out.push(current)
    }
    if (current !== undefined) current.text += l + "\n"
  }
  return out
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * WHICH CHECKS CAN EMIT EACH BUILDER — the static half of "which check owns this message", resolved THROUGH the helpers
 * that call a builder on a check's behalf (`rules.ts` `conversionWarning` gives `narrowing` for three checks). Every
 * top-level declaration in `src/analysis/**` and the network-text file that calls `.<builder>(` is a source; a
 * declaration belongs to the rows its file defines (a check file's local helper to that file's checks, the network file
 * to the network-text row), and to the rows of every declaration that refers to it — in its own file, or in a file that
 * imports it by name. `messages.ts`, which defines the builders, calls none.
 */
let ownersCache: Map<string, Set<string>> | undefined
export function builderOwners(): Map<string, Set<string>> {
  if (ownersCache === undefined) {
    const builders = builderNames()
    const rowsOfFile = new Map<string, Set<string>>()
    for (const r of registryRows()) rowsOfFile.set(r.file, (rowsOfFile.get(r.file) ?? new Set<string>()).add(r.check))
    const files = [...walkTs(join(PACKAGE, "src", "analysis")), NETWORK_FILE]
      .filter((p) => !p.endsWith(`${sep}messages.ts`))
      .map((p) => ({ file: portable(p), text: readFileSync(p, "utf8") }))
    const imports = new Map(files.map((f) => [f.file, (f.text.match(/^import[\s\S]*?from\s+["'][^"']+["']/gm) ?? []).join("\n")]))
    const segments = files.flatMap((f) => segmentsOf(f.file, f.text))
    const callersMemo = new Map<Segment, Segment[]>()
    const callers = (seg: Segment): Segment[] => {
      const hit = callersMemo.get(seg)
      if (hit !== undefined) return hit
      const ref = new RegExp(`(?<![\\w$.])${escapeRe(seg.name)}(?![\\w$])`)
      const named = new RegExp(`(?<![\\w$])${escapeRe(seg.name)}(?![\\w$])`)
      const found = segments.filter(
        (c) => c !== seg && (c.file === seg.file || named.test(imports.get(c.file)!)) && ref.test(c.text),
      )
      callersMemo.set(seg, found)
      return found
    }
    // every row one declaration reaches: its own file's, and those of every declaration that refers to it, transitively
    const reach = (from: Segment): Set<string> => {
      const rows = new Set<string>()
      const seen = new Set<Segment>([from])
      const queue = [from]
      for (let seg = queue.shift(); seg !== undefined; seg = queue.shift()) {
        for (const r of rowsOfFile.get(seg.file) ?? []) rows.add(r)
        for (const c of callers(seg))
          if (!seen.has(c)) {
            seen.add(c)
            queue.push(c)
          }
      }
      return rows
    }
    const owners = new Map(builders.map((b) => [b, new Set<string>()]))
    for (const seg of segments)
      for (const b of builders) if (new RegExp(`\\.${b}\\(`).test(seg.text)) for (const r of reach(seg)) owners.get(b)!.add(r)
    ownersCache = owners
  }
  return new Map([...ownersCache].map(([b, s]) => [b, new Set(s)]))
}

// ─── builder attribution ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `messagesFor(vendor)`, each builder wrapped to remember which builder produced each text — per WINDOW: `take()` hands
 * over what was produced since the last `take()` and forgets it. A window is one check's run on one document (or the
 * network pass on one), so a finding is attributed only to a builder its own emitter called, never to one some earlier
 * fixture happened to call with the same wording (the parser's own "Expression expected instead of …" among them).
 */
export function recordingMessages(vendor: Vendor): { messages: Messages; take: () => Map<string, string> } {
  const base = messagesFor(vendor) as unknown as Record<string, unknown>
  let builderOf = new Map<string, string>()
  const wrapped: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(base)) {
    if (typeof value !== "function") throw new Error(`messagesFor(${vendor}).${name} is no builder`)
    wrapped[name] = (...args: unknown[]) => {
      const text = (value as (...a: unknown[]) => unknown)(...args)
      if (typeof text === "string") builderOf.set(text, name)
      return text
    }
  }
  const take = (): Map<string, string> => {
    const window = builderOf
    builderOf = new Map<string, string>()
    return window
  }
  return { messages: wrapped as unknown as Messages, take }
}

export const builderNames = (): string[] => Object.keys(messagesFor("codesys"))

/** A message's shape: normalized as the corpus gate normalizes, every quoted part as `'…'`. */
export const shapeOf = (message: string): string => normMessage(message).replace(/'[^']*'/g, "'…'")

/** Each builder's text with every argument a wildcard — skipped when what is left is too little to name a message. */
function placeholderPatterns(vendor: Vendor): [string, RegExp][] {
  const out: [string, RegExp][] = []
  const marker = (i: number) => `\u0001${i}\u0001`
  for (const [name, fn] of Object.entries(messagesFor(vendor) as unknown as Record<string, (...a: unknown[]) => unknown>)) {
    let text: unknown
    try {
      text = fn(...Array.from({ length: Math.max(fn.length, 1) }, (_, i) => marker(i)))
    } catch {
      continue
    }
    if (typeof text !== "string") continue
    const parts = normMessage(text).split(/\u0001\d+\u0001/)
    if (parts.join("").replace(/\s/g, "").length < 12) continue
    out.push([name, new RegExp(`^${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*?")}$`)])
  }
  return out
}

// ─── counting ────────────────────────────────────────────────────────────────────────────────────────────────

interface Tally {
  /** Fixtures (or, for a corpus code, documents) it fired on. */
  fired: number
  items: number
  TP: number
  SEV: number
  FP: number
  div: number
  GAP: number
}
const zero = (): Tally => ({ fired: 0, items: 0, TP: 0, SEV: 0, FP: 0, div: 0, GAP: 0 })

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
interface Gaps {
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

const line = (m: string): string => comparable(m).replace(/\n/g, "\\n")

/** Identical lines folded into one, with how often it occurred. */
function folded(lines: readonly string[]): string[] {
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

const isReported = (d: { severity: string }): d is { severity: "error" | "warning" } =>
  d.severity === "error" || d.severity === "warning"

/** Every finding the analysis emits for fixture `i`, attributed — the replay's documents, the replay's project. */
function fixtureFindings(i: number, vendor: Vendor, rec: ReturnType<typeof recordingMessages>): Finding[] {
  const config = resolveConfig({ vendor })
  return withReplayFixture(i, vendor, ({ own, plc, lists }, project) => {
    const out: Finding[] = []
    for (const doc of [own, ...(plc === undefined ? [] : [plc]), ...lists]) {
      const ctx: CheckContext = {
        parseResult: doc.parseResult,
        source: doc.source,
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
    rec.take()
    const network = computeNetworkTextDiagnostics({ uri: own.uri, source: own.source, parseResult: own.parseResult }, project, rec.messages)
    const window = rec.take()
    for (const it of network)
      if (isReported(it)) out.push({ severity: it.severity, message: it.message, row: NETWORK_ROW, builder: window.get(it.message) ?? INLINE })
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

function fixtureCensus(vendor: Vendor, gaps: Gaps): VendorCensus {
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
      { parseResult: { units: [], errors: [], failedDeclarations: [], tokens: [], dialect: vendor }, source: "", project, config: resolveConfig({ vendor }), messages: messagesFor(vendor), tokens: () => [] },
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

// ─── gap attribution ─────────────────────────────────────────────────────────────────────────────────────────

export interface Attribution {
  /** The builder whose shape it has, or undefined (unowned). */
  builder: string | undefined
  /** The one row that calls that builder, or undefined (none, or more than one). */
  row: string | undefined
  owners: readonly string[]
}

function attributor(census: VendorCensus): (message: string) => Attribution {
  const builders = builderNames()
  const owners = builderOwners()
  for (const [b, s] of census.seen) for (const r of s.rows) owners.get(b)?.add(r)
  // a shape the builders were seen producing first, then the parser's and the inline texts'
  const byShape = new Map<string, string>()
  for (const b of [...builders, PARSER, INLINE]) for (const s of census.seen.get(b)?.shapes ?? []) if (!byShape.has(s)) byShape.set(s, b)
  const patterns = placeholderPatterns(census.vendor)
  return (message) => {
    const shape = shapeOf(message)
    const norm = normMessage(message)
    const builder = byShape.get(shape) ?? patterns.find(([, re]) => re.test(norm))?.[0]
    if (builder === undefined) return { builder: undefined, row: undefined, owners: [] }
    // every row that calls the builder, and every row seen emitting this very shape (the parser's wording among them)
    const own = [...new Set([...(owners.get(builder) ?? []), ...(census.shapeRows.get(shape) ?? [])])].sort()
    return { builder, row: own.length === 1 ? own[0] : undefined, owners: own }
  }
}

// ─── the unowned shapes, classified ──────────────────────────────────────────────────────────────────────────

export type UnownedClass = "owned-by-frontend" | "project-config" | "missing-rule"

/**
 * WHY NO BUILDER PRODUCES A SHAPE (task 0.2) — each unowned shape in exactly one class, by its wording (the first class
 * whose pattern matches; `missing-rule` is what neither names):
 *   project-config     a fact of the recording environment, not of the source: the device (no memory for dynamic objects,
 *                      no structured exception handling on its code generator, no description, its stack size), the
 *                      application (no VAR_PERSISTENT list, symbol configuration) or the toolchain itself (an internal
 *                      error, an exception text) — no check can know it from the text;
 *   owned-by-frontend  the vendor's PARSER (a token or declaration expected instead of what was found, an unexpected token
 *                      or end, a FOR without its counter) or its constant FOLDER (a bound that does not evaluate) — which
 *                      `frontend-conformance` owns, not a check;
 *   missing-rule       every other shape: an IDE rule no Volt check has — the work list of task 3.11.
 */
const UNOWNED_CLASSES: readonly [Exclude<UnownedClass, "missing-rule">, RegExp][] = [
  [
    "project-config",
    /No memory for dynamic object creation|No VAR_PERSISTENT list|does not support structured exception handling|Device description for .* is missing|maximal stack size|Calculation of stack usage|^SymbolConfig:|^Internal error|^Exception text:/i,
  ],
  ["owned-by-frontend", /expected instead of|^Counter initialisation expected$|^Unexpected (token|end|pragma)|end-of-file|does not evaluate to a valid/i],
]
export const unownedClass = (shape: string): UnownedClass => UNOWNED_CLASSES.find(([, re]) => re.test(shape))?.[0] ?? "missing-rule"

// ─── the whole census ────────────────────────────────────────────────────────────────────────────────────────

export interface Census {
  fixtures: Record<Vendor, Baseline>
  corpus: Baseline
  coverage: Baseline
  /** Human tables for tasks.md — per row, per builder, per vendor. */
  report: {
    rows: Record<Vendor, Map<string, Tally>>
    builders: Record<Vendor, Map<string, Tally>>
    unowned: Record<Vendor | "corpus", Map<string, number>>
    measured: Record<Vendor, number>
    corpus: Map<string, Map<string, Tally>>
  }
}

const groupOf = (row: string): string => registryRows().find((r) => r.check === row)!.group

function tallyCounts(prefix: string, t: Tally, counts: Record<string, number>): void {
  for (const k of ["fired", "TP", "SEV", "FP", "div", "GAP"] as const) counts[`${prefix}: ${k}`] = t[k]
}

function fixtureBaseline(c: VendorCensus, gaps: Gaps, attribute: (m: string) => Attribution, unowned: Map<string, number>): Baseline {
  const counts: Record<string, number> = {}
  const findings = [...c.findings]
  const gapLines: string[] = []
  let shared = 0
  for (const g of gaps.residue) {
    const a = attribute(g.message)
    if (a.builder === undefined) {
      const shape = shapeOf(g.message)
      unowned.set(shape, (unowned.get(shape) ?? 0) + 1)
      gapLines.push(`${g.where} unowned - GAP [${g.severity}] ${line(g.message)}`)
      continue
    }
    c.builders.get(a.builder)!.GAP++ // PARSER and INLINE are rows of `builders` too
    if (a.row !== undefined) c.rows.get(a.row)!.GAP++
    else shared++
    gapLines.push(`${g.where} ${a.row ?? "shared"} ${a.builder} GAP [${g.severity}] ${line(g.message)}`)
  }
  findings.push(...folded(gapLines))
  const owners = builderOwners()
  const groups = new Map<string, { openFP: number; GAP: number; neverFired: number }>()
  const group = (g: string) => groups.get(g) ?? (groups.set(g, { openFP: 0, GAP: 0, neverFired: 0 }), groups.get(g)!)
  for (const r of registryRows()) group(r.group)
  for (const [row, t] of c.rows) {
    tallyCounts(`check ${row}`, t, counts)
    if (!c.ran.has(row)) counts[`check ${row}: not run for this vendor`] = 1
    group(groupOf(row)).openFP += t.FP - t.div
    group(groupOf(row)).GAP += t.GAP
  }
  let neverFired = 0
  for (const [b, t] of c.builders) {
    tallyCounts(`builder ${b}`, t, counts)
    if (b === PARSER || b === INLINE || t.items > 0) continue
    neverFired++
    for (const r of owners.get(b) ?? []) group(groupOf(r)).neverFired++
  }
  for (const [g, v] of groups) {
    counts[`group ${g}: open FP`] = v.openFP
    counts[`group ${g}: GAP`] = v.GAP
    counts[`group ${g}: never-fired builders`] = v.neverFired
  }
  const total = (k: keyof Tally) => [...c.rows.values()].reduce((s, t) => s + t[k], 0)
  counts["total: fixtures measured"] = c.measured
  counts["total: TP"] = total("TP")
  counts["total: SEV"] = total("SEV")
  counts["total: FP"] = total("FP")
  counts["total: open FP"] = total("FP") - total("div")
  counts["total: GAP"] = gaps.residue.length
  counts["total: GAP on a shared builder"] = shared
  counts["total: unowned GAP"] = [...unowned.values()].reduce((s, n) => s + n, 0)
  counts["total: never-fired builders"] = neverFired
  for (const cls of ["owned-by-frontend", "project-config", "missing-rule"] as const)
    counts[`unowned GAP ${cls}`] = [...unowned].filter(([s]) => unownedClass(s) === cls).reduce((s, [, n]) => s + n, 0)
  return { counts, findings }
}

// ─── corpora ─────────────────────────────────────────────────────────────────────────────────────────────────

const SEVERITY_NAME: Record<number, string> = { 1: "error", 2: "warning", 3: "information", 4: "hint" }
/** A server diagnostic's severity, by name — one with none is refused, never read as an error. */
export function corpusSeverity(severity: number | undefined): string {
  const name = severity === undefined ? undefined : SEVERITY_NAME[severity]
  if (name === undefined) throw new Error(`a corpus diagnostic with no severity (${String(severity)})`)
  return name
}
/** The server's finding for a body with no `IMPLEMENTATION` line (`server/diagnostics.ts` `missingLanguage`). */
const MISSING_LANGUAGE = /^'[^']*' states no language: its body opens with no 'IMPLEMENTATION <ST\|LD\|FBD>' line/
/**
 * A server diagnostic's census key: its code, or — for the two findings the server gives without one — its name: a body
 * that states no language (`server:missing-language`), or one of the document's own parse errors as the server words
 * them (`server:parse-raw`). Any other codeless finding is refused by name, never counted as one of those.
 */
export function corpusCode(diag: { code?: number | string; message: string }, parseErrors: readonly string[]): string {
  if (diag.code !== undefined) return String(diag.code)
  if (MISSING_LANGUAGE.test(diag.message)) return "server:missing-language"
  if (parseErrors.includes(diag.message)) return "server:parse-raw"
  throw new Error(`a codeless server finding the census does not know: ${diag.message}`)
}

function corpusCensus(attributors: Record<Vendor, (m: string) => Attribution>): {
  baseline: Baseline
  perProject: Map<string, Map<string, Tally>>
  unowned: Map<string, number>
} {
  const counts: Record<string, number> = {}
  const findings: string[] = []
  const perProject = new Map<string, Map<string, Tally>>()
  const unowned = new Map<string, number>()
  for (const p of corpusProjects()) {
    if (p.build === undefined) throw new Error(`corpus project ${p.name} has no recorded build`)
    const rows = new Map<string, Tally>()
    const row = (k: string) => rows.get(k) ?? (rows.set(k, zero()), rows.get(k)!)
    const lsp: { severity: string; message: string; code: string; doc: string }[] = []
    for (const d of projectDocuments(p.dir, p.vendor))
      for (const diag of d.diagnostics) {
        const severity = corpusSeverity(diag.severity)
        if (severity !== "error" && severity !== "warning") continue
        lsp.push({ severity, message: diag.message, code: corpusCode(diag, d.parseErrors), doc: d.uri })
      }
    const ide = p.build.diagnostics.filter(isReported)
    const { tp, sev, fp, gap } = matchMultiset(lsp, ide, normMessage)
    const fired = new Map<string, Set<string>>()
    const lines: string[] = []
    const bump = (f: (typeof lsp)[number], k: "TP" | "SEV" | "FP") => {
      const t = row(f.code)
      t.items++
      t[k]++
      fired.set(f.code, (fired.get(f.code) ?? new Set()).add(f.doc))
    }
    for (const f of tp) bump(f, "TP")
    for (const f of sev) {
      bump(f, "SEV")
      lines.push(`${p.name} ${f.code} SEV [${f.severity}] ${line(normMessage(f.message))}`)
    }
    for (const f of fp) {
      bump(f, "FP")
      lines.push(`${p.name} ${f.code} FP [${f.severity}] ${line(normMessage(f.message))}`)
    }
    for (const [code, docs] of fired) row(code).fired = docs.size
    for (const g of gap) {
      const a = attributors[p.vendor](g.message)
      const key = a.builder === undefined ? "unowned" : `gap:${a.row ?? "shared"}`
      row(key).GAP++
      if (a.builder === undefined) unowned.set(shapeOf(g.message), (unowned.get(shapeOf(g.message)) ?? 0) + 1)
      lines.push(`${p.name} ${key} ${a.builder ?? "-"} GAP [${g.severity}] ${line(normMessage(g.message))}`)
    }
    findings.push(...folded(lines))
    for (const [code, t] of rows) tallyCounts(`${p.name} ${code}`, t, counts)
    const truncated = p.build.diagnostics.some((d) => /More than \d+ warnings/i.test(d.message))
    counts[`${p.name}: FP`] = fp.length
    counts[`${p.name}: GAP`] = gap.length
    counts[`${p.name}: TP`] = tp.length
    counts[`${p.name}: SEV`] = sev.length
    counts[`${p.name}: oracle incomplete (build failed or truncated)`] = p.build.buildSuccess && !truncated ? 0 : 1
    perProject.set(p.name, rows)
  }
  counts["total: FP"] = [...perProject.keys()].reduce((s, n) => s + counts[`${n}: FP`]!, 0)
  counts["total: GAP"] = [...perProject.keys()].reduce((s, n) => s + counts[`${n}: GAP`]!, 0)
  counts["total: unowned GAP"] = [...unowned.values()].reduce((s, n) => s + n, 0)
  for (const cls of ["owned-by-frontend", "project-config", "missing-rule"] as const)
    counts[`unowned GAP ${cls}`] = [...unowned].filter(([s]) => unownedClass(s) === cls).reduce((s, [, n]) => s + n, 0)
  return { baseline: { counts, findings }, perProject, unowned }
}

// ─── coverage ────────────────────────────────────────────────────────────────────────────────────────────────

function coverageBaseline(byVendor: Record<Vendor, VendorCensus>): Baseline {
  const counts: Record<string, number> = {}
  const findings: string[] = []
  const owners = builderOwners()
  const zeroOn = (v: Vendor, b: string) => byVendor[v].builders.get(b)!.TP === 0
  let both = 0
  let csOnly = 0
  let tcOnly = 0
  for (const b of builderNames()) {
    const cs = zeroOn("codesys", b)
    const tc = zeroOn("twincat", b)
    if (!cs && !tc) continue
    const on = cs && tc ? "both vendors" : cs ? "codesys" : "twincat"
    if (cs && tc) both++
    else if (cs) csOnly++
    else tcOnly++
    findings.push(`builder ${b}: 0 TP on ${on} (called by ${[...(owners.get(b) ?? [])].sort().join(", ") || "no check file"})`)
  }
  counts["builders with 0 TP on codesys"] = both + csOnly
  counts["builders with 0 TP on twincat"] = both + tcOnly
  counts["builders with 0 TP on both vendors"] = both
  counts["builders with 0 TP on codesys only"] = csOnly
  counts["builders with 0 TP on twincat only"] = tcOnly
  let none = 0
  for (const r of registryRows()) {
    const cs = byVendor.codesys.rows.get(r.check)!.fired
    const tc = byVendor.twincat.rows.get(r.check)!.fired
    if (cs === 0 && tc === 0) {
      none++
      findings.push(`check ${r.check} (${r.group}): fires on 0 fixtures on either vendor`)
    } else if (cs === 0 || tc === 0)
      findings.push(
        `check ${r.check} (${r.group}): fires on 0 fixtures on ${cs === 0 ? "codesys" : "twincat"}${byVendor[cs === 0 ? "codesys" : "twincat"].ran.has(r.check) ? "" : " (not run for it)"}`,
      )
  }
  counts["checks firing on 0 fixtures"] = none
  return { counts, findings }
}

let censusCache: Census | undefined
/** The whole census, once per process. */
export function runCensus(): Census {
  if (censusCache !== undefined) return censusCache
  const gaps: Record<Vendor, Gaps> = { codesys: { vendor: "codesys", residue: [] }, twincat: { vendor: "twincat", residue: [] } }
  const byVendor = { codesys: fixtureCensus("codesys", gaps.codesys), twincat: fixtureCensus("twincat", gaps.twincat) }
  const attributors = { codesys: attributor(byVendor.codesys), twincat: attributor(byVendor.twincat) }
  const unowned = { codesys: new Map<string, number>(), twincat: new Map<string, number>() }
  const fixtures = {
    codesys: fixtureBaseline(byVendor.codesys, gaps.codesys, attributors.codesys, unowned.codesys),
    twincat: fixtureBaseline(byVendor.twincat, gaps.twincat, attributors.twincat, unowned.twincat),
  }
  const corpus = corpusCensus(attributors)
  censusCache = {
    fixtures,
    corpus: corpus.baseline,
    coverage: coverageBaseline(byVendor),
    report: {
      rows: { codesys: byVendor.codesys.rows, twincat: byVendor.twincat.rows },
      builders: { codesys: byVendor.codesys.builders, twincat: byVendor.twincat.builders },
      unowned: { ...unowned, corpus: corpus.unowned },
      measured: { codesys: byVendor.codesys.measured, twincat: byVendor.twincat.measured },
      corpus: corpus.perProject,
    },
  }
  return censusCache
}
