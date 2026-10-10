/**
 * THE PRINTER — the lines and source map being written, the file their spans index, the body being printed (its frame),
 * the loops it is inside; and the helpers a call's arguments and a dereference's checks are printed through.
 */
import type { IrBinding, IrCopy, IrPou, IrRoutine, Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { Type } from "../../../frontend/types/index.js"
import { expr, unparen } from "./expr.js"
import { tmp } from "./names.js"
import { place } from "./place.js"
import type { Layouts } from "./values.js"
import { storeImage } from "./image.js"

/** One POU's printer: the state every print function reads and writes. */
export class Printer {
  readonly lines: string[] = []
  readonly sourceMap: { line: number; span: Span; uri?: string }[] = []
  /** The file whose spans `push` is currently recording — set around each routine (`printRoutine`). */
  sourceUri: string | undefined = undefined
  /** A harness's loop guard ({@link EmitOptions}) — undefined prints none. */
  loopGuard: number | undefined = undefined

  /** The enclosing IR loops, innermost last — each one's number names its `'loop_N` and `'body_N` labels (whether a
   *  label is printed at all is asked of the IR before the loop prints: `ir/walk.loopUses`). */
  readonly loops: { n: number }[] = []
  loopCount = 0

  /** The body being printed: its VAR_IN_OUT parameters and its routine's locals (Rust names and slots), and the name of
   *  the result local a `return` hands back. */
  frame: Frame = { inoutNames: [], inoutSlots: [], localNames: [], localSlots: [] }

  constructor(
    public fields: readonly string[],
    readonly layouts: Layouts,
    readonly routines: ReadonlyMap<string, IrRoutine>,
    /** Every routine's Rust fn name, deduped once — see `routineFnNames`. Read by the definition AND the calls. */
    readonly fnNames: ReadonlyMap<string, string>,
    /** Each global slot's Rust access (`g.g_shared`, `prg.prg_writer`), and the slots — `IrPou.globals`' order. */
    readonly globals: { access: readonly string[]; slots: IrPou["slots"] },
    /** The program reaches GVL variables — every generated call is handed `g`. */
    readonly usesGlobals: boolean,
    /** The program reaches PROGRAM instances — every generated call is handed `prg` too, as any body may call one. */
    readonly usesPrograms = false,
    /** The program has a byte image — every generated call is handed `__mem` too (`image.ts`). */
    readonly usesImage = false,
  ) {}
}

/** Print `run` inside an FB's `call` or a routine: `fields` are `self`'s, the frame holds its parameters and locals. */
export function inFrame(p: Printer, fields: readonly string[], frame: Frame, run: () => void): void {
  const saved = [p.fields, p.frame] as const
  ;[p.fields, p.frame] = [fields, frame]
  run()
  ;[p.fields, p.frame] = saved
}

/** An instance lent to a call (design §24): `&mut place` — and `THIS^`, already `&mut self`, reborrowed as `&mut *self`
 *  (`&mut self` is a `&mut &mut`, E0596; review of the interface-input batch, 2026-09-15). */
export function lendMut(p: Printer, target: Place, slots: IrPou["slots"]): string {
  return target.root === "this" && target.path.length === 0 ? "&mut *self" : `&mut ${place(p, target, slots)}`
}

/** A VAR_IN_OUT argument: `&mut place` — a VAR_IN_OUT CONSTANT's `&place`, or `&__copy_i`, the copy `lentCopies` took. */
export function lend(p: Printer, b: IrBinding, i: number, param: IrPou["slots"][number], slots: IrPou["slots"]): string {
  if ("kind" in b) return written(b) ? `&mut ${tmp("copy", i)}` : `&${tmp("copy", i)}`
  return `${param.readOnly === true ? "&" : "&mut "}${place(p, b, slots)}`
}

/** After the call, each copy marked `back` stored to its place: `self.points = __copy_0;` (an own field lent to an own METHOD). */
export function copiesBack(p: Printer, bindings: readonly IrBinding[], slots: IrPou["slots"]): string {
  return bindings
    .flatMap((b, i) => ("kind" in b && b.back !== undefined ? [b.back.root === "image" ? storeImage(p, b.back, tmp("copy", i), slots) : `${place(p, b.back, slots)} = ${tmp("copy", i)};`] : []))
    .join(" ")
}

/**
 * The copies a call lends its VAR_IN_OUT CONSTANTs, each into a `let` before the call — so a copy of `x` sits beside a
 * `&mut x` of the same call, which `f(&mut self.x, &{ self.x })` could not (E0503; review of the batch, 2026-09-15). No
 * argument holds a call (`call-nested`), so taking them first changes no order anything can observe.
 */
export function lentCopies(p: Printer, bindings: readonly IrBinding[], slots: IrPou["slots"]): string {
  return bindings.flatMap((b, i) => ("kind" in b ? [`let ${written(b) ? "mut " : ""}${tmp("copy", i)} = ${expr(p, b.value, slots)};`] : [])).join(" ")
}

/** A copy the callee may write — one written back, or an unconnected output's, discarded — is lent `&mut`; else `&`. */
const written = (b: IrCopy): boolean => b.back !== undefined || b.discarded === true

/** A read through a dereference, checked first: `{ iec_deref(self.p); self.value }` — the null pointer panics. */
export function guarded(p: Printer, target: Place, text: string, slots: IrPou["slots"]): string {
  // the guarded value is the BLOCK's tail — it stands alone there, so a `(*v)` needs no parentheses of its own
  return target.guard === undefined ? text : `{ iec_deref(${place(p, target.guard, slots)}); ${unparen(text)} }`
}

/** A write through a dereference is checked on the line before it. */
export function guardLine(p: Printer, target: Place, slots: IrPou["slots"], indent: number): void {
  if (target.guard !== undefined) push(p, `iec_deref(${place(p, target.guard, slots)});`, indent)
}

/** Print `run` with every span it pushes indexing `uri` (undefined: the main source), and restore the file after. */
export function withUri(p: Printer, uri: string | undefined, run: () => void): void {
  const outer = p.sourceUri
  p.sourceUri = uri
  run()
  p.sourceUri = outer
}

export function push(p: Printer, text: string, indent: number, span?: Span): void {
  p.lines.push(`${"    ".repeat(indent)}${text}`)
  if (span !== undefined) p.sourceMap.push({ line: p.lines.length, span, ...(p.sourceUri === undefined ? {} : { uri: p.sourceUri }) })
}

export function code(p: Printer): string {
  return `${p.lines.join("\n")}\n`
}

/** What a body is printed against: its VAR_IN_OUT parameters, its routine's locals, and its result local. */
export interface Frame {
  inoutNames: readonly string[]
  inoutSlots: IrPou["slots"]
  localNames: readonly string[]
  localSlots: IrPou["slots"]
  result?: string
  /** The FB a body runs on — what a `this` place (`THIS^`) walks from. */
  selfType?: Type
}
