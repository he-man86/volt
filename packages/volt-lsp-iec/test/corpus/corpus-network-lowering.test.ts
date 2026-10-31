/**
 * THE CORPORA'S NETWORK BODIES LOWERED, HELD TO THEIR EXEC TWINS (openspec network-text-lowering 3.2): two implementations
 * of one meaning — the lowering (`src/transpile/lower/network/`) and the exec twin (`test/support/network-twin.ts`, whose
 * twins CODESYS builds) — compared on every corpus POU that holds a network body. Each POU is lowered twice: as pulled,
 * and with every network body of the project replaced by its twin, lowered as ST. Where both lower, both run the same
 * scans on the same inputs (every VAR_INPUT and every global, a pattern per scan) and every variable they hold must agree
 * after every scan; where one lowers and the other does not, that is the finding.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { parseDocument, type TopLevel } from "../../src/frontend/syntax/index.js"
import { scopeForUnit } from "../../src/frontend/symbols/index.js"
import { lowerUnit, run, type Runner } from "../../src/transpile/index.js"
import type { IrPou, IrSlot } from "../../src/transpile/ir/index.js"
import { twinProject } from "../support/network-twin-project.js"
import { corpusVendor, loweringProject, parseProject } from "./support/project.js"
import { CORPUS, hasCorpus, isRunnable, projectDirs } from "./support/walk.js"

const SCANS = 12

/** Per project, the POUs holding a network body that both lower and run (compared) and that both refuse by the same
 *  codes — exact, so the comparison cannot quietly reach fewer (measured 2026-10-31). */
const REACHED: Readonly<Record<string, { compared: number; refused: number }>> = {
  "awa-palletizer": { compared: 0, refused: 1 },
  "bakon-nano": { compared: 0, refused: 1 },
  "lenze-mid": { compared: 13, refused: 20 },
  pro2193: { compared: 0, refused: 2 },
  "twincat-project14": { compared: 1, refused: 1 },
}
const TIMEOUT = 300_000

/** The elementary variables a run reads and the ones it drives: `name` or `inst.field`, hidden (`__`) state left out. */
function leaves(pou: IrPou): { read: string[]; driven: { path: string; type: string }[] } {
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), l]))
  const read: string[] = []
  const driven: { path: string; type: string }[] = []
  const visit = (s: IrSlot, path: string, input: boolean, depth: number) => {
    if (s.name.startsWith("__") || s.name.includes(".")) return
    if (s.type.kind === "elementary") {
      read.push(path)
      if (input && s.constant !== true) driven.push({ path, type: s.type.name })
    } else if (s.type.kind === "function_block" && depth === 0)
      for (const f of layouts.get(s.type.name.toUpperCase())?.fields ?? []) visit(f, `${path}.${f.name}`, f.section === "VAR_INPUT", 1)
  }
  for (const s of pou.slots) visit(s, s.name, s.section === "VAR_INPUT", 0)
  for (const g of pou.globals) if (g.section !== "program" && g.list !== undefined && g.image === undefined) visit(g, `${g.list}.${g.name}`, true, 1)
  return { read, driven }
}

const INTEGER = /^(U?(S|D|L)?INT|BYTE|WORD|DWORD|LWORD)$/

/** The value `scan` drives into the `i`th input: a pattern that changes every scan, the same for both runs. */
function stimulus(type: string, scan: number, i: number): boolean | bigint | undefined {
  const bit = ((scan * 7 + i * 3) >> 1) % 3 !== 0
  if (type === "BOOL") return bit
  if (INTEGER.test(type)) return BigInt((scan * 5 + i) % 7)
  return undefined
}

/** Every value after each scan, as one comparable text per scan. */
function traces(pou: IrPou, driven: readonly { path: string; type: string }[], read: readonly string[]): string[] {
  const r: Runner = run(pou, { loopGuard: 100_000 })
  const out: string[] = []
  for (let scan = 0; scan < SCANS; scan++) {
    driven.forEach((d, i) => {
      const v = stimulus(d.type, scan, i)
      if (v !== undefined) r.set(d.path, v)
    })
    r.scan()
    out.push(read.map((p) => `${p}=${String(r.get(p))}`).join(" "))
  }
  return out
}

const name = (u: TopLevel): string => ("name" in u && u.name !== undefined ? (u.name as { text: string }).text : u.kind)

describe.skipIf(!hasCorpus)("the corpora's network bodies lower as their exec twins run", () => {
  for (const project of projectDirs()) {
    const dir = join(CORPUS, project)
    test(`${project}: every POU holding a network body lowers and runs as its twin does`, () => {
      const vendor = corpusVendor(dir)
      const twins = twinProject(dir, vendor)
      if (twins.files.length === 0) return
      const parsed = parseProject(dir)
      const original = loweringProject(dir, parsed)
      const twinSources = new Map(twins.files.map((f) => [f.uri, f.source]))
      const twinned = loweringProject(
        dir,
        parsed.map((f) => {
          const source = twinSources.get(f.uri)
          return source === undefined ? f : { ...f, source, parseResult: parseDocument(f.uri, source, { networkText: true, unicodeIdentifiers: false }, f.parseResult.dialect) }
        }),
      )
      const findings: string[] = []
      let compared = 0
      let refused = 0
      for (const f of twins.files) {
        const own = original.files.find((x) => x.uri === f.uri)!
        const twin = twinned.files.find((x) => x.uri === f.uri)!
        for (const unit of own.parseResult.units.filter(isRunnable)) {
          const other = twin.parseResult.units.find((u) => isRunnable(u) && name(u) === name(unit))!
          const a = lowerUnit(unit, scopeForUnit(original.project, unit)!, original)
          const b = lowerUnit(other, scopeForUnit(twinned.project, other)!, twinned)
          const why = (d: readonly { code: string; message: string }[]) => d.map((x) => `${x.code}: ${x.message}`).join("; ")
          if ((a.pou === undefined) !== (b.pou === undefined)) {
            findings.push(`${name(unit)}: the network ${a.pou === undefined ? `is refused (${why(a.diagnostics)})` : "lowers"}, its twin ${b.pou === undefined ? `is refused (${why(b.diagnostics)})` : "lowers"}`)
            continue
          }
          if (a.pou === undefined || b.pou === undefined) {
            // both refused: by the same codes, none the network's own
            const codes = (d: readonly { code: string }[]) => [...new Set(d.map((x) => x.code))].sort().join(", ")
            if (codes(a.diagnostics) !== codes(b.diagnostics)) findings.push(`${name(unit)}: the network is refused (${why(a.diagnostics)}), its twin (${why(b.diagnostics)})`)
            refused++
            continue
          }
          const { read, driven } = leaves(a.pou)
          const ta = traces(a.pou, driven, read)
          const tb = traces(b.pou, driven, read)
          const scan = ta.findIndex((t, i) => t !== tb[i])
          if (scan >= 0) findings.push(`${name(unit)}, scan ${scan + 1}:\n  network ${ta[scan]}\n  twin    ${tb[scan]}`)
          compared++
        }
      }
      expect(findings).toEqual([])
      expect({ compared, refused }).toEqual(REACHED[project] ?? { compared: 0, refused: 0 })
    }, TIMEOUT)
  }
})
