/**
 * THE FIXTURE CONTRACT — one walk over `ALL_TESTS`, and each fixture's EVIDENCE RATING names the row it answers.
 *
 * A fixture is a question put to CODESYS 3.5.21.40. What it is worth depends entirely on whether the vendor
 * answered and whether we match, and `support/evidence.ts` derives exactly that into `t.evidence`:
 *
 *   confirmed    the vendor ran it; the interpreter AND the emitted Rust produce its values
 *   refused      the vendor rejects the source, and so do we — in its own words where a fragment is recorded
 *   not-lowered  the vendor runs it and lowering refuses, under a registered code
 *   diverges     we both execute it and disagree; the fixture says what was measured
 *   lsp-gap      the vendor objects and the LSP is silent; the fixture says so, with a date
 *   unaskable    the oracle cannot put the question, and the fixture says why
 *   unasked      nobody has asked yet — the one rating that must stay at zero
 *
 * WHY ONE FILE AND NOT FOUR. This was `replay` + `refused` + `transpile` + `confidence`. They already shared one
 * input (the fixtures), one derivation (the rating) and one report; what they did not share was a SELECTION. Each
 * re-selected its own subset by hand — `refused !== undefined`, `recording.tests[name] !== undefined`,
 * `deferred?.transpile === undefined` — so a fixture could be covered by three of them and a fixture in a state
 * nobody had thought of by none, silently. The rating is total over the fixtures, so a row that no rating maps to
 * is a hole this table shows. Four hand-written selections cannot show it.
 *
 * WHAT DRIVES THE ROWS is the STORED rating, not a freshly computed one — `map.generated.ts`, written by
 * `bun run rate:fixtures`. That is only safe because the tests under "the table is total" recompute every rating
 * and fail on a disagreement; derived data committed to source needs exactly that gate and nothing less.
 *
 * That file carries the OTHER half of each fixture's row too — the tier its ST lowers to, which oracle reached the
 * emitted Rust, what the Rust linter still says about that Rust, how many pedantic findings it carries, whether the
 * interpreter and the Rust agree on edge inputs, its size and its emission shape — and this gate owns all of it: the
 * tier, the oracle, the shape and the size are recomputed below, and the lints, the pedantic count and the edge
 * verdict come out of the compile (and the run) the Rust blocks already make, one binary per fixture.
 *
 * A RED ROW IS THE PRODUCT BEING WRONG, never the recording. Fix `lower/`, `interp/`, `emit/` or the check —
 * never the expectation.
 *
 * COST. This is the expensive gate: every lowering case is compiled by `rustc` as its own binary, one process per
 * core. It stays its own file precisely so it can be run alone.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CODESYS_ONLY_KEYWORDS, TWINCAT_LITERAL_PREFIXES, decodeStringLiteral, parseDocument, parseSource } from "../../src/frontend/syntax/index.js"
import { build, type Scope } from "../../src/frontend/symbols/index.js"
import { computeSemanticDiagnostics, messagesFor, resolveConfig, type Vendor } from "../../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../../src/network/index.js"
import { CLOCK, emitRust, isBit, lowerSource, run, rustAccess, type IrPou, type IrValue, type LoweredPou } from "../../src/transpile/index.js"
import { lowerCodeKind } from "../../src/transpile/ir/codes.js"
import { CODESYS_TRIAGE, KNOWN_DIVERGENCES, TWINCAT_TRIAGE } from "./support/divergences.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture, splitLists, withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { RECORDING_ENVIRONMENT } from "./support/recording-environment.js"
import { PROJECT_LIBRARY, PROJECT_BASE, PROJECT_MANIFESTS, projectDevices } from "./support/project-libraries.js"
import { CLIPPY, RUSTC as rustc, skipLintCheck, skipRustSuite } from "./support/rustc.js"
import { buildRust } from "./support/rustc-cache.js"
import { selectFixtures } from "./support/selection.js"

/** The fixtures this run covers — all of them, or the ones `VOLT_FIXTURES` names (`support/selection.ts`). Every
 *  per-fixture row walks THIS; `ALL_TESTS` stays the universe a fixture is assembled, rated and bound in, so a named
 *  fixture is checked against exactly the project the full run checks it against. */
const SELECTION = selectFixtures(ALL_TESTS)
/** A project-wide total — a partial run cannot answer it, and skips it (the loud line says so). */
const whole = test.skipIf(SELECTION.partial)

/** What a harness binary is run with — the recorded scan, and the edge run. A re-proved cache hit runs both builds on
 *  each (`support/rustc-cache.ts`). */
const HARNESS_PROBES = [[], [EDGE_ARG]]
import {
  buildArgv,
  assertPolicy,
  correctnessOf,
  assertNotes,
  deadNotes,
  divergesOf,
  EDGE_ARG,
  edgeHarness,
  edgePlan,
  edgeSeeds,
  edgeVerdict,
  HARNESS_LOOP_GUARD,
  emissionShape,
  normalizeRustLine,
  NOTES,
  notesOf,
  reachesLibm,
  rejectionIsADefect,
  renderNotes,
  rendered,
  shapeId,
  sizeRatio,
  splitFindings,
  tierOf,
  type EdgeVerdict,
} from "./support/transpile-confidence.js"
import { STRING_PRELUDE } from "../../src/transpile/emit/rust/prelude.js"
import { elementaryType, elementaryTypeRef } from "../../src/frontend/types/index.js"
import { comparable } from "./support/compare-message.js"
import { EVIDENCE_ORDER, lspErrors, rateFixture, type Evidence } from "./support/evidence.js"
import { expectStillDiverges } from "./support/expected-failure.js"
import type { LanguageTest } from "./types.js"

// ─── the recordings ──────────────────────────────────────────────────────────────────────────────────────────

interface RecordedDiagnostic {
  severity: "error" | "warning" | "info"
  message: string
  line: number
}
interface BuildRecording {
  recorded: { at: string } | null
  tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>
}
interface RunRecorded {
  cycles?: string
  values?: Record<string, string>
  error?: string
  unreadable?: Record<string, string>
}

const RECORDINGS_DIR = join(import.meta.dir, "recordings")
const readRecording = <T>(name: string): T => JSON.parse(readFileSync(join(RECORDINGS_DIR, name), "utf8")) as T

/** What each IDE's BUILD said — per vendor, because the two compilers diverge at times. */
const BUILDS: Record<Vendor, BuildRecording> = {
  codesys: readRecording<BuildRecording>("codesys.build.json"),
  twincat: readRecording<BuildRecording>("twincat.build.json"),
}
/** What CODESYS's SIMULATOR did — every variable after N scans, or the reason it could not run. */
const RUNS = readRecording<{ tests: Record<string, RunRecorded> }>("codesys.run.json").tests

// ─── one lowering per fixture, shared by every row that needs one ────────────────────────────────────────────

const loweredCache = new Map<string, LoweredPou>()
function lowering(c: LanguageTest): LoweredPou {
  let lowered = loweredCache.get(c.name)
  if (lowered === undefined) {
    // A GVL is an object of its own, named by its pouName — `GVL_Name.var` reaches it only under that name, which a
    // file gives it. Folded into the one source, every list was named `source`, and no qualified access could resolve.
    const { source, gvls } = assembleFixture(c, ALL_TESTS)
    lowered = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE)
    loweredCache.set(c.name, lowered)
  }
  return lowered
}

/** The source a case lowers from, unassembled — used only to read the enum declarations out of. */
function runSource(c: LanguageTest): string {
  const sources = withDependencies(c, ALL_TESTS)
    .map((f) => f.source)
    .filter((s) => s !== "")
  return [...sources, plcPrgSource(c)].join("\n")
}

/** Each `Type.Value` a case's enums declare, as the number it is: the written `:= n`, else one more than the value
 *  before it, from 0 — how CODESYS numbers them (conformance `type_dut_enum_*`). A referenced library's enum displays
 *  the same way (`enum_library_bare`: `GEN_MODE.SAWTOOTH_RISE`), so the fixture project's libraries' are numbered too,
 *  and a fixture's own enum of a library enum's name is the one it means. */
function enumsOf(c: LanguageTest): Map<string, bigint> {
  const out = new Map<string, bigint>(libraryEnums())
  numberEnums(out, parseSource(runSource(c), { networkText: true }).units)
  return out
}

let libraryEnumsCache: ReadonlyMap<string, bigint> | undefined
const libraryEnums = (): ReadonlyMap<string, bigint> => {
  if (libraryEnumsCache === undefined) {
    const out = new Map<string, bigint>()
    numberEnums(out, PROJECT_LIBRARY.flatMap((f) => f.parseResult?.units ?? []))
    libraryEnumsCache = out
  }
  return libraryEnumsCache
}

function numberEnums(out: Map<string, bigint>, units: readonly import("../../src/frontend/syntax/index.js").TopLevel[]): void {
  const number = (prefix: string, values: readonly { name: { text: string }; value?: import("../../src/frontend/syntax/index.js").Expr }[]) => {
    let next = 0n
    for (const v of values) {
      // `Cold := -1` is a unary minus over a literal — reading literals only numbered it as the value before it plus one
      const negated = v.value?.kind === "unary" && v.value.op === "-" ? v.value.operand : undefined
      const literal = negated ?? v.value
      const magnitude = literal?.kind === "literal" && typeof literal.value === "bigint" ? literal.value : undefined
      const written = magnitude === undefined ? undefined : negated === undefined ? magnitude : -magnitude
      const value = written ?? next
      out.set(`${prefix}.${v.name.text}`.toUpperCase(), value)
      next = value + 1n
    }
  }
  for (const unit of units) {
    if (unit.kind === "type_decl" && unit.body.kind === "enum") number(unit.name.text, unit.body.values)
    // an implicit enumeration displays under a name of the IDE's making: `Implicit_Enum__FB_LANG_implicit_enum__eState.Running`
    if ("varSections" in unit && "name" in unit && unit.name !== undefined)
      for (const section of unit.varSections)
        for (const decl of section.decls) {
          // …and an ARRAY OF one, under the ARRAY variable's name (`decl_implicit_enum_in_array`:
          // `Implicit_Enum__FB_LANG_decl_implicit_enum_in_array__a.ia_a` for `a[0]`)
          let type = decl.type
          while (type.kind === "array_type") type = type.element
          if (type.kind === "implicit_enum_type") for (const n of decl.names) number(`Implicit_Enum__${unit.name.text}__${n.text}`, type.values)
        }
  }
}

// ─── the vendor's display formats ────────────────────────────────────────────────────────────────────────────

/** A monitoring string as CODESYS prints it — `INT#5`, `REAL#3`, `TRUE` — as the interpreter's value. A form this
 *  does not know is refused, never guessed: a wrong parse would make both sides agree on something untrue. */
function ideValue(raw: string, enums: ReadonlyMap<string, bigint> = new Map()): IrValue {
  if (raw === "TRUE") return true
  if (raw === "FALSE") return false
  // an enum value displays by NAME — `DUT_LANG_enum_simple.Running` — where both backends hold its number
  const enumValue = /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(raw) ? enums.get(raw.toUpperCase()) : undefined
  if (enumValue !== undefined) return enumValue
  // A STRING displays quoted and re-escaped: `'a$Tb'` holds a tab and `'x$$y'` one dollar (conformance `string_escapes`).
  // A WSTRING displays in double quotes: `"héllo"`.
  const quote = raw[0]
  if (raw.length >= 2 && (quote === "'" || quote === '"') && raw.endsWith(quote)) {
    const text = decodeStringLiteral(raw.slice(1, -1), quote === '"')
    if (text === undefined) throw new Error(`unrecognised escape in IDE value ${JSON.stringify(raw)}`)
    return text
  }
  // A date prints as `DATE#2024-2-28`, `DATE_AND_TIME#2024-2-29-0:0:0`, `TIME_OF_DAY#12:30:15.500` (L-prefixed for the
  // 64-bit ones, with up to nine fraction digits). The IR holds DATE/DT in seconds, TOD in milliseconds, L* in ns.
  const calendar = /^(L?)(DATE_AND_TIME|DATE|TIME_OF_DAY)#(.+)$/.exec(raw)
  if (calendar !== null) {
    const [, long, kind, text] = calendar as unknown as [string, string, string, string]
    const clock = (h: string, m: string, s: string, frac = ""): bigint =>
      ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(s)) * 1_000_000_000n +
      BigInt(frac.padEnd(9, "0").slice(0, 9) || "0")
    let ns: bigint
    if (kind === "TIME_OF_DAY") {
      const t = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)!
      ns = clock(t[1]!, t[2]!, t[3]!, t[4])
    } else {
      const d = /^(\d+)-(\d+)-(\d+)(?:-(\d+):(\d+):(\d+)(?:\.(\d+))?)?$/.exec(text)!
      ns = BigInt(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) / 86_400_000) * 86_400_000_000_000n
      if (d[4] !== undefined) ns += clock(d[4], d[5]!, d[6]!, d[7])
    }
    if (long === "L") return ns
    return ns / (kind === "TIME_OF_DAY" ? 1_000_000n : 1_000_000_000n)
  }
  // A duration prints as its components — `TIME#49d17h2m46s796ms`, `LTIME#1s1ns` — and the IR holds TIME in
  // milliseconds and LTIME in nanoseconds.
  const duration = /^(L?TIME)#((?:\d+(?:ms|us|ns|d|h|m|s))+)$/.exec(raw)
  if (duration !== null) {
    const unit: Record<string, bigint> = {
      d: 86_400_000_000_000n,
      h: 3_600_000_000_000n,
      m: 60_000_000_000n,
      s: 1_000_000_000n,
      ms: 1_000_000n,
      us: 1_000n,
      ns: 1n,
    }
    let ns = 0n
    for (const [, count, u] of duration[2]!.matchAll(/(\d+)(ms|us|ns|d|h|m|s)/g)) ns += BigInt(count!) * unit[u!]!
    return duration[1] === "LTIME" ? ns : ns / 1_000_000n
  }
  // A NaN prints as `REAL#NaN` — the only non-numeric REAL spelling in any recording (checked across both, 2026-09-18).
  // It reached here as an unrecognised form, which is this function refusing to guess rather than a defect.
  const notANumber = /^L?REAL#NaN$/.exec(raw)
  if (notANumber !== null) return Number.NaN
  // `REAL#Infinity` and `REAL#-Infinity`. The comment above once said NaN was the only non-numeric REAL spelling in
  // any recording; `bound_real_above_max` and `realovf_multiply_to_infinity` falsified that the day they were
  // written. An infinity is an ordinary value to this vendor — see `ir/values.ts`.
  const infinite = /^L?REAL#(-?)Infinity$/.exec(raw)
  if (infinite !== null) return infinite[1] === "-" ? -Infinity : Infinity
  const m = /^([A-Z]+)#(-?[0-9.eE+-]+)$/.exec(raw)
  if (m === null) throw new Error(`unrecognised IDE value ${JSON.stringify(raw)}`)
  const [, type, literal] = m as unknown as [string, string, string]
  if (type === "REAL") return Math.fround(Number(literal))
  if (type === "LREAL") return Number(literal)
  return BigInt(literal)
}

/**
 * A stored value as CODESYS DISPLAYS it. Its date displays lose information: a TOD shows modulo a day — TOD#12:30:15.5
 * + T#12H stores 88215500 ms but reads back `TIME_OF_DAY#0:30:15.500` — and a DATE shows no time of day. So the
 * interpreter's and emitter's values are reduced the same way before comparing; the STORED truth is compared through
 * the cases' own `*Units` variables (`TOD_TO_UDINT(…)`), which display losslessly.
 */
function asDisplayed(raw: string, value: IrValue): IrValue {
  // A STRING IS STORED AS UTF-8 BYTES AND DISPLAYED AS TEXT. `strings/escapes.ts` measured both halves: `LEN('a$FFb')`
  // is 4, so the bytes are what the value IS, and the IDE reads it back as `'aÿb'`, so decoding is what the DISPLAY
  // does. We hold the bytes one JS char each (`literal-value.ts`), which is the right model and the wrong thing to
  // compare against the IDE's text — so it is decoded here, in the one place that owns the vendor's display format.
  // ...a NARROW string only. A WSTRING is UTF-16 code units, not UTF-8 bytes, and the IDE tells them apart by the
  // quote it displays: `'abc'` for a STRING, `"abc"` for a WSTRING (`prim_default_string` beside
  // `prim_default_wstring`). Decoding a WSTRING here mangled `wstring_basic` and `wstring_code_units`.
  if (typeof value === "string" && raw.startsWith("'"))
    return new TextDecoder().decode(Uint8Array.from(value, (ch) => ch.charCodeAt(0) & 0xff))
  if (typeof value !== "bigint") return value
  const floorTo = (v: bigint, step: bigint): bigint => v - (((v % step) + step) % step)
  if (raw.startsWith("TIME_OF_DAY#")) return ((value % 86_400_000n) + 86_400_000n) % 86_400_000n
  if (raw.startsWith("LTIME_OF_DAY#"))
    return ((value % 86_400_000_000_000n) + 86_400_000_000_000n) % 86_400_000_000_000n
  if (raw.startsWith("DATE#")) return floorTo(value, 86_400n)
  // The IDE displays an LDATE's 64-bit count SIGNED: `xf_tod_to_ldate_call_once` records raw 2^64 - 2e9 beside
  // `LDATE#1969-12-31`.
  if (raw.startsWith("LDATE#")) return floorTo(BigInt.asIntN(64, value), 86_400_000_000_000n)
  // ...and an LDT's the same way: `tr_12_fmt_long_dates` records LDT#2300-01-01's raw 2^64-wrapped count as
  // `LDATE_AND_TIME#1715-6-13-0:25:26.290448384` — the same bits read as a signed i64.
  if (raw.startsWith("LDATE_AND_TIME#")) return BigInt.asIntN(64, value)
  return value
}

/** The recorded values a run can reproduce — all but the ones that read the IDE's wall clock (`LanguageTest.wallClock`). */
const reproducible = (c: LanguageTest, rec: RunRecorded): [string, string][] =>
  Object.entries(rec.values!).filter(([path]) => !(c.wallClock ?? []).includes(path))

/** The instant scan `i` (from 1) of a CLOCKED fixture saw, in the nanoseconds `CLOCK` counts — or undefined for an
 *  unclocked one (`LanguageTest.clock`). A clocked fixture whose recording lacks one is a harness fault, thrown. */
function clockAt(c: LanguageTest, rec: RunRecorded, i: number): bigint | undefined {
  if (c.clock === undefined) return undefined
  const raw = rec.values?.[`${c.clock}[${i}]`]
  if (raw === undefined) throw new Error(`${c.name}: no recorded ${c.clock}[${i}] to run scan ${i} on`)
  return (ideValue(raw) as bigint) * 1_000_000n // a TIME counts milliseconds
}

/** The recorded values as the IR holds them, and the interpreter's answers reduced to the same display. */
function compareInterp(c: LanguageTest, rec: RunRecorded): void {
  const lowered = lowering(c)
  if (lowered.pou === undefined)
    throw new Error(`cannot lower: ${lowered.diagnostics[0]?.message} [${lowered.diagnostics[0]?.code}]`)
  const pou = run(lowered.pou)
  for (let i = 1; i <= (c.cycles ?? 1); i++) {
    const now = clockAt(c, rec, i)
    if (now !== undefined) pou.set(CLOCK, now)
    pou.scan()
  }
  const want = Object.fromEntries(reproducible(c, rec).map(([k, v]) => [k, ideValue(v, enumsOf(c))]))
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, asDisplayed(rec.values![k]!, pou.get(k) as IrValue)]))
  expect(got).toEqual(want)
  // a wall-clock path is not compared, and it is still one the run must PRODUCE
  for (const path of c.wallClock ?? []) expect(typeof pou.get(path)).toBe("bigint")
}

// ─── the rating rows ─────────────────────────────────────────────────────────────────────────────────────────

/** Every fixture under the rating it stores. A rating with no fixtures is not an error; a fixture with a rating
 *  this file has no row for IS, and the last test in the table says so. */
const BY_RATING = new Map<Evidence, LanguageTest[]>(EVIDENCE_ORDER.map((r) => [r, []]))
for (const t of SELECTION.selected) BY_RATING.get(t.evidence as Evidence)?.push(t)
const rated = (r: Evidence): LanguageTest[] => BY_RATING.get(r) ?? []

/** Every fixture by name — the lint ratchet looked one up per case, which is 1,900 x 2,600 string compares a run. */
const BY_NAME = new Map<string, LanguageTest>(ALL_TESTS.map((t) => [t.name, t]))

/**
 * Where a compiled case's lints disagree with its stored row, in EITHER direction — a new one is the emitted Rust
 * getting worse, a missing one is a row excusing a lint the emitter no longer produces.
 */
const lintDrift = (found: Map<string, string[]>): string[] =>
  [...found]
    .map(([name, got]) => {
      const stored = new Set(BY_NAME.get(name)?.transpile?.lints ?? [])
      const mine = new Set(got)
      const extra = [...mine].filter((l) => !stored.has(l)).sort()
      const gone = [...stored].filter((l) => !mine.has(l)).sort()
      return [name, extra, gone] as const
    })
    .filter(([, extra, gone]) => extra.length > 0 || gone.length > 0)
    .map(([name, extra, gone]) =>
      `${name}:${extra.length > 0 ? ` now reports ${extra.join(", ")}` : ""}${gone.length > 0 ? ` no longer reports ${gone.join(", ")}` : ""}`,
    )

/** What one fixture's compile and edge run measured — the three columns only a built binary can answer. */
interface Measured {
  lints: string[]
  pedantic: number
  edge: EdgeVerdict
}

/**
 * THE PEDANTIC COUNT AND THE EDGE VERDICT, stored against computed — the same symmetric check `lintDrift` makes, for
 * the two columns that come out of the same build. An edge verdict that moved is either an emitter change (regenerate)
 * or a backend that started to disagree with the other (the `disagree` rows in the map's header say where).
 */
const measuredDrift = (found: Map<string, Measured>): string[] =>
  [...found].flatMap(([name, got]) => {
    const stored = BY_NAME.get(name)?.transpile
    const out: string[] = []
    if (stored?.pedantic !== got.pedantic) out.push(`${name}: pedantic stored ${stored?.pedantic}, computed ${got.pedantic}`)
    if (stored?.edge !== got.edge) out.push(`${name}: edge stored ${stored?.edge}, computed ${got.edge}`)
    return out
  })

/**
 * The edge column for one built fixture — run only when it built and there is something to seed; a fixture whose
 * Rust did not build, or that has no elementary variable, is `not-run` exactly as the generator writes it.
 */
async function edgeOf(built: boolean, exe: string, pou: IrPou, plan: ReturnType<typeof edgePlan>): Promise<EdgeVerdict> {
  if (!built || "notRun" in plan) return "not-run"
  return (await edgeVerdict(exe, pou, plan)).verdict
}

/** A built case's run: its exit, and what it printed. `exit: -1` is a case that did not build (or lower). */
interface RustRun {
  exit: number
  stdout: string
  stderr: string
}

/** The body of `main` that runs a case's RECORDED scan and prints every recorded path, tab-separated — what
 *  `compareRust` reads back. */
function recordedScan(c: LanguageTest, pou: IrPou, emitted: ReturnType<typeof emitRust>): string {
  const prints = Object.keys(RUNS[c.name]!.values!).map((name) => {
    const { expr, type, global } = rustAccess(pou, name)
    // A REAL prints with Debug, which keeps its decimal point. A STRING prints its BYTES as a list — not Debug, whose
    // `\u{c}` for a form feed is no JSON — so no control character inside it can break this tab-separated output.
    const family = type.kind === "elementary" ? type.elem.family : undefined
    // an FB's VAR_STAT read through an instance lives in the application's globals
    const field = `${global ? "g" : "p"}.${expr}${family === "string" ? ".units()" : ""}`
    return `    println!("${name}\\t{${family === "real" || family === "string" ? ":?" : ""}}", ${field});`
  })
  // a program that reaches globals or calls PROGRAMs scans against one of each, created once like the IDE's application
  const setup = [
    ...(emitted.usesGlobals ? ["    let mut g = Globals::new();"] : []),
    ...(emitted.usesPrograms ? ["    let mut prg = Programs::new();"] : []),
  ]
  const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : [])].join(", ")
  // a POU with an init step (a `call_after_global_init_slot` method) runs it once, before the first scan
  const init = pou.init === undefined ? [] : [`    p.init(${args});`]
  // a CLOCKED fixture scans on the instants the recording saw: `CLOCK` assigned before each scan
  const clock = c.clock === undefined ? undefined : rustAccess(pou, CLOCK).expr
  const scans =
    clock === undefined
      ? [`    for _ in 0..${c.cycles ?? 1} { p.scan(${args}); }`]
      : Array.from({ length: c.cycles ?? 1 }, (_, i) => `    g.${clock} = ${clockAt(c, RUNS[c.name]!, i + 1)!}; p.scan(${args});`)
  const scan = [...setup, ...init, ...scans].join("\n")
  return `    let mut p = ${pou.name}::new();\n${scan}\n${prints.join("\n")}\n`
}

/** A built case's printed values against the recording — the Rust half of a value comparison. Throws on a mismatch. */
function compareRust(c: LanguageTest, result: RustRun): void {
  expect({ exit: result.exit, stderr: result.stderr }).toEqual({ exit: 0, stderr: "" })
  const rec = RUNS[c.name]!
  const pou = lowering(c).pou!
  const printed = new Map(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("\t") as [string, string]),
  )
  const want = Object.fromEntries(reproducible(c, rec).map(([k, v]) => [k, ideValue(v, enumsOf(c))]))
  for (const path of c.wallClock ?? []) expect(printed.has(path)).toBe(true)
  const got = Object.fromEntries(
    Object.keys(want).map((k) => {
      const { type } = rustAccess(pou, k)
      const raw = printed.get(k)!
      if ((type.kind === "elementary" && type.elem.family === "bool") || isBit(type)) return [k, raw === "true"]
      // The Rust side prints a STRING as its BYTES, which is what it holds — decoded as UTF-8 for the same
      // reason `asDisplayed` decodes the interpreter's: the IDE shows text, the value is bytes.
      if (type.kind === "elementary" && type.elem.family === "string")
        return [
          k,
          type.elem.bits === 8
            ? new TextDecoder().decode(Uint8Array.from(JSON.parse(raw) as number[]))
            : String.fromCharCode(...(JSON.parse(raw) as number[])), // a WSTRING is UTF-16 code units
        ]
      if (type.kind === "elementary" && type.elem.family === "real") {
        // RUST SPELLS AN INFINITY `inf`, and `Number("inf")` is NaN — so an overflow read back as a NaN and
        // every real-overflow fixture reported the wrong divergence. `Number` handles `NaN` itself.
        const n = raw === "inf" ? Infinity : raw === "-inf" ? -Infinity : Number(raw)
        return [k, type.elem.bits === 32 ? Math.fround(n) : n]
      }
      return [k, asDisplayed(rec.values![k]!, BigInt(raw))]
    }),
  )
  expect(got).toEqual(want)
}

/** The vendor stopped; so must we — by refusing to lower (with a reason) or by throwing in the scan. */
function compareFault(c: LanguageTest): void {
  const lowered = lowering(c)
  if (lowered.pou === undefined) {
    // Refused before it could run — a stricter refusal, still a refusal. It must SAY why: a lowering that
    // produced neither a POU nor a diagnostic would be this test passing on an empty result.
    expect(lowered.diagnostics.length).toBeGreaterThan(0)
    return
  }
  expect(() => {
    const pou = run(lowered.pou!)
    for (let i = 0; i < (c.cycles ?? 1); i++) pou.scan()
  }).toThrow()
}

/** The Rust runs of the `diverges` fixtures, filled by the rest-of-the-lowered pass that already builds them, and
 *  read by their expected-failure rows. Empty where there is no `rustc` — their Rust half is then unmeasured. */
const DIVERGES_RUST = new Map<string, RustRun>()

/**
 * THE VENDOR RAN IT AND SO DO WE. Two halves, because they fail differently: the interpreter and the emitter print
 * the same IR, so a LOWERING bug shows in both — but an EMITTER bug (a Rust operator that does not mean what the
 * IEC one does) shows only in the Rust half.
 *
 * A REAL compares as the 32-bit float the IDE holds, so a backend computing in float64 fails here. That is a real
 * divergence, not rounding noise.
 *
 * THE VENDOR STOPPING IS ALSO AN ANSWER, and `confirmed` covers it. A fixture written to build can FAULT when it
 * runs — `use_pointer_deref_struct_field` writes through a pointer its FB body never set, `cc_div_udint_dint`
 * divides by a zero-initialised DINT — and the simulator STOPS THE APPLICATION, which reaches the recorder as a
 * timeout or a done flag that never rose. There is no value to compare, and that used to make it a counted `todo`:
 * the case was named and then never run. But "no value to compare" is not "nothing to check". CODESYS's answer is
 * REFUSAL, and refusal is behaviour the transpiler has to match — the failure this guards against is the
 * interpreter quietly returning a number for `p^` on a null pointer or for `a / 0`, which is a silent divergence on
 * exactly the inputs where being wrong is worst.
 *
 * EITHER refusal counts and the two are not ranked: throwing at run time, or not lowering at all (`pointer-order`
 * catches a deref of an unbound pointer a stage EARLIER than CODESYS does). Asserting the disjunction keeps this
 * green when a construct graduates from "cannot lower" to "lowers, then faults", which is progress. What it will
 * never let through is a completed scan.
 */
describe("confirmed — the vendor ran it, and we produce its values", () => {
  for (const c of rated("confirmed")) {
    const rec = RUNS[c.name]!
    if (rec.error !== undefined) {
      test(`${c.name} — faults in CODESYS (${rec.error.slice(0, 40)}), and must fault here too`, () => compareFault(c))
      continue
    }
    test(c.name, () => {
      expect(rec.unreadable).toBeUndefined()
      expect(ideValue(rec.cycles!)).toBe(BigInt(c.cycles ?? 1)) // the recorder's gate held
      compareInterp(c, rec)
    })
  }
})

/**
 * THE SAME RECORDINGS, THROUGH THE EMITTED RUST. Each case is its own binary, so one that does not compile or
 * panics cannot take the others down; and a DEBUG build on purpose, where an arithmetic overflow panics — a panic
 * is a divergence, not noise. Skipped where rustc is absent, like `emit.test.ts`.
 */
describe.skipIf(skipRustSuite())("confirmed — the same values out of the emitted Rust", () => {
  // LOWERED HERE, AT REGISTRATION, not inside `beforeAll`. Lowering is synchronous JS: done on the worker lanes it
  // does not overlap with anything, so all 1880 of them land INSIDE the hang guard and push it over 180s. The lanes
  // exist to overlap `rustc` processes, and this keeps them doing only that.
  const recorded = rated("confirmed").filter((c) => RUNS[c.name]?.values !== undefined && lowering(c).pou !== undefined)
  const runs = new Map<string, RustRun>()
  /** What the linter said about each case's EMITTED code, and what its edge run found — the halves of its row in
   *  `map.generated.ts` only this build can answer. */
  const measured = new Map<string, Measured>()

  beforeAll(async () => {
    const started = performance.now()
    const dir = await mkdtemp(join(tmpdir(), "volt-exec-rust-"))
    // BOUNDED CONCURRENCY, not `Promise.all` over every case. Each case spawns `rustc`, and at 2253 fixtures that
    // was 2253 compilers at once — which is not parallelism, it is thrashing, and it pushed this past its own hang
    // guard as the census sweeps landed. One per core keeps every core busy and the scheduler out of it.
    //
    // The guard stays 180s and stays a HANG guard: it is not the budget that changed, it is the shape.
    const lanes = Math.max(1, navigator.hardwareConcurrency - 1)
    let next = 0
    await Promise.all(
      // each case its own try: one that throws while being prepared fails as itself, not as every Rust case at once
      Array.from({ length: Math.min(lanes, recorded.length) }, async () => {
        for (let i = next++; i < recorded.length; i = next++) {
          const c = recorded[i]!
          try {
            await prepare(c)
          } catch (error) {
            runs.set(c.name, { exit: -1, stdout: "", stderr: `could not be prepared: ${(error as Error).message}` })
          }
        }
      }),
    )
    await rm(dir, { recursive: true, force: true })
    console.log(`  [rust] ${recorded.length} cases compiled+run in ${Math.round((performance.now() - started) / 1000)}s`)

    async function prepare(c: LanguageTest): Promise<void> {
      const { pou, diagnostics } = lowering(c)
      if (pou === undefined)
        return void runs.set(c.name, { exit: -1, stdout: "", stderr: `does not lower: ${diagnostics[0]?.message}` })
      // built with the harness's loop guard, which the edge run's seeds need and no recorded pass count reaches
      const emitted = emitRust(pou, { loopGuard: HARNESS_LOOP_GUARD })
      // THE EDGE RUN RIDES THE SAME BINARY: `main` runs the recorded scan, or with `edge` the edge variants
      const plan = edgePlan(c, ALL_TESTS, pou, emitted.code)
      const main = edgeHarness(pou, emitted, plan, recordedScan(c, pou, emitted))
      const file = join(dir, `${c.name}.rs`)
      const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
      // ST has no dynamic memory, so the Rust needs no `unsafe` — forbidden, so a case needing it fails rather than builds
      //
      // DENY warnings, with the exceptions `support/transpile-confidence.ts` names and REASONS. This used to be
      // `-A warnings`, which meant 600+ emitted programs were compiled with no lint checking at all while the
      // crate check applied real lints to about fifteen — one policy per harness, and the larger one denied
      // nothing. Measured when it was flipped: 2 of 625 failed, and BOTH were faithful emissions of correct ST
      // rather than emitter defects (a statement after RETURN, and a SINT loop bound of 127 that rustc reads as
      // a tautology), which is why those two lints are named there instead of the flip being abandoned.
      //
      // `-A unused_parens` USED TO BE ON THAT LIST, under "generated code is not read for style". It is not on it
      // any more: `emit/rust/index.ts` declares an emitted SURFACE a user's harness reaches into, so somebody reads
      // this code, and the printer was emitting 2,722 pairs of parentheses no one would write.
      //
      // BUILT WITH `clippy-driver` WHERE THERE IS ONE — a drop-in for `rustc` that also runs the lints, so the
      // OPTIMALITY half of the map costs the compile this pass was already paying for.
      //
      // NOTHING IS DENIED. `LINT_FLAGS` is `-W warnings -W clippy::all`, warn and not deny, for the reason spelled
      // out where it is defined: `-D` makes a diagnostic `level: "error"`, so a findings parser reading warnings
      // sees nothing and every row is written clean while the build fails for a reason no row records. What a
      // rustc lint used to get from `-D warnings` it gets from the RATCHET below instead — a fixture may report
      // only the lints its stored row carries — which is the same guarantee per fixture and covers clippy's too.
      // A real compile ERROR still fails the build here; it is not a lint.
      //
      // THROUGH THE CACHE (`support/rustc-cache.ts`): a source, argv and compiler already built are not built again.
      const build = await buildRust(buildArgv(CLIPPY ?? rustc!, file, { exe }), file, exe, `${emitted.code}\n${main}`, HARNESS_PROBES)
      const buildExit = build.exit
      const buildErr = build.stderr
      const findings = splitFindings(buildErr, emitted.code.split("\n").length)
      const measure = (edge: EdgeVerdict) =>
        measured.set(c.name, { lints: findings.found.map((f) => f.code), pedantic: findings.pedantic.length, edge })
      if (buildExit !== 0) measure("not-run")
      if (buildExit !== 0)
        return void runs.set(c.name, {
          exit: -1,
          stdout: "",
          stderr: `does not compile:\n${rendered(buildErr)}`,
        })
      const run = Bun.spawn([exe], { stdout: "pipe", stderr: "pipe" })
      const exit = await run.exited
      runs.set(c.name, {
        exit,
        stdout: await new Response(run.stdout).text(),
        stderr: await new Response(run.stderr).text(),
      })
      measure(await edgeOf(true, exe, pou, plan))
    }
    // A HANG GUARD PROPORTIONAL TO THE WORK, not a constant. Measured 2026-09-20: 1857 cases compile and run in
    // 179s — against a guard of 180s, which it had silently grown into. That is the failure mode a constant has:
    // it is a budget the suite outgrows without anybody deciding to, and it fails as a timeout, which reads as a
    // hang rather than as "there are more fixtures now". 300ms per case is ~3x the measured cost, so a real hang
    // still fails and a thousand more fixtures do not.
  }, Math.max(120_000, recorded.length * 300))

  for (const c of recorded) {
    test(c.name, () => compareRust(c, runs.get(c.name)!))
  }

  /**
   * THE LINT ROWS, CHECKED IN BOTH DIRECTIONS — the optimality half of `map.generated.ts`, and what a rustc lint
   * gets instead of the `-D warnings` that moved out of the build above.
   *
   * IT USED TO FAIL ONLY UPWARD, on the reasoning that a fix which removes a finding is the point of the sweep and
   * should not arrive red. That was wrong in the way one-way ratchets always are: a row that still lists a lint the
   * emitter no longer produces EXCUSES that lint for that fixture forever, so a later regression reintroducing it
   * is green. Nothing else reclaimed a stale row — `rate:fixtures --check` is in no CI job.
   *
   * So it is symmetric, like `the stored rating on every fixture matches the computed one` already is: stored data
   * must equal computed data, and an improvement is a regeneration rather than an exception.
   */
  test.skipIf(skipLintCheck())("every case's lints are exactly what its stored row carries", () => {
    const stale = lintDrift(new Map([...measured].map(([name, m]) => [name, m.lints])))
    if (stale.length > 0) console.log("  [fixtures] the emitted Rust changed — run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })

  test.skipIf(skipLintCheck())("every case's pedantic count and edge verdict are what its stored row carries", () => {
    const stale = measuredDrift(measured)
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })
})

/**
 * THE LOWERED FIXTURES THE VALUE PASS DOES NOT REACH — compiled, and run only on edge inputs.
 *
 * The block above needs RECORDED VALUES, so it selects `confirmed` fixtures that have them: 1,912 of the 2,295 that
 * lower. The other 383 emitted Rust that nothing in this suite ever built, and their rows said `rust: "compiles"`
 * anyway — because the generator ran the compiler and threw the exit code away. **Six of them do not compile.**
 * All six are outside the input contract (`evidence: refused` — `i : INT := 1.5` emits `1.5i16`), which makes the
 * EMISSION defensible and the claim false; the map says `rejected` for them now.
 *
 * So this exists to make the claim checkable on every push, and to put the 383 under the lint ratchet with the
 * rest. Nothing recorded is compared — which is why it is its own block and not a widened selection above: that
 * one's whole shape is print-the-values-and-diff-them. What does run is the EDGE differential (interpreter against
 * the Rust on inputs nobody recorded), so the build is an executable; for exactly two fixtures that is stricter than
 * the metadata build this used to make (`array_index_const_*`: rustc's deny-by-default `unconditional_panic`),
 * and both are refused by CODESYS, so `rejected` is the honest oracle for them.
 */
describe.skipIf(skipRustSuite())("the rest of the lowered fixtures — the emitted Rust builds, or says why not", () => {
  const seen = new Set(rated("confirmed").filter((c) => RUNS[c.name]?.values !== undefined).map((c) => c.name))
  const rest = SELECTION.selected.filter((t) => !seen.has(t.name) && t.transpile?.tier !== undefined)
  const built = new Map<string, { ok: boolean; why: string } & Measured>()

  beforeAll(async () => {
    const started = performance.now()
    const dir = await mkdtemp(join(tmpdir(), "volt-exec-rust-rest-"))
    const lanes = Math.max(1, navigator.hardwareConcurrency - 1)
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(lanes, rest.length) }, async () => {
        for (let i = next++; i < rest.length; i = next++) {
          const c = rest[i]!
          const pou = lowering(c).pou
          if (pou === undefined) continue
          const emitted = emitRust(pou, { loopGuard: HARNESS_LOOP_GUARD })
          // AN EXECUTABLE, like the value pass and the generator: the edge run needs one, and `rust` then means one
          // build everywhere — the generator's `compiles`/`rejected` is decided by this same argv.
          const plan = edgePlan(c, ALL_TESTS, pou, emitted.code)
          const file = join(dir, `${c.name}.rs`)
          const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
          // A `diverges` fixture the vendor RAN also gets the recorded scan, so its expected-failure row can tell
          // the day its Rust starts producing CODESYS's values (`DIVERGES_RUST`).
          const valued = c.evidence === "diverges" && RUNS[c.name]?.values !== undefined
          const source = `${emitted.code}\n${edgeHarness(pou, emitted, plan, valued ? recordedScan(c, pou, emitted) : "")}`
          const build = await buildRust(buildArgv(CLIPPY ?? rustc!, file, { exe }), file, exe, source, HARNESS_PROBES)
          const ok = build.exit === 0
          const stderr = build.stderr
          if (valued && !ok) DIVERGES_RUST.set(c.name, { exit: -1, stdout: "", stderr: `does not compile:\n${rendered(stderr)}` })
          if (valued && ok) {
            const run = Bun.spawn([exe], { stdout: "pipe", stderr: "pipe" })
            const exit = await run.exited
            DIVERGES_RUST.set(c.name, {
              exit,
              stdout: await new Response(run.stdout).text(),
              stderr: await new Response(run.stderr).text(),
            })
          }
          const { found, pedantic } = splitFindings(stderr, emitted.code.split("\n").length)
          built.set(c.name, {
            ok,
            lints: found.map((f) => f.code),
            pedantic: pedantic.length,
            edge: await edgeOf(ok, exe, pou, plan),
            why: ok ? "" : rendered(stderr),
          })
        }
      }),
    )
    await rm(dir, { recursive: true, force: true })
    console.log(`  [rust] ${rest.length} more cases compiled in ${Math.round((performance.now() - started) / 1000)}s`)
  }, Math.max(120_000, rest.length * 300))

  test("a fixture whose ST CODESYS accepts emits Rust that compiles", () => {
    const broken = rest
      .filter((c) => built.get(c.name)?.ok === false && rejectionIsADefect(c.evidence ?? ""))
      .map((c) => `${c.name} (${c.evidence}):\n${built.get(c.name)!.why}`)
    expect(broken).toEqual([])
  })

  test("the stored oracle matches what the compiler actually did", () => {
    const wrong = rest
      .filter((c) => built.has(c.name))
      .map((c) => [c, built.get(c.name)!.ok ? "compiles" : "rejected"] as const)
      .filter(([c, want]) => c.transpile?.rust !== want)
      .map(([c, want]) => `${c.name}: stored ${c.transpile?.rust}, compiler says ${want}`)
    if (wrong.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(wrong).toEqual([])
  })

  test.skipIf(skipLintCheck())("every case's lints are exactly what its stored row carries", () => {
    const stale = lintDrift(new Map(rest.filter((c) => built.has(c.name)).map((c) => [c.name, built.get(c.name)!.lints])))
    if (stale.length > 0) console.log("  [fixtures] the emitted Rust changed — run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })

  test.skipIf(skipLintCheck())("every case's pedantic count and edge verdict are what its stored row carries", () => {
    const stale = measuredDrift(built)
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })
})

/**
 * THE VENDOR REFUSES IT AND SO DO WE. The rating already established that the LSP objects — that is what separates
 * `refused` from `lsp-gap`. What is left is the WORDING, for the fixtures that record the vendor's own text.
 *
 * This is the class fix for the LSP gaps the transpiler work keeps exposing: the replay below fails only on a false
 * POSITIVE, so a construct the compiler rejects and the LSP silently accepts could stay unnoticed forever. Here it
 * is a failing row.
 *
 * PARSE ERRORS COUNT. `lspErrors` collects them alongside the semantic ones — a reserved word in name position is
 * reported by `cursor.ts` rather than by a check (`lt : BOOL;` is `Unexpected token 'LT' found`, CODESYS's own
 * wording), and a gate that reads only semantic diagnostics sees half of what the LSP says. Two fixtures were filed
 * as LSP gaps on that basis and were never gaps at all.
 *
 * And the vendor's own answer is re-asserted: a fixture cannot quietly stop being refused.
 *
 * NOTHING ELSE IS OWED. The transpiler's input contract is "code CODESYS compiles" (`src/transpile/index.ts`),
 * so a source the vendor rejects is outside it — there is no value to produce and no lowering to demand. That is
 * why a refused fixture is an answer rather than a gap, and why it is COUNTED rather than dropped: a fixture
 * cannot go quiet here by becoming uncompilable.
 */
describe("refused — the vendor rejects it, in words we repeat", () => {
  for (const c of rated("refused").filter((x) => x.refused !== undefined)) {
    test(c.name, () => {
      const rec = RUNS[c.name]
      if (rec?.error !== undefined) expect(rec.error).toContain(c.refused!)
      expect(lspErrors(c, ALL_TESTS, "codesys")).toContainEqual(expect.stringContaining(c.refused!))
    })
  }
})

/**
 * THE VENDOR RUNS IT AND LOWERING REFUSES — a coverage gap, named by the code that stops it.
 *
 * Counted rather than asserted case by case: which construct is missing is the work list's question
 * (`scripts/lower-completeness.ts`), and the number that DO lower is what must not regress. The code has to be in
 * the registry, so a refusal cannot arrive under a slug nothing documents.
 */
describe("not-lowered — the vendor runs it and lowering refuses", () => {
  for (const c of rated("not-lowered")) {
    const code = lowering(c).diagnostics[0]?.code ?? "unknown"
    test.todo(`${c.name} — not lowered: ${code}`, () => {})
  }

  whole("what blocks them, by code — the work list's input", () => {
    const blockers = new Map<string, number>()
    for (const c of rated("not-lowered")) {
      const code = lowering(c).diagnostics[0]?.code ?? "unknown"
      blockers.set(code, (blockers.get(code) ?? 0) + 1)
    }
    const summary = [...blockers].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code} ${n}`)
    console.log(`  [fixtures] ${rated("confirmed").length} of ${ALL_TESTS.length} lower and run; what blocks the ${rated("not-lowered").length}: ${summary.join(" · ") || "nothing"}`)
    console.log(`  [fixtures] ${rated("refused").length} more the VENDOR refuses to compile — not this row's to answer`)
    // the report is the point; the ceiling above is the gate
    expect(blockers.size).toBeGreaterThan(0)
  })

  test("every refusal is a registered code", () => {
    // `lowerCodeKind` is the one answer: an exact entry, or one of the templated families (`stmt-try`, `slot-*`),
    // which cannot be enumerated because they expand over AST kinds. Reading `LOWER_CODES` alone called eleven
    // perfectly well-registered refusals unregistered.
    const unregistered = rated("not-lowered")
      .map((c) => [c.name, lowering(c).diagnostics[0]?.code] as const)
      .filter(([, code]) => code === undefined || lowerCodeKind(code) === undefined)
      .map(([name, code]) => `${name}: ${code ?? "(no diagnostic)"}`)
    expect(unregistered).toEqual([])
  })
})

/**
 * WE BOTH EXECUTE IT AND DISAGREE — the only rating that means something is WRONG rather than missing. Each carries
 * `deferred.transpile` saying what was measured; the ceiling below is what keeps a new one visible.
 *
 * EACH RUNS AS AN EXPECTED FAILURE (`support/expected-failure.ts`), not a todo. The check is the one the fixture
 * would face as `confirmed` — the fault check when the vendor stopped, the values through the interpreter AND the
 * emitted Rust when it ran — and the row passes while that check still fails. The day both halves match, the row
 * fails and names the mark to delete. A todo could not notice, so a closed divergence stayed excused for whatever
 * reopened it.
 */
describe("diverges — measured, and run as an expected failure", () => {
  const inconclusive: string[] = []
  for (const c of rated("diverges")) {
    const mark = c.deferred?.transpile ?? "no reason recorded"
    test(`${c.name} — still diverges: ${mark}`, () => {
      const rec = RUNS[c.name]
      const halves =
        rec?.values === undefined
          ? [() => compareFault(c)]
          : [
              () => compareInterp(c, rec),
              // the Rust half is measured by the pass above; without `rustc` (or with it filtered out) it is not
              DIVERGES_RUST.has(c.name) ? () => compareRust(c, DIVERGES_RUST.get(c.name)!) : undefined,
            ]
      const verdict = expectStillDiverges(c.name, mark, halves)
      if (verdict.verdict === "inconclusive") inconclusive.push(c.name)
    })
  }

  // An interpreter half that MATCHES with no Rust half to settle it is unproven either way — reported, and allowed
  // only where the Rust pass did not run. Where it ran, every diverging fixture the vendor ran must be in it.
  test("an unproven row is one the Rust pass did not reach this run", () => {
    console.log(
      `  [fixtures] ${rated("diverges").length} diverge, each run as an expected failure` +
        (inconclusive.length > 0 ? `; ${inconclusive.length} unproven (no Rust half this run): ${inconclusive.join(", ")}` : ""),
    )
    if (DIVERGES_RUST.size > 0) expect(inconclusive).toEqual([])
  })

  test("each names what was measured", () => {
    expect(rated("diverges").filter((c) => c.deferred?.transpile === undefined).map((c) => c.name)).toEqual([])
  })
})

/**
 * THE VENDOR OBJECTS AND THE LSP IS SILENT. Asserting parity would assert something false; dropping the fixture
 * would lose the vendor's answer. So each is named, dated on the fixture, and COUNTED — a backlog that reports
 * itself is one that cannot quietly grow.
 */
describe("lsp-gap — a refusal the LSP does not make yet", () => {
  // AN EXPECTED FAILURE, like `diverges`: the check is the one `refused` makes — the LSP objects, in the vendor's
  // words where the fixture records them — and the row fails the day it passes. `deferred.lsp` pins the rating to
  // `lsp-gap` whatever the LSP says, so without this a closed gap stayed excused indefinitely.
  for (const c of rated("lsp-gap")) {
    const mark = c.deferred?.lsp ?? "MEASURED_SILENT: the vendor refuses and the LSP says nothing"
    test(`${c.name} — still silent: ${mark}`, () => {
      expectStillDiverges(c.name, mark, [
        () =>
          c.refused === undefined
            ? expect(lspErrors(c, ALL_TESTS, "codesys").length).toBeGreaterThan(0)
            : expect(lspErrors(c, ALL_TESTS, "codesys")).toContainEqual(expect.stringContaining(c.refused)),
      ])
    })
  }

  /**
   * THE RATING HAS TWO SOURCES AND ONLY ONE OF THEM IS DECLARED. A fixture reaches `lsp-gap` either by CARRYING
   * `deferred.lsp` — somebody wrote the gap down, with a date — or by being MEASURED silent: the vendor refused
   * and `lspReportsAnError` found nothing. This asserted the first and the two measured ones failed it, which is
   * the hole the table exists to show. Four separate filters could not: each selected the subset it already knew.
   *
   * The measured kind is not required to say anything on the fixture — there is nothing to say until somebody
   * looks — so what is asserted is that they are the ones we know about. The ceiling holds the total at 2.
   */
  const MEASURED_SILENT: ReadonlySet<string> = new Set([
    // the `???` target over a CALL. The fixture and the corpus disagree because the compiler never reads network
    // text at all — see `network/network-analysis.ts`.
    "network_unnamed_target_of_void_call",
    "network_unnamed_target_of_valued_call",
    // `__QUERYINTERFACE`, measured for the first time on 2026-09-20. The fixture had always named an interface
    // another fixture declares, in a METHOD BODY — which `withDependencies` does not scan — so it was never
    // pushed and the vendor only ever answered `Unknown type`. Given its own interface, CODESYS refuses it with
    // three specific errors (the FB must extend `__System.IQueryInterface`; the operand must be an INSTANCE, not
    // a type) and the LSP says nothing about any of them. A real gap, newly visible because the question is now
    // real.
    "op_sys_queryinterface",
    // a FOR limit WIDER than an INT counter (a DINT variable, a DINT expression, UPPER_BOUND), measured 2026-09-29
    // for transpile-review task 13: CODESYS refuses each with "Cannot convert type 'DINT' to type 'INT'" and the LSP
    // says nothing. A UINT counter's `n - 1` limit it compiles (`for_limit_wider_than_counter_uint_expr`, confirmed).
    "for_limit_wider_than_counter_dint_var",
    "for_limit_wider_than_counter_dint_expr",
    "for_limit_wider_than_counter_upper_bound",
    // transpile-review-2026-09-29, recorded 2026-09-29 — each refused by CODESYS, silently accepted by the LSP:
    //   task 35: a FOR step the counter's type cannot hold — a runtime INT step on a BYTE counter, 300 on a SINT one
    //            ("Cannot convert type 'INT' to type 'BYTE'" / "... 'SINT'").
    "tr_35_for_byte_runtime_int_step",
    "tr_35_for_sint_step_300",
    // frontend-conformance 2.1.3, recorded 2026-09-30 on both vendors — `__POOL` named where an operand (or an
    // assignment target) belongs reads the next token as its member, a shape the LSP does not model (rules E30/E34,
    // task 2.5.6; niche, accepted — `support/divergences.ts`). Bare `__NEW` and `__POUNAME` left this set in 2.1: the
    // parser now answers them as the vendor does (`parse/expression.ts`).
    "lex_keyword_assigned_sys_pool",
    "lex_keyword_operand_sys_pool",
    // …and called where a statement starts, `__pool(n);` (review 2.6, both vendors 2026-10-02): the same member read,
    // "Identifier expected instead of ''" and the `.` on `!!!'ERROR'!!!` — niche: accepted loss (0 `__POOL(` in the
    // corpora)
    "lex_keyword_called_sys_pool",
    // frontend-conformance 2.3.4, recorded 2026-10-01 — an ARRAY OF a function block initialized element by element with
    // no `:=` passes each element's list to the FB's FB_Init, which this FB does not declare: CODESYS "No matching
    // 'FB_Init' method found for instantiation of FB_…" (TwinCAT: a failed build with no message). The grammar now reads
    // the form (`parse/declarations`); the FB_Init matching is `analysis/checks/oop/fb-init-instantiation`'s, outside
    // the front-end (`support/divergences.ts` `CODESYS_DECLARATION_DIVERGENCES`).
    "decl_bracket_init_no_assign_fb",
    // …and `[K+L(7)]`: the parser reads L's call as the vendors do; refusing a call inside an aggregate initializer is the
    // calls check's, which walks bodies (`support/divergences.ts` `CALL_IN_AN_AGGREGATE_INITIALIZER`)
    "decl_repeat_count_expression_names",
    // frontend-conformance 2.3b review, recorded 2026-10-01 on both vendors — an implicit enum's value stored into a BYTE,
    // with or without a written base: "Cannot convert type 'IMPLICIT_ENUM__FB_…__E' to type 'BYTE'". Every implicit
    // enum is the one `(implicit)` type with no base, so the store is unchecked (`support/divergences.ts`
    // `IMPLICIT_ENUM_TYPE_NAME`, the type's identity, tasks 3.3/4.7.4)
    "decl_implicit_enum_into_byte",
    "decl_implicit_enum_with_base_into_byte",
    // frontend-conformance 2.7: a conditional pragma in a declaration part (the declaration parser applies none)
    "prag_if_defined_in_declaration",
    "prag_project_defined_in_declaration",
    // frontend-conformance 3.3 review, recorded 2026-10-02 — CODESYS takes an open library's enum member (Util's GEN_MODE)
    // before a project FUNCTION / PROGRAM of its name; which libraries' members are candidates is LB2's (task 3.4.2), and
    // pro2193's 87 clean POU names beside other libraries' members forbid refusing without it (`support/divergences.ts`
    // `CODESYS_ENUM_DIVERGENCES`)
    "enum_library_member_vs_project_function",
    "enum_library_member_vs_project_program",
  ])

  test("each is either written down on the fixture or a known measured silence", () => {
    const unaccounted = rated("lsp-gap")
      .filter((c) => c.deferred?.lsp === undefined && !MEASURED_SILENT.has(c.name))
      .map((c) => c.name)
    expect(unaccounted).toEqual([])
    // and the other direction — one that gains a check should leave the set rather than rot in it
    expect([...MEASURED_SILENT].filter((n) => SELECTION.has(n) && !rated("lsp-gap").some((c) => c.name === n))).toEqual([])
  })
})

/** THE ORACLE CANNOT PUT THE QUESTION — a graphical body the exec recorder cannot load, a project setting no LSP
 *  can see. Not a gap in the product; a limit of the harness, which has to say which. */
describe("unaskable — the oracle cannot ask it", () => {
  test("each says why, in execSkip or recorderSkip", () => {
    const silent = rated("unaskable").filter((c) => c.execSkip === undefined && c.recorderSkip !== true)
    // A fixture rated unaskable for the PROJECT's configuration carries neither flag — the reason is in the
    // recording, and `evidence.ts` names it (`PROJECT_CONFIGURATION`). Those are allowed; anything else is not.
    expect(silent.filter((c) => RUNS[c.name]?.error === undefined).map((c) => c.name)).toEqual([])
  })
})

/**
 * THE SIMULATOR REFUSED WHAT THE BRIDGE BUILT — not a rating, a harness defect, and the one thing the rating
 * cannot see because both halves look like ordinary refusals from the inside.
 *
 * `record:exec` writes declaration and implementation text STRAIGHT into a POU, so a body that is not ST cannot
 * survive the trip: network text reaches the compiler as the literal `NETWORK 0 FBD` and is answered "';' expected
 * instead of 'FBD'". Those fixtures carry `execSkip` and are never sent; one arriving here slipped past it.
 */
test("no fixture the BUILD recording compiled was refused by the simulator", () => {
  const disagreed = SELECTION.selected.filter(
    (c) => RUNS[c.name]?.error?.startsWith("does not compile") === true && BUILDS.codesys.tests[c.name]?.buildSuccess === true,
  ).map((c) => `${c.name}: ${RUNS[c.name]!.error}`)
  expect(disagreed).toEqual([])
})

// ─── the table itself ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every rating is either handled above or listed here with why. This is what makes the selection total: add a
 * rating to `EVIDENCE_ORDER` without a row and this fails naming it, where four hand-written filters would each
 * have silently skipped it.
 */
const NO_ROW: Partial<Record<Evidence, string>> = {
  unasked: "nothing has been measured, so there is nothing to assert — the ceiling below holds it at zero",
}

/**
 * THE PURE HALVES OF THE MAP'S MEASURED COLUMNS — the normalizer behind `shape` and the input set behind `edge`,
 * pinned on their own so a change to either is a red line here before it is 2,300 changed rows in the map.
 *
 * The two ids below are the ones the overnight review (transpile-review-2026-09-29) printed into its `shapes.json`
 * for these lines. Pinning them is what "the same normalization the measure step used" means in a test: the
 * review's lean items and `NOTES` are keyed by those ids, and a normalizer that drifted would orphan all of them.
 */
describe("the map's measured columns — the pure halves", () => {
  test("a line normalizes to its construct: identifiers, literals and temporaries are erased, types are kept", () => {
    expect(normalizeRustLine("    self.total = (self.total as i32).wrapping_add(1i32) as i16; // step")).toBe(
      "self.f = (self.f as i32).wrapping_add(Li32) as i16;",
    )
    expect(normalizeRustLine("        let __mod_l_3 = helper(5u8);")).toBe("let __mod_l_N = m(Lu8);")
    expect(normalizeRustLine('    name: IecString::<12>::lit(b"hi"),')).toBe("x: IecString::<L>::lit(B),")
    // the SUFFIX is the construct: an i16 and a u8 store are different emissions
    expect(normalizeRustLine("x = 1i16;")).not.toBe(normalizeRustLine("x = 1u8;"))
    expect(normalizeRustLine("alpha = 1i16;")).toBe(normalizeRustLine("beta = 7i16;"))
  })

  test("a construct's id is the review's id for the same line", () => {
    expect(shapeId("loop {")).toBe("521ba042ac")
    expect(shapeId(normalizeRustLine("    limit: 5,"))).toBe("fbde4d6e1e")
  })

  test("a fixture's shape is its constructs in order — renaming is invisible, reordering is not", () => {
    const a = "pub struct P {\n    pub a: i16,\n}\nfn scan() {\n    self.a = 1i16;\n    self.b = self.a;\n}\n"
    const renamed = a.replaceAll("self.a", "self.zz").replace("pub a", "pub zz").replace("1i16", "9i16")
    const swapped = "pub struct P {\n    pub a: i16,\n}\nfn scan() {\n    self.b = self.a;\n    self.a = 1i16;\n}\n"
    expect(emissionShape(renamed)).toEqual(emissionShape(a))
    expect(emissionShape(swapped).shape).not.toBe(emissionShape(a).shape)
    // braces are boilerplate, not constructs
    expect(emissionShape(a).constructs.length).toBe(5)
  })

  test("the prelude is not the fixture's construct", () => {
    const body = "pub struct P {\n    pub s: IecString<5>,\n}\n"
    expect(emissionShape(STRING_PRELUDE + body)).toEqual(emissionShape(body))
  })

  test("a fixture's constructs come with their normalized lines, one per id", () => {
    const code = "fn scan() {\n    self.a = 1i16;\n    self.b = self.a;\n}\n"
    const { constructs, lines } = emissionShape(code)
    expect(lines).toEqual(["fn scan() {", "self.a = 1i16;", "self.b = self.a;"].map((l) => normalizeRustLine(l)))
    expect(constructs).toEqual(lines.map(shapeId))
  })

  test("a row's notes are the ids of its noted constructs, deduplicated and sorted", () => {
    const [first, second] = Object.keys(NOTES).sort()
    const unnoted = shapeId("no review ever judged this line")
    expect(NOTES[unnoted]).toBeUndefined()
    expect(notesOf([unnoted])).toEqual({})
    expect(notesOf([second!, unnoted, first!, second!])).toEqual({ notes: [first!, second!] })
  })

  test("the map's NOTES section renders every note's full text under its construct line, by id", () => {
    const notes = {
      bbbbbbbbbb: { improvement: 'say "less"' },
      aaaaaaaaaa: { improvement: "one", alternatives: ["x", "y"], chosen: "y", why: "because" },
    }
    const lines = new Map([
      ["aaaaaaaaaa", "self.f = Li16;"],
      ["bbbbbbbbbb", "loop {"],
    ])
    const text = renderNotes(notes, lines)
    expect(text).toContain(
      [
        "export const NOTES: Readonly<Record<string, ShapeNote>> = {",
        "  // self.f = Li16;",
        '  "aaaaaaaaaa": {',
        '    improvement: "one",',
        "    alternatives: [",
        '      "x",',
        '      "y",',
        "    ],",
        '    chosen: "y",',
        '    why: "because",',
        "  },",
        "  // loop {",
        '  "bbbbbbbbbb": {',
        '    improvement: "say \\"less\\"",',
        "  },",
        "}",
      ].join("\n"),
    )
    expect(text.endsWith("}\n")).toBe(true)
    // a note whose construct no fixture emits has no line to print — refused, never printed without one
    expect(() => renderNotes(notes, new Map([["aaaaaaaaaa", "loop {"]]))).toThrow(/bbbbbbbbbb/)
  })

  test("size counts emitted lines per ST line, the prelude and blank lines excluded", () => {
    const rust = "pub struct P {\n\n    pub a: i16,\n}\n"
    expect(sizeRatio(rust, "PROGRAM P\n// note\nVAR a : INT; END_VAR\n\nEND_PROGRAM", [])).toBe(1)
    expect(sizeRatio(STRING_PRELUDE + rust, "PROGRAM P\nEND_PROGRAM", [])).toBe(1.5)
    expect(sizeRatio(rust, "PROGRAM P\n", [{ source: "VAR_GLOBAL\nEND_VAR" }])).toBe(1)
  })

  const elementary = (name: string, length?: number) => ({ ...elementaryTypeRef(elementaryType(name)!), ...(length === undefined ? {} : { length }) })
  const labels = (name: string, length?: number) => edgeSeeds(elementary(name, length)).map((s) => s.label)

  test("the edge inputs of an integer are its extremes, zero, one and minus one", () => {
    expect(labels("INT")).toEqual(["INT#-32768", "INT#-1", "INT#0", "INT#1", "INT#32767"])
    // an unsigned type has no -1 to seed: its -1 IS its maximum, one past its range from below
    expect(labels("USINT")).toEqual(["USINT#0", "USINT#1", "USINT#255"])
    expect(labels("LWORD")).toEqual(["LWORD#0", "LWORD#1", "LWORD#18446744073709551615"])
    const [min] = edgeSeeds(elementary("DINT"))
    expect(min).toEqual({ label: "DINT#-2147483648", interp: -2147483648n, rust: "(-2147483648i128) as _" })
  })

  test("the edge inputs of a REAL reach NaN, both infinities, both zeros and the largest finite value", () => {
    for (const name of ["REAL", "LREAL"]) {
      const seeds = labels(name)
      for (const l of ["NaN", "+inf", "-inf", "0", "-0", `${name}_MAX`, `-${name}_MAX`, "min_subnormal"])
        expect(seeds).toContain(`${name}#${l}`)
    }
    const nan = edgeSeeds(elementary("REAL")).find((s) => s.label === "REAL#NaN")!
    expect(Number.isNaN(nan.interp as number)).toBe(true)
    expect(nan.rust).toBe("f32::from_bits(0x7fc00000)")
  })

  test("a program that reaches the platform's libm is not an edge question the repo can answer", () => {
    expect(reachesLibm("self.r = self.x.powf(2.0f32);")).toBe(true)
    expect(reachesLibm("self.r = (self.x as f64).ln();")).toBe(true)
    expect(reachesLibm("self.r = self.x.sin();")).toBe(true)
    // IEEE-754 defines these to the last bit on every platform
    expect(reachesLibm("self.r = self.x.sqrt(); self.q = self.x.abs(); self.t = self.x.trunc();")).toBe(false)
    // the prelude is the same text everywhere, and does not reach it
    expect(reachesLibm(STRING_PRELUDE)).toBe(false)
  })

  test("the edge inputs of a string are empty and full; of a BOOL both values", () => {
    expect(labels("STRING", 5)).toEqual(["''(empty)", "'A'x5(max length)"])
    expect(edgeSeeds(elementary("WSTRING", 3))[1]).toEqual({ label: "'A'x3(max length)", interp: "AAA", rust: "IecStr::lit(&[65u16; 3])" })
    expect(labels("BOOL")).toEqual(["FALSE", "TRUE"])
  })
})

describe("the table is total", () => {
  test("every fixture carries a rating this file has a row for", () => {
    const unknown = SELECTION.selected.filter((t) => !EVIDENCE_ORDER.includes(t.evidence as Evidence)).map(
      (t) => `${t.name}: ${t.evidence ?? "(none)"}`,
    )
    expect(unknown).toEqual([])
  })

  test("the stored rating on every fixture matches the computed one", () => {
    // The whole reason `evidence` can live in a generated file: a stale entry is a red test, not a quiet lie.
    const stale = SELECTION.selected.map((t) => [t, rateFixture(t, ALL_TESTS)] as const)
      .filter(([t, rating]) => t.evidence !== rating)
      .map(([t, rating]) => `${t.name}: stored ${t.evidence ?? "(none)"}, computed ${rating}`)
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
    // A BUDGET PROPORTIONAL TO THE WORK, because this had none — it ran on bun's 5s default, which is a default
    // and not a decision. `rateFixture` lowers AND runs every fixture, so the cost is linear in how many there
    // are: measured 2026-09-20, 2514 fixtures in ~6.0s, or 2.4ms each. Under full-suite load that tipped over 5s
    // and failed as a timeout, which reads as a hang rather than as "there are more fixtures now" — the same
    // shape as the rustc guard above, and the same fix.
    //
    // Checked for the quadratic first, because this suite has had two: `withDependencies` calls
    // `declarationIndex(all)` per fixture, which LOOKS like O(n) per call. It is memoized on the identity of
    // `all`, and `parsed` caches per fixture, so the walk is O(its own dependencies). There is no hidden term —
    // this is the work the gate exists to do.
  }, Math.max(30_000, SELECTION.selected.length * 10))

  /**
   * THE OTHER HALF OF THE SAME ROW. `tier` and `rust` are derived from the lowered IR and the recordings — no
   * compiler — so they are checked for every fixture here rather than inside the Rust block, which only reaches
   * the cases that have recorded values. `lints` is checked there, because only there is anything compiled.
   */
  test("the stored tier and oracle on every fixture match the computed ones", () => {
    const stale: string[] = []
    for (const t of SELECTION.selected) {
      const { pou } = lowering(t)
      const tier = pou === undefined ? undefined : tierOf(pou, t.pouName)
      if (tier !== t.transpile?.tier) stale.push(`${t.name}: tier stored ${t.transpile?.tier ?? "(none)"}, computed ${tier ?? "(none)"}`)

      // `compiles` VS `rejected` IS NOT DECIDED HERE, and asserting it was how this test started failing on the
      // six rows that are honestly `rejected`: no compiler runs in this block, so it cannot know which one a
      // fixture earned. The two Rust blocks above compile every lowered fixture and assert exactly that. What is
      // checkable WITHOUT a compiler is the rest of the claim, and all of it is checked:
      //   a row exists exactly when the fixture lowers, and
      //   `vendor` — the strongest thing the field says — is claimed only where a recording holds values.
      const rust = t.transpile?.rust
      if ((pou === undefined) !== (rust === undefined))
        stale.push(`${t.name}: rust stored ${rust ?? "(none)"}, but it ${pou === undefined ? "does not lower" : "lowers"}`)
      // `built: true` only so the call is well formed — this compares the `vendor` half, which does not depend on it
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      const inputs = [source, ...gvls.map((g) => g.source)].join("\n")
      if (rust !== undefined && (rust === "vendor") !== (correctnessOf(t.name, t.evidence ?? "", true, inputs) === "vendor"))
        stale.push(`${t.name}: rust stored ${rust}, and the recording says otherwise`)

      const diverges = divergesOf(t.name)
      if (JSON.stringify(diverges ?? null) !== JSON.stringify(t.transpile?.diverges ?? null))
        stale.push(`${t.name}: diverges stored ${JSON.stringify(t.transpile?.diverges)}, computed ${JSON.stringify(diverges)}`)
    }
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  }, Math.max(30_000, SELECTION.selected.length * 10))

  /**
   * THE COLUMNS THAT NEED NO COMPILER — the emission's `shape`, its `size`, and the ids of its constructs `NOTES`
   * judged — recomputed for every fixture that lowers, from the same emitted code the generator hashed. And the
   * map's own `NOTES` section, re-rendered from the authored table and the construct lines those fixtures emit: the
   * texts a row's `notes` point at are in the same file, so they are gated like every other column.
   */
  test("the stored shape, size and notes on every fixture, and the map's NOTES section, match the computed ones", () => {
    const stale: string[] = []
    const lines = new Map<string, string>()
    for (const t of SELECTION.selected) {
      const { pou } = lowering(t)
      if (pou === undefined) continue
      const code = emitRust(pou).code
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      const emitted = emissionShape(code)
      emitted.constructs.forEach((id, i) => lines.set(id, emitted.lines[i]!))
      const got = { shape: emitted.shape, size: sizeRatio(code, source, gvls), notes: notesOf(emitted.constructs).notes }
      const stored = t.transpile
      const want = { shape: stored?.shape, size: stored?.size, notes: stored?.notes }
      if (JSON.stringify(got) !== JSON.stringify(want)) stale.push(`${t.name}: stored ${JSON.stringify(want)}, computed ${JSON.stringify(got)}`)
    }
    if (stale.length > 0) console.log("  [fixtures] the emitted Rust changed — run `bun run rate:fixtures`")
    expect(stale).toEqual([])
    // the section renders the construct lines of EVERY fixture — a project-wide total a partial run cannot answer
    if (SELECTION.partial) return
    const map = readFileSync(join(import.meta.dir, "fixtures", "map.generated.ts"), "utf8")
    const section = renderNotes(NOTES, lines)
    if (!map.endsWith(section)) console.log("  [fixtures] the map's NOTES section is stale — run `bun run rate:fixtures`")
    expect(map.endsWith(section)).toBe(true)
  }, Math.max(30_000, SELECTION.selected.length * 10))

  /**
   * A NOTE ABOUT A CONSTRUCT NOBODY EMITS IS A NOTE ABOUT NOTHING — the refusal the generator makes for a dead
   * `ALLOWED` entry, made for `NOTES` here as well, so an emitter change that retires a construct cannot leave its
   * review note behind looking like open work.
   */
  whole("every note names a construct some fixture still emits, and says something", () => {
    expect(() => assertNotes()).not.toThrow()
    const emitted = new Set<string>()
    for (const t of ALL_TESTS) {
      const { pou } = lowering(t)
      if (pou !== undefined) for (const id of emissionShape(emitRust(pou).code).constructs) emitted.add(id)
    }
    expect(deadNotes(emitted)).toEqual([])
  }, Math.max(30_000, ALL_TESTS.length * 10))

  test("every allowed lint states the reason it is Volt's answer rather than a defect", () => {
    expect(() => assertPolicy()).not.toThrow()
  })

  test("the ratings with no row say why", () => {
    const handled = new Set<Evidence>(["confirmed", "refused", "not-lowered", "diverges", "lsp-gap", "unaskable"])
    expect(EVIDENCE_ORDER.filter((r) => !handled.has(r) && NO_ROW[r] === undefined)).toEqual([])
  })
})

// ─── ratchet one: how much of what the vendor answered we match ──────────────────────────────────────────────

/**
 * Ceilings, not targets. `unasked` is the normal state of a fixture written before the next recording, and
 * `refused` is an answer — neither is a problem. These exist so the numbers stay visible rather than assumed, and
 * so the ones that mean something is missing or wrong cannot grow quietly.
 */
const CEILINGS: Partial<Record<Evidence, number>> = {
  // 6 -> 4. `real_to_dint_below_range` and `real_to_dint_runtime_below` are RESOLVED: 192 measured cells showed the
  // REAL->INT conversion happens at the DESTINATION'S register width, so a DINT gets the 32-bit indefinite where a
  // LINT gets the 64-bit one. Four points could not show that, and it had been parked as unexplainable.
  // What is left is two families, both about a vendor routine rather than a rule: trig argument reduction for a huge
  // angle (`op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large`) and STRING being UTF-8 bytes.
  // 4 -> 5. `string_high_byte_escape` is RESOLVED — a STRING holds UTF-8 bytes and `literal-value.ts` stores them
  // — and `strings/escapes.ts` added `$80`, the one cell nothing explains: LEN answers 3 where every other escape
  // at or above 0x80 answers 2, and no reading that gives 3 there leaves `$81` at 2. Deferred rather than fitted.
  // 5 -> 3. `$80` is RESOLVED too, by widening the probe: `$hh` is a WINDOWS-1252 byte, not the code point U+00XX,
  // and sixteen cells across 0x80..0x9F follow that codepage exactly. What is left is one family — CODESYS's trig
  // is the x87 FPU, whose 66-bit argument reduction and few-ULP kernel are named at `ir/values.ts` and
  // deliberately not emulated.
  // 3 -> 4. `named_const_expression_keeps` (transpile-review-2026-09-29 task 2.3): CODESYS reads a constant whose
  // constant-EXPRESSION initializer overflows its type as the unwrapped fold (`D : SINT := K + 1` reads SINT#128);
  // lowering stores and reads it through a slot of the declared width.
  // 4 -> 58, ALL FOR MEASUREMENT. transpile-review-2026-09-29 landed a CODESYS-recorded fixture for every open root
  // cause ahead of its fix (tasks 6, 12, 14, 16-22, 24-33, 35, 36, 41, 42, 45-47), each carrying its task in
  // `deferred.transpile`. This number comes back down task by task as the fixes land.
  // 58 -> 57: task 18 refuses its fixture now (`not-lowered`).
  // `named_const_expression_keeps` (task 2.3) is RESOLVED: a CONSTANT's slot takes the width its unwrapped fold needs.
  diverges: 57,
  // 18 -> 34 because the MEASUREMENT changed, not because gaps appeared. `refused` claimed the vendor rejects a
  // source AND so do we, while only checking the vendor; 16 fixtures were counted as evidence while the LSP accepted
  // them silently (`cc_reserved_name_s_string` and its neighbours). The rating asks both sides now.
  // 35 -> 36: `tc_nc_axis` reached a compiler for the first time and came back "Unknown type: 'AXIS_REF'", which the
  // LSP does not say.
  // 36 -> 2, over a run of measurements rather than one change: the signature-name family (a harness fault — the
  // rating was reading the TRANSPILER's assembly, two POUs in one file), the operator call forms, `__POSITION` and
  // `__CURRENTTASK`, the `CALC` family, `ANYNUM_TO_*`, `FB_Init`'s arguments, `__QUERYPOINTER`'s first operand and
  // `__NEW`'s pragma. The two left are the `???` target over a call, where the fixture and the corpus disagree
  // because the compiler never reads network text — see `network/network-analysis.ts`.
  // 2 -> 3. `op_sys_queryinterface` is a gap this session CREATED, by making the fixture ask a real question:
  // its method body named an interface ANOTHER fixture declares, and `withDependencies` scans declarations
  // rather than bodies, so the interface was never pushed and every recording said `Unknown type`. It has never
  // measured `__QUERYINTERFACE` on either vendor. Given its own interface it now records CODESYS's real answer
  // (the FB must extend `__System.IQueryInterface`, and the operand must be an instance rather than a type),
  // and the LSP says nothing about any of it.
  // 3 -> 4. `cc_decl_init_dunder_unknown` is another gap a fixture CREATED by asking properly: both vendors
  // refuse an unknown `__` name in a declaration initializer at the PARSER, and `nameResolves` accepts every
  // unlisted `__` name on purpose — the blanket that keeps an unlisted system operator from false-positiving.
  // `system-initializer` answers the half the dialect table HAS a verdict for; this is the half it does not.
  // 4 -> 7. `for_limit_wider_than_counter_{dint_var,dint_expr,upper_bound}` (transpile-review task 13) asked
  // whether a FOR limit wider than an INT counter compiles, and it does NOT: "Cannot convert type 'DINT' to type
  // 'INT'". The LSP says nothing. A rise for measurement — the refusal is the follow-up.
  // 7 -> 17. transpile-review-2026-09-29 tasks 35, 37 and 40: ten sources CODESYS refuses (a FOR step or a CASE label
  // outside the type, an inverted CASE range, DATE/DT/TOD +/- LTIME) that the LSP accepts — `MEASURED_SILENT` names them.
  // 17 -> 18. frontend-conformance 2.4a review (2026-10-01): `unit_interface_property_accessor_var_output` and
  // `_var_in_out` asked whether an interface accessor may declare an output or in-out — CODESYS refuses the implementer's
  // getter against it ("Interface of overridden method '__GETVAL' … doesn't match declaration"), which the LSP does not
  // compare; niche, accepted (`deferred.lsp`, 0 occurrences in the corpora). A rise for measurement.
  // 18 -> 19. frontend-conformance 2.5 (2026-10-01): `expr_trailing_comma_conversion_call` — `INT_TO_DINT(a,)` is "')'
  // expected instead of ','" on both vendors (a conversion takes ONE argument), which the parser cannot tell from a user
  // function named like one; niche, accepted (`deferred.lsp`, 0 occurrences in the corpora). A rise for measurement.
  // 19 -> 22. frontend-conformance 2.5.6 (2026-10-02), new questions, no fixture moved: `expr_pool_qualified_call` and
  // `_global` (`__POOL.X` is a lookup in the POUs view, which the workspace does not model) and `expr_inline_assign_operand`
  // (a chain's inner target `1 + a`, ST4's) — each niche, accepted (`deferred.lsp`, 0 occurrences in the corpora). A rise
  // for measurement.
  // 22 -> 21. frontend-conformance 2.6 (2026-10-02): `expr_inline_assign_operand` agrees — a chain's inner target that is no
  // name is "no valid assignment target" (`statement-rules`).
  // 21 -> 22, FOR MEASUREMENT. The 2.6 review (2026-10-02): `lex_keyword_called_sys_pool` — `__pool(n);`, the member read
  // `__POOL` makes of the next token, which the LSP does not model (`MEASURED_SILENT`; niche, 0 occurrences).
  // 22 -> 24, FOR MEASUREMENT. frontend-conformance 2.7 (2026-10-02): `prag_if_defined_in_declaration` ("This code is not
  // supported in declaration part", CODESYS) and `prag_project_defined_in_declaration` (a declaration under an unset
  // `project_defined` dropped) — the declaration parser applies no conditional pragma (`MEASURED_SILENT`, both
  // `KNOWN_DIVERGENCES`; niche: accepted loss, 0 conditional directives in any declaration part of the corpora).
  // 24 -> 23. frontend-conformance 2.8.3 (2026-10-02): `cc_decl_init_dunder_unknown` — the PARSER refuses a `__` identifier
  // leading an initializer (every `__` operator a dialect has is its keyword; the `__SYSTEM` namespace is read through its
  // `.`), where name resolution had answered every `__` name on CODESYS.
  // 23 -> 26, FOR MEASUREMENT. frontend-conformance 2.10 (2026-10-02): P14's three `strict` refusals
  // (`prag_strict_enum_int_assign`, `_literal_not_a_member_assign`, `_add_literal`, both vendors) — `strict` is read by the
  // type compatibility of task 4.5.1, which owns it (`deferred.lsp`). Not niche: 56 `{attribute 'strict'}` in the corpora.
  // 26 -> 29, FOR MEASUREMENT. frontend-conformance 3.1 (2026-10-02), new questions, no fixture moved, each niche and accepted
  // (`deferred.lsp`, 0 occurrences in the corpora): `sym_var_external_of_ambiguous_global` (a VAR_EXTERNAL of a global two
  // lists declare), `sym_library_gvl_needs_qualification` (a library global read bare — the manifest carries no
  // qualified-access flag) and `sym_library_gvl_qualified_by_namespace` (`Stu.HALFSHIFT`: a namespace holds no list's
  // variable).
  // 29 -> 31, FOR MEASUREMENT. frontend-conformance 3.2 (2026-10-02), new questions, no fixture moved (`deferred.lsp`):
  // `inh_override_final_method` and `inh_abstract_method_not_implemented` — both vendors' words recorded, the CODESYS code
  // number unknown (a wire diagnostic is a catalog `Cnnnn`; `server/diagnostic-codes.ts` admits no new slug), 0
  // occurrences of either refusal in the corpora.
  // 31 -> 34, FOR MEASUREMENT. frontend-conformance 3.3 (2026-10-02), new questions, no fixture moved, each niche and accepted
  // (`deferred.lsp`, 0 occurrences in the corpora): `enum_member_vs_global` (a project global and a project enum member of
  // one name are ambiguous), `enum_member_vs_function_name` (the member before a FUNCTION of its name) and
  // `enum_library_member_vs_library_global` (Util's `TUESDAY`, a WEEKDAY member and a DAY_FLAGS global).
  // 34 -> 36, FOR MEASUREMENT. frontend-conformance 3.3 review (2026-10-02), new questions, no fixture moved (`MEASURED_SILENT`,
  // LB2 → 3.4.2): `enum_library_member_vs_project_function` / `_program` — CODESYS takes Util's member before a project
  // POU of its name; which libraries are open (their members candidates at all) is not in the manifest, and pro2193's 87
  // clean POU names beside qualified-access libraries' members say the LSP must not refuse without it.
  // 36 -> 43, FOR MEASUREMENT. frontend-conformance 3.4 (2026-10-02): 8 new library questions CODESYS refuses
  // (`deferred.lsp`, `CODESYS_LIBRARY_DIVERGENCES`, each niche: 0 occurrences in the corpora) — which libraries the
  // APPLICATION references, which require qualified access, which dependencies a namespace publishes, and which POUs are
  // INTERNAL are facts the manifest does not carry (`lib_ns_transitive_bare`, `_transitive_namespace`,
  // `_qualified_access_library_bare`, `_type_name_two_libraries_other_member`, `_direct_dependency_only`,
  // `_library_internal_function_bare`, `_qualified`, `_library_gvl_shared_list_name_bare`); and one closed:
  // `decl_type_unknown_qualified` (a qualifier naming nothing, `unknownQualifiedTypeName`).
  // 43 -> 55, FOR MEASUREMENT. frontend-conformance 3.5 (2026-10-02): 12 member cells both vendors refuse for an access
  // modifier checked after resolution, the LSP silent — "Cannot access private method B.M", an interface METHOD implemented PRIVATE "must
  // be PUBLIC" (`deferred.lsp`, `MEMBER_DIVERGENCES`): no catalog code for a METHOD's refusal (a PROPERTY's C0513/C0515
  // document another, unverified sentence), 0 occurrences in the corpora of a refused access (they build; pro2193's own
  // Application declares 525 such members, user code — not library code, as first written). No fixture moved.
  "lsp-gap": 55,
  // 21 -> 25 by RECLASSIFICATION, not regression: fixtures that had never been ASKED turn out to be ones the vendor
  // compiles and we refuse — `refuse_var_temp_struct`, two pointer derefs — which is exactly what this rating is for.
  // 25 -> 27. `conversions/cross-family.ts` asked 76 conversions across the isolated families and found 35 the
  // transpiler refused; 33 are implemented now (the whole date family plus TIME<->LTIME, one tick rule). The two
  // left are `LTIME_TO_STRING` and `REAL_TO_STRING`, whose FORMAT is a fact one recording cannot generalize — one
  // duration does not show whether an LTIME prints `us` and `ns` components, and one REAL does not show how many
  // digits. They are refused honestly until a format sweep asks properly.
  // 27 -> 49. `conversions/to-string-format.ts` recorded eleven shapes each of `REAL_TO_STRING` and
  // `LREAL_TO_STRING`, and the two widths do not agree on the case of the exponent (`1.2345679E08` against
  // `1.0e20`), on where plain notation stops, or on how many digits survive. Reproducing that from eleven points
  // would be inventing the rest of it, and the prelude mirrors these line for line — a guess is a silent divergence
  // between the backends, not a rough edge. 22 fixtures refuse on purpose, and the table in `lower/builtins.ts` is
  // what a proper format sweep would extend. `LTIME_TO_STRING` from the same sweep IS implemented: its boundaries
  // are all measured and it is a TIME's format with three more units.
  // 49 -> 53. Six of those are address ALIASING — two names on one storage, which the vendor does and this has no
  // byte-addressable area to do in. The whole model is measured at the refusal in `lower/storage.ts` (little-endian,
  // addresses numbered in UNITS, bit 0 the least significant) and waiting for that area. `not-lowered` is the honest
  // rating for it: the vendor runs them and we refuse.
  // 53 -> 55: `atomic_xadd_pointer` and `atomic_cas_pointer` — the two probes the vendor ACCEPTS. They take the
  // address of a local and pass it to an atomic, which `pointer-targets` refuses; the interesting half (what the
  // operators demand of a non-pointer) is measured and implemented.
  // 55 -> 75, and the whole rise is ONE formatter told apart from another. A format sweep of 70 more cells
  // determined `LREAL_TO_STRING` completely (fifteen significant digits, fixed while the exponent is 0..13,
  // lowercase `e`) — it is implemented in both backends and its 35 cells are `confirmed`. `REAL_TO_STRING` is a
  // DIFFERENT formatter and the same sweep showed it is not derivable: two of its exponential cells print eight
  // significant digits beside four that print seven at the same magnitudes, and four fractions round their
  // seventh digit where rounding the value does not (1/3 is '0.3333334', 1/9 prints eight digits and stops).
  // Its 35 cells refuse on purpose, with 70 measurements written down rather than a rule invented from them.
  // 75 -> 80. `declarations/constant-folding.ts` asked 31 cells about what an initial value may hold; 26 of them
  // now lower (a conversion, a shift, SIZEOF of a type, MIN/MAX/SEL/MUX/ABS/TRUNC/EXPT/SQRT, nested and
  // parenthesised). The five here are the ones that are NOT constants and say so:
  //   `cfold_user_function`, `cfold_user_function_reads_global`  a user FUNCTION runs, and sees an initialized global
  //   `cfold_argument_declared_first`, `cfold_non_constant_argument`  initializers run in DECLARATION ORDER
  //   `cfold_sizeof_var`  SIZEOF of a variable declared LATER — constant to the vendor, and our fold needs the slot
  // The first four are one finding: a CODESYS initializer is an initialisation SEQUENCE, not a fold. Modelling
  // that is the next increment, and these are its acceptance tests.
  // 80 -> 88. `declarations/init-sequence.ts` asked 16 more cells about the initialisation SEQUENCE, and the eight
  // that stay here are the ones an FB INSTANCE'S fields raise: an instance's initializers run per instance, which
  // is the FB_Init machinery rather than the POU's init step, so `declareVars` only defers for the POU's own frame.
  // Deferring in a layout would take the DEFAULT silently, which is the bug the refusal was added for.
  // 88 -> 79. An FB INSTANCE'S field initializers run too now, as an implicit per-type routine `initStep` invokes
  // at each instance — which is what a routine already is, a body that runs on an instance. Built while the
  // LAYOUT is, before any body: a field may store an address (`p : POINTER TO X := ADR(y)`) and a body may only
  // dereference that pointer once the store is known.
  // 79 -> 87. `semantics/try-catch.ts` measured `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY` — the one construct that
  // CHANGES the fault model: a divide by zero inside one is caught (code 258), the logarithm of a run-time zero
  // too (338), and THE SCAN FINISHES where the same fault outside ends the application. Eight cells, complete and
  // deliberately not lowered: the model is written at the refusal in `lower/statements.ts` so the implementation
  // is not asked to guess, and the open design question is the Rust form (the emitter's faults are `panic!`).
  // 87 -> 89. `declarations/reference-binding.ts` asked what a reference bound at its DECLARATION does, and two of
  // its sixteen cells rebind afterwards — `refdecl_rebound_by_statement` (declaration bind, then `ref_ REF= other`)
  // and `refdecl_rebound_in_method` (rebound from a METHOD, and the new target SURVIVES to the next scan: seen=20).
  // Two targets is design §9 form 3, the tagged handle, which is not built — so these are refused honestly, and
  // they are the first measured acceptance tests form 3 has.
  // 89 -> 90. `sysop_position_value` reads `__POSITION`'s actual TEXT out of the simulator — the one question a
  // build cannot answer — and the transpiler has no business lowering a CODESYS source-position intrinsic.
  // 90 -> 98. `memory/pointer-parameters.ts` — eight fixtures RECORDED BEFORE the thing they measure is built,
  // which is the order `memory-model.ts` beside them used and the order `fixtures/README.md` asks for. They are
  // the acceptance tests for `pointer-model.md` §8 step 1: a `POINTER TO` input the callee only dereferences is a
  // VAR_IN_OUT binding with a `^` on every use. The recordings say the erasure is sound —
  //   `ptrparam_write`        the callee's `p^ := 77` changes the CALLER's variable, so it is a borrow, not a copy
  //   `ptrparam_two_targets`  one input, two call sites, two ADR arguments, two answers (11 and 22) — which is
  //                           precisely what form 1's ONE recorded target per pointer cannot represent
  //   `ptrparam_kept`         a pointer input stored in a field still reads its target three scans later, so the
  //                           handle form is real and this is the shape the borrow may NOT swallow
  // This number is expected to come back DOWN by eight when step 1 lands, and further as it clears the 105 POUs
  // `pointer-order` stops in the corpus. A ceiling that rises for measurement is not the same as one that rises
  // for a gap, and the eight below are the first kind.
  // 98 -> 94. Step 1 landed for a ROUTINE's pointer input — `ptrparam_read`, `_write`, `_two_targets` and
  // `_method` lower and match CODESYS.
  // 94 -> 95. `ptrparam_input_persists`, which answers the question that decides whether form 2 reaches an FB at
  // all: it does NOT. An FB's VAR_INPUT is a FIELD, and the recording says it keeps its address — supplied on one
  // call and OMITTED on the next, the body still reads 55 through it. So the address outlives the call by
  // construction, which is §4's own definition of a HANDLE.
  // 95 -> 92. FORM 3 READS. A pointer or reference naming several variables holds a TAG, and a read selects the
  // arm it names (`IrSelect` — `IrDispatch` with a place where the call is). `refuse_pointer_two_targets` reads b
  // after `p := ADR(a); p := ADR(b)`, and both `refdecl_rebound_*` follow a reference rebound after its
  // declaration, one of them from a METHOD and across a scan. Writing through such a pointer is still refused,
  // and says so: a place cannot express a select, so the write wants an `IrSwitch` over the arms.
  // 92 -> 103. transpile-review-2026-09-29's recorded fixtures that lowering refuses today — tasks 11, 15, 22 (THIS),
  // 23, 28, 34, 43 (three output conversions) and 44. Coverage the fixes are expected to take back.
  // 103 -> 104. `tr_18_queryinterface_into_global` (task 18): a wrong answer turned into a refusal — the query's edge
  // is foreign like the plain store's (`interface-instance-relative`); CODESYS's r1 = r2 = 1 wants form-3 lending.
  // 104 -> 108. Task 11 lowers its fixture (-1); task 16 (`call-fb-inout`: a METHOD reaching the in-out of an FB copied
  // whole) and task 17 (`pointer-type`: an ANY input's pValue dereferenced as another type, four) turn wrong answers
  // into refusals (+5) — CODESYS's answers want the copied binding tag and a byte view.
  // 108 -> 109, FOR MEASUREMENT. frontend-conformance 2.3a recorded `decl_var_generic_in_array` (an ARRAY OF a
  // VAR_GENERIC FB with its value builds and runs on CODESYS); lowering refuses VAR_GENERIC as it does for
  // `decl_var_generic` and `_read` — the transpiler's, not the front-end's.
  // 109 -> 111, FOR MEASUREMENT. frontend-conformance 2.3.6 recorded two type expressions CODESYS builds and runs that
  // lowering refuses: `decl_implicit_enum_in_array` (`a[1] := ia_b` — `place-not-local`, an implicit enum's value whose
  // declaration is an ARRAY OF it is no constant to lowering, `constants.ts` reads only a declaration typed directly)
  // and `decl_array_star_in_function_input` (a FUNCTION's `ARRAY[*]` VAR_INPUT indexed — `place-shape`). The
  // transpiler's, not the front-end's.
  // 111 stays, its members change (2.3b review): `decl_implicit_enum_in_array` LOWERS now (`constants.ts` reads an
  // implicit enum through the ARRAY OF it; confirmed), and `decl_array_star_in_method_input` (a METHOD's `ARRAY[*]`
  // VAR_INPUT, CODESYS builds and runs it) joins the function's. Both are `deferred.transpile`: lowering lends an open
  // array only as a VAR_IN_OUT; niche: accepted loss (0 occurrences in the corpora — their 36 `ARRAY[*]` are VAR_IN_OUT).
  // `decl_pointer_to_pointer_deref` was recorded refused by lowering and lowers too (`pointers.ts`: a pointer's storage
  // is its target's), so it adds nothing here.
  // 111 -> 113, FOR MEASUREMENT. frontend-conformance 2.4a recorded two units CODESYS builds and runs that lowering
  // refuses, each the transpiler's and not the front-end's: `unit_fb_extends_qualified` (an FB extending a LIBRARY FB,
  // `Standard.TON` — its base has no layout lowering reaches, `layout-base`; 0 qualified library bases in the corpora)
  // and `unit_type_extends_on_union` (a UNION of INT and DINT — `layout-union`, its overlaid bytes unmeasured; the
  // EXTENDS is only the warning's).
  // 113 -> 130, FOR MEASUREMENT. frontend-conformance 2.5.6 (2026-10-02) recorded 17 expressions CODESYS builds and runs
  // that lowering refuses, each the transpiler's and not the front-end's: nine inline assignments (`expr_inline_assign_*`
  // — `assign_expr` is lowered nowhere, `cp_inline_assignment` is not either), six global-namespace reads, writes and
  // calls (`expr_global_namespace_*`, the new `global_expr` node: "global_expr is not lowered yet"),
  // `expr_this_as_pointer` (`p := THIS`) and `expr_pool_qualified_fb_type` (whose `__POOL.` type the parser refuses).
  // 130 -> 132, FOR MEASUREMENT. The 2.5b review (2026-10-02) recorded two more CODESYS builds and runs that lowering
  // refuses: `expr_inline_assign_for_start` (`assign_expr`, as above) and `expr_global_namespace_enum_bound` — an array
  // bounded `E.Up...E.Left` is "not a sized array" (`aggregate-init`), and so it is with `..` and no dot: `constEval`
  // folds no enum value yet (task 4.6.1; 60-odd enum-bounded arrays in the corpora wait on it).
  // 132 -> 136, FOR MEASUREMENT. frontend-conformance 2.6 (2026-10-02) recorded four statements CODESYS builds and runs
  // that lowering refuses, each the transpiler's and not the front-end's: `stmt_try_nested` and
  // `stmt_try_catch_without_operand` (`__TRY` is lowered nowhere — `try_*` are not either), `stmt_bare_member` (a bare
  // expression statement, `bx.v;`) and `stmt_label_at_end` (JMP and its label).
  // 136 -> 137, FOR MEASUREMENT. The 2.6 review (2026-10-02): `stmt_function_own_name_bare` builds and runs (out = 12)
  // and lowering refuses its bare-name statement, as `stmt_bare_member`'s (the transpiler's).
  // 137 -> 139, FOR MEASUREMENT. frontend-conformance 2.7 (2026-10-02): `prag_if_hasconstanttype` (whether a constant is
  // replaced is the project's "Replace constants" option, which the exec world does not state — refused by name, not
  // guessed; P16 is area 4's) and `prag_unknown_attribute_on_union` (a UNION of INT and DINT — `layout-union`, the
  // transpiler's, as `unit_type_extends_on_union`).
  // 139 -> 146, FOR MEASUREMENT. frontend-conformance 2.10 (2026-10-02), each the transpiler's: `decl_pointer_to_pointer_deref_typed`
  // (dereferences in a branch never taken — `pointer-order`, the pointer model wants an address stored before a `^`) and
  // six `prag_to_string_*` — under `{attribute 'to_string'}` an enum's STRING conversions print the member's NAME
  // (CODESYS 'On', "On"), which lowering printed as the number: a silent wrong answer, now refused by name
  // (`lower/builtins.ts`; the name table is task 4.5.1's). `prag_to_string_absent` (no attribute, '1') is confirmed.
  // 146 -> 151, FOR MEASUREMENT. frontend-conformance 3.1 (2026-10-02) recorded five scope fixtures CODESYS builds and runs
  // that lowering refuses, each the transpiler's: `sym_global_namespace_dot_skips_local` (`expr-global_expr`, as the
  // `expr_global_namespace_*`), `sym_method_output_param_bound` (a METHOD's VAR_OUTPUT bound `o => out`,
  // `call-inout-alias`), `sym_library_gvl_qualified_by_list` and `_fully` (a library's global, `place-not-local`) and
  // `sym_device_instance_bare` (`ADR(Device)`, a device instance has no storage the lowering knows, `place-not-local`).
  // 151 -> 152, FOR MEASUREMENT. frontend-conformance 3.2 (2026-10-02): `inh_interface_method_output_param` builds and runs
  // (out = 6) and lowering refuses an interface METHOD's VAR_OUTPUT bound `o => out`, as `sym_method_output_param_bound`
  // (the transpiler's).
  // 152 -> 161, FOR MEASUREMENT. frontend-conformance 3.4 (2026-10-02): 9 new library cells CODESYS builds and runs and the
  // lowering refuses — library elements it has no body or place for (`ISLIBRELEASED`, `DATETIMEFROMWEEK`, a library's
  // globals `Util.DAY_FLAGS.TUESDAY` / `Util.CONSTANTS.…`, `Util.Standard.LEN`, a library enum through a namespace or a
  // namespace's dependency, bare `ERROR`): `lib_ns_type_qualified`, `_type_name_two_libraries`, `_library_member_own_type`,
  // `_own_type_other_enum`, `_same_name_two_libraries`, `_transitive_qualification`, `_transitive_qualification_call`,
  // `_library_gvl_member`, `_library_gvl_shared_list_name` (the transpiler's; src/transpile is not this change's to edit).
  // 161 -> 162, FOR MEASUREMENT. frontend-conformance 3.5 (2026-10-02): `mem_private_method_of_same_type_instance` builds
  // and runs (out 14) — a PRIVATE METHOD through a POINTER TO an instance of its own FB, `pOther := THIS` — and the lowering
  // refuses it (the transpiler's).
  "not-lowered": 162,
  // `refused` is uncapped on purpose: it is the rating that GROWS when a probe family asks the vendor something it
  // rejects, which is the point of a probe family. 252 -> 322 in one sitting (`mixed-type`, `unary-operand`), all of
  // them questions with answers.
  // ZERO. Every fixture has been put to a real CODESYS. It was 140 while fixtures were written ahead of the recording
  // sessions, and the last 59 fell in two groups: some the vendor had genuinely never seen, and more that were
  // SKIPPED BY THE RECORDER because they declared nothing readable — a DUT, a GVL, an INTERFACE, an FB whose only
  // members are VAR_TEMP. Those were never unanswerable; they were unasked, which is a different thing and a worse
  // one. A fixture added from here starts at 0 and gets recorded, or it says in `execSkip` why it cannot be.
  unasked: 0,
}

describe("the evidence ratchet", () => {
  whole("the distribution, printed so a status report quotes a measured number", () => {
    const total = ALL_TESTS.length
    const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`
    console.log(`  [fixtures] ${total} fixtures`)
    for (const r of EVIDENCE_ORDER) console.log(`  [fixtures]   ${r.padEnd(12)} ${String(rated(r).length).padStart(4)}  ${pct(rated(r).length).padStart(6)}`)

    // The number a status report should quote is not "2514 fixtures", which counts QUESTIONS. It is how much of what
    // the vendor answered we actually match.
    const executed = rated("confirmed").length + rated("diverges").length
    const answered = executed + rated("refused").length + rated("not-lowered").length
    console.log(`  [fixtures] the vendor ANSWERED ${answered} of ${total} (${pct(answered)})`)
    console.log(
      `  [fixtures] of the ${executed} we both EXECUTE, we match ${rated("confirmed").length} — ${executed === 0 ? "n/a" : `${((rated("confirmed").length / executed) * 100).toFixed(1)}%`}`,
    )
    expect(total).toBeGreaterThan(900)
  })

  whole("each rating stays within its ceiling, and the ones that matter are named", () => {
    console.log(`  [fixtures] diverges: ${rated("diverges").map((c) => c.name).join(", ") || "none"}`)
    console.log(`  [fixtures] not-lowered: ${rated("not-lowered").length} the vendor runs and lowering refuses`)
    console.log(`  [fixtures] unasked: ${rated("unasked").length} have no recording — run \`bun run record:exec\``)

    const over = EVIDENCE_ORDER.filter((r) => CEILINGS[r] !== undefined && rated(r).length > CEILINGS[r]!).map(
      (r) => `${r}: ${rated(r).length} > ${CEILINGS[r]!}`,
    )
    expect(over).toEqual([])
  })
})

// ─── ratchet two: the LSP against each vendor's recorded build ───────────────────────────────────────────────

/**
 * BYTE-IDENTICAL AGREEMENT, per vendor. The active vendor selects the recording AND the LSP's config, because the
 * two IDEs diverge at times. Two assertions encode the incremental build toward full parity:
 *
 *   1. NO FALSE POSITIVES (hard, always green): every LSP message is a real IDE message (LSP ⊆ IDE). This is the
 *      safety guarantee — the LSP never invents an error the compiler did not emit.
 *   2. AGREEMENT RATCHET: the count of fixtures whose message SETS match exactly only ever rises.
 *
 * This is a different mechanism from the rating rows above and deliberately so: the rating asks WHETHER the LSP
 * objects, this asks whether it says the same thing, and conflating them would make the first either too strict (a
 * wording drift becomes a gap) or unable to run at all, since most fixtures carry no fragment to compare.
 *
 * The replay is pure — no live bridge. Re-record via `bun run record:language`.
 */
const FLOORS: ReadonlyArray<{ vendor: Vendor; floor: number }> = [
  // floor = current exact-agreement count; raise as checks are ported, never lower.
  // + oop/ (interface-implementation) + pragmas/ (message + orphan-conditional) + names/
  // (unresolved-identifier): 231 TC / 228 CS of 259. Remaining non-agreements are documented IDE-only
  // divergences (parse cascades, app-config warnings, op_sys_* / __-system constructs) — not reproducible
  // offline; the subset (no-FP) gate stays green on them.
  // 253 → 255 (2026-09-14): gap 13 — untyped integer literals typed as CODESYS/TwinCAT type them (`overflow_*`).
  // 255 → 256: consolidate-lsp-structure A7 — the network-text jump-label check no longer fires on TwinCAT.
  // 265 -> 266: `__CURRENTTASK` is refused, and TwinCAT refuses it too (the fixture records both).
  // 266 -> 2200 (2026-09-20). Not a precision improvement: TwinCAT's ground truth went from 280 fixtures
  // (recorded 2026-07-07, before the census sweeps took the suite from ~967 to 2530) to 2524, so most of the
  // old gap was questions TwinCAT had never been asked. Measured on the 406 both vendors had answered before
  // this: 96.1% identical build verdicts. CODESYS is now the UNDER-measured vendor at 866 — its recording still
  // covers only 893 fixtures, and re-recording it is the obvious next move.
  // 2200 -> 2203: the TwinCAT driver stopped gluing its build log onto three string-warning messages.
  // 2203 -> 2220 (2026-09-20). Five wording differences, measured on both recordings and now data in
  // `messages.ts`: TwinCAT capitalises "Unexpected Token", drops the article and the full stop from
  // "Assignment target not specified", upper-cases the names in a recursion chain, and never words a
  // function's input count as a range. Plus two rules TwinCAT does not have at all (the ABSTRACT-keyword
  // warning) and `INDEXOF`, which both vendors removed and word differently. No check changed its mind about
  // anything — the LSP says what it said, in the vendor's spelling.
  // 2220 -> 2229. Nine string-constant cells, closed by TwinCAT's own exception text: below STRING(3) the
  // prefix it prints would have a negative length, and its message builder throws where CODESYS falls back.
  // One more: TwinCAT names an unresolved base class and stops, where CODESYS adds the type it therefore lacks.
  // 2229 -> 2230, and the backlog 33 -> 19, which is the number that moved: THE VOCABULARY IS VENDOR DATA TOO.
  // `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`, `__VECTOR` and the `UCHAR#`/`LDATE#`/`LDT#`/`LTOD#` literal
  // prefixes are CODESYS's alone, so on TwinCAT they lex as ordinary identifiers that resolve nowhere — which is
  // exactly what TwinCAT says about them. Fifteen fixtures stopped inventing a type for a name the compiler has
  // never heard of; `ldate_ltod_ldt` is the one that arrived, where the two parsers resync differently after an
  // unknown prefix.
  // 2230 -> 2240, and the backlog 19 -> 4, on the day the TwinCAT recording was finally made against the RIGHT
  // TARGET. The fixture solution had been building for `TwinCAT CE7 (ARMV7)`; on `TwinCAT RT (x64)` the
  // platform-width family answers LINT/ULINT/LWORD exactly as CODESYS does, and `__XADD` stops reporting an ARM
  // code-generator crash and states its signature — the mirror image of CODESYS's, taking the counter where
  // CODESYS takes its address, and returning the operand's own type where CODESYS returns DINT. Six operand
  // types each. Plus two rules measured as CODESYS's alone: a sign crossing at an ARGUMENT, and `__NEW` nested
  // in an expression.
  // 2240 -> 2241: the last contaminated row. An apostrophe is a quote, so "Outputs can't be of type
  // 'REFERENCE TO'" carries three and the driver joined the build summary onto it.
  // 2241 -> 2242: `op_sys_varinfo` left `KNOWN_DIVERGENCES` — it was masked as a TwinCAT divergence while
  // the real fault was the same line-joining bug, and the two vendors record it identically now.
  // 2242 -> 2255: the LSP was UNDER-reporting, which costs agreement without ever making a gate red. A sign
  // crossing in a comparison has a 32-bit floor and the floor is CODESYS's — TwinCAT warns at SINT/USINT and
  // INT/UINT too, in all twelve of those cells.
  // 2255 -> 2305 on ONE rule, and not a rule about any check: TwinCAT never says the same thing twice on
  // one LINE. 111 of 2541 CODESYS fixtures carry a message repeated on a single line and ZERO TwinCAT ones
  // do, so the collapse happens once, where the diagnostics leave the analyzer.
  // 2305 -> 2317: a BITWISE operator computes in the UNSIGNED integer of its operands' width, so every
  // signed operand converts going in and the result converts coming back out — three warnings for
  // `out := a AND b` with LINT operands, which the LSP answered with silence because it typed the result
  // LINT and saw no conversion at all.
  // 2317 -> 2346, and the same rule again from the other end: ARITHMETIC MEETS ITS OPERANDS and converts both
  // into the meet. `aUlint MOD aSint` meets at LINT and the ULINT operand warns; `aLint + aReal` meets at REAL
  // and the LINT operand warns about the mantissa. Neither pair is the same WIDTH, which is all the check used
  // to look at, so it had no rule to name a whole family of conversions with.
  // 2346 -> 2351: the 64-bit DATE types are CODESYS's as well — TwinCAT has LTIME and has no LDATE, LTOD or
  // LDT, so a declaration is "Unknown type" there and `DATE_TO_LDATE` is an identifier nothing defines.
  // 2351 -> 2424 on SEVENTY-THREE fixtures, by deleting placeholders. Six checks were gated to CODESYS with
  // the note "TwinCAT unmeasured" — written when TwinCAT's recording covered 280 fixtures. It covers 2524
  // now and every one of the six AGREES: an IL operator used as a name cascades identically on both, down
  // to the ten messages and their order. The single false positive they exposed was the reachability case
  // CODESYS already had documented, measured on TwinCAT and filed beside it.
  // 2424 -> 2426: three more gates that rested on the same stale premise. TwinCAT HAS the dynamic-creation
  // rule (it calls the pragma an attribute), the conditional-call rule (it hyphenates call-statement) and
  // the FB_init one (it stops at the name, with no input count and no suggested syntax).
  // 2426 -> 2446: the twenty `mathret_*` cells, recorded on both vendors and agreeing on both.
  // 2446 -> 2447: a declaration's initializer converts even when it is not a literal.
  // 2447 -> 2450: an ordinary name in a resync cascade IS a statement once the compiler has supplied the `;` it
  // was asking for, and both vendors then say what they always say about a statement that reads a variable and
  // does nothing with it.
  // 2450 -> 2470: AN UNKNOWN LITERAL PREFIX CASCADES LIKE ANY OTHER REFUSED NAME, and the cascade machine
  // was already here — `LDT#` quoted whole, then a pair per token to the `;`. Twenty fixtures, and the only
  // new code is a token scan: the parser gives up at the first stray, so there is no AST to walk. It also
  // found that the cascade re-lexed WITHOUT the dialect, which read `LDATE#2026-05-09` as one CODESYS date
  // literal and quoted a token TwinCAT never saw.
  // 2470 -> 2479: the NINE `xf_*_to_l*` conversions, and the fix is one guard drawn a shade finer. An
  // assignment whose source has no type was skipped when the TARGET had none either, on the sound worry
  // that the target is usually a library type the LSP cannot see. TwinCAT does not fall silent there -- it
  // writes the unresolved name out ("... to type 'LDATE'"), so the skip only had to stop covering the
  // names the VENDOR provably lacks, which `dialectMissingType` already decided for the declaration.
  // 2479 -> 2496: THE REPLAY HAD NO STANDARD LIBRARY ON TWINCAT, so `LEN` resolved nowhere and seventeen
  // fixtures said nothing where the recording has a real error. The harness had said so in a comment for
  // months ("Tc2_Standard, a different materialization — not added for it") and nobody costed the sentence.
  // Sharing CODESYS's materialization adds ZERO false positives, which is the gate that makes it a
  // measurement rather than a guess.
  // 2496 -> 2497: `__NEW` again, and this time the answer was that there is no answer to have. TwinCAT
  // prints the attribute message with the attribute PRESENT, in every position, for a self-reference, for a
  // different FB and for a STRUCT alike, and with the attribute removed nothing changes. CODESYS prints
  // "No memory for dynamic object creation" on either side of the same message, so the pragma rule is
  // plainly never reached on either project. Five TwinCAT cells joined the divergence list with that
  // evidence; the one that moved is the new control, which agrees.
  // 2497 -> 2501: PARTIAL ACCESS (`dwSource.%W1`) IS A CODESYS EXTENSION. TwinCAT reads the `.` as an ordinary
  // member access, finds `%` where a component name belongs and leaves the width+index standing as a statement
  // of its own — three messages, and the same three at all four widths. `.%W`/`.%B` had been recorded since
  // 2026-05-29 and `.%X`/`.%D` were asserted in a note beside them; asked properly they answer identically.
  // 2501 -> 2506: A DECLARATION INITIALIZER IS NOT A BODY, and the name check only ever walked bodies, so
  // `n : DINT := nope;` said nothing where both vendors say "Identifier 'nope' not defined". Plus the rule
  // above it: a `__` name the compiler does not know is a PARSE refusal there, not an undefined identifier
  // — three messages, both vendors, and four probes to tell that apart from "an initializer must fold"
  // (a sibling VARIABLE initializes one just fine).
  // 2506 -> 2513: A UNARY OPERATOR CONVERTS ITS OPERAND, and two rows of that rule had been written down as
  // "nothing". They were the summary's error, not the recording's — `unary_minus_on_bool` has carried
  // "Cannot convert type 'BOOL' to type 'INT'" all along and `uop_not_time` the TIME one, both read as the
  // RESULT conversion with the operand half unnoticed. Four new cells close it: `-BOOL` asked into a STRING,
  // where the operand message cannot hide behind the result's, and `NOT` on TOD, DT and LTIME. Every one
  // reports, on both vendors, at its operand's own width.
  // 2513 -> 2516: two dialect rules and a gate that named the wrong kind. TwinCAT refuses LOWER_BOUND/
  // UPPER_BOUND on an array with FIXED bounds where CODESYS folds them (the `ARRAY[*]` cells compile clean on
  // both, which is what makes it a rule rather than a coincidence). A DEFAULT does not make an input optional
  // there either — leaving out the one that HAS an initial value is "requires exactly '2' inputs". And the
  // required-inputs check was gated to `function` while the METHOD form had never been asked: asked, both
  // vendors answer with the same message, naming the method.
  // 2516 -> 2526: `TEST_AND_SET` TAKES A DWORD BY ADDRESS, and four cells could only say that in outline. Seven
  // more operand types turn it into one sentence: the operand converts into a DWORD exactly as an assignment
  // would convert it, so DWORD and UDINT make no temporary and say nothing, a legal conversion makes one and
  // "'BYTE_TO_DWORD(flag)' is not allowed as operand for ADR" is the address being refused, a SIGNED operand
  // adds the sign-change warning the same conversion carries anywhere else, and a type with no conversion at
  // all (BOOL, REAL, STRING, LWORD) reports the conversion instead. Identical on both vendors, and written
  // through the shared assignment rules so an operand nobody probed answers the way `x : DWORD := flag` does.
  // 2526 -> 2528: A DECLARATION'S INITIALIZER IS A PLACE EXPRESSIONS LIVE, twice over. The narrowing check asked
  // only what the STORE converts, so `i : DINT := REAL_TO_DINT(EXPT(2, 10))` was silent — nothing converts at
  // the store and everything converts at the ARGUMENT. And `unknown-source` walked bodies, so a hole in an
  // initializer was named as an undefined identifier and never carried into the declared type.
  // 2528 -> 2538: ONE RULE, TWO IMPLEMENTATIONS, AND THEY DISAGREED — found by a review of
  // `consolidate-lsp-structure`, which is the change about exactly this. A one-argument math function's result
  // is its argument's REAL type, and lowering typed a non-real argument LREAL while inference said nothing at
  // all, its own comment recording the integer case as "unmeasured". Ten cells measured it: `SQRT(anInt)` into
  // a REAL warns on both vendors, as do LN, LOG, EXP, SIN, COS, TAN, ASIN, ACOS and ATAN.
  // 2538 -> 2539: WHICH NAMES MAY A CALL BIND — one question with two answers in one package. The ST check
  // asked `lookupMember` unfiltered, so a plain `VAR loc : INT` bound silently; the network-text check beside
  // it already restricted to the pin sections and properties. Both vendors say the ST side was wrong. The
  // same cell settled the CASING too: a call site upper-cases the callee, a member WRITE keeps its case, and
  // only the network check knew.
  // 2539 -> 2546 (2026-09-27): network text v2 (openspec network-text-literal-nwl 5.6). TwinCAT reports a JMP to a
  // missing label after all (census 1.15 — the silence measured 2026-07-07 was of v1 text), and the label checks
  // follow the recorded builds: four new label fixtures, each recorded live on both vendors.
  // 2546 -> 2562 (2026-09-30): push-without-header-check 4.1/4.2 — the texts the push now writes as sent, recorded on
  // both vendors: a DUT/GVL read as the IDE reads it (nothing before its keyword), a declaration missing its `;` in
  // CODESYS's own words, a FUNCTION's EXTENDS, and C0145 in TwinCAT's spelling.
  // 2562 -> 2564 (2026-09-30, the step's review): `op_sys_type_class_bare` and `call_ldate_instance`, recorded live —
  // the second pins C0035 beside "Unknown type: 'LDATE'" for a call of a CODESYS-only type's instance.
  // 2564 -> 2601 (2026-09-30, frontend-conformance 2.1): the lexer's fixtures (`grammar/lexer.ts`), recorded live — 37
  // agree; ten are `KNOWN_DIVERGENCES` (the recovery rule R1's) and six are refused at object creation (`execSkip`).
  // 2601 -> 2886 (2026-09-30, frontend-conformance 2.1.3): every keyword asked in the three positions a statement gives a
  // name (`lex_keyword_{assigned,before_name,operand}_*`), the cascade meeting a soft name, the modifiers as named
  // arguments and `cal` read — recorded live; the parser refuses a keyword that is no operand, takes the next token for
  // a call operator's `(`, and refuses at a statement start only the words the recordings refuse.
  // 2886 -> 2954 (2026-10-01, frontend-conformance 2.2): the literal fixtures (`grammar/literals.ts`), recorded live — the
  // lexer ends a literal where the vendor does and refuses a malformed one whole (`Token.malformed`), a calendar field
  // out of range is "too large", and the statement a refused literal's resync resumes at is warned (`resumed`); 2.1.4's
  // own fixtures had already taken the count past the old floor.
  // 2954 -> 2968 (2026-10-01, frontend-conformance 2.2a): the review's 18 literal cells, recorded live — `_` as free in a
  // typed integer and a duration as in an integer, a duration's components strictly largest first, a 32-bit DATE/DT's
  // upper end, a refused literal in a type position or after an operator in an initializer said where it stands. The
  // four that do not agree are `LITERAL_REFUSAL_DECLARATION_RECOVERY`.
  // 2968 -> 3025 (2026-10-01, frontend-conformance 2.2.6/2.2.7): the typed character, string, enum and UTF8# literals and
  // the address shapes (58 `lit_*`), recorded live — every `<word>#` TwinCAT has no literal for is ONE refused token
  // (`TWINCAT_LITERAL_PREFIXES`), an address is taken by its shape (`literal/address`); `tr_12_fmt_long_dates`, first
  // recorded on TwinCAT here, agrees. Not agreeing: `TWINCAT_MALFORMED_ADDRESS_ALIGNMENT`,
  // the `xf_l*_call_once` (then one mark; split by the 2.2b review into the three rules they show).
  // 3025 -> 3036 (2026-10-01, frontend-conformance 2.2b): the review's 17 literal and address cells, recorded live — a
  // literal hole under NOT/ABS/ADR/a negation or a bare conversion, a sized address with no position in a body, a typed
  // integer as a CASE label, a UCHAR# escape past ASCII; the six a refused `<word>#` reaches inside a list are
  // `TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST`.
  // 3036 -> 3081 (2026-10-01, frontend-conformance 2.3.1-2.3.5): the declaration fixtures (`grammar/declarations.ts`),
  // recorded live — VAR_ACCESS at file scope, the qualifiers in any order, NON_RETAIN a name, AT refused after the type
  // and on an operand that is no address (the declaration dropped by the binder), `:=` with no value, repeat counts, a
  // STRUCT field read by the one declaration parser, a VAR section in a STRUCT named by its placement. Not agreeing: the
  // marks of `support/divergences.ts` 2.3 (recovery, VAR_GENERIC, the driver's cut echo, NON_RETAIN's recovery).
  // 3081 -> 3086 (2026-10-01, 2.3 review fixes and 2.3a): the review's five cells, and `decl_struct_init_unknown_field_in_array`,
  // `_in_field_array` (a struct value in an array initializer held to the element's struct).
  // 3086 -> 3124 (2026-10-01, frontend-conformance 2.3.6): the same type-expression fixtures and fixes, on TwinCAT, with
  // its own words for a reversed bound, a reference as a base type and an `ARRAY[*]` outside a VAR_IN_OUT.
  // 3124 -> 3135 (2026-10-01, 2.3b review): the same cells on TwinCAT, in its words for a nested `ARRAY[*]`.
  // 3135 -> 3191 (2026-10-01, frontend-conformance 2.4a): the same unit fixtures and fixes, on TwinCAT, with its own
  // words for PRIVATE/PROTECTED, the alias's EXTENDS (the type named, not the base) and an interface property's
  // PRIVATE/PROTECTED (it builds).
  // 3191 -> 3200 (2026-10-01, 2.4a review): the review's cells on TwinCAT (a PROPERTY's FINAL/ABSTRACT after its access
  // modifier, an interface METHOD's VAR_TEMP/VAR_STAT/VAR_INST, a refused FB as no base).
  // 3200 -> 3268 (2026-10-01, frontend-conformance 2.5): the expression fixtures (`grammar/expressions.ts`) and the parser
  // moves — `**`/`&` and the IL call form refused by the parser, a statement without its `;` standing and resynced as the
  // vendors do (which also closed the ten `R1_CASCADE_AFTER_A_STRAY_TOKEN` marks and two literal ones), a keyword member
  // and TwinCAT's `.%` partial access refused as no component, an index list's trailing comma and an operator's.
  // 3268 -> 3278 (2026-10-02, 2.5a review): the review's cells — a parenthesis left open in an IF/WHILE condition and in
  // an index, a one-operand operator's trailing comma (with its operand count), `&` in ABS, an operator word before a
  // sign, `d.%W0` beside an undefined name, a missing `;` before a CASE arm.
  // 3278 -> 3306 (2026-10-02, frontend-conformance 2.5.6): the THIS/SUPER, inline-assignment, global-namespace and
  // parenthesis fixtures (`expr_this_*`, `expr_super_*`, `expr_inline_assign_*`, `expr_global_namespace_*`,
  // `expr_paren_*`), with a leading-dot primary (`global_expr`), an inline assignment as a CASE selector, a FOR bound and
  // an index, SUPER typed by its base and refused as the vendors refuse it in a base-less FB (`refuse_super_without_base`
  // agrees now), and THIS/SUPER without their `^` no structured variable.
  // 3306 -> 3316 (2026-10-02, 2.5b review): the review's cells — the corpora's `1...X` array bounds (bare, list-qualified,
  // enum, an index past one), `.g` as a CONSTANT target, called, in a CONSTANT's initializer, declared by two lists,
  // SUPER.Get() with no base, an inline assignment as a FOR start (`expr_global_namespace_ambiguous_bare` a niche
  // divergence); a fixture's lists bound as objects of their own (`splitLists`).
  // 3316 -> 3393 (2026-10-02, frontend-conformance 2.6): the statement fixtures (`grammar/statements.ts`, 85 `stmt_*`) and
  // the statement rules — a token no statement starts with refused at the start, `s=`/`ref=` in any case, the one-line
  // missing `;` after RETURN/EXIT/CONTINUE/JMP and before a block's END, a CASE label list's trailing comma, `__CATCH`
  // without its operand, a binary operation as a statement "no valid statement", an empty CASE arm a warning, S=/R= and
  // FOR counter and typed-label conversions, a chain's non-name target, TwinCAT's reversed literal REF= and its CASE
  // range full stop (`cc3_reference_assign` agrees now, `expr_inline_assign_operand` too).
  // 3393 -> 3508 (2026-10-02, 2.6 review): every reserved word called where a statement starts (`lex_keyword_called_*`),
  // an assignment without its `;` before every statement and block keyword (`stmt_assign_no_semicolon_before_*`), a
  // negation as a chain's inner target and as a FOR counter, a FUNCTION's own name bare inside it.
  // 3508 -> 3585 (2026-10-02, frontend-conformance 2.7): the pragma fixtures (`grammar/pragmas.ts`, 75 `prag_*`) — conditional
  // directives only where a statement may start, one statement tree per body, the condition grammar and its operators,
  // message pragmas only where said; attributes in the AST (obsolete per use, a METHOD's its own); and the 49 fixtures the
  // recorder had pushed without the pragmas above their units, re-recorded (the five TwinCAT `newdel_*` agree now).
  // 3585 -> 3592 (2026-10-02, 2.7 review): the message words in upper/mixed case, the unquoted `hasattribute` cells.
  // 3592 -> 3645 (2026-10-02, frontend-conformance 2.8): the error-recovery fixtures (`grammar/recovery.ts`, 55 `rec_*`) —
  // one token wording, a block left open, the refused words and their cascades in the parser — and the cells they closed
  // (`stmt_assign_missing_value`, `stmt_if_else_if_two_words`, `stmt_s_eq_spaced`, `stmt_assign_spaced_operator`,
  // `lit_time_fraction_ms`, `cc5_deprecated_functionblock_keyword`).
  // 3645 -> 3662 (2026-10-02, 2.8 review): the refused word in the positions 2.8.3 had not asked (`rec_refused_word_*`: a
  // label, a JMP target, an initializer, a STRUCT/UNION field), the end of the text as a member name, a keyword in an
  // INTERFACE, the first CASE arm without its label ("No case label found" — `lit_enum_typed_case_label` agrees with it).
  // 3662 -> 3696 (2026-10-02, frontend-conformance 2.10): area 2's last rules asked — T6's POINTER TO POINTER used, P14's
  // `strict` cells (its refusals are 4.5.1's, `deferred.lsp`), P15's `to_string`, P16's `const_replaced`/`_non_replaced`.
  // 3696 -> 3732 (2026-10-02, frontend-conformance 3.1): the scope and lookup fixtures (`fixtures/names/scopes.ts`, Y1–Y24)
  // and the bare-name search order the front-end now owns (`types/names` `resolveBareName`).
  // 3732 -> 3764 (2026-10-02, frontend-conformance 3.2): the inheritance fixtures (`fixtures/names/inheritance.ts`,
  // H4–H10) — interface EXTENDS bound and linked, every base through the link, overrides checked in compiled FBs only.
  // 3764 -> 3784 (2026-10-02, frontend-conformance 3.3): the enum fixtures (`fixtures/names/enums.ts`, EN1–EN6) — a
  // bare member resolved per asker, ambiguity reported, a library member bare where one enum declares it.
  // 3784 -> 3787 (2026-10-02, frontend-conformance 3.4): the library-namespace fixtures (`fixtures/names/libraries.ts`,
  // LB1–LB9) — library precedence per asker, a qualified type in its namespace, the incremental library rebind.
  // 3787 -> 3825 (2026-10-03, frontend-conformance 3.5): the member fixtures (`fixtures/names/members.ts`, M1–M6) —
  // callees found by their instance's TYPE (REFERENCE, array element, SUPER^), interface members as `<ITF>__Union`,
  // the named-argument count; access refusals are MEMBER_DIVERGENCES.
  { vendor: "twincat", floor: 3825 },
  // the `???` slots match on text. 257 → 280 (2026-09-14): the LSP gaps the transpiler's execution oracle exposed —
  // `r`/`s` names, `**`, unary-minus and EXPT typing, set/reset chains — plus the operator-coverage fixtures
  // (now `suite.test.ts`), which found `&` is not a CODESYS operator either. Each recorded live and fixed.
  // 280 → 293 (2026-09-14): gaps 7 (a TIME literal's US/NS unit), 8 (LTIME literal typing), 9 (a library FUNCTION's
  // arguments), 11 (string arithmetic), 12 (a stray token after an initializer); the Standard library now in the CODESYS
  // replay project, as it is in the recording project; and declaration parse errors no longer counted twice here.
  // 293 → 311: gap 13 — an untyped integer literal the target cannot hold, typed as its narrowest integer type.
  // 311 → 315: consolidate-lsp-structure A2 — an L-prefixed date literal is the 64-bit type, printed in full.
  // 315 → 316: A4 — one conversion-name parser; the types it prints are the compiler's.
  // 316 → 318: A10 — one string-literal decoder; the assignment message counts decoded characters.
  // 318 → 333: A13 — declaration initializers type-checked like assignments (gap 14).
  // 333 → 349: A14 — IL operator names reserved as identifiers; C8 — a project enum's values and variables convert as INT.
  // 349 → 354: B6 — inference types an enum value, so call arguments and comparisons see it as assignments do.
  // 354 → 460 (2026-09-14): unify-conformance-suite §5 — the 117 execution programs build-recorded through the bridge.
  // 460 → 503: §5.2 — operand sign changes (arithmetic, bit operations, comparisons, MAX/MIN, NOT), a chained
  // assignment's inner store, an over-long WSTRING, a REAL literal beyond REAL, a typed literal sum; 37 `cc_*` probes.
  // 503 → 509: the six memory-model fixtures (transpile-st-to-rust design §9).
  // 509 → 521: the twelve call fixtures (`fb-call.ts`, transpile-st-to-rust phase 3).
  // 521 → 734 (2026-09-16): the fixture programme — 138 new fixtures across the cross-object, corpus-mined and
  // check-coverage batches, and the eleven LSP defects they found. The last jump, 717 → 734, is the IDE's parse-error
  // CASCADE after a reserved name, which no fixture could agree without.
  // 734 → 755 (2026-09-16): how often a DECLARATION'S INITIALIZER warning repeats. The IDE reports one twice — once
  // for the type, once for the instance initialisation it generates — and the LSP now does the same (measured with
  // `initializer-repeat.ts`: no instance 0, one instance 2, two instances 2, nested 2, PROGRAM 1; so it is per-type,
  // not per-instance). The goal is the IDE's answer, not a tidier one.
  // 849 -> 857 (2026-09-17): NINE ng_* fixtures whose recorded "ground truth" was of a project they never
  // entered. Their network text was not a round-trip fixed point, the bridge refused the push with
  // NETWORK_NOT_CANONICAL, and the recorder (then) logged a warning and wrote down the build anyway — so the
  // IDE side read `Unknown type: 'FB_NG_arith'`, which is PLC_PRG failing to find an FB that was never
  // created. Rewritten with the canonical body the refusal prints verbatim, eight now build CLEAN and the
  // ninth records real errors. No LSP change was involved in any of it.
  // 857 -> 859: `NOT` on a signed integer types as the UNSIGNED integer of its width (the result side of a
  // rule the operand side already had), and an ARRAY OF STRING(n) checks its elements.
  // 859 -> 862: the abstract ATTRIBUTE on a method without the ABSTRACT keyword warns; two probe fixtures
  // (`cc6_abstract_attribute_on_fb` / `_on_method`) established it is a METHOD rule, which `cc4_not_instantiable`
  // could not say because it carries the attribute on both and records one warning.
  // 862 -> 865: `ANYNUM_TO_*` is not a CODESYS function (it was accepted on the strength of 80 corpus uses, every
  // one inside a materialized library file), and an FB whose `FB_Init` takes extra inputs must be given them at
  // the declaration.
  // 865 -> 866: `__CURRENTTASK`, whose two messages are the same in all six positions measured.
  // 866 -> 2412 (2026-09-20). Like TwinCAT's jump the same day, this is COVERAGE and not precision: the CODESYS
  // recording covered 893 of 2530 fixtures — it had not been re-recorded since 2026-09-17, before the last of the
  // census sweeps — so two thirds of the suite could not agree because there was nothing to agree WITH.
  // 2412 -> 2418: six new fixtures, not six fixes. `cc_string_prefix_len_*` now sweeps EVERY capacity from 1
  // to 10 instead of four of them, and the sweep confirms the prefix rule the LSP already implements
  // (`n - 3`, and `n` when there is nothing to subtract from) against the "length mod 3" guess the old
  // comment carried from three data points.
  // 2419 -> 2423: four more `cc_enum_arg_into_*` cells. The family asked one unsigned target and TwinCAT was
  // silent on exactly that one, which is a hypothesis, not a measurement — four more unsigned targets make it one.
  // 2423 -> 2424: `sysop_position_value`, which asks what `__POSITION` actually EVALUATES to. It answers
  // `'Line 1, Column 1 (Impl)'` and `'Line 5 (Decl)'` — the text behind the two sizes the type carries.
  // 2424 -> 2436: the same bitwise model. It is the first CODESYS gain today that is the LSP learning a RULE
  // rather than a vendor difference being taken out of one.
  // 2436 -> 2465: the meet-based operand rule, the same twenty-nine fixtures as on TwinCAT.
  // 2465 -> 2485: A ONE-ARGUMENT MATH FUNCTION HANDS BACK THE REAL IT WAS GIVEN. All ten, both ways: the
  // catalog modelled no return type for any of them, so the LSP said nothing about a narrowing the compiler
  // reports twice. `cfold_sqrt` was the one data point, and one point cannot tell "SQRT is LREAL" from "SQRT
  // follows its argument, and an untyped real literal is an LREAL". Twenty cells can.
  // 2485 -> 2486: `cfold_sqrt` — the initializer check only ever asked `literalCheckType`, so an initializer
  // with a SHAPE (a call, a member read, an expression) converted in silence.
  // 2486 -> 2489: the same three, on CODESYS.
  // 2489 -> 2505: SEVENTEEN `tc_*` fixtures, and the catalog was the bug. `{attribute 'TcRetain'}` is a real
  // attribute to TwinCAT and an unknown one to CODESYS, which says so -- but both families sat in ONE flat set,
  // so every `Tc*` name was known to both and the LSP answered silence where CODESYS warns. Sixteen warn; the
  // seventeenth is `Tc2GvlVarNames` above a `VAR_GLOBAL`, which CODESYS says nothing about for a reason that is
  // not the name at all -- the attribute pass does not run on a GVL file, exactly as it does not on a DUT.
  // 2505 -> 2521: a WSTRING hex escape is FOUR digits, and the four cells that said so were never enough to
  // say it. They establish a REFUSAL; "a WSTRING takes no `$` escape" and "a WSTRING escape is four digits"
  // both fit them and disagree about every valid string. Thirteen new cells separate the two — `$0041`,
  // `$20AC`, `a$0041b`, the named escapes and both `WSTRING(n)` forms all compile, `$41`/`$FF`/`$C3$A9`/`$004`
  // do not — and twelve of the thirteen agreed the moment they were recorded.
  // 2521 -> 2523: the two new partial-access widths, which CODESYS compiles clean and now says so.
  // 2523 -> 2526: the same two, on the vendor where `__POSITION` resolves and only the plain unknown name bites.
  // 2526 -> 2533: the same rule, the same seven cells.
  // 2533 -> 2534: the METHOD half of the required-inputs rule, which CODESYS words as a range like a FUNCTION's.
  // 2534 -> 2544: the same eleven cells.
  // 2544 -> 2545: the same two, on the vendor that records `cfold_expt`.
  // 2545 -> 2555: the same ten cells.
  // 2555 -> 2556: the same cell.
  // 2556 -> 2560 (2026-09-27): the four label fixtures of network text v2 (5.6), each the build's own message.
  // 2560 -> 2582 (2026-09-30): the same, plus C0077 "Unknown type" for a bare name nothing declares (CODESYS only —
  // TwinCAT's library materialization does not carry every type its compiler knows).
  // 2582 -> 2585 (2026-09-30, the step's review): a global missing its `;` is silent on CODESYS
  // (`pwh_gvl_missing_semicolon` left `KNOWN_DIVERGENCES`), bare TYPE_CLASS is no unknown type
  // (`op_sys_type_class_bare`) and a call of an LDATE instance (`call_ldate_instance`), both recorded live.
  // 2585 -> 2622 (2026-09-30, frontend-conformance 2.1): the lexer's fixtures (`grammar/lexer.ts`), recorded live — 37
  // agree; ten are `KNOWN_DIVERGENCES` (the recovery rule R1's) and six are refused at object creation (`execSkip`).
  // 2622 -> 2912 (2026-09-30, frontend-conformance 2.1.3): the same fixtures, the same fixes, on the vendor they were
  // first recorded on.
  // 2912 -> 2982 (2026-10-01, frontend-conformance 2.2): the same literal fixtures and fixes, on CODESYS.
  // 2982 -> 2996 (2026-10-01, frontend-conformance 2.2a): the same review cells and fixes, on CODESYS.
  // 2996 -> 3054 (2026-10-01, frontend-conformance 2.2.6/2.2.7): the same 58 literal and address fixtures, all agreeing —
  // a `<word>#<operand>` is a typed literal, a character, a UTF-8 string, its token's own text, or a component
  // (`literal/value` `typedLiteralForm`), `STRING#`/`WSTRING#` refused words.
  // 3054 -> 3069 (2026-10-01, frontend-conformance 2.2b): the same 17 cells — a literal hole is a hole under NOT, ABS,
  // ADR and a negation and converts to ANY in a bare conversion (`analysis/hole` `passThroughOperand`), `%MW` is no
  // operand and no target, "no component" in every initializer, `INT#5:` a CASE label and an enum's `Type#Value` none,
  // `UCHAR#'$80'` one character; the two DUT ones are `COMPONENT_CARRIED_ON_IN_A_DUT`.
  // 3069 -> 3128 (2026-10-01, frontend-conformance 2.3.1-2.3.5): the same declaration fixtures and fixes, on CODESYS,
  // with VAR_GENERIC (`FB<6>`, its CONSTANT, its count) and the section-in-a-STRUCT echo whole.
  // 3128 -> 3137 (2026-10-01, 2.3 review fixes and 2.3a): the review's five cells; a struct value in an array initializer
  // held to the element's struct (`decl_struct_init_unknown_field_in_array`, `_in_field_array`), and an ARRAY OF a
  // VAR_GENERIC FB counted by its element (`decl_var_generic_in_array_no_argument`, `_two_values`).
  // 3137 -> 3178 (2026-10-01, frontend-conformance 2.3.6): the type-expression fixtures (`grammar/type-expressions.ts`),
  // recorded live — the subrange/argument-list split by type, ARRAY dimensions all `*` or none, STRING's either closer
  // and WSTRING's `(…)` only, one enum value parser, an implicit enum's base and its values through an array, and the
  // declared types refused once read (`analysis` declared-type, string-length-non-const). Not agreeing: the marks of
  // `support/divergences.ts` 2.3.6.
  // 3178 -> 3190 (2026-10-01, 2.3b review): the cells the review asked for — punctuation and TIME/DATE/platform-integer
  // subranges, untyped negative and `N-1` bounds, a POINTER TO POINTER written through, a TYPE enum value followed by
  // neither `,` nor `)` in the vendors' two wordings, an `ARRAY[*]` nested, in a STRUCT field or a METHOD's VAR_INPUT.
  // 3190 -> 3250 (2026-10-01, frontend-conformance 2.4a): the unit fixtures (`grammar/units.ts`), recorded live — the
  // header clauses in each position, each modifier on each unit kind (an access modifier only first, OVERRIDE a name),
  // a qualified base linked through its library's namespace, the TYPE's `;` per body kind and a refused body kept, the
  // checks the recordings worded (PRIVATE/PROTECTED, ABSTRACT and FINAL, EXTENDS on an alias or enum). Not agreeing:
  // the marks of `support/divergences.ts` 2.4a.
  // 3250 -> 3259 (2026-10-01, 2.4a review): the review's cells (a PROPERTY's FINAL/ABSTRACT after its access modifier,
  // an interface METHOD's ABSTRACT FINAL and VAR_TEMP/VAR_STAT/VAR_INST, a refused FB as no base).
  // 3259 -> 3260 (2026-10-01, 2.4.6): `unit_namespace_opening_only` — no word about a text opening with NAMESPACE.
  // 3260 -> 3328 (2026-10-01, frontend-conformance 2.5): the expression fixtures and the parser moves, as on TwinCAT.
  // 3328 -> 3338 (2026-10-02, 2.5a review): the review's cells, as on TwinCAT.
  // 3338 -> 3366 (2026-10-02, frontend-conformance 2.5.6): the THIS/SUPER, inline-assignment, global-namespace and
  // parenthesis fixtures, as on TwinCAT.
  // 3366 -> 3376 (2026-10-02, 2.5b review): the review's cells, as on TwinCAT.
  // 3376 -> 3454 (2026-10-02, frontend-conformance 2.6): the statement fixtures and rules, as on TwinCAT.
  // 3454 -> 3569 (2026-10-02, 2.6 review): the review's cells, as on TwinCAT; `__queryinterface(n);` the operand count alone.
  // 3569 -> 3640 (2026-10-02, frontend-conformance 2.7): the same, on CODESYS — and with the pragmas pushed, an unknown
  // attribute on any DUT warns, `deprecated` is no CODESYS attribute, `abstract` on an FB warns, `pingroup` on a unit.
  // 3640 -> 3647 (2026-10-02, 2.7 review): the same, on CODESYS.
  // 3647 -> 3707 (2026-10-02, frontend-conformance 2.8): the same, on CODESYS, and `unit_struct_extends_after_struct`,
  // `unit_struct_extends_twice` (the declaration resync resuming at a name).
  // 3707 -> 3723 (2026-10-02, 2.8 review): the same, on CODESYS.
  // 3723 -> 3757 (2026-10-02, frontend-conformance 2.10): the same, on CODESYS.
  // 3757 -> 3797 (2026-10-02, frontend-conformance 3.1): the same, on CODESYS.
  // 3797 -> 3829 (2026-10-02, frontend-conformance 3.2): the same, on CODESYS.
  // 3829 -> 3854 (2026-10-02, frontend-conformance 3.3): the same, on CODESYS.
  // 3854 -> 3868 (2026-10-02, frontend-conformance 3.4): the same, on CODESYS.
  // 3868 -> 3914 (2026-10-03, frontend-conformance 3.5): the same, on CODESYS.
  { vendor: "codesys", floor: 3914 },
]


function extFor(kind: string): string {
  const map: Record<string, string> = { function_block: "pou", function: "pou", program: "pou", gvl: "gvl", interface: "itf", dut: "dut" }
  const ext = map[kind]
  if (!ext) throw new Error(`fixture kind "${kind}" has no file extension`)
  return ext
}

// Cross-fixture declaration context: every fixture's interfaces/DUTs/GVLs and FBs (with their standalone
// method/property/action member units) are visible to the others, so `EXTENDS X` / `IMPLEMENTS X` / type refs
// AND inherited members resolve across fixtures. Each fixture is its own file, so a standalone method binds to
// the FB in its OWN fixture (no cross-fixture leak); fixture pouNames are unique (`FB_LANG_<name>`) so FBs
// don't collide. Only PROGRAM units are excluded (PLC_PRG is synthesized per fixture separately).
// Each read as the object its file holds (`parseDocument`), as the workspace store reads a workspace file — a DUT's or a
// GVL's text the way the IDE reads it (`syntax/format/source-object.ts`).
const PARSED = ALL_TESTS.map((t) => {
  const uri = `file:///conformance/${t.pouName}.${extFor(t.kind)}`
  return { uri, source: t.source, parseResult: parseDocument(uri, t.source, { networkText: true }) }
})
// A list a fixture holds beside its POU is an item of its own, under the name the push gives it (`splitLists`): bound
// once with the declarations, and analysed with its fixture.
const SPLIT = PARSED.map((p, i) => splitLists(ALL_TESTS[i]!, p))
const LISTS = SPLIT.flatMap((s) => s.lists)
const CROSS_DECLS = SPLIT.map(({ item: p }) => ({
  uri: p.uri,
  source: p.source,
  parseResult: {
    units: p.parseResult.units.filter((u) => u.kind !== "program"),
    errors: [],
    // The declaration-only copy parses the SAME source, so it fails on the same names; keeping them means a fixture
    // whose declaration cannot parse stays as quiet here as it is anywhere else.
    failedDeclarations: p.parseResult.failedDeclarations,
    tokens: p.parseResult.tokens,
    dialect: p.parseResult.dialect,
  },
}))
// The recorder builds each fixture with a PLC_PRG that instantiates + uses it; usage-only diagnostics
// (assignment in the caller, external write) live there, so synthesize + analyze it too.
const PLC_PRGS = ALL_TESTS.map((t) => {
  if (t.plcPrgVar === undefined && t.plcPrgBody === undefined) return undefined
  const source = plcPrgSource(t)
  // A DIRECTORY per fixture, so the file's BASE NAME is the object's name — `PLC_PRG.pou`, as a workspace has it.
  // It used to be `<fixture>__plcprg.pou`, which made every synthesized PLC_PRG look like a POU whose signature
  // disagrees with its object name (`signature-name`), and that is a real CODESYS error, not a harness detail.
  return { uri: `file:///conformance/${t.name}/PLC_PRG.pou`, source, parseResult: parseSource(source, { networkText: true }) }
})

/**
 * BOTH recording projects reference a standard library, so a fixture calling `LEN` compiled against its
 * declaration and the replay has to as well (gap 9, `cc_standard_len_wstring`).
 *
 * <p>This was CODESYS-only, on the note "TwinCAT's standard library is Tc2_Standard, a different materialization
 * — not added for it". True about the materialization and wrong about the consequence: without one, TwinCAT's
 * replay could not resolve `LEN` at all, so it said NOTHING where the recording has a real error, and SEVENTEEN
 * fixtures lost agreement to a missing library rather than to a missing check.</p>
 *
 * <p>Sharing CODESYS's materialization is a claim about Tc2_Standard, and it is the no-FP gate that makes it
 * testable rather than a guess: a signature that differs would put an LSP-only message on the board immediately.
 * Measured 2026-09-21 — agreement 2479 -> 2496 and the false-positive list unchanged at three. A specific
 * divergence, when one is found, is a reason to materialize Tc2_Standard separately, not to go back to none.</p>
 */
const standardLibrary = (vendor: Vendor) => PROJECT_LIBRARY.map((l) => ({ ...l, parseResult: parseSource(l.source, { networkText: true }, vendor) }))

/**
 * THE SAME SOURCE, LEXED AS THE OTHER VENDOR — for the handful of fixtures where that can differ at all.
 *
 * `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`, `__VECTOR` are CODESYS's alone, and so is every `<word>#` literal
 * prefix TwinCAT does not read (`TWINCAT_LITERAL_PREFIXES`: `UCHAR#`, `LDATE#`, `CHAR#`, an enum's `E#`…;
 * `syntax/lex/vocabulary.ts`, measured on both recordings) — and a WSTRING hex escape
 * of fewer than four digits ends the token where TwinCAT stops, not where CODESYS does (`lex/lexer.ts`
 * `lexQuotedString`, `esc_wstring_hex_*`). For every other source the two dialects produce identical tokens, so this
 * re-parses only what contains one of them — by name, and for the escape any `$` with one to three hex digits (a
 * STRING's too: re-parsing more than needed is exact, only slower). Parsing all 2540 fixtures twice would be correct
 * and would also double the harness's setup for about thirty files.
 */
// …and a partial access `x.%W0`: one token on CODESYS, `.` `%` `W0` on TwinCAT (`lex/lexer`, `accepts_partial_access`)
const DIALECT_WORDS = new RegExp(`(?<![A-Za-z0-9_])(${[...CODESYS_ONLY_KEYWORDS].join("|")})|\\$[0-9A-Fa-f]{1,3}(?![0-9A-Fa-f])|\\.%`, "i")
const LITERAL_PREFIX = /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)#/g
const DIALECT_SENSITIVE = {
  test: (source: string): boolean =>
    DIALECT_WORDS.test(source) || [...source.matchAll(LITERAL_PREFIX)].some((m) => !TWINCAT_LITERAL_PREFIXES.has(m[1].toUpperCase())),
}
// By the document, not its uri: fixtures share a POU name, so two fixtures' files can share a uri.
const TC_PARSE = new WeakMap<object, { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }>()
function asVendor<T extends { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }>(
  doc: T,
  vendor: Vendor,
): T | { uri: string; source: string; parseResult: ReturnType<typeof parseSource> } {
  if (vendor !== "twincat") return doc
  let hit = TC_PARSE.get(doc)
  if (hit === undefined) {
    // A source with none of the CODESYS-only words lexes to the same tokens in both dialects, so its CODESYS parse IS
    // its TwinCAT parse, and says so (`ParseResult.dialect` — the analysis refuses a parse made for the other vendor).
    const parseResult = DIALECT_SENSITIVE.test(doc.source)
      ? parseDocument(doc.uri, doc.source, { networkText: true }, "twincat")
      : { ...doc.parseResult, dialect: "twincat" as const }
    hit = { uri: doc.uri, source: doc.source, parseResult }
    TC_PARSE.set(doc, hit)
  }
  return hit
}
/**
 * ONE PROJECT PER VENDOR, EDITED IN PLACE — not one rebuilt per fixture.
 *
 * This used to call `buildSymbolTable` with `CROSS_DECLS.filter((_, i) => i !== testIdx)`: every fixture's
 * declarations except its own, bound from scratch, once per fixture. That is O(n^2) in the fixture count — at 1453
 * fixtures it is 2.1 million file-binds per vendor — and it timed out the moment a census sweep pushed n up by half.
 * The census will push it much further, so the shape had to change rather than the budget.
 *
 * The exclusion was only ever there because `CROSS_DECLS[i]` and `own` are the same file: binding both would declare
 * every fixture's own types twice. `unbindFile` takes that one file out by URI and `bindFile` puts it back, so the
 * project each fixture sees is EXACTLY what it saw before — every other fixture's declarations, plus its own units
 * with their programs, plus the standard library.
 */
const SHARED = new Map<Vendor, Scope>()
function sharedProject(vendor: Vendor): Scope {
  let project = SHARED.get(vendor)
  if (project === undefined) {
    project = build.buildSymbolTable([...CROSS_DECLS, ...LISTS, ...standardLibrary(vendor)], PROJECT_MANIFESTS, vendor, RECORDING_ENVIRONMENT, projectDevices(vendor))
    SHARED.set(vendor, project)
  }
  return project
}

/** The swap left in place by the previous call, undone lazily at the start of the next. */
let pending: { project: Scope; idx: number; plcUri: string | undefined } | undefined
function restore(): void {
  if (pending === undefined) return
  build.unbindFile(pending.project, PARSED[pending.idx]!.uri)
  if (pending.plcUri !== undefined) build.unbindFile(pending.project, pending.plcUri)
  build.bindFile(pending.project, CROSS_DECLS[pending.idx]!)
  pending = undefined
}

/**
 * Every error+warning message the LSP emits for a fixture (incl. parse errors + PLC_PRG usage) — ONCE per fixture and
 * vendor. The replay against the recorded build and the simulator gate below both ask it for every codesys fixture; it
 * was computed twice (31 s of the file, measured 2026-10-01). Each call swaps its own fixture into the shared project
 * after undoing the previous one, so its answer does not depend on the order fixtures are asked in.
 */
const LSP_MEMO = new Map<string, string[]>()
function runLsp(testIdx: number, vendor: Vendor): string[] {
  const key = `${vendor} ${testIdx}`
  let hit = LSP_MEMO.get(key)
  if (hit === undefined) LSP_MEMO.set(key, (hit = runLspNow(testIdx, vendor)))
  return hit
}
function runLspNow(testIdx: number, vendor: Vendor): string[] {
  const { item: own, lists } = splitLists(ALL_TESTS[testIdx]!, asVendor(PARSED[testIdx] as (typeof PARSED)[number], vendor))
  const plc0 = PLC_PRGS[testIdx]
  const plc = plc0 === undefined ? undefined : asVendor(plc0, vendor)
  const project = sharedProject(vendor)
  // swap this fixture's declaration-only copy for its real one, run, then put it back
  // ONE `relink` PER FIXTURE, not two. It walks every child in the project, so at two per fixture it is the
  // O(n^2) term all over again — which is what pushed this back over the 5s hang guard once the census sweeps added
  // another eight hundred fixtures. The restore does not link: the project is left bound-but-unlinked, and the NEXT
  // fixture's link fixes it before anything reads it. Nothing runs in between.
  restore()
  build.unbindFile(project, own.uri)
  build.bindFile(project, { uri: own.uri, parseResult: own.parseResult, source: own.source })
  if (plc) build.bindFile(project, { uri: plc.uri, parseResult: plc.parseResult, source: plc.source })
  // with the MANIFESTS: re-linking without them cleared the library-visibility table the first build published, so
  // every fixture after the first resolved an ambiguous library name as if no library could see another
  build.relink(project, PROJECT_MANIFESTS)
  pending = { project, idx: testIdx, plcUri: plc?.uri }

  const config = resolveConfig({ vendor })
  const diags = computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config })
  if (plc) diags.push(...computeSemanticDiagnostics({ parseResult: plc.parseResult, source: plc.source, project, config }))
  for (const list of lists) diags.push(...computeSemanticDiagnostics({ parseResult: list.parseResult, source: list.source, project, config }))
  // Graphical (network text) bodies: the semantic pass skips them; run the network text checks too so network text fixtures are covered.
  diags.push(...computeNetworkTextDiagnostics({ uri: own.uri, source: own.source, parseResult: own.parseResult }, project, messagesFor(vendor)))
  // No separate `parseResult.errors` here: `checkParseErrors` already reports them. Pushing them again counted every
  // DECLARATION parse error twice, so a fixture like `cc_decl_init_trailing_ident` could never agree exactly.
  return diags
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${comparable(d.message)}`)
    .sort()
}

function ideMsgs(ds: readonly RecordedDiagnostic[]): string[] {
  return ds
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${comparable(d.message)}`)
    .sort()
}

for (const { vendor, floor } of FLOORS) {
  const expected = BUILDS[vendor]

  describe(`the LSP against ${vendor}'s recorded build`, () => {
    if (expected.recorded === null) {
      test.skip(`(no recording — run \`bun run record:language\` for ${vendor})`, () => {})
      return
    }

    let agree = 0
    const falsePositives: string[] = []
    const disagreed: { name: string; lsp: string[]; ide: string[] }[] = []
    /** Marked fixtures that AGREE exactly now — each mark is stale (`support/expected-failure.ts`). */
    const stale: string[] = []
    const stillDiverges = (name: string, mark: string, lsp: string[], ide: string[]): void => {
      try {
        expectStillDiverges(name, mark, [() => expect(lsp).toEqual(ide)], `${vendor}'s build`)
      } catch (error) {
        stale.push((error as Error).message)
      }
    }
    for (let i = 0; i < ALL_TESTS.length; i++) {
      const t = ALL_TESTS[i] as (typeof ALL_TESTS)[number]
      if (!SELECTION.has(t.name)) continue
      const rec = expected.tests[t.name]
      if (rec === undefined) continue
      const lsp = runLsp(i, vendor)
      const ide = ideMsgs(rec.diagnostics)
      // A KNOWN DIVERGENCE is still replayed, as an expected failure: exempt from the false-positive gate, and
      // reported the day it agrees, so the set cannot keep a fixture that no longer diverges.
      if (KNOWN_DIVERGENCES[vendor].has(t.name)) {
        stillDiverges(t.name, `KNOWN_DIVERGENCES.${vendor}`, lsp, ide)
        continue
      }
      const ideSet = new Set(ide)
      for (const m of lsp) if (!ideSet.has(m)) falsePositives.push(`${t.name}: LSP-only ${m}`)
      // A fixture the LSP deliberately does not answer yet — the reason, with its date, is on the fixture — claims no
      // agreement. Its FALSE POSITIVES are still checked, just above: a deferral says "we do not emit this", never
      // "anything we emit here is fine". And it is an expected failure like the set above: agreeing ends it.
      if (t.deferred?.lsp !== undefined) {
        stillDiverges(t.name, t.deferred.lsp, lsp, ide)
        continue
      }
      if (lsp.length === ide.length && lsp.every((m, k) => m === ide[k])) agree += 1
      else disagreed.push({ name: t.name, lsp, ide })
    }

    // `VOLT_REPLAY_REPORT=1 bun test test/conformance/fixtures.test.ts` — every fixture that is not exact agreement,
    // with both sides printed. The ratchet says HOW MANY are left; closing them needs to know WHICH, and grepping a
    // 890-entry recording by hand is how a session goes missing.
    if (process.env.VOLT_REPLAY_REPORT === "1") {
      console.log(`\n[${vendor}] ${disagreed.length} fixture(s) not in exact agreement:`)
      for (const d of disagreed) {
        const ideSet = new Set(d.ide)
        const lspSet = new Set(d.lsp)
        console.log(
          `\n  ${d.name}\n` +
            d.ide.map((m) => `    IDE  ${lspSet.has(m) ? " " : "-"} ${m}`).join("\n") +
            (d.ide.length > 0 ? "\n" : "") +
            d.lsp.map((m) => `    LSP  ${ideSet.has(m) ? " " : "+"} ${m}`).join("\n"),
        )
      }
    }

    test("emits NO false positives (every LSP message is a real IDE message)", () => {
      // CODESYS is a hard zero. TwinCAT has a dated triage list (see `TWINCAT_TRIAGE`) that may only shrink.
      const triaged = vendor === "twincat" ? TWINCAT_TRIAGE : CODESYS_TRIAGE
      const unexcused = falsePositives.filter((f) => !triaged.has(f.slice(0, f.indexOf(":"))))
      expect(unexcused).toEqual([])
      // ...and an entry that no longer fires must LEAVE the list, or the list becomes a place things go to hide.
      const firing = new Set(falsePositives.map((f) => f.slice(0, f.indexOf(":"))))
      console.log(`  [${vendor}] LSP-only on ${firing.size} fixture(s) — the triage backlog`)
      expect([...triaged].filter((n) => SELECTION.has(n) && !firing.has(n))).toEqual([])
    })

    test("every known divergence still diverges (a marked fixture that agrees must lose its mark)", () => {
      expect(stale).toEqual([])
    })

    whole(`agreement does not regress (>= ${floor})`, () => {
      console.log(`  [${vendor}] exact agreement: ${agree}/${ALL_TESTS.length} fixtures`)
      expect(agree).toBeGreaterThanOrEqual(floor)
    })
  })
}

/**
 * THE ORACLE A FIXTURE HAS THE DAY IT IS WRITTEN. A fixture written today has no BUILD recording until somebody
 * brings the bridge up and re-records, so it could sit green for weeks while the LSP reported nonsense on it. It
 * does have one: `codesys.run.json` says the case BUILT and RAN in the simulator, so every LSP ERROR on it is a
 * false positive whether or not its diagnostics were ever recorded.
 *
 * Errors only — a build that succeeds still emits warnings, and which ones is what the ratchet above is for. Weaker
 * than that check (it cannot see a diagnostic the LSP MISSES) and needs nothing but the run recording.
 *
 * AN EXPLICIT BUDGET, because the default 5s is not one. This runs the whole analyzer over every fixture and the
 * cost is LINEAR in how many there are — about 3ms each, and the census sweeps took the suite from 967 fixtures
 * to 2332 in a day. It timed out twice on the way and both times it was a real quadratic term in the harness, now
 * gone: a symbol table rebuilt per fixture from every other fixture's declarations, and `relink` walking
 * every child twice per fixture. What is left is the work the gate exists to do.
 */
test("the LSP emits NO error on a fixture the simulator built and executed", () => {
  const falsePositives: string[] = []
  for (const [i, t] of ALL_TESTS.entries()) {
    if (!SELECTION.has(t.name)) continue
    const rec = RUNS[t.name]
    if (rec === undefined || rec.error !== undefined || t.source === "" || t.recorderSkip === true) continue
    if (KNOWN_DIVERGENCES.codesys.has(t.name)) continue
    for (const m of runLsp(i, "codesys")) if (m.startsWith("[error]")) falsePositives.push(`${t.name}: ${m}`)
  }
  expect(falsePositives).toEqual([])
}, 60_000)
