/**
 * THE DIAGNOSTIC CENSUS — every diagnostic the LSP's analysis emits, held against the builds both vendors recorded, per
 * check and per message builder (openspec analysis-conformance design.md §6, tasks 0.1–0.3). Measurement only: it
 * judges nothing and fixes nothing; `diagnostic-census.test.ts` pins what it counts in `baselines/`.
 *
 * FIXTURES (0.1). Every conformance fixture × vendor with a build recording, bound exactly as the replay binds it
 * (`conformance/support/replay.ts`, the composition `lsp-replay.test.ts` gates) with network text ON (the test preload).
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
import { type Vendor } from "../../src/analysis/index.js"
import { projectDocuments } from "../corpus/support/diagnostics.js"
import { corpusProjects, normMessage } from "../frontend/sources.js"
import type { Baseline } from "../baseline/baseline.js"
import {
  PARSER,
  INLINE,
  builderNames,
  builderOwners,
  placeholderPatterns,
  registryRows,
  shapeOf,
} from "./census-owners.js"
import {
  type VendorCensus,
  type Tally,
  type Gaps,
  line,
  folded,
  zero,
  isReported,
  matchMultiset,
  fixtureCensus,
} from "./census-fixtures.js"

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
 *                      no structured exception handling on its code generator, no description, its stack size, the
 *                      memory segment a variable must fit — `decl_array_reversed_bounds`' "The variable 'a' is too large.
 *                      (variable size: …, segment size: …)", reclassified from missing-rule by task 3.11), the
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
    /No memory for dynamic object creation|No VAR_PERSISTENT list|does not support structured exception handling|Device description for .* is missing|maximal stack size|Calculation of stack usage|is too large\. \(variable size:|^SymbolConfig:|^Internal error|^Exception text:/i,
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
/** The server's finding for a body with no `IMPLEMENTATION` line (`server/document-diagnostics.ts` `missingLanguage`). */
const MISSING_LANGUAGE = /^'[^']*' states no language: its body opens with no 'IMPLEMENTATION <ST\|LD\|FBD>' line/
/**
 * A server diagnostic's census key: its code, or — for the one finding the server gives without one — its name: a body
 * that states no language (`server:missing-language`). Any other codeless finding is refused by name. (A parse error
 * reached the server's output codeless too, `server:parse-raw`, until analysis-conformance 2.5 dropped that duplicate
 * stream: it is the pipeline's C0002 finding now.)
 */
export function corpusCode(diag: { code?: number | string; message: string }): string {
  if (diag.code !== undefined) return String(diag.code)
  if (MISSING_LANGUAGE.test(diag.message)) return "server:missing-language"
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
        lsp.push({ severity, message: diag.message, code: corpusCode(diag), doc: d.uri })
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
