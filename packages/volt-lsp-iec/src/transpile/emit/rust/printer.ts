/**
 * THE PRINTER — the lines and source map being written, the file their spans index, the body being printed (its frame),
 * the loops it is inside; and the helpers a call's arguments and a dereference's checks are printed through.
 */
import type { IrBinding, IrCopy, IrPou, IrRoutine, Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { peelArray, stringKind, type Type } from "../../../frontend/types/index.js"
import { expr } from "./expr.js"
import { at, Prec, printed, type Printed } from "./precedence.js"
import { type GlobalsUse, tmp } from "./names.js"
import { place } from "./place.js"
import type { Layouts } from "./values.js"
import { storeImage } from "./image.js"
import type { DeadParams } from "./locals.js"
import type { RuntimeId } from "./runtime/index.js"
import { byValue, rustType } from "./types.js"

/** One POU's printer: the state every print function reads and writes. */
export class Printer {
  readonly lines: string[] = []
  readonly sourceMap: { line: number; span: Span; uri?: string }[] = []
  /** The file whose spans `push` is currently recording — set around each routine (`printRoutine`). */
  sourceUri: string | undefined = undefined
  /** A harness's loop guard ({@link EmitOptions}) — undefined prints none. */
  loopGuard: number | undefined = undefined

  /** The enclosing IR loops, innermost last — each one's number names its `'loop_N` and `'body_N` labels, `labeled` when its body
   *  sits in a labeled block (a CONTINUE before a step or a tail test) and EXIT and CONTINUE name them (whether a
   *  label is printed at all is asked of the IR before the loop prints: `ir/walk.loopUses`). */
  readonly loops: { n: number; labeled: boolean }[] = []
  loopCount = 0

  /** The body being printed: its VAR_IN_OUT parameters and its routine's locals (Rust names and slots), and the name of
   *  the result local a `return` hands back. */
  frame: Frame = { inoutNames: [], inoutSlots: [], localNames: [], localSlots: [] }

  /** The pointer the statement being printed checked on its own line (`guardLine`), as printed — a read through it in the
   *  statement's value prints unchecked (`guarded`, lean 9.3); undefined when there is none or the value holds a call. */
  checked: string | undefined = undefined

  /** Each frame's scoped temps already bound by a `let` (`letTemp`), by the frame's field names — one write site each. */
  readonly letTemps = new WeakMap<readonly string[], Set<number>>()

  /** What each generated body reaches of `g` / `prg` / `__mem` (`reachOf`, 7.7.5) — by routine key, `layout:<NAME>`. */
  reach: ReadonlyMap<string, GlobalsUse> = new Map()

  /** Each routine's parameters no run can see — by key (`deadParamsOf`, 7.7.7, 7.7.9): no parameter, and no argument at
   *  any call. */
  dead: ReadonlyMap<string, DeadParams> = new Map()

  /** The runtime helpers the printed code calls (`use`) — the module prints their closure and nothing else (lean 1). */
  readonly uses = new Set<RuntimeId>()

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

/** Record that the printed code calls the runtime helper `id`, and answer its name — `${use(p, "iec_div")}(a, b)`. */
export function use(p: Printer, id: RuntimeId): string {
  p.uses.add(id)
  return id
}

/** Whether `t` holds a STRING or WSTRING, itself or as an array's element — a type printed through the string runtime. */
export const holdsString = (t: Type): boolean => stringKind(peelArray(t)?.element ?? t) !== undefined

/** `rustType(t)`, recording the string runtime when `t` holds a string — for every place a type is spelled out. */
export function typeOf(p: Printer, t: Type): string {
  if (holdsString(t)) use(p, "string")
  return rustType(t)
}

/** Print `run` inside an FB's `call` or a routine: `fields` are `self`'s, the frame holds its parameters and locals. */
export function inFrame<T>(p: Printer, fields: readonly string[], frame: Frame, run: () => T): T {
  const saved = [p.fields, p.frame] as const
  ;[p.fields, p.frame] = [fields, frame]
  const out = run()
  ;[p.fields, p.frame] = saved
  return out
}

/** An instance lent to a call (design §24): `&mut place` — and `THIS^`, already `&mut self`, reborrowed as `&mut *self`
 *  (`&mut self` is a `&mut &mut`, E0596; review of the interface-input batch, 2026-09-15). */
export function lendMut(p: Printer, target: Place, slots: IrPou["slots"]): string {
  return target.root === "this" && target.path.length === 0 ? "&mut *self" : `&mut ${place(p, target, slots)}`
}

/**
 * A VAR_IN_OUT argument: `&mut place` — a VAR_IN_OUT CONSTANT's `&place`, or `&__copy_i`, the copy `lentCopies` took. A
 * scalar CONSTANT's is the value itself (`byValue`, 7.6.5), and a literal lent to a CONSTANT is `&` that literal: a
 * temporary lives to the end of its statement, and a literal is no place a `&mut` beside it could borrow (7.6.5).
 */
export function lend(p: Printer, b: IrBinding, i: number, param: IrPou["slots"][number], slots: IrPou["slots"]): string {
  if ("kind" in b) {
    if (inline(b)) return `${byValue(param) ? "" : "&"}${expr(p, b.value, slots, byValue(param) ? Prec.Block : Prec.Unary)}`
    // a copy of a place stays a `let` taken before the call — a `&mut` of the same place may sit beside it (E0503) — and
    // a scalar CONSTANT takes that copy by value
    return written(b) ? `&mut ${tmp("copy", i)}` : `${byValue(param) ? "" : "&"}${tmp("copy", i)}`
  }
  if (byValue(param)) return place(p, b, slots)
  return `${param.readOnly === true ? "&" : "&mut "}${place(p, b, slots)}`
}

/** A copy lent with no `let` of its own (`lend`): a literal — no place a `&mut` beside it could borrow — never one written. */
const inline = (b: IrCopy): boolean => !written(b) && b.value.kind === "const"

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
  return bindings.flatMap((b, i) => ("kind" in b && !inline(b) ? [`let ${written(b) ? "mut " : ""}${tmp("copy", i)} = ${expr(p, b.value, slots, Prec.Block)};`] : [])).join(" ")
}

/** A copy the callee may write — one written back, or an unconnected output's, discarded — is lent `&mut`; else `&`. */
const written = (b: IrCopy): boolean => b.back !== undefined || b.discarded === true

/** A read through a dereference, checked first: `{ iec_deref(self.p); self.value }` — the null pointer panics. */
export function guarded(p: Printer, target: Place, value: Printed, slots: IrPou["slots"]): Printed {
  if (target.guard === undefined) return value
  const pointer = place(p, target.guard, slots)
  // ONE GUARD PER STATEMENT: the statement's own line checked this pointer already (`Printer.checked`)
  if (pointer === p.checked) return value
  // the guarded value is the BLOCK's tail — it stands alone there, so a `*v` needs no parentheses of its own
  return printed(`{ ${use(p, "iec_deref")}(${pointer}); ${at(value, Prec.Block)} }`, Prec.Postfix)
}

/** A write through a dereference is checked on the line before it. */
export function guardLine(p: Printer, target: Place, slots: IrPou["slots"], indent: number): void {
  if (target.guard !== undefined) push(p, `${use(p, "iec_deref")}(${place(p, target.guard, slots)});`, indent)
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
  /** Locals declared where they are first stored, `let x: T = v;` (lean 7.7.2), each with whether it is `mut` — taken
   *  out of the map as its `let` is printed. */
  declareAt?: Map<number, boolean>
}

/**
 * The write of a SCOPED TEMP (`IrSlot.scoped`, lean 7.6.1) as the `let` that binds it — `let __chain_value_3: bool` — or
 * undefined for any other place. Lowering writes such a temp at one site, before every read and in the block they stand
 * in, so the binding is where it is written; a second write site is a lowering bug, named — a `let` there would shadow
 * the first for the reads after it only.
 */
export function letTemp(p: Printer, target: Place, slots: IrPou["slots"]): string | undefined {
  // a routine's local first stored here is declared here too (`Frame.declareAt`)
  const declared = target.root === "local" && target.path.length === 0 ? p.frame.declareAt?.get(target.slot) : undefined
  if (declared !== undefined) {
    p.frame.declareAt!.delete(target.slot)
    return `let ${declared ? "mut " : ""}${p.frame.localNames[target.slot]}: ${typeOf(p, target.type)}`
  }
  if (target.root !== undefined || target.path.length > 0 || slots[target.slot]?.scoped !== true) return undefined
  const bound = p.letTemps.get(p.fields) ?? new Set<number>()
  p.letTemps.set(p.fields, bound)
  if (bound.has(target.slot)) throw new Error(`emit: the scoped temp ${p.fields[target.slot]} is written at a second site`)
  bound.add(target.slot)
  return `let ${p.fields[target.slot]}: ${typeOf(p, target.type)}`
}

/** What the body `key` reaches (`Printer.reach`): a key with no entry is a printer bug, named — never the program's all. */
export function reachOfBody(p: Printer, key: string): GlobalsUse {
  const use = p.reach.get(key)
  if (use === undefined) throw new Error(`emit: no reach for the body ${key}`)
  return use
}
