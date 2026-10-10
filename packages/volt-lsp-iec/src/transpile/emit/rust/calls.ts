/**
 * CALLS AS RUST — a routine invoked, a call through an interface (`dispatch`), a read through a multi-target pointer
 * (`select`), and an FB call statement; their arguments built once (`callArguments`).
 */
import type { IrBinding, IrExpr, IrPou, IrStmt, Place } from "../../ir/index.js"
import { holdsCall } from "../../ir/walk.js"
import { cannotFault, rustFaultLiteral } from "../../ir/faults.js"
import { expr } from "./expr.js"
import { Prec, printed, type Printed } from "./precedence.js"
import { globalsArgs, tmp } from "./names.js"
import { borrowOf, movedOut, place } from "./place.js"
import { copiesBack, guarded, guardLine, lend, lendMut, lentCopies, letTemp, type Printer, push, reachOfBody, typeOf } from "./printer.js"
import { isCopy } from "./types.js"

export function exprInvoke(p: Printer, e: Extract<IrExpr, { kind: "invoke" }>, slots: IrPou["slots"]): Printed {
  // the inputs by value, then the VAR_IN_OUT as `&mut` — a METHOD or ACTION on its instance, a FUNCTION free
  const routine = p.routines.get(e.routine)!
  // An input holding a call makes its evaluation order visible: every input is then taken into a `let`, in the order
  // written (`callshape_argument_order`) — which also keeps a call on the same instance out of the argument list's
  // borrow. Inputs without one stay inline, where no order can show — except on a PROGRAM's METHOD, whose inline
  // arguments would run after the program is moved out and read its `::new()` stand-in (review of batch 3a).
  const onProgram = e.instance !== undefined && movesOut(p, e.instance, e.routine, e.inouts, e.lent ?? [])
  const hoisted = hoistedInputs(p, e, onProgram)
  const inputLets = [...(e.order ?? e.inputs.keys())]
    .flatMap((k) =>
      typeof k === "number"
        ? hoisted.has(k) ? [`let ${tmp("arg", k)} = ${expr(p, e.inputs[k]!, slots, Prec.Block)};`] : []
        : [`${letTemp(p, k.temp, slots) ?? place(p, k.temp, slots)} = ${expr(p, k.value, slots, Prec.Block)};`],
    )
    .join(" ")
  // an input no run can see is handed nothing (7.7.7, `deadInputsOf`): it is a constant, so its evaluation shows nowhere
  const dead = p.dead.get(e.routine)
  const inputs = e.inputs.flatMap((a, k) => (dead?.inputs.has(k) === true ? [] : [hoisted.has(k) ? tmp("arg", k) : expr(p, a, slots, Prec.Block)]))
  // the inputs, the in-outs, then each instance lent to the routine (design §24)
  const args = callArguments(p, routine.key, inputs, e.inouts, routine.inouts, e.lent ?? [], slots)
  const fn = p.fnNames.get(routine.key)!
  // a METHOD of a PROGRAM's one instance runs moved out of `Programs`, as the program's call does (`prg` is handed in)
  const moved = onProgram ? movedOut(p, e.instance!, slots) : undefined
  // A ROUTINE WITH NO RESULT YIELDS `()`, and binding that is `clippy::let_unit_value`. The binding exists to
  // hold the value across the copy-back / the move-back, which a `()` needs no help with: the call runs as a
  // statement and the block's own value is the unit it would have carried.
  const yields = routine.result !== undefined
  const call: Printed =
    e.instance === undefined
      ? printed(`${fn}(${args})`, Prec.Postfix)
      : moved !== undefined
        ? yields
          ? printed(`{ let mut ${tmp("program")} = ${moved.take}; let ${tmp("result")} = ${tmp("program")}${moved.member}.${fn}(${args}); ${moved.program} = ${tmp("program")}; ${tmp("result")} }`, Prec.Postfix)
          : printed(`{ let mut ${tmp("program")} = ${moved.take}; ${tmp("program")}${moved.member}.${fn}(${args}); ${moved.program} = ${tmp("program")}; }`, Prec.Postfix)
        : guarded(p, e.instance, printed(`${receiverOf(place(p, e.instance, slots))}.${fn}(${args})`, Prec.Postfix), slots)
  // a VAR_IN_OUT bound through a dereference is checked before the call, as the interpreter checks it when binding
  const checked = e.inouts.reduce((text, b) => ("kind" in b ? text : guarded(p, b, text, slots)), call)
  const lets = [inputLets, lentCopies(p, e.inouts, slots)].filter((l) => l !== "").join(" ")
  const back = copiesBack(p, e.inouts, slots)
  if (back !== "") return printed(yields ? `{ ${lets} let ${tmp("back")} = ${checked.text}; ${back} ${tmp("back")} }` : `{ ${lets} ${checked.text}; ${back} }`, Prec.Postfix)
  return lets === "" ? checked : printed(`{ ${lets} ${checked.text} }`, Prec.Postfix)
}

/** A place as a method's receiver: a lent or in-out instance is its borrow, which Rust auto-derefs (7.8.6). */
const receiverOf = (text: string): string => borrowOf(text) ?? text

/**
 * WHICH INPUTS ARE TAKEN INTO A `let __arg_k` BEFORE THE CALL (lean 7.6.6) — only those whose evaluation order a call
 * could make visible. Rust evaluates the hoisted `let`s in the order WRITTEN (`IrInvoke.order`), then the arguments
 * inline, in the order DECLARED. So:
 *   - in written order, every input up to the LAST one that holds a call is hoisted (a call there may change what an
 *     input before it reads; one after it runs after every call either way, so it stays inline);
 *   - a constant never is — it reads nothing, so where it runs cannot show;
 *   - that last call-holding input stays inline too, on a FUNCTION with no `g`/`prg`/`__mem` argument before it (which it
 *     could not borrow beside), when every input left inline after it in written order is also after it in the argument
 *     list — `len(concat(…))`, `insert(delete(str1, l, p), str2, …)`;
 *   - on a PROGRAM's METHOD every input but a constant is hoisted: an inline one would run after the program is moved
 *     out, and read its `::new()` stand-in (review of batch 3a).
 * A frozen in-out index (`IrFreeze`) is always taken where it is written.
 */
function hoistedInputs(p: Printer, e: Extract<IrExpr, { kind: "invoke" }>, onProgram: boolean): Set<number> {
  const order = [...(e.order ?? e.inputs.keys())]
  const written = order.filter((k): k is number => typeof k === "number")
  const constant = (k: number): boolean => e.inputs[k]!.kind === "const"
  if (onProgram) return new Set(written.filter((k) => !constant(k)))
  const last = written.reduce((at, k, i) => (holdsCall(e.inputs[k]!) ? i : at), -1)
  const hoisted = new Set(written.slice(0, last + 1).filter((k) => !constant(k)))
  const call = written[last]
  const inlineAfter = written.slice(last + 1).filter((k) => !constant(k))
  if (call !== undefined && e.instance === undefined && globalsArgs(reachOfBody(p, e.routine)).length === 0 && inlineAfter.every((k) => k > call)) hoisted.delete(call)
  // a freeze runs where it is written — a Standard function's string input taken there (`string-inputs.ts`) —, so an
  // input written before it runs before it too: every one before a freeze that holds a call (which could change what the
  // input reads), and every one that could fault before a freeze that could (whose fault would else come first)
  const lastFreeze = (test: (value: IrExpr) => boolean): number => order.reduce<number>((at, k, i) => (typeof k !== "number" && test(k.value) ? i : at), 0)
  const callFreeze = lastFreeze(holdsCall)
  const faultFreeze = lastFreeze((v) => !cannotFault(v))
  for (const [i, k] of order.entries())
    if (typeof k === "number" && !constant(k) && (i < callFreeze || (i < faultFreeze && !cannotFault(e.inputs[k]!)))) hoisted.add(k)
  return hoisted
}

/** A generated call's arguments: `g`/`prg`, the inputs, each VAR_IN_OUT lent (`lend`), then each instance lent to the
 *  callee (design §24) — for a routine's invoke and an FB call alike. */
function callArguments(p: Printer, callee: string, inputs: readonly string[], inouts: readonly IrBinding[], params: IrPou["slots"], lent: readonly Place[], slots: IrPou["slots"]): string {
  const dead = p.dead.get(callee)?.inouts
  const bound = inouts.flatMap((b, i) => (dead?.has(i) === true ? [] : [lend(p, b, i, params[i]!, slots)]))
  return [...globalsArgs(reachOfBody(p, callee)), ...inputs, ...bound, ...lent.map((l) => lendMut(p, l, slots))].join(", ")
}

/**
 * WHETHER A CALL ON A PROGRAM'S INSTANCE RUNS MOVED OUT OF `Programs` (lean 7.7.6): only where the call borrows `prg`
 * beside it — the callee reaches `Programs` (it is handed `prg`), or an in-out or a lent instance is a place of that same
 * program. Otherwise `prg.p.call(…)` borrows one field of `Programs` and the arguments disjoint ones, and the
 * move-out (a whole `P::new()` built as the stand-in, moved twice) buys nothing.
 */
function movesOut(p: Printer, instance: Place, callee: string, inouts: readonly IrBinding[], lent: readonly Place[]): boolean {
  if (instance.root !== "global" || p.globals.slots[instance.slot]?.section !== "program") return false
  const sameProgram = (at: Place): boolean => at.root === "global" && at.slot === instance.slot
  return reachOfBody(p, callee).usesPrograms || inouts.some((b) => !("kind" in b) && sameProgram(b)) || lent.some(sameProgram)
}

export function exprDispatch(p: Printer, e: Extract<IrExpr, { kind: "dispatch" }>, slots: IrPou["slots"]): Printed {
  // a call through an interface: its value picks the instance; none — a null interface — panics (design §22).
  //
  // `panic!` IS `!`, which coerces to any type, so the arm needs no help — EXCEPT when there is no other arm.
  // An interface nothing is ever stored into makes every arm `!`, so the match itself is `!`, which no cast
  // takes (E0605) and rustc calls unreachable (found in a review, 2026-09-15). A closure of the call's own
  // type fixes that, and it was applied to EVERY dispatch, which is 19 `clippy::redundant_closure_call`.
  const arms = e.arms.map((a) => `${a.tag} => ${expr(p, a.call, slots, Prec.Block)},`).join(" ")
  const typed = e.type.kind === "unknown" ? "()" : typeOf(p, e.type)
  const nothing = `panic!(${rustFaultLiteral(e.fault)})`
  const none = e.arms.length === 0 ? `(|| -> ${typed} { ${nothing} })()` : nothing
  return printed(`match ${expr(p, e.tag, slots, Prec.Block)} { ${arms} _ => ${none} }`, Prec.Block)
}

export function exprSelect(p: Printer, e: Extract<IrExpr, { kind: "select" }>, slots: IrPou["slots"]): Printed {
  // a read through a pointer that may name several variables (form 3): the tag picks the place. `panic!` for a
  // tag no arm names, which is the null dereference `iec_deref` raises for the single-target form — and the
  // same closure trick when there is no arm at all, for the reason the `dispatch` note above gives.
  const read = (at: Place): string => {
    const field = place(p, at, slots)
    return isCopy(at.type, p.layouts) ? field : `${field}.clone()`
  }
  const nothing = `panic!(${rustFaultLiteral("null-dereference")})`
  // NO ARM AT ALL IS JUST THE PANIC. A select with no arms is how lowering spells "this tag can only be 0",
  // and wrapping it in `match tag { _ => … }` is a match on nothing — `clippy::match_single_binding`, plus
  // the closure `dispatch` needs only because a `!` match cannot be CAST. Here it is assigned, and `!`
  // coerces to any type on the way in, so the bare `panic!` is both correct and what a reader expects.
  if (e.arms.length === 0) return printed(nothing, Prec.Postfix)
  const arms = e.arms.map((a) => `${a.tag} => ${read(a.place)},`).join(" ")
  return printed(`match ${expr(p, e.tag, slots, Prec.Block)} { ${arms} _ => ${nothing} }`, Prec.Block)
}

export function stmtCall(p: Printer, s: Extract<IrStmt, { kind: "call" }>, slots: IrPou["slots"], indent: number): void {
  // the inputs were assigned before this line and the outputs are read after it; VAR_IN_OUT is a `&mut` (design §9)
  guardLine(p, s.instance, slots, indent)
  // a VAR_IN_OUT bound through a dereference is checked too — the interpreter checks it when it binds the argument
  for (const b of s.inouts) if (!("kind" in b)) guardLine(p, b, slots, indent)
  const params = p.layouts.get(s.fb.toUpperCase())?.layout.inouts ?? []
  const bound = callArguments(p, `layout:${s.fb.toUpperCase()}`, [], s.inouts, params, s.lent ?? [], slots)
  const instance = receiverOf(place(p, s.instance, slots))
  const lets = lentCopies(p, s.inouts, slots)
  const back = copiesBack(p, s.inouts, slots)
  // the binding this call makes, which the FB's METHODs called from outside dispatch on (`lower/calls/last-binding.ts`)
  if (s.bind !== undefined)
    push(p, `${place(p, s.bind.place, slots)} = ${expr(p, { kind: "const", value: s.bind.tag, type: s.bind.place.type, span: s.span }, slots, Prec.Block)};`, indent, s.span)
  // A PROGRAM's instance lives in `Programs`; where the call is handed `prg` too — `prg.p.call(g, prg)` would borrow it
  // twice (E0499) — it runs moved out and back (`movesOut`). Lowering refuses a program whose run reaches its own instance.
  if (movesOut(p, s.instance, `layout:${s.fb.toUpperCase()}`, s.inouts, s.lent ?? [])) {
    // an instance inside the program too (`callshape_program_instance_from_outside`): called on the moved-out value
    const moved = movedOut(p, s.instance, slots)
    const program = tmp("program")
    push(p, `{ ${lets}${lets === "" ? "" : " "}let mut ${program} = ${moved.take}; ${program}${moved.member}.call(${bound}); ${moved.program} = ${program};${back === "" ? "" : ` ${back}`} }`, indent, s.span)
    return
  }
  push(p, lets === "" && back === "" ? `${instance}.call(${bound});` : `{ ${lets} ${instance}.call(${bound}); ${back} }`, indent, s.span)
  return
}
