/**
 * THE RATING ROWS — each fixture under the row its EVIDENCE RATING names: confirmed (the interpreter AND the emitted
 * Rust produce the vendor's values), refused, not-lowered, diverges, lsp-gap, create-refused-by-name, unaskable. The
 * contract, the selection and the rating index are `support/fixture-suite.ts`'s (transpile-restructure 1.8.7).
 *
 * A RED ROW IS THE PRODUCT BEING WRONG, never the recording. Fix `lower/`, `interp/`, `emit/` or the check — never the
 * expectation. COST: this is the expensive file — every lowering case is compiled by `rustc` as its own binary, one
 * process per core.
 */

import { beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseSource, type Expr, type TopLevel } from "../../src/frontend/syntax/index.js"
import { build, scopeForUnit } from "../../src/frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../src/analysis/index.js"
import { CLOCK, emitRust, lowerCodeKind, run, type IrPou, type IrValue } from "../../src/transpile/index.js"
import { rustAccess } from "./support/rust-access.js"
import { CREATE_REFUSAL_BY_NAME_NOT_MODELLED } from "./support/divergences.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { PROJECT_LIBRARY } from "./support/project-libraries.js"
import { RUNS, type RunRecorded } from "./support/recordings.js"
import { asDisplayed, ideValue } from "./support/display.js"
import { CLIPPY, RUSTC as rustc, skipLintCheck, skipRustSuite } from "./support/rustc.js"
import { buildRust } from "./support/rustc-cache.js"
import { rejectionIsADefect } from "./support/transpile/correctness.js"
import { EDGE_ARG, edgeHarness, edgePlan, edgeVerdict, HARNESS_LOOP_GUARD } from "./support/transpile/edge.js"
import { buildArgv, rendered, splitFindings } from "./support/transpile/lint-policy.js"
import type { EdgeVerdict } from "./fixtures/map-row.js"
import { constEval, isBoolValued } from "../../src/frontend/types/index.js"
import { comparable } from "./support/compare-message.js"
import { lspErrors } from "./support/evidence.js"
import { expectStillDiverges } from "./support/expected-failure.js"
import type { LanguageTest } from "./types.js"
import { BUILDS, lowering, rated, reproducible, SELECTION, whole } from "./support/fixture-suite.js"

/** What a harness binary is run with — the recorded scan, and the edge run. A re-proved cache hit runs both builds on
 *  each (`support/rustc-cache.ts`). */
const HARNESS_PROBES = [[], [EDGE_ARG]]

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
  // a member written as an expression — another enum's member, a global CONSTANT (`eninit_other_enum_member`,
  // `eninit_gvl_constant`) — is the value it folds to in the fixture's own project; it was numbered as the member before
  // it plus one, a guess the run recording contradicted
  const source = runSource(c)
  const parseResult = parseSource(source, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "file:///run.st", parseResult, source }])
  const fold = (unit: TopLevel, e: Expr): bigint | undefined => {
    const v = constEval(e, scopeForUnit(project, unit) ?? project)
    return typeof v === "bigint" ? v : undefined
  }
  numberEnums(out, parseResult.units, fold)
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

function numberEnums(out: Map<string, bigint>, units: readonly TopLevel[], fold?: (unit: TopLevel, e: Expr) => bigint | undefined): void {
  let unit: TopLevel | undefined
  const number = (prefix: string, values: readonly { name: { text: string }; value?: Expr }[]) => {
    let next = 0n
    for (const v of values) {
      // `Cold := -1` is a unary minus over a literal — reading literals only numbered it as the value before it plus one
      const negated = v.value?.kind === "unary" && v.value.op === "-" ? v.value.operand : undefined
      const literal = negated ?? v.value
      const magnitude = literal?.kind === "literal" && typeof literal.value === "bigint" ? literal.value : undefined
      const written = magnitude !== undefined ? (negated === undefined ? magnitude : -magnitude) : v.value !== undefined && fold !== undefined && unit !== undefined ? fold(unit, v.value) : undefined
      const value = written ?? next
      out.set(`${prefix}.${v.name.text}`.toUpperCase(), value)
      next = value + 1n
    }
  }
  for (const u of units) {
    unit = u
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
    // …and one as a STRUCT's component, under the DUT's name (`enumdup_struct_inline_enum`:
    // `Implicit_Enum__DUT_LANG_enumdup_struct_inline_enum__e.A`)
    if (unit.kind === "type_decl" && unit.body.kind === "struct")
      for (const decl of unit.body.fields) {
        let type = decl.type
        while (type.kind === "array_type") type = type.element
        if (type.kind === "implicit_enum_type") for (const n of decl.names) number(`Implicit_Enum__${unit.name.text}__${n.text}`, type.values)
      }
  }
}

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
      if (isBoolValued(type)) return [k, raw === "true"]
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
      // DENY warnings, with the exceptions `support/transpile/lint-policy.ts` names and REASONS. This used to be
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
    // `__POUNAME()` into an INT (frontend-conformance 4.3.4): CODESYS names a STRING sized by the asking body's qualified
    // name, which an ACTION's body does not carry (`CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY`); TwinCAT has no `__POUNAME`
    // and agrees, so it cannot be written on the fixture as a deferral (agreeing would end it there)
    "ar_pouname_type",
    // the `???` target over a CALL. The fixture and the corpus disagree because the compiler never reads network
    // text at all — see `network/network-analysis.ts`.
    "network_unnamed_target_of_void_call",
    "network_unnamed_target_of_valued_call",
    // (`op_sys_queryinterface` left 2026-10-06, analysis-conformance 3.8: the interface named as an operand must be
    // instantiated, `fb-instantiation` says so now; its two other errors stay GAPs — niche, task 3.8.4.)
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
    // (`callarg_no_argument_variable_default` left 2026-10-06, analysis-conformance 3.8: a VARIABLE default is no default
    // on CODESYS, `call-arguments` 4b.)
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

/**
 * THE IDE REFUSES TO CREATE IT BY NAME, AND THE LSP DOES NOT SAY SO (`CREATE_REFUSAL_BY_NAME_NOT_MODELLED`). A fixture
 * the vendor refuses carries no build, so the agreement replay skips it; without this, a refused name the LSP misreads
 * was rated `unaskable` or `confirmed` (by the OTHER vendor) and nothing showed it (review 5+6).
 */
describe("create refused by name — a vendor refusal the LSP does not make", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    for (const [name, sentence] of Object.entries(CREATE_REFUSAL_BY_NAME_NOT_MODELLED[vendor])) {
      if (!SELECTION.has(name)) continue
      test(`${name} — ${vendor}: the LSP does not say ${JSON.stringify(sentence)}`, () => {
        const c = ALL_TESTS.find((t) => t.name === name)
        expect(c).toBeDefined()
        // only a fixture the vendor refuses belongs here — any other has a build, and the replay judges it
        expect(c!.vendorRefuses?.[vendor]).toBeDefined()
        const check = () => expect(lspErrors(c!, ALL_TESTS, vendor)).toContainEqual(expect.stringContaining(sentence))
        expectStillDiverges(name, "CREATE_REFUSAL_BY_NAME_NOT_MODELLED", [check], `${vendor}'s create refusal`)
      })
    }
  }
  whole("every entry names a fixture", () => {
    const names = new Set(ALL_TESTS.map((t) => t.name))
    const listed = [...Object.keys(CREATE_REFUSAL_BY_NAME_NOT_MODELLED.codesys), ...Object.keys(CREATE_REFUSAL_BY_NAME_NOT_MODELLED.twincat)]
    expect(listed.filter((n) => !names.has(n))).toEqual([])
  })
})

/**
 * THE LINE, where a recording carries one — openspec bridge-refusal-review 5.2 (review 5+6). The agreement replay
 * compares `[severity] message` and never a line, so it cannot back a claim of line parity. CODESYS records every line
 * as 0. TwinCAT records an ST body's line as its declaration's lines plus the body's own line — the file's line minus
 * one, since the push takes the IMPLEMENTATION line off. A NETWORK body's lines are the vendor's own numbering, no text
 * line (`rcc_network_undeclared_wire_shape`: 6 and 7 for the one statement on file line 8), so none is compared there.
 *
 * Pinned for this change's ST row. Three of its four lines agree; the fourth, "';' expected instead of end of POU", the
 * build puts on the body's last line and the LSP on END_FUNCTION_BLOCK, one line lower — held as an expected failure
 * here, and the same for every "end of POU" (146 recorded, never compared: a line-parity gate for the whole replay is
 * the follow-up this belongs to, not this change).
 */
describe("lines — TwinCAT's, for this change's ST row", () => {
  const name = "rcc_st_body_network"
  const lines = (): { lsp: string[]; ide: string[] } => {
    const t = ALL_TESTS.find((x) => x.name === name)!
    const pr = parseSource(t.source, { networkText: true }, "twincat")
    const project = build.buildSymbolTable([{ uri: `file:///w/${t.pouName}.pou`, parseResult: pr, source: t.source }], [], "twincat")
    const at = (ds: readonly { severity: string; message: string; line: number }[]) =>
      ds.filter((d) => d.severity === "error" || d.severity === "warning").map((d) => `[${d.severity}] ${comparable(d.message)} @${d.line}`)
    const lsp = computeDiagnostics({ uri: `file:///w/${t.pouName}.pou`, parseResult: pr, source: t.source, project, config: resolveConfig({ vendor: "twincat" }) })
    // the file's 1-based line, less the IMPLEMENTATION line the push takes off
    return {
      lsp: at(lsp.map((d) => ({ severity: d.severity, message: d.message, line: d.span.startLine - 1 }))),
      ide: at(BUILDS.twincat.tests[name]!.diagnostics),
    }
  }
  const endOfPou = (m: string) => m.includes("end of POU")
  const run = SELECTION.has(name) && BUILDS.twincat.recorded !== null
  test.if(run)(`${name} — every message but "end of POU" on the build's line`, () => {
    const { lsp, ide } = lines()
    expect(lsp.filter((m) => !endOfPou(m)).sort()).toEqual(ide.filter((m) => !endOfPou(m)).sort())
  })
  test.if(run)(`${name} — "end of POU" is one line below the build's, still`, () => {
    const { lsp, ide } = lines()
    expectStillDiverges(name, "end of POU on END_FUNCTION_BLOCK, the build's on the body's last line", [
      () => expect(lsp.filter(endOfPou)).toEqual(ide.filter(endOfPou)),
    ], "TwinCAT's lines")
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
