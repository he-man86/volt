/**
 * Language conformance — LSP vs recorded IDE ground truth (T.1, the D gate).
 *
 * Runs the LSP's semantic diagnostics over every catalog fixture and compares against PER-VENDOR
 * recordings captured from the LIVE compilers:
 *   - recordings/expected-codesys.json  — CODESYS ground truth (VOLT_BRIDGE_PORT=8556)
 *   - recordings/expected-tc.json       — TwinCAT ground truth  (VOLT_BRIDGE_PORT=8555)
 * The active vendor selects the recording AND the LSP's config, because the two IDEs diverge at times.
 *
 * The single criterion is byte-identical: the LSP's error+warning message SET must equal the
 * compiler's. Two assertions encode the incremental build toward it:
 *   1. NO FALSE POSITIVES (hard, always green): every LSP message is a real IDE message (LSP ⊆ IDE).
 *      This is the safety guarantee — the LSP never invents an error the compiler didn't emit.
 *   2. AGREEMENT RATCHET: the count of fixtures whose sets match EXACTLY only ever rises. Each ported
 *      check lifts it toward full byte-identical parity; `KNOWN_DIVERGENCES` is the documented opt-out.
 *
 * The replay is pure — no live bridge. Re-record via `bun run record:language` against a bridge.
 */
import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseSource } from "../../src/syntax/index.js"
import { buildSymbolTable } from "../../src/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../src/analysis/index.js"
import { ALL_TESTS } from "./fixtures/index.js"

interface RecordedDiagnostic {
  severity: "error" | "warning" | "info"
  message: string
  line: number
}
interface ExpectedRecording {
  recorded: { at: string } | null
  tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>
}

function loadExpected(filename: string): ExpectedRecording {
  const path = join(import.meta.dir, "recordings", filename)
  const raw = JSON.parse(readFileSync(path, "utf8")) as ExpectedRecording
  return { recorded: raw.recorded, tests: raw.tests }
}

const RECORDINGS: ReadonlyArray<{ vendor: Vendor; filename: string; floor: number }> = [
  // floor = current exact-agreement count; raise as checks are ported, never lower.
  // + oop/ (interface-implementation) + pragmas/ (message + orphan-conditional) + names/
  // (unresolved-identifier): 231 TC / 228 CS of 259. Remaining non-agreements are documented IDE-only
  // divergences (parse cascades, app-config warnings, op_sys_* / __-system constructs) — not reproducible
  // offline; the subset (no-FP) gate stays green on them.
  { vendor: "twincat", filename: "expected-tc.json", floor: 236 },
  { vendor: "codesys", filename: "expected-codesys.json", floor: 233 },
]

/** Fixtures that legitimately do NOT match, each with a documented reason. Empty until a real divergence
 *  is confirmed against a recording (not a not-yet-ported check — those are tracked by the ratchet). */
// subrange divergence (confirmed via live /build 2026-07-07): both compilers report a subrange violation as
// a type-CONVERSION error (`Cannot convert type '200' to type 'INT (1..100)'`); our check emits a clear range
// message instead. It never false-positives (a subrange violation IS an error on both), so it's kept for the
// user's benefit but excluded from the byte-identical ratchet. array-index-out-of-bounds is NOT here — its
// wording was locked byte-identical. The overflow fixtures are NO LONGER here: the `constant-overflow` check
// was REMOVED (it false-positived — CODESYS accepts out-of-range untyped literals), so the LSP is now silent
// on them; they read as honest "not-yet-implemented" misses (conversion-warning detection is future work).
const SUBRANGE_DIVERGENCES = ["subrange_init_above_range", "subrange_init_below_range"]
const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
  twincat: new Set<string>(SUBRANGE_DIVERGENCES),
  codesys: new Set<string>(SUBRANGE_DIVERGENCES),
}

// Cross-fixture declaration context: every fixture's interfaces/DUTs/GVLs are visible to the others
// (so `IMPLEMENTS X` resolves), without leaking FBs/methods that collide on common names.
const PARSED = ALL_TESTS.map((t) => ({
  uri: `file:///conformance/${t.pouName}.${extFor(t.kind)}`,
  source: t.source,
  parseResult: parseSource(t.source),
}))
const CROSS_DECLS = PARSED.map((p) => ({
  uri: p.uri,
  source: p.source,
  parseResult: {
    units: p.parseResult.units.filter(
      (u) => u.kind === "interface" || u.kind === "type_decl" || u.kind === "global_var_list",
    ),
    errors: [],
  },
}))
// The recorder builds each fixture with a PLC_PRG that instantiates + uses it; usage-only diagnostics
// (assignment in the caller, external write) live there, so synthesize + analyze it too.
const PLC_PRGS = ALL_TESTS.map((t) => {
  if (t.plcPrgVar === undefined && t.plcPrgBody === undefined) return undefined
  const source = `PROGRAM PLC_PRG\nVAR\n${t.plcPrgVar ?? ""}\nEND_VAR\n${t.plcPrgBody ?? ""}\nEND_PROGRAM\n`
  return { uri: `file:///conformance/${t.name}__plcprg.fb`, source, parseResult: parseSource(source) }
})

function extFor(kind: string): string {
  const map: Record<string, string> = {
    function_block: "fb",
    function: "fun",
    program: "prg",
    gvl: "gvl",
    structure: "struct",
    interface: "itf",
  }
  return map[kind] ?? "fb"
}

/** Every error+warning message the LSP emits for a fixture (incl. parse errors + PLC_PRG usage). */
function runLsp(testIdx: number, vendor: Vendor): string[] {
  const own = PARSED[testIdx] as (typeof PARSED)[number]
  const plc = PLC_PRGS[testIdx]
  const project = buildSymbolTable([
    { uri: own.uri, parseResult: own.parseResult, source: own.source },
    ...(plc ? [{ uri: plc.uri, parseResult: plc.parseResult, source: plc.source }] : []),
    ...CROSS_DECLS.filter((_, i) => i !== testIdx),
  ])
  const config = resolveConfig({ vendor })
  const diags = computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config })
  if (plc) {
    diags.push(...computeSemanticDiagnostics({ parseResult: plc.parseResult, source: plc.source, project, config }))
  }
  const msgs = diags
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${d.message}`)
  for (const e of own.parseResult.errors) msgs.push(`[error] ${e.message}`)
  return msgs.sort()
}

function ideMsgs(ds: readonly RecordedDiagnostic[]): string[] {
  return ds
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${d.message}`)
    .sort()
}

for (const { vendor, filename, floor } of RECORDINGS) {
  const expected = loadExpected(filename)
  const hasRecording = expected.recorded !== null

  describe(`language conformance (LSP vs ${vendor})`, () => {
    if (!hasRecording) {
      it.skip(`(no recording — run \`bun run record:language\` for ${vendor})`, () => {})
      return
    }

    let agree = 0
    const falsePositives: string[] = []
    for (let i = 0; i < ALL_TESTS.length; i++) {
      const test = ALL_TESTS[i] as (typeof ALL_TESTS)[number]
      const rec = expected.tests[test.name]
      if (rec === undefined || KNOWN_DIVERGENCES[vendor].has(test.name)) continue
      const lsp = runLsp(i, vendor)
      const ide = ideMsgs(rec.diagnostics)
      const ideSet = new Set(ide)
      for (const m of lsp) if (!ideSet.has(m)) falsePositives.push(`${test.name}: LSP-only ${m}`)
      if (lsp.length === ide.length && lsp.every((m, k) => m === ide[k])) agree += 1
    }

    it("emits NO false positives (every LSP message is a real IDE message)", () => {
      expect(falsePositives).toEqual([])
    })

    it(`agreement does not regress (>= ${floor})`, () => {
      // eslint-disable-next-line no-console
      console.log(`  [${vendor}] exact agreement: ${agree}/${ALL_TESTS.length} fixtures`)
      expect(agree).toBeGreaterThanOrEqual(floor)
    })
  })
}
