/**
 * Differential execution — the transpiler vs CODESYS itself (transpile-st-to-rust design §7; unify-conformance-suite).
 *
 * Every conformance case that builds was RUN in CODESYS 3.5.21.40's simulator by `bun run record:exec`: the execution
 * cases (their program is PLC_PRG) and every other fixture (its units, then PLC_PRG). This replays that recording offline
 * through the interpreter and the emitted Rust. Every recorded variable must be EQUAL. A REAL compares as the 32-bit float
 * the IDE holds, so a backend that computes in float64 fails here — that is a real divergence, not rounding noise.
 *
 * A fixture the transpiler cannot LOWER yet is a todo naming the lowering code — counted, never a pass and never a skip —
 * and the number of cases that do lower is held by a floor that only rises. A case that lowers and disagrees is a failure.
 *
 * A red case is the product being wrong, not the recording: fix `lower/`, `interp/` or `emit/`, never the expectation.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodeStringLiteral, parseSource } from "../../src/syntax/index.js"
import {
  emitRust,
  isBit,
  lowerSource,
  run,
  rustAccess,
  type IrValue,
  type LoweredPou,
} from "../../src/transpile/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture, withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY as LIBRARIES } from "./support/standard-library.js"
import { RUSTC as rustc, skipRustSuite } from "./support/rustc.js"
import type { LanguageTest } from "./types.js"

interface Recorded {
  cycles?: string
  values?: Record<string, string>
  error?: string
  unreadable?: Record<string, string>
}

const recording = JSON.parse(readFileSync(join(import.meta.dir, "recordings", "codesys.run.json"), "utf8")) as {
  tests: Record<string, Recorded>
}
/** The BUILD recording — read ONLY to tell a loader disagreement from an ordinary vendor refusal. See below. */
const buildRecording = JSON.parse(readFileSync(join(import.meta.dir, "recordings", "codesys.build.json"), "utf8")) as {
  tests: Record<string, { buildSuccess?: boolean }>
}

/**
 * The cases with transpiler lowering held above this floor — execution cases and fixtures together. Raise it when more
 * cases lower; never lower it to make a change pass.
 */
const LOWERED_FLOOR = 582

/** The source a case lowers from: the fixture's own units (an execution case has none), then its PLC_PRG. */
function runSource(c: LanguageTest): string {
  // the project the recorder loaded: the fixtures this one depends on, itself, and PLC_PRG
  const sources = withDependencies(c, ALL_TESTS)
    .map((f) => f.source)
    .filter((s) => s !== "")
  return [...sources, plcPrgSource(c)].join("\n")
}

const loweredCache = new Map<string, LoweredPou>()
function lowering(c: LanguageTest): LoweredPou {
  let lowered = loweredCache.get(c.name)
  if (lowered === undefined) {
    // A GVL is an object of its own, named by its pouName — `GVL_Name.var` reaches it only under that name, which a file
    // gives it. Folded into the one source, every list was named `source`, and no qualified access could resolve.
    const { source: rest, gvls } = assembleFixture(c, ALL_TESTS)
    lowered = lowerSource(rest, "PLC_PRG", [...LIBRARIES, ...gvls])
    loweredCache.set(c.name, lowered)
  }
  return lowered
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

/** The cases the transpiler answers to: every execution case (an unrecorded one is reported), and every other fixture
 *  that has a run recording. */
const CASES = ALL_TESTS.filter((c) => c.source === "" || recording.tests[c.name] !== undefined)

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
  // written. An infinity is an ordinary value to this vendor — see `interp/values.ts`.
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
  if (typeof value !== "bigint") return value
  const floorTo = (v: bigint, step: bigint): bigint => v - (((v % step) + step) % step)
  if (raw.startsWith("TIME_OF_DAY#")) return ((value % 86_400_000n) + 86_400_000n) % 86_400_000n
  if (raw.startsWith("LTIME_OF_DAY#"))
    return ((value % 86_400_000_000_000n) + 86_400_000_000_000n) % 86_400_000_000_000n
  if (raw.startsWith("DATE#")) return floorTo(value, 86_400n)
  if (raw.startsWith("LDATE#")) return floorTo(value, 86_400_000_000_000n)
  return value
}

describe("differential execution — interp vs CODESYS 3.5.21.40", () => {
  let lowered = 0
  let vendorRefused = 0
  const blockers = new Map<string, number>()
  for (const c of CASES) {
    const rec = recording.tests[c.name]
    if (rec === undefined) {
      test.skip(`${c.name} (not recorded — bun run record:exec)`, () => {})
      continue
    }
    // A case that must NOT compile pins the transpiler's input contract (src/transpile/index.ts): the transpiler never sees
    // such code, so the only check is that CODESYS still refuses it. (The Rust half skips it: it recorded no values.)
    if (c.refused !== undefined) {
      test(`${c.name} (does not compile)`, () => expect(rec.error).toContain(c.refused!))
      continue
    }
    if (c.deferred?.transpile !== undefined) {
      test.todo(`${c.name} — deferred: ${c.deferred.transpile}`, () => {})
      continue
    }
    // A FIXTURE WRITTEN TO BUILD CAN FAULT WHEN IT RUNS — `use_pointer_deref_struct_field` writes through a pointer
    // its FB body never set, `cc_div_udint_dint` divides by a zero-initialised DINT — and the simulator STOPS THE
    // APPLICATION, which reaches the recorder as a timeout or a done flag that never rose.
    //
    // There is no value to compare, and that used to make this a counted `todo`: the case was named and then never
    // run. But "no value to compare" is not "nothing to check". CODESYS's answer here is REFUSAL, and refusal is a
    // behaviour the transpiler has to match — the failure this guards against is the interpreter quietly returning
    // a number for `p^` on a null pointer or for `a / 0`, which would be a silent divergence on exactly the inputs
    // where being wrong is worst. Six fixtures were sitting in that blind spot.
    //
    // EITHER refusal counts, and the two are not ranked. Four of the six throw at run time (division by zero, a
    // call through an interface holding no instance); two never lower at all (`pointer-order` — a dereference of a
    // pointer no address was stored into), which catches it a stage EARLIER than CODESYS does. Asserting the
    // disjunction keeps this green when a construct graduates from "cannot lower" to "lowers, then faults", which
    // is progress and not a regression; what it will never let through is a completed scan.
    if (c.source !== "" && rec.error !== undefined && !rec.error.startsWith("does not compile")) {
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
    // A fixture that does not COMPILE in the simulator is NOT that, and it is not a transpiler result either: the
    // BUILD recording says the bridge built this same source, so the two loaders disagree about what the fixture is.
    // It is a real failure and it stays one — but it used to arrive as `expect(rec.error).toBeUndefined()` twelve
    // lines below, which reports "expected undefined, received 'does not compile: …'" and names neither the cause
    // nor the fix. The known cause: `record:exec` writes declaration and implementation text STRAIGHT into a POU,
    // so a body that is not ST cannot survive the trip — network text reaches the compiler as the literal
    // `NETWORK 0 FBD` and is answered "';' expected instead of 'FBD'". Those fixtures carry `execSkip` and are
    // never sent; one arriving here is one that slipped past it.
    // ...AND ONLY WHEN THE BUILD RECORDING ACTUALLY SAYS SO. This read the paragraph above as its premise without
    // ever checking it: for a fixture with NO build recording — every newly written one — nobody had claimed the
    // bridge built anything, and a plain vendor refusal was reported as two loaders disagreeing. Sixteen boundary
    // fixtures arrived that way the day they were written, each carrying a perfectly good answer
    // ("Cannot convert type 'INT' to type 'SINT'"). A refusal is evidence; `refused.test.ts` owns whether the LSP
    // agrees with its wording.
    if (rec.error?.startsWith("does not compile") === true && buildRecording.tests[c.name]?.buildSuccess === true) {
      test(`${c.name} (the simulator refused what the bridge built)`, () => {
        throw new Error(
          `${c.name}: the BUILD recording says this source compiles, but \`record:exec\` could not load it:\n` +
            `  ${rec.error}\n` +
            `The exec recorder writes declaration and implementation text directly into a POU, so a body that is ` +
            `not ST (a network-text body, i.e. FBD/LD) cannot reach the compiler intact. Either give the fixture ` +
            `an \`execSkip\` saying why it has no execution ground truth to have, or teach the recorder to load ` +
            `this shape.`,
        )
      })
      continue
    }
    // CODESYS REFUSES TO COMPILE IT, and no build recording says otherwise — so this is the fixture's ANSWER, not a
    // disagreement and not a transpiler result. The transpiler's input contract is "code CODESYS compiles"
    // (`transpile/index.ts`), so it owes nothing for a source the vendor rejects; `refused.test.ts` owns whether the
    // LSP reports the same refusal, against the vendor's own wording. Counted rather than dropped, so a fixture
    // cannot go quiet here by becoming uncompilable.
    if (rec.error?.startsWith("does not compile") === true) {
      vendorRefused += 1
      continue
    }
    // A FIXTURE whose constructs do not lower yet is a counted todo naming its blocker. An execution case must lower.
    if (c.source !== "" && rec.error === undefined && lowering(c).pou === undefined) {
      const code = lowering(c).diagnostics[0]?.code ?? "unknown"
      blockers.set(code, (blockers.get(code) ?? 0) + 1)
      test.todo(`${c.name} — not lowered: ${code}`, () => {})
      continue
    }
    lowered += 1
    test(c.name, () => {
      expect(rec.error).toBeUndefined()
      expect(rec.unreadable).toBeUndefined()
      const cycles = c.cycles ?? 1
      expect(ideValue(rec.cycles!)).toBe(BigInt(cycles)) // the recorder's gate held

      // the same lowering the Rust half prints — one project shape for both backends (a GVL a file of its own)
      const lowered = lowering(c)
      if (lowered.pou === undefined) throw new Error(`cannot lower: ${lowered.diagnostics[0]?.message} [${lowered.diagnostics[0]?.code}]`)
      const pou = run(lowered.pou)
      for (let i = 0; i < cycles; i++) pou.scan()
      const want = Object.fromEntries(Object.entries(rec.values!).map(([k, v]) => [k, ideValue(v, enumsOf(c))]))
      const got = Object.fromEntries(
        Object.keys(want).map((k) => [k, asDisplayed(rec.values![k]!, pou.get(k) as IrValue)]),
      )
      expect(got).toEqual(want)
    })
  }

  test(`the cases that lower do not regress (>= ${LOWERED_FLOOR})`, () => {
    const summary = [...blockers].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code} ${n}`)
    // eslint-disable-next-line no-console
    console.log(
      `  [transpile] ${lowered} of ${CASES.length} cases lower; what blocks the rest: ${summary.join(" · ") || "nothing"}`,
    )
    // eslint-disable-next-line no-console
    console.log(`  [transpile] ${vendorRefused} more the VENDOR refuses to compile — not this gate's to answer, see \`refused.test.ts\``)
    expect(lowered).toBeGreaterThanOrEqual(LOWERED_FLOOR)
  })
})

// ─── the same recordings, through the EMITTED RUST ───────────────────────────────────────────────────────────
// The interpreter and the emitter print the same IR, so a lowering bug shows in both — but an EMITTER bug (a Rust
// operator that does not mean what the IEC one does) shows only here. Each case is its own binary, so one that
// does not compile or panics cannot take the others down; and a DEBUG build on purpose, where an arithmetic
// overflow panics — a panic is a divergence, not noise. Skipped where rustc is absent, like emit.test.ts.

describe.skipIf(skipRustSuite())("differential execution — emitted Rust vs CODESYS 3.5.21.40", () => {
  const recorded = CASES.filter(
    (c) =>
      recording.tests[c.name]?.values !== undefined &&
      c.deferred?.transpile === undefined &&
      (c.source === "" || lowering(c).pou !== undefined),
  )
  const runs = new Map<string, { exit: number; stdout: string; stderr: string }>()

  beforeAll(async () => {
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

    async function prepare(c: LanguageTest): Promise<void> {
      const { pou, diagnostics } = lowering(c)
      if (pou === undefined)
        return void runs.set(c.name, { exit: -1, stdout: "", stderr: `does not lower: ${diagnostics[0]?.message}` })
      const prints = Object.keys(recording.tests[c.name]!.values!).map((name) => {
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
      //   unused_comparisons — a FOR bound AT its type's maximum is a comparison rustc can prove
      //     (`for_at_type_max`: `i <= 127i8` for a SINT). The comparison is necessary and the loop needs it.
      const build = Bun.spawn(
        [rustc!, "--edition", "2021", "-D", "warnings", "-A", "dead_code", "-A", "unused_parens", "-A", "unused_comparisons", "-F", "unsafe_code", "-o", exe, file],
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
  }, 180_000)

  for (const c of recorded) {
    test(c.name, () => {
      const run = runs.get(c.name)!
      expect({ exit: run.exit, stderr: run.stderr }).toEqual({ exit: 0, stderr: "" })
      const rec = recording.tests[c.name]!
      const pou = lowering(c).pou!
      const printed = new Map(
        run.stdout
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
          if (type.kind === "elementary" && type.elem.family === "string")
            return [k, String.fromCharCode(...(JSON.parse(raw) as number[]))]
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
