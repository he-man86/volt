/**
 * IR → Rust. A syntax-directed printer, and nothing more.
 *
 * Every semantic question was answered in lowering: types are resolved, conversions are explicit nodes, CASE
 * labels are constant ranges, all three loop forms are one shape. **If this emitter ever has to decide
 * something, the lowering is incomplete and that is the bug** — the rule that keeps the backend reviewable
 * and keeps a second target (C, LLVM) cheap.
 *
 * Two things are not cosmetic:
 *
 * **Safe Rust, three forms of memory** (design §9). A POU, struct or FB is one owned `struct`, its body
 * `fn scan(&mut self)`; GVL variables are a `Globals` struct handed in as `g`, called PROGRAMs a `Programs` as `prg`. A
 * VAR_IN_OUT, which never outlives its call, is a `&mut` parameter; a POINTER or REFERENCE is a `usize` naming its one
 * target (0 is null), checked at every dereference. Lowering refuses whatever would need two `&mut` at once.
 *
 * **Deterministic numerics.** IEC integers wrap at their declared width, so arithmetic emits `wrapping_*`
 * rather than Rust's overflow-panicking defaults. The width comes from `types/elementary`, the same facts the
 * diagnostics use — there is no second table of type sizes here.
 *
 * This file assembles one POU's module: the structs, the routines, the runtime helpers the code calls, the string
 * prelude and the source-map shift.
 */
import type { IrLayout, IrPou } from "../../ir/index.js"
import { rustFaultLiteral } from "../../ir/faults.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { fieldNames, globalsParams, routineFnNames, rustName } from "./names.js"
import { STRING_PRELUDE } from "./prelude.js"
import { code, Printer, push } from "./printer.js"
import { printCall, printRoutine } from "./routine.js"
import { block } from "./stmt.js"
import { printStruct } from "./structs.js"

/** Emitted Rust, plus the line→ST mapping a panic or a failed assertion is reported through. */
export interface Emitted {
  code: string
  /** 1-based emitted line → the ST span it came from. */
  /** Each emitted line that maps back to ST: the Rust line (1-based), the span, and the FILE the span indexes.
   *  `uri` is undefined for the POU's own body, which is the main source — a routine lowered from a GVL or a library
   *  declaration names its own file, because a span alone cannot say which source it belongs to. */
  sourceMap: readonly { line: number; span: Span; uri?: string }[]
  /** The program reaches GVL variables: `scan` takes `g: &mut Globals` (`Globals::new()` builds it). */
  usesGlobals: boolean
  /** The program calls PROGRAMs: `scan` takes `prg: &mut Programs` (`Programs::new()`), after `g`. */
  usesPrograms: boolean
}

/** How a HARNESS emits a POU — the default emission, what a user gets, sets none of this. */
export interface EmitOptions {
  /** Panic when one loop enters its body more than this many times — the interpreter's `run(pou, { loopGuard })`,
   *  counted the same way. CODESYS caps no loop (`tr_27_loop_cap_*`), so only a harness bounds a runaway one. */
  readonly loopGuard?: number
}

/** Emit one lowered POU as a Rust struct with a `scan` method. */
export function emitRust(pou: IrPou, options: EmitOptions = {}): Emitted {
  const { p, layouts, fields, storage } = printerFor(pou, options)
  push(p, `// generated from ${pou.name} — do not edit`, 0)
  for (const [struct, slots, names] of [
    ["Globals", storage.variables, storage.variableNames],
    ["Programs", storage.programs, storage.programNames],
  ] as const) {
    if (slots.length === 0) continue
    printStruct(p, struct, slots, names, undefined, () => {})
  }
  // One plain struct per DUT and FB the frame holds, each with a `new` at its declared initial values. No `Default`
  // derive — Rust derives it only for arrays up to 32 elements — so every value starts through `new`.
  // ponytail: the layouts ride with each POU, like the string prelude; hoist them when whole projects are emitted.
  for (const { layout, fields: names } of layouts.values()) printLayout(p, pou, layout, names)
  printPou(p, pou, fields)
  // a FUNCTION has no instance: a free fn beside the structs
  for (const routine of pou.routines.filter((r) => r.kind === "function")) printRoutine(p, routine, [], [], 0)
  appendRuntime(p)
  return withPrelude(p)
}

/** The application's global storage, as two structs so a call borrows two things: the GVL variables (`Globals`, handed
 *  to every body as `g`) and each called PROGRAM's one instance (`Programs`, the POU's own `scan` only) — design §9. */
function storageOf(pou: IrPou): { variables: IrPou["slots"]; programs: IrPou["slots"]; variableNames: string[]; programNames: string[] } {
  const variables = pou.globals.filter((s) => s.section !== "program")
  const programs = pou.globals.filter((s) => s.section === "program")
  return { variables, programs, variableNames: fieldNames(variables), programNames: fieldNames(programs) }
}

/** The printer for one POU: its layouts' and slots' Rust field names, the globals' accesses, every routine's fn name. */
function printerFor(pou: IrPou, options: EmitOptions) {
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), { layout: l, fields: fieldNames(l.fields) }]))
  const fields = fieldNames(pou.slots)
  const storage = storageOf(pou)
  const { variables, programs, variableNames, programNames } = storage
  const access = pou.globals.map((s) =>
    s.section === "program" ? `prg.${programNames[programs.indexOf(s)]}` : `g.${variableNames[variables.indexOf(s)]}`,
  )
  const p = new Printer(fields, layouts, new Map(pou.routines.map((r) => [r.key, r])), routineFnNames(pou.routines), { access, slots: pou.globals }, variables.length > 0, programs.length > 0)
  p.loopGuard = options.loopGuard
  return { p, layouts, fields, storage }
}

/** A DUT's or FB's struct: an FB's body as its `call`, and its METHODs and ACTIONs. */
function printLayout(p: Printer, pou: IrPou, layout: IrLayout, names: readonly string[]): void {
  printStruct(p, rustName(layout.name), layout.fields, names, undefined, () => {
    if (layout.body !== undefined) printCall(p, layout, names)
    for (const routine of pou.routines.filter((r) => r.fb?.toUpperCase() === layout.name.toUpperCase())) printRoutine(p, routine, names, layout.fields, 1)
  })
}

/** The POU's own struct: `new`, the `init` its `call_after_global_init_slot` methods need, and `scan`. */
function printPou(p: Printer, pou: IrPou, fields: readonly string[]): void {
  const globals = globalsParams(p).map((param) => `, ${param}`).join("")
  printStruct(p, rustName(pou.name), pou.slots, fields, pou.span, () => {
    push(p, "", 0)
    // once, before the first scan: each instance's `call_after_global_init_slot` method (IrPou.init) — only a POU that has one
    if (pou.init !== undefined) {
      push(p, "#[allow(unused_variables)]", 1)
      push(p, `pub fn init(&mut self${globals}) {`, 1)
      block(p, pou.init, pou.slots, 2)
      push(p, "}", 1)
      push(p, "", 0)
    }
    // a global only `init` reads — an FB_Init argument — leaves `g` unused in the scan (found in a review, 2026-09-15)
    if (p.usesGlobals || p.usesPrograms) push(p, "#[allow(unused_variables)]", 1)
    push(p, `pub fn scan(&mut self${globals}) {`, 1)
    block(p, pou.body, pou.slots, 2)
    push(p, "}", 1)
  })
}

/** The runtime helpers the printed code calls, each appended only when the code calls it. */
function appendRuntime(p: Printer): void {
  // the one check every dereference makes: a null pointer stops the program, as it stops the CODESYS application
  if (code(p).includes("iec_deref(")) {
    push(p, "", 0)
    push(p, `fn iec_deref(at: usize) { if at == 0 { panic!(${rustFaultLiteral("null-dereference")}); } }`, 0)
  }
  // The two halves of the measured REAL -> INTEGER table. See `coerce` in `semantics/convert.ts`.
  if (code(p).includes("iec_r2i64(")) {
    push(p, "", 0)
    push(p, "fn iec_r2i64(v: f64) -> i64 {", 0)
    push(p, "let c = if v < 0.0 { -((-v).round()) } else { v.round() };", 1)
    push(p, "if c.is_nan() || !(-9223372036854775808.0..18446744073709551616.0).contains(&c) { return i64::MIN; }", 1)
    push(p, "if c >= 9223372036854775808.0 { return (c as u64) as i64; }", 1)
    push(p, "c as i64", 1)
    push(p, "}", 0)
  }
  if (code(p).includes("iec_r2i32(")) {
    push(p, "", 0)
    push(p, "fn iec_r2i32(v: f64) -> i32 {", 0)
    push(p, "let c = if v < 0.0 { -((-v).round()) } else { v.round() };", 1)
    push(p, "if c.is_nan() { return 0; }", 1)
    push(p, "if c < -2147483648.0 { return i32::MIN; }", 1)
    push(p, "if c >= 9223372036854775808.0 { return 0; }", 1)
    push(p, "(c as i64) as i32", 1)
    push(p, "}", 0)
  }
  // MAX / MIN over a REAL: CODESYS's compare-select, the SECOND argument on a tie or a NaN (`semantics/builtins.ts` `select`)
  if (code(p).includes("iec_fmax(")) {
    push(p, "", 0)
    push(p, "fn iec_fmax<T: PartialOrd>(a: T, b: T) -> T { if a > b { a } else { b } }", 0)
  }
  if (code(p).includes("iec_fmin(")) {
    push(p, "", 0)
    push(p, "fn iec_fmin<T: PartialOrd>(a: T, b: T) -> T { if a < b { a } else { b } }", 0)
  }
  if (code(p).includes("iec_log(")) {
    push(p, "", 0)
    push(p, `fn iec_log(x: f64) -> f64 { if x == 0.0 { panic!(${rustFaultLiteral("logarithm-of-zero")}); } x }`, 0)
  }
  if (code(p).includes("iec_pow(")) {
    push(p, "", 0)
    push(p,
      `fn iec_pow(x: f64, y: f64) -> f64 { if x == 0.0 && y < 0.0 && y.is_finite() { panic!(${rustFaultLiteral("zero-to-negative-power")}); } x.powf(y) }`,
      0,
    )
  }
  // The emitted twin of `arith`'s zero-divisor check. Gated on its OWN use, not on `iec_deref`'s — a program can
  // divide by zero without ever dereferencing a pointer, and attaching it to the wrong condition left the helper
  // undefined in every program that does.
  if (code(p).includes("iec_div(")) {
    push(p, "", 0)
    push(p,
      `fn iec_div<T: Copy + PartialEq + Default + std::ops::Div<Output = T>>(a: T, b: T) -> T { if b == T::default() { panic!(${rustFaultLiteral("division-by-zero")}); } a / b }`,
      0,
    )
  }
}

/** The finished emission — the string prelude in front of a program that holds a string, the source map shifted past it. */
function withPrelude(p: Printer): Emitted {
  const { usesGlobals, usesPrograms } = p
  // Only a program that holds a string gets the string type — every other output stays exactly what it was.
  // ponytail: the prelude rides with each POU, so a crate of TWO string POUs would define it twice; hoist it into a
  // shared module when the emitter emits whole projects rather than one POU at a time.
  if (!code(p).includes("IecStr") && !code(p).includes("IecWString")) return { code: code(p), sourceMap: p.sourceMap, usesGlobals, usesPrograms }
  const offset = STRING_PRELUDE.split("\n").length - 1
  return {
    code: STRING_PRELUDE + code(p),
    sourceMap: p.sourceMap.map((m) => ({ ...m, line: m.line + offset })),
    usesGlobals,
    usesPrograms,
  }
}
