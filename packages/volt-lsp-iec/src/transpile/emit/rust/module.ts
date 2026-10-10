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
import type { Span } from "../../../frontend/syntax/index.js"
import { fieldNames, globalsParams, routineFnNames, rustName } from "./names.js"
import { code, Printer, push } from "./printer.js"
import { printCall, printRoutine } from "./routine.js"
import { INLINE, runtimeText, usedIn } from "./runtime/index.js"
import { block } from "./stmt.js"
import { printStruct } from "./structs.js"
import { memNew } from "./image.js"

/** Emitted Rust, plus the line→ST mapping a panic or a failed assertion is reported through. */
export interface Emitted {
  code: string
  /** Each emitted line that maps back to ST: the Rust line (1-based), the span, and the FILE the span indexes.
   *  `uri` is undefined for the POU's own body, which is the main source — a routine lowered from a GVL or a library
   *  declaration names its own file, because a span alone cannot say which source it belongs to. */
  sourceMap: readonly { line: number; span: Span; uri?: string }[]
  /** The program reaches GVL variables: `scan` takes `g: &mut Globals` (`Globals::new()` builds it). */
  usesGlobals: boolean
  /** The program calls PROGRAMs: `scan` takes `prg: &mut Programs` (`Programs::new()`), after `g`. */
  usesPrograms: boolean
  /** The program has a byte image: `scan` takes `__mem: &mut Mem` (`Mem::new()`), after `prg` (`image.ts`). */
  usesImage: boolean
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
    printStruct(p, struct, ...held(slots, names), undefined, () => {})
  }
  // One plain struct per DUT and FB the frame holds, each with a `new` at its declared initial values. No `Default`
  // derive — Rust derives it only for arrays up to 32 elements — so every value starts through `new`.
  // ponytail: the layouts ride with each POU, like the string prelude; hoist them when whole projects are emitted.
  for (const { layout, fields: names } of layouts.values()) printLayout(p, pou, layout, names)
  printPou(p, pou, fields)
  // a FUNCTION has no instance: a free fn beside the structs
  for (const routine of pou.routines.filter((r) => r.kind === "function")) printRoutine(p, routine, [], [], 0)
  // the program's own image, which the runtime's `Mem` starts from (`image.ts`)
  if (pou.image !== undefined) for (const line of ["", ...memNew(pou.image)]) push(p, line, 0)
  appendRuntime(p)
  return withPrelude(p)
}

/** The slots a Rust struct holds, with their names: every one but those the byte image holds (`IrSlot.image`), which are
 *  reached through `Mem` alone — a copy in the struct as well would be a second value of one variable. */
function held<S extends { image?: number }>(slots: readonly S[], names: readonly string[]): [S[], string[]] {
  const kept = slots.flatMap((s, i) => (s.image === undefined ? [i] : []))
  return [kept.map((i) => slots[i]!), kept.map((i) => names[i]!)]
}

/** The application's global storage, as two structs so a call borrows two things: the GVL variables (`Globals`, handed
 *  to every body as `g`) and each called PROGRAM's one instance (`Programs`, the POU's own `scan` only) — design §9. */
function storageOf(pou: IrPou): { variables: IrPou["slots"]; programs: IrPou["slots"]; variableNames: string[]; programNames: string[] } {
  const variables = pou.globals.filter((s) => s.section !== "program")
  const programs = pou.globals.filter((s) => s.section === "program")
  // Two lists declaring one name are two globals (6.A.17, `tr_a17_two_lists_one_name_both_qualified`): each such slot is
  // named by its LIST (`IrSlot.list`), so the two fields are apart whatever order they are reached in, and every other
  // collision still refuses (`fieldNames`' contract-name rule)
  const named = variables.map((s) => (s.list === undefined ? s : { ...s, name: `${s.list}_${s.name}` }))
  return { variables, programs, variableNames: fieldNames(named), programNames: fieldNames(programs) }
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
  const p = new Printer(fields, layouts, new Map(pou.routines.map((r) => [r.key, r])), routineFnNames(pou.routines), { access, slots: pou.globals }, variables.length > 0, programs.length > 0, pou.image !== undefined)
  p.loopGuard = options.loopGuard
  return { p, layouts, fields, storage }
}

/** A DUT's or FB's struct: an FB's body as its `call`, and its METHODs and ACTIONs. */
function printLayout(p: Printer, pou: IrPou, layout: IrLayout, names: readonly string[]): void {
  // a STRUCT's offsets say where its fields sit when it is in the image; its Rust struct holds them all the same
  const [fields, fieldNames] = layout.kind === "function_block" ? held(layout.fields, names) : [layout.fields, names]
  printStruct(p, rustName(layout.name), fields, fieldNames, undefined, () => {
    if (layout.body !== undefined) printCall(p, layout, names)
    for (const routine of pou.routines.filter((r) => r.fb?.toUpperCase() === layout.name.toUpperCase())) printRoutine(p, routine, names, layout.fields, 1)
  })
}

/** The POU's own struct: `new`, the `init` its `call_after_global_init_slot` methods need, and `scan`. */
function printPou(p: Printer, pou: IrPou, fields: readonly string[]): void {
  const globals = globalsParams(p).map((param) => `, ${param}`).join("")
  printStruct(p, rustName(pou.name), ...held(pou.slots, fields), pou.span, () => {
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
    if (p.usesGlobals || p.usesPrograms || p.usesImage) push(p, "#[allow(unused_variables)]", 1)
    push(p, `pub fn scan(&mut self${globals}) {`, 1)
    block(p, pou.body, pou.slots, 2)
    push(p, "}", 1)
  })
}

/** The runtime helpers the printed code calls, each appended only when the code calls it (`runtime/index.ts`). */
function appendRuntime(p: Printer): void {
  for (const id of INLINE) {
    if (!usedIn(id, code(p))) continue
    push(p, "", 0)
    for (const line of runtimeText(id).slice(0, -1).split("\n")) push(p, line, 0)
  }
}

/** The finished emission — the string prelude in front of a program that holds a string, the source map shifted past it. */
function withPrelude(p: Printer): Emitted {
  const { usesGlobals, usesPrograms, usesImage } = p
  // Only a program that holds a string gets the string type — every other output stays exactly what it was.
  // ponytail: the prelude rides with each POU, so a crate of TWO string POUs would define it twice; hoist it into a
  // shared module when the emitter emits whole projects rather than one POU at a time.
  if (!usedIn("string", code(p))) return { code: code(p), sourceMap: p.sourceMap, usesGlobals, usesPrograms, usesImage }
  const prelude = runtimeText("string")
  const offset = prelude.split("\n").length - 1
  return {
    code: prelude + code(p),
    sourceMap: p.sourceMap.map((m) => ({ ...m, line: m.line + offset })),
    usesGlobals,
    usesPrograms,
    usesImage,
  }
}
