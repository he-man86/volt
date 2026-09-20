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
 * WHAT DRIVES THE ROWS is the STORED rating, not a freshly computed one — `evidence.generated.ts`, written by
 * `bun run rate:fixtures`. That is only safe because the first test below recomputes every rating and fails on a
 * disagreement; derived data committed to source needs exactly that gate and nothing less.
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
import { CODESYS_ONLY_KEYWORDS, CODESYS_ONLY_LITERAL_PREFIXES, decodeStringLiteral, parseSource } from "../../src/syntax/index.js"
import { bindFile, buildSymbolTable, linkExtends, unbindFile, type Scope } from "../../src/symbols/index.js"
import { computeSemanticDiagnostics, messagesFor, resolveConfig, type Vendor } from "../../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../../src/network/index.js"
import { emitRust, isBit, lowerSource, run, rustAccess, type IrValue, type LoweredPou } from "../../src/transpile/index.js"
import { lowerCodeKind } from "../../src/transpile/ir/codes.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture, withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"
import { RUSTC as rustc, skipRustSuite } from "./support/rustc.js"
import { comparable } from "./support/compare-message.js"
import { EVIDENCE_ORDER, lspErrors, rateFixture, type Evidence } from "./support/evidence.js"
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
    lowered = lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls])
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
 *  before it, from 0 — how CODESYS numbers them (conformance `type_dut_enum_*`). */
function enumsOf(c: LanguageTest): Map<string, bigint> {
  const out = new Map<string, bigint>()
  const number = (prefix: string, values: readonly { name: { text: string }; value?: import("../../src/syntax/index.js").Expr }[]) => {
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
  for (const unit of parseSource(runSource(c)).units) {
    if (unit.kind === "type_decl" && unit.body.kind === "enum") number(unit.name.text, unit.body.values)
    // an implicit enumeration displays under a name of the IDE's making: `Implicit_Enum__FB_LANG_implicit_enum__eState.Running`
    if ("varSections" in unit && "name" in unit && unit.name !== undefined)
      for (const section of unit.varSections)
        for (const decl of section.decls)
          if (decl.type.kind === "implicit_enum_type") for (const n of decl.names) number(`Implicit_Enum__${unit.name.text}__${n.text}`, decl.type.values)
  }
  return out
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
  if (raw.startsWith("LDATE#")) return floorTo(value, 86_400_000_000_000n)
  return value
}

/** The recorded values as the IR holds them, and the interpreter's answers reduced to the same display. */
function compareInterp(c: LanguageTest, rec: RunRecorded): void {
  const lowered = lowering(c)
  if (lowered.pou === undefined)
    throw new Error(`cannot lower: ${lowered.diagnostics[0]?.message} [${lowered.diagnostics[0]?.code}]`)
  const pou = run(lowered.pou)
  for (let i = 0; i < (c.cycles ?? 1); i++) pou.scan()
  const want = Object.fromEntries(Object.entries(rec.values!).map(([k, v]) => [k, ideValue(v, enumsOf(c))]))
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, asDisplayed(rec.values![k]!, pou.get(k) as IrValue)]))
  expect(got).toEqual(want)
}

// ─── the rating rows ─────────────────────────────────────────────────────────────────────────────────────────

/** Every fixture under the rating it stores. A rating with no fixtures is not an error; a fixture with a rating
 *  this file has no row for IS, and the last test in the table says so. */
const BY_RATING = new Map<Evidence, LanguageTest[]>(EVIDENCE_ORDER.map((r) => [r, []]))
for (const t of ALL_TESTS) BY_RATING.get(t.evidence as Evidence)?.push(t)
const rated = (r: Evidence): LanguageTest[] => BY_RATING.get(r) ?? []

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
      test(`${c.name} — faults in CODESYS (${rec.error.slice(0, 40)}), and must fault here too`, () => {
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
      })
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
  const runs = new Map<string, { exit: number; stdout: string; stderr: string }>()

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
      const prints = Object.keys(RUNS[c.name]!.values!).map((name) => {
        const { expr, type, global } = rustAccess(pou, name)
        // A REAL prints with Debug, which keeps its decimal point. A STRING prints its BYTES as a list — not Debug, whose
        // `\u{c}` for a form feed is no JSON — so no control character inside it can break this tab-separated output.
        const family = type.kind === "elementary" ? type.elem.family : undefined
        // an FB's VAR_STAT read through an instance lives in the application's globals
        const field = `${global ? "g" : "p"}.${expr}${family === "string" ? ".units()" : ""}`
        return `    println!("${name}\\t{${family === "real" || family === "string" ? ":?" : ""}}", ${field});`
      })
      const emitted = emitRust(pou)
      // a program that reaches globals or calls PROGRAMs scans against one of each, created once like the IDE's application
      const setup = [
        ...(emitted.usesGlobals ? ["    let mut g = Globals::new();"] : []),
        ...(emitted.usesPrograms ? ["    let mut prg = Programs::new();"] : []),
      ]
      const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : [])].join(", ")
      // a POU with an init step (a `call_after_global_init_slot` method) runs it once, before the first scan
      const init = pou.init === undefined ? [] : [`    p.init(${args});`]
      const scan = [...setup, ...init, `    for _ in 0..${c.cycles ?? 1} { p.scan(${args}); }`].join("\n")
      const main = `fn main() {\n    let mut p = ${pou.name}::new();\n${scan}\n${prints.join("\n")}\n}\n`
      const file = join(dir, `${c.name}.rs`)
      const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
      await Bun.write(file, `${emitted.code}\n${main}`)
      // ST has no dynamic memory, so the Rust needs no `unsafe` — forbidden, so a case needing it fails rather than builds
      // DENY warnings, with the same three exceptions the crate check makes plus one of its own. This used to be
      // `-A warnings`, which meant 600+ emitted programs were compiled with no lint checking at all while the
      // crate check applied real lints to about fifteen — one policy per harness, and the larger one denied
      // nothing. Measured when it was flipped: 2 of 625 failed, and BOTH were faithful emissions of correct ST
      // rather than emitter defects (a statement after RETURN, and a SINT loop bound of 127 that rustc reads as
      // a tautology), which is why those two lints are named here instead of the flip being abandoned.
      //   dead_code / unused_parens — as the crate check: generated code is not read for style.
      //   unreachable_code — a statement after RETURN or EXIT is a real ST program CODESYS compiles, and
      //     `stmt_return_midway` and `stmt_exit_inner` exist to ask what it does. Rust is right that the line
      //     cannot run; that IS the measurement.
      //   unused_comparisons — a FOR bound AT its type's maximum is a comparison rustc can prove
      //     (`for_at_type_max`: `i <= 127i8` for a SINT). The comparison is necessary and the loop needs it.
      const build = Bun.spawn(
        [rustc!, "--edition", "2021", "-D", "warnings", "-A", "dead_code", "-A", "unused_parens", "-A", "unused_comparisons", "-A", "unreachable_code", "-F", "unsafe_code", "-o", exe, file],
        { stderr: "pipe" },
      )
      if ((await build.exited) !== 0)
        return void runs.set(c.name, {
          exit: -1,
          stdout: "",
          stderr: `does not compile:\n${await new Response(build.stderr).text()}`,
        })
      const run = Bun.spawn([exe], { stdout: "pipe", stderr: "pipe" })
      const exit = await run.exited
      runs.set(c.name, {
        exit,
        stdout: await new Response(run.stdout).text(),
        stderr: await new Response(run.stderr).text(),
      })
    }
    // A HANG GUARD PROPORTIONAL TO THE WORK, not a constant. Measured 2026-09-20: 1857 cases compile and run in
    // 179s — against a guard of 180s, which it had silently grown into. That is the failure mode a constant has:
    // it is a budget the suite outgrows without anybody deciding to, and it fails as a timeout, which reads as a
    // hang rather than as "there are more fixtures now". 300ms per case is ~3x the measured cost, so a real hang
    // still fails and a thousand more fixtures do not.
  }, Math.max(120_000, recorded.length * 300))

  for (const c of recorded) {
    test(c.name, () => {
      const result = runs.get(c.name)!
      expect({ exit: result.exit, stderr: result.stderr }).toEqual({ exit: 0, stderr: "" })
      const rec = RUNS[c.name]!
      const pou = lowering(c).pou!
      const printed = new Map(
        result.stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => line.split("\t") as [string, string]),
      )
      const want = Object.fromEntries(Object.entries(rec.values!).map(([k, v]) => [k, ideValue(v, enumsOf(c))]))
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
    })
  }
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
      expect(lspErrors(c, ALL_TESTS)).toContainEqual(expect.stringContaining(c.refused!))
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

  test("what blocks them, by code — the work list's input", () => {
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

/** WE BOTH EXECUTE IT AND DISAGREE — the only rating that means something is WRONG rather than missing. Each
 *  carries `deferred.transpile` saying what was measured; the ceiling below is what keeps a new one visible. */
describe("diverges — measured, and not matched yet", () => {
  for (const c of rated("diverges"))
    test.todo(`${c.name} — ${c.deferred?.transpile ?? "no reason recorded"}`, () => {})

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
  for (const c of rated("lsp-gap"))
    test.todo(`${c.name} — ${c.deferred?.lsp ?? "measured silent: the vendor refuses and the LSP says nothing"}`, () => {})

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
  ])

  test("each is either written down on the fixture or a known measured silence", () => {
    const unaccounted = rated("lsp-gap")
      .filter((c) => c.deferred?.lsp === undefined && !MEASURED_SILENT.has(c.name))
      .map((c) => c.name)
    expect(unaccounted).toEqual([])
    // and the other direction — one that gains a check should leave the set rather than rot in it
    expect([...MEASURED_SILENT].filter((n) => !rated("lsp-gap").some((c) => c.name === n))).toEqual([])
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
  const disagreed = ALL_TESTS.filter(
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

describe("the table is total", () => {
  test("every fixture carries a rating this file has a row for", () => {
    const unknown = ALL_TESTS.filter((t) => !EVIDENCE_ORDER.includes(t.evidence as Evidence)).map(
      (t) => `${t.name}: ${t.evidence ?? "(none)"}`,
    )
    expect(unknown).toEqual([])
  })

  test("the stored rating on every fixture matches the computed one", () => {
    // The whole reason `evidence` can live in a generated file: a stale entry is a red test, not a quiet lie.
    const stale = ALL_TESTS.map((t) => [t, rateFixture(t, ALL_TESTS)] as const)
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
  }, Math.max(30_000, ALL_TESTS.length * 10))

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
  diverges: 3,
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
  "lsp-gap": 3,
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
  "not-lowered": 89,
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
  test("the distribution, printed so a status report quotes a measured number", () => {
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

  test("each rating stays within its ceiling, and the ones that matter are named", () => {
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
  { vendor: "twincat", floor: 2230 },
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
  { vendor: "codesys", floor: 2423 },
]

/**
 * THE TWINCAT TRIAGE BACKLOG — fixtures where the LSP says something TwinCAT does not, dated 2026-09-20.
 *
 * These are NOT excused. `lsp-parity-not-better` is the rule: an LSP-only message is a false positive until a
 * recording says otherwise. They are here because they all arrived at once, from one event, and pretending to
 * have 79 individual reasons would be worse than admitting to none.
 *
 * THE EVENT: TwinCAT's ground truth went from 280 fixtures (recorded 2026-07-07) to 2524. The no-false-positive
 * gate was green before because 90% of the suite had no TwinCAT data to contradict it — silence read as
 * agreement. None of this is a regression; it is the first honest look.
 *
 * They fall into families, and the families are the unit of work — one recording answers a whole column:
 *
 *   ~11  a STRING/WSTRING constant too long for its destination (`cc_string_*`, `cc_wstring_*`, `xo4_string*`,
 *        `ir_initializer_*`). CODESYS warns; this TwinCAT appears not to.
 *   ~9   the `__` atomic operators (`atomic_*`, `operand_xadd`, `operand_compare_and_swap`, `operand_indexof`).
 *   11   the platform-width types (`plat_xint_*`, `plat_uxint_*`, `plat_xword_*`) — TRIAGED 2026-09-20, and the
 *        guess above was wrong: TwinCAT accepts all three spellings and resolves them, just to the other width.
 *        `__XINT`/`__UXINT`/`__XWORD` follow the TARGET: CODESYS records LINT/ULINT/LWORD (its device is named
 *        `CODESYS Control Win V3 x64`), TwinCAT records DINT/UDINT/DWORD (32-bit default, no marker), across
 *        all 18 `plat_*` cells. The LSP hardcodes the 64-bit half, so it is exactly right on one and exactly
 *        wrong on the other. NOT a vendor property — TwinCAT ships x64 runtimes and CODESYS ships 32-bit PLCs,
 *        so a vendor branch would be right for these two projects and wrong in principle. The fix is one rule:
 *        take the width from the project's target, and say NOTHING when it is not knowable. That needs a way to
 *        know the target, so it is a decision rather than a cleanup — see the openspec change. Exposure today
 *        is nil and measured: all 1833 corpus uses live under `Library Manager/`, which the server skips.
 *   ~7   `__POSITION` (`sysop_position_*`, `operand_position`).
 *   ~5   the unnamed network-text target (`network_unnamed_*`), which the compiler never reads at all.
 *   ~4   IL-operator and function-name CASING (`echo_*`).
 *   the rest are individual, and several already have a documented CODESYS twin in KNOWN_DIVERGENCES for a
 *   REACHABILITY reason (`cc2_var_in_interface`, `itf_var_section_*`, `cc6_loop_cannot_exit`,
 *   `ir_initializer_warning_no_instance`) — the same reasoning is likely to apply, and must be checked rather
 *   than assumed.
 *
 * 79 -> 69 on the day it was written, by fixing a BRIDGE bug rather than the LSP. TwinCAT's driver joined
 * following lines onto a message while its quote count was odd — and a complete message can have an odd count,
 * because what it quotes is ST source full of string literals. It swallowed the error list's path echo and the
 * build log, so a family of string warnings TwinCAT reports IDENTICALLY to CODESYS read as a vendor divergence.
 * Ten entries left this list without a line of LSP changing. Prefer that: the cheapest vendor difference to
 * close is the one that was never real.
 *
 * THE RULE HERE IS THAT IT ONLY SHRINKS. A fixture not in this list may not emit an LSP-only message, and a
 * fixture that stops emitting one must leave the list — both are asserted below, so this cannot quietly grow and
 * cannot quietly rot. Triage is tracked in `openspec/changes/twincat-conformance-parity`.
 */
/**
 * THE CODESYS TRIAGE BACKLOG, dated 2026-09-20 — and it is THREE, where TwinCAT's is 79.
 *
 * Same event, same reason it was invisible: the CODESYS recording covered 893 of 2530 fixtures until today, so
 * this gate was green on two thirds of the suite by having nothing to contradict it. That it comes back with 3
 * rather than 79 is the honest measure of how much more this LSP has been developed against CODESYS.
 *
 * Each is a real LSP-only message — an invented error, by `lsp-parity-not-better` — and small enough to name:
 *
 *   meet_bool_mod_int        the LSP says "MOD is not defined for BOOL"; CODESYS compiles it. The meet-type
 *                            table refuses a pair the vendor accepts.
 *   sysop_position_call_form  `__POSITION` typed as STRING where the destination is DINT. Both cells are the
 *   sysop_position_initializer  same rule in two positions, so one measurement closes both.
 */
const CODESYS_TRIAGE: ReadonlySet<string> = new Set([
  "sysop_position_call_form",
  "sysop_position_initializer",
])

const TWINCAT_TRIAGE: ReadonlySet<string> = new Set([
  "atomic_xadd_dint",
  "atomic_xadd_dword",
  "atomic_xadd_int",
  "atomic_xadd_lint",
  "atomic_xadd_lword",
  "cc3_reference_assign",
  "cc4_output_reference_type",
  "cc5_deprecated_functionblock_keyword",
  "cc5_new_in_expression",
  "cc_enum_arg_into_uint",
  "ldate_ltod_ldt",
  "operand_xadd",
  "plat_uxint_into_dint",
  "plat_uxint_into_lint",
  "plat_uxint_meet_dint",
  "plat_xint_into_dint",
  "plat_xword_into_dint",
  "plat_xword_into_lint",
  "plat_xword_meet_dint",
])
/** Fixtures that legitimately do NOT match, each with a documented reason. Empty until a real divergence
 *  is confirmed against a recording (not a not-yet-ported check — those are tracked by the ratchet). */
// subrange is NO LONGER a divergence: the check now emits the compilers' own type-CONVERSION wording
// (`Cannot convert type '200' to type 'INT (1..100)'`, folded onto `cannotConvert`) — byte-identical on both,
// so it's in the ratchet. array-index-out-of-bounds is likewise byte-identical. The overflow fixtures are NOT
// here: the `constant-overflow` check was REMOVED (it false-positived — CODESYS accepts out-of-range untyped
// literals), so the LSP is silent on them; they read as honest "not-yet-implemented" misses.
const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
  // TwinCAT does NOT flag a network-text JMP to a missing label (CODESYS does) — confirmed live 2026-07-07.
  // `cc_vg_undefined_label` was listed here: the LSP flagged the network-text JMP on TwinCAT too, a false positive this
  // set hid. The message is vendor data now (`networkJumpLabelUndefined`), undefined on TwinCAT — no divergence left.
  //   `op_sys_varinfo` — the TwinCAT RECORDING is truncated, not the behaviour: it stores `The code '.size;` with no
  //                       closing quote, where CODESYS stores the whole sentence including the line break it quotes.
  //                       The message is cut at that break on the way out of the TwinCAT driver — a BRIDGE bug to
  //                       fix and re-record, not something for the LSP to match.
  //   `operand_uchar_literal` — `UCHAR#'A'` is a CODESYS extension TwinCAT does not have: it parse-cascades on the
  //                       prefix (five errors), where CODESYS types the literal UDINT. The LSP's parser accepts the
  //                       extension for both, so it types the literal and TwinCAT sees a message it never emits.
  //                       The fix is a TwinCAT-only rejection of the prefix, in the shape `analysis/resync` already
  //                       models — TwinCAT work, deferred until CODESYS is finished.
  //   THE SAME FIVE REASONS CODESYS ALREADY HAS, now checked against TwinCAT's own recording rather than
  //   assumed from its twin (2026-09-20). Each was on the triage backlog as if it were a false positive:
  //   `cc2_var_in_interface`, `itf_var_section_declaration`, `ir_initializer_warning_no_instance` — TwinCAT
  //                       builds all three CLEAN, exactly as CODESYS does, because nothing instantiates the
  //                       POU and an uncompiled POU has no diagnostics. An editor cannot work that way.
  //   `itf_var_section_inherited` — both vendors report the interface error and STOP, never type-checking the
  //                       body that uses the member the interface could not declare.
  //   `cc6_loop_cannot_exit` — C0266 is configurable and is OFF in both recording projects: each records only
  //                       the sign-change warning in `FOR small : SINT := 1 TO 200`, which the LSP matches.
  //   `cc3_pointer_conversions` — TwinCAT prints `Variable of type '1' requires exactly 1 Index`, with the
  //                       INDEX where the type belongs. CODESYS names the type and the LSP matches CODESYS;
  //                       reproducing this one would be copying a vendor defect, not reaching parity.
  twincat: new Set<string>([
    "op_sys_varinfo",
    "operand_uchar_literal",
    "cc2_var_in_interface",
    "itf_var_section_declaration",
    "itf_var_section_inherited",
    "cc6_loop_cannot_exit",
    "ir_initializer_warning_no_instance",
    "cc3_pointer_conversions",
  ]),
  // The `???` fixtures were here while the LSP answered every position with ONE invented sentence. They are
  // NOT divergences any more: the check reads the slot and emits the COMPILER'S wording for it
  // (`Expression expected instead of '?'` for an operand/pin/instance, `The assignment target is not
  // specified.` for a coil target), so they match on text like every other fixture.
  // Three checks the LSP emits that CODESYS does NOT — found by giving the untriggered checks their first fixtures
  // (2026-09-16). Each is recorded here with what the IDE says INSTEAD, because deleting a check on one measurement
  // is a decision, not a cleanup: each may still be right on TwinCAT, or in a shape this fixture does not reach.
  // Four of them are GONE (2026-09-16): each was an LSP message neither compiler emits in ANY recording, and the goal
  // is the IDE's answer, not a better one. `cc2_call_recursion` and `cc2_type_name_…` now say what CODESYS says;
  // `cc2_var_in_interface`'s rule is deleted (SP21 builds it clean); `cc5_no_op_statement` was a storage convention
  // (CRLF vs LF) and is normalized in `comparable()`.
  //   `cc5_pointer_not_convertible` — C0033 is CONFIGURABLE. The recording project has it as an ERROR; the replay
  //                            resolves no project settings, so it is a warning here. Configuration, not behaviour.
  //   `cc5_new_in_expression` — the recording device has no memory configured for dynamic creation, so the IDE
  //                            reports that instead and never reaches the nesting rule.
  //   `cc5_deprecated_functionblock_keyword` — the IDE does not report the spelling at all: it parses `FUNCTIONBLOCK`
  //                            as something else and reports "Unknown type". Both LSP messages are Volt's own.
  //   `sn_dut_mismatch_used` — THE RECORDING IS OF A PROJECT BUILD; A DIAGNOSTIC IS PER FILE. The fixture is an FB
  //                            holding `held : DUT_SN_signature`, and its recorded error — "The name used in the
  //                            signature is not identical to the object name" — is about the DUT, which is a
  //                            DIFFERENT OBJECT in a different file. `record:language` builds the fixture with
  //                            `withDependencies` and collects everything the build says, so the error lands under
  //                            this fixture's name; the LSP computes diagnostics for the file it is given, where
  //                            there is nothing wrong.
  //                            Analysing the dependencies too was tried and does close this one — and costs more
  //                            than it pays: `interface_with_property_impl` then reports the interface's
  //                            accessorless property, which CODESYS does NOT record, because that fixture sets no
  //                            `plcPrgVar` so nothing is instantiated and nothing is compiled. One gained, one
  //                            lost, plus a TwinCAT ratchet point. The rule "an implemented interface property is
  //                            silent" was written to explain it and is WRONG: `interface_with_property` has the
  //                            same interface AND an implementer in the project and still records the warning —
  //                            it instantiates the FB and reads the property, and the other does not.
  //                            What actually separates every one of these is REACHABILITY, which a per-file
  //                            analysis does not have and should not guess at.
  codesys: new Set<string>([
    "sn_dut_mismatch_used",
    "cc5_pointer_not_convertible",
    "cc5_new_in_expression",
    //   C0149, three fixtures, one cause — the compiler only looks at what it REACHES:
    //   `cc2_var_in_interface`, `itf_var_section_declaration` — an interface NOBODY IMPLEMENTS is never compiled,
    //                            so its VAR section draws no error. This is why the rule was wrongly deleted on
    //                            2026-09-16: a clean build on an unreferenced POU was read as "not an error".
    //                            `itf_var_section_inherited` adds an implementer and the error appears.
    //   `itf_var_section_inherited` — CODESYS reports the interface error and STOPS, never type-checking the FB
    //                            body, so `held` is never called undefined. An editor cannot stop: the body is
    //                            in front of the engineer and `held` is genuinely not there.
    "cc2_var_in_interface",
    "itf_var_section_declaration",
    "itf_var_section_inherited",
    //   `sn_dut_mismatch` — a DUT whose type name disagrees with its object, REFERENCED BY NOBODY. The same
    //                            reachability rule, and `sn_dut_mismatch_used` is the proof it is only that: add
    //                            one FB that declares a variable of the type and CODESYS reports the mismatch.
    "sn_dut_mismatch",
    //   `op_sys_new_delete` — the same device fact: the recording project configures no dynamic memory, so every
    //                            __NEW reports that instead of anything about the code.
    "op_sys_new_delete",
    "cc5_deprecated_functionblock_keyword",
    //   `cc6_loop_cannot_exit` — C0266 is CONFIGURABLE too, and the recording project has it OFF: the IDE warns only
    //                            about the sign change in `FOR small : SINT := 1 TO 200`, which the LSP matches.
    "cc6_loop_cannot_exit",
    //   `ir_initializer_warning_no_instance` — the IDE compiles only what the entry point REACHES, so a POU nobody
    //                            instantiates gets no diagnostics at all. An editor cannot work that way: it has to
    //                            answer about the file in front of you before anything instantiates it. The fixture
    //                            stays because the 0 it records is what proves the FB count is not per-declaration.
    "ir_initializer_warning_no_instance",
  ]),
}

function extFor(kind: string): string {
  const map: Record<string, string> = { function_block: "fb", function: "fun", program: "prg", gvl: "gvl", dut: "dut", interface: "itf" }
  return map[kind] ?? "fb"
}

// Cross-fixture declaration context: every fixture's interfaces/DUTs/GVLs and FBs (with their standalone
// method/property/action member units) are visible to the others, so `EXTENDS X` / `IMPLEMENTS X` / type refs
// AND inherited members resolve across fixtures. Each fixture is its own file, so a standalone method binds to
// the FB in its OWN fixture (no cross-fixture leak); fixture pouNames are unique (`FB_LANG_<name>`) so FBs
// don't collide. Only PROGRAM units are excluded (PLC_PRG is synthesized per fixture separately).
const PARSED = ALL_TESTS.map((t) => ({
  uri: `file:///conformance/${t.pouName}.${extFor(t.kind)}`,
  source: t.source,
  parseResult: parseSource(t.source),
}))
const CROSS_DECLS = PARSED.map((p) => ({
  uri: p.uri,
  source: p.source,
  parseResult: {
    units: p.parseResult.units.filter((u) => u.kind !== "program"),
    errors: [],
    // The declaration-only copy parses the SAME source, so it fails on the same names; keeping them means a fixture
    // whose declaration cannot parse stays as quiet here as it is anywhere else.
    failedDeclarations: p.parseResult.failedDeclarations,
  },
}))
// The recorder builds each fixture with a PLC_PRG that instantiates + uses it; usage-only diagnostics
// (assignment in the caller, external write) live there, so synthesize + analyze it too.
const PLC_PRGS = ALL_TESTS.map((t) => {
  if (t.plcPrgVar === undefined && t.plcPrgBody === undefined) return undefined
  const source = plcPrgSource(t)
  // A DIRECTORY per fixture, so the file's BASE NAME is the object's name — `PLC_PRG.prg`, as a workspace has it.
  // It used to be `<fixture>__plcprg.fb`, which made every synthesized PLC_PRG look like a POU whose signature
  // disagrees with its object name (`signature-name`), and that is a real CODESYS error, not a harness detail.
  return { uri: `file:///conformance/${t.name}/PLC_PRG.prg`, source, parseResult: parseSource(source) }
})

// The CODESYS recording project references Standard, as every CODESYS project does, so a fixture calling LEN compiled
// against that library's declaration: replay against the same materialized files (gap 9, `cc_standard_len_wstring`).
// TwinCAT's standard library is Tc2_Standard, a different materialization — not added for it.
const CODESYS_STANDARD = STANDARD_LIBRARY.map((l) => ({ ...l, parseResult: parseSource(l.source) }))

/**
 * THE SAME SOURCE, LEXED AS THE OTHER VENDOR — for the handful of fixtures where that can differ at all.
 *
 * `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`, `__VECTOR` and the `UCHAR#`/`LDATE#`/`LDT#`/`LTOD#` literal
 * prefixes are CODESYS's alone (`syntax/tokens.ts`, measured on both recordings). For every other source the
 * two dialects produce identical tokens, so this re-parses only what contains one of them — exactly, by name,
 * not by a heuristic. Parsing all 2540 fixtures twice would be correct and would also double the harness's
 * setup for about thirty files.
 */
const DIALECT_SENSITIVE = new RegExp(
  `(?<![A-Za-z0-9_])(${[...CODESYS_ONLY_KEYWORDS].join("|")}|(${[...CODESYS_ONLY_LITERAL_PREFIXES].join("|")})#)`,
  "i",
)
const TC_PARSE = new Map<string, { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }>()
function asVendor<T extends { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }>(
  doc: T,
  vendor: Vendor,
): T | { uri: string; source: string; parseResult: ReturnType<typeof parseSource> } {
  if (vendor !== "twincat" || !DIALECT_SENSITIVE.test(doc.source)) return doc
  let hit = TC_PARSE.get(doc.uri)
  if (hit === undefined) {
    hit = { uri: doc.uri, source: doc.source, parseResult: parseSource(doc.source, "twincat") }
    TC_PARSE.set(doc.uri, hit)
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
    project = buildSymbolTable([...CROSS_DECLS, ...(vendor === "codesys" ? CODESYS_STANDARD : [])], [], vendor)
    SHARED.set(vendor, project)
  }
  return project
}

/** The swap left in place by the previous call, undone lazily at the start of the next. */
let pending: { project: Scope; idx: number; plcUri: string | undefined } | undefined
function restore(): void {
  if (pending === undefined) return
  unbindFile(pending.project, PARSED[pending.idx]!.uri)
  if (pending.plcUri !== undefined) unbindFile(pending.project, pending.plcUri)
  bindFile(pending.project, CROSS_DECLS[pending.idx]!)
  pending = undefined
}

/** Every error+warning message the LSP emits for a fixture (incl. parse errors + PLC_PRG usage). */
function runLsp(testIdx: number, vendor: Vendor): string[] {
  const own = asVendor(PARSED[testIdx] as (typeof PARSED)[number], vendor)
  const plc0 = PLC_PRGS[testIdx]
  const plc = plc0 === undefined ? undefined : asVendor(plc0, vendor)
  const project = sharedProject(vendor)
  // swap this fixture's declaration-only copy for its real one, run, then put it back
  // ONE `linkExtends` PER FIXTURE, not two. It walks every child in the project, so at two per fixture it is the
  // O(n^2) term all over again — which is what pushed this back over the 5s hang guard once the census sweeps added
  // another eight hundred fixtures. The restore does not link: the project is left bound-but-unlinked, and the NEXT
  // fixture's link fixes it before anything reads it. Nothing runs in between.
  restore()
  unbindFile(project, own.uri)
  bindFile(project, { uri: own.uri, parseResult: own.parseResult, source: own.source })
  if (plc) bindFile(project, { uri: plc.uri, parseResult: plc.parseResult, source: plc.source })
  linkExtends(project)
  pending = { project, idx: testIdx, plcUri: plc?.uri }

  const config = resolveConfig({ vendor })
  const diags = computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config })
  if (plc) diags.push(...computeSemanticDiagnostics({ parseResult: plc.parseResult, source: plc.source, project, config }))
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
    for (let i = 0; i < ALL_TESTS.length; i++) {
      const t = ALL_TESTS[i] as (typeof ALL_TESTS)[number]
      const rec = expected.tests[t.name]
      if (rec === undefined || KNOWN_DIVERGENCES[vendor].has(t.name)) continue
      const lsp = runLsp(i, vendor)
      const ide = ideMsgs(rec.diagnostics)
      const ideSet = new Set(ide)
      for (const m of lsp) if (!ideSet.has(m)) falsePositives.push(`${t.name}: LSP-only ${m}`)
      // A fixture the LSP deliberately does not answer yet — the reason, with its date, is on the fixture — claims no
      // agreement. Its FALSE POSITIVES are still checked, just above: a deferral says "we do not emit this", never
      // "anything we emit here is fine".
      if (t.deferred?.lsp !== undefined) continue
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
      expect([...triaged].filter((n) => !firing.has(n))).toEqual([])
    })

    test(`agreement does not regress (>= ${floor})`, () => {
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
 * gone: a symbol table rebuilt per fixture from every other fixture's declarations, and `linkExtends` walking
 * every child twice per fixture. What is left is the work the gate exists to do.
 */
test("the LSP emits NO error on a fixture the simulator built and executed", () => {
  const falsePositives: string[] = []
  for (const [i, t] of ALL_TESTS.entries()) {
    const rec = RUNS[t.name]
    if (rec === undefined || rec.error !== undefined || t.source === "" || t.recorderSkip === true) continue
    if (KNOWN_DIVERGENCES.codesys.has(t.name)) continue
    for (const m of runLsp(i, "codesys")) if (m.startsWith("[error]")) falsePositives.push(`${t.name}: ${m}`)
  }
  expect(falsePositives).toEqual([])
}, 60_000)
