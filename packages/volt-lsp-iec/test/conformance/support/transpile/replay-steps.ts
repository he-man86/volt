/**
 * THE TRANSPILE REPLAY'S SHARED STEPS — a fixture's run source, its enums numbered, the interpreter and the emitted Rust
 * compared against its recording. Shared by the three `transpile-replay*.test.ts` suites.
 */
import { expect } from "bun:test"
import { parseSource, type Expr, type TopLevel } from "../../../../src/frontend/syntax/index.js"
import { build, scopeForUnit } from "../../../../src/frontend/symbols/index.js"
import { CLOCK, emitRust, run, type IrPou, type IrValue } from "../../../../src/transpile/index.js"
import { rustAccess } from "../rust-access.js"
import { ALL_TESTS } from "../../fixtures/index.js"
import { withDependencies } from "../fixture-units.js"
import { plcPrgSource } from "../plc-prg.js"
import { PROJECT_LIBRARY } from "../project-libraries.js"
import { RUNS, type RunRecorded } from "../recordings.js"
import { asDisplayed, ideValue } from "../display.js"
import { EDGE_ARG, edgePlan, edgeVerdict, HARNESS_LOOP_GUARD } from "./edge.js"
import { replayFault } from "./fault.js"
import type { EdgeVerdict } from "../../fixtures/map-row.js"
import { constEval, isBoolValued } from "../../../../src/frontend/types/index.js"
import type { LanguageTest } from "../../types.js"
import { lowering, reproducible, uncompared } from "../fixture-suite.js"

/** What a harness binary is run with — the recorded scan, and the edge run. A re-proved cache hit runs both builds on
 *  each (`support/rustc-cache.ts`). */
export const HARNESS_PROBES = [[], [EDGE_ARG]]

/** The source a case lowers from, unassembled — used only to read the enum declarations out of. */
export function runSource(c: LanguageTest): string {
  const sources = withDependencies(c, ALL_TESTS)
    .map((f) => f.source)
    .filter((s) => s !== "")
  return [...sources, plcPrgSource(c)].join("\n")
}

/** Each `Type.Value` a case's enums declare, as the number it is: the written `:= n`, else one more than the value
 *  before it, from 0 — how CODESYS numbers them (conformance `type_dut_enum_*`). A referenced library's enum displays
 *  the same way (`enum_library_bare`: `GEN_MODE.SAWTOOTH_RISE`), so the fixture project's libraries' are numbered too,
 *  and a fixture's own enum of a library enum's name is the one it means. */
export function enumsOf(c: LanguageTest): Map<string, bigint> {
  const out = new Map<string, bigint>(libraryEnums())
  // a member written as an expression — another enum's member, a global CONSTANT (`eninit_other_enum_member`,
  // `eninit_gvl_constant`) — is the value it folds to in the fixture's own project; it was numbered as the member before
  // it plus one, a guess the run recording contradicted
  const source = runSource(c)
  const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "file:///run.st", parseResult, source }], [], "codesys")
  const fold = (unit: TopLevel, e: Expr): bigint | undefined => {
    const v = constEval(e, scopeForUnit(project, unit) ?? project)
    return typeof v === "bigint" ? v : undefined
  }
  numberEnums(out, parseResult.units, fold)
  return out
}

let libraryEnumsCache: ReadonlyMap<string, bigint> | undefined

export const libraryEnums = (): ReadonlyMap<string, bigint> => {
  if (libraryEnumsCache === undefined) {
    const out = new Map<string, bigint>()
    numberEnums(out, PROJECT_LIBRARY.flatMap((f) => f.parseResult?.units ?? []))
    libraryEnumsCache = out
  }
  return libraryEnumsCache
}

export function numberEnums(out: Map<string, bigint>, units: readonly TopLevel[], fold?: (unit: TopLevel, e: Expr) => bigint | undefined): void {
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
export function clockAt(c: LanguageTest, rec: RunRecorded, i: number): bigint | undefined {
  if (c.clock === undefined) return undefined
  const raw = rec.values?.[`${c.clock}[${i}]`]
  if (raw === undefined) throw new Error(`${c.name}: no recorded ${c.clock}[${i}] to run scan ${i} on`)
  return (ideValue(raw) as bigint) * 1_000_000n // a TIME counts milliseconds
}

/** The recorded values as the IR holds them, and the interpreter's answers reduced to the same display. */
export function compareInterp(c: LanguageTest, rec: RunRecorded): void {
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
  // a BOOL held as its byte shows as the BOOL it is declared (`rustAccess`'s `rawBool`): 0 FALSE, 1 TRUE
  const shown = (k: string, v: IrValue): IrValue => (rustAccess(lowered.pou!, k).rawBool === true ? v !== 0n : v)
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, asDisplayed(rec.values![k]!, shown(k, pou.get(k) as IrValue))]))
  expect(got).toEqual(want)
  // a wall-clock or residue path is not compared, and it is still one the run must PRODUCE
  for (const path of uncompared(c)) expect(typeof pou.get(path)).toBe("bigint")
  // a path the IDE's monitor could not show is one the model explains, or the row fails: a BOOL held as its byte shows
  // only as 0 or 1 — any other byte is "Failed to convert input bytes to monitoring variables" (`bool_byte_ops`, 8.2)
  const unexplained = Object.keys(rec.unreadable ?? {}).filter((k) => {
    const v = pou.get(k)
    return !(rustAccess(lowered.pou!, k).rawBool === true && typeof v === "bigint" && v > 1n)
  })
  expect(unexplained).toEqual([])
}

/** Every fixture by name — the lint ratchet looked one up per case, which is 1,900 x 2,600 string compares a run. */
export const BY_NAME = new Map<string, LanguageTest>(ALL_TESTS.map((t) => [t.name, t]))

/**
 * Where a compiled case's lints disagree with its stored row, in EITHER direction — a new one is the emitted Rust
 * getting worse, a missing one is a row excusing a lint the emitter no longer produces.
 */
export const lintDrift = (found: Map<string, string[]>): string[] =>
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
export interface Measured {
  lints: string[]
  pedantic: number
  edge: EdgeVerdict
  edgeUnanswered?: number
}

/**
 * THE PEDANTIC COUNT AND THE EDGE VERDICT, stored against computed — the same symmetric check `lintDrift` makes, for
 * the two columns that come out of the same build. An edge verdict that moved is either an emitter change (regenerate)
 * or a backend that started to disagree with the other (the `disagree` rows in the map's header say where).
 */
export const measuredDrift = (found: Map<string, Measured>): string[] =>
  [...found].flatMap(([name, got]) => {
    const stored = BY_NAME.get(name)?.transpile
    const out: string[] = []
    if (stored?.pedantic !== got.pedantic) out.push(`${name}: pedantic stored ${stored?.pedantic}, computed ${got.pedantic}`)
    if (stored?.edge !== got.edge) out.push(`${name}: edge stored ${stored?.edge}, computed ${got.edge}`)
    if (stored?.edgeUnanswered !== got.edgeUnanswered)
      out.push(`${name}: edge variants unanswered stored ${stored?.edgeUnanswered}, computed ${got.edgeUnanswered}`)
    return out
  })

/**
 * The edge column for one built fixture — run only when it built and there is something to seed; a fixture whose
 * Rust did not build, or that has no elementary variable, is `not-run` exactly as the generator writes it.
 */
export async function edgeOf(
  built: boolean,
  exe: string,
  pou: IrPou,
  plan: ReturnType<typeof edgePlan>,
): Promise<Pick<Measured, "edge" | "edgeUnanswered">> {
  if (!built || "notRun" in plan) return { edge: "not-run" }
  const { verdict, unanswered } = await edgeVerdict(exe, pou, plan)
  return unanswered === undefined ? { edge: verdict } : { edge: verdict, edgeUnanswered: unanswered }
}

/** A built case's run: its exit, and what it printed. `exit: -1` is a case that did not build (or lower). */
export interface RustRun {
  exit: number
  stdout: string
  stderr: string
}

/** The body of `main` that runs a case's RECORDED scan and prints every recorded path, tab-separated — what
 *  `compareRust` reads back. */
export function recordedScan(c: LanguageTest, pou: IrPou, emitted: ReturnType<typeof emitRust>): string {
  const prints = Object.keys(RUNS[c.name]!.values!).map((name) => {
    const { read, type } = rustAccess(pou, name)
    // A REAL prints with Debug, which keeps its decimal point. A STRING prints its BYTES as a list — not Debug, whose
    // `\u{c}` for a form feed is no JSON — so no control character inside it can break this tab-separated output.
    const family = type.kind === "elementary" ? type.elem.family : undefined
    // an FB's VAR_STAT read through an instance lives in the application's globals, an image-held variable in `mem`
    const field = `${read}${family === "string" ? ".units()" : ""}`
    return `    println!("${name}\\t{${family === "real" || family === "string" ? ":?" : ""}}", ${field});`
  })
  // a program that reaches globals or calls PROGRAMs scans against one of each, created once like the IDE's application
  const setup = [
    ...(emitted.usesGlobals ? ["    let mut g = Globals::new();"] : []),
    ...(emitted.usesPrograms ? ["    let mut prg = Programs::new();"] : []),
    ...(emitted.usesImage ? ["    let mut mem = Mem::new();"] : []),
  ]
  const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : []), ...(emitted.usesImage ? ["&mut mem"] : [])].join(", ")
  // a POU with an init step (a `call_after_global_init_slot` method) runs it once, before the first scan
  const init = pou.init === undefined ? [] : [`    p.init(${args});`]
  // a CLOCKED fixture scans on the instants the recording saw: `CLOCK` assigned before each scan
  const clock = c.clock === undefined ? undefined : rustAccess(pou, CLOCK)
  const scans =
    clock === undefined
      ? [`    for _ in 0..${c.cycles ?? 1} { p.scan(${args}); }`]
      : Array.from({ length: c.cycles ?? 1 }, (_, i) => `    ${clock.write(String(clockAt(c, RUNS[c.name]!, i + 1)!))} p.scan(${args});`)
  const scan = [...setup, ...init, ...scans].join("\n")
  return `    let mut p = ${pou.name}::new();\n${scan}\n${prints.join("\n")}\n`
}

/** A built case's printed values against the recording — the Rust half of a value comparison. Throws on a mismatch. */
export function compareRust(c: LanguageTest, result: RustRun): void {
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
  for (const path of uncompared(c)) expect(printed.has(path)).toBe(true)
  const got = Object.fromEntries(
    Object.keys(want).map((k) => {
      const { type, rawBool } = rustAccess(pou, k)
      const raw = printed.get(k)!
      if (isBoolValued(type)) return [k, raw === "true"]
      // a BOOL held as its byte shows as the BOOL it is declared: 0 FALSE, 1 TRUE
      if (rawBool === true) return [k, raw !== "0"]
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
        return [k, asDisplayed(rec.values![k]!, type.elem.bits === 32 ? Math.fround(n) : n)]
      }
      return [k, asDisplayed(rec.values![k]!, BigInt(raw))]
    }),
  )
  expect(got).toEqual(want)
}

/** The vendor stopped; so must we — by refusing to lower (with a reason) or by throwing in the scan. */
export function compareFault(c: LanguageTest): void {
  const lowered = lowering(c)
  if (lowered.pou === undefined) {
    // Refused before it could run — a stricter refusal, still a refusal. It must SAY why: a lowering that
    // produced neither a POU nor a diagnostic would be this test passing on an empty result.
    expect(lowered.diagnostics.length).toBeGreaterThan(0)
    return
  }
  // under the harness guard: the recording cannot tell a stop from a runaway, so the replay bounds every loop and a
  // run past the guard fails by name (`support/transpile/fault.ts`)
  replayFault(lowered.pou, c.cycles ?? 1, HARNESS_LOOP_GUARD)
}
