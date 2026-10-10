/**
 * CALLS AS RUST — a routine invoked, a call through an interface (`dispatch`), a read through a multi-target pointer
 * (`select`), and an FB call statement; their arguments built once (`callArguments`).
 */
import type { IrBinding, IrExpr, IrPou, IrStmt, Place } from "../../ir/index.js"
import { holdsCall } from "../../ir/walk.js"
import { rustFaultLiteral } from "../../ir/faults.js"
import { expr } from "./expr.js"
import { Prec, printed, type Printed } from "./precedence.js"
import { globalsArgs, tmp } from "./names.js"
import { movedOut, place } from "./place.js"
import { copiesBack, guarded, guardLine, lend, lendMut, lentCopies, type Printer, push, typeOf } from "./printer.js"
import { isCopy } from "./types.js"

export function exprInvoke(p: Printer, e: Extract<IrExpr, { kind: "invoke" }>, slots: IrPou["slots"]): Printed {
  // the inputs by value, then the VAR_IN_OUT as `&mut` — a METHOD or ACTION on its instance, a FUNCTION free
  const routine = p.routines.get(e.routine)!
  // An input holding a call makes its evaluation order visible: every input is then taken into a `let`, in the order
  // written (`callshape_argument_order`) — which also keeps a call on the same instance out of the argument list's
  // borrow. Inputs without one stay inline, where no order can show — except on a PROGRAM's METHOD, whose inline
  // arguments would run after the program is moved out and read its `::new()` stand-in (review of batch 3a).
  const onProgram = e.instance !== undefined && e.instance.root === "global" && p.globals.slots[e.instance.slot]?.section === "program"
  const hoisted = onProgram || e.inputs.some(holdsCall)
  const inputLets = hoisted
    ? [...(e.order ?? e.inputs.keys())].map((k) => (typeof k === "number" ? `let ${tmp("arg", k)} = ${expr(p, e.inputs[k]!, slots, Prec.Block)};` : `${place(p, k.temp, slots)} = ${expr(p, k.value, slots, Prec.Block)};`)).join(" ")
    : ""
  const inputs = e.inputs.map((a, k) => (hoisted ? tmp("arg", k) : expr(p, a, slots, Prec.Block)))
  // the inputs, the in-outs, then each instance lent to the routine (design §24)
  const args = callArguments(p, inputs, e.inouts, routine.inouts, e.lent ?? [], slots)
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
          ? printed(`{ let mut ${tmp("program")} = std::mem::take(&mut ${moved.program}); let ${tmp("result")} = ${tmp("program")}${moved.member}.${fn}(${args}); ${moved.program} = ${tmp("program")}; ${tmp("result")} }`, Prec.Postfix)
          : printed(`{ let mut ${tmp("program")} = std::mem::take(&mut ${moved.program}); ${tmp("program")}${moved.member}.${fn}(${args}); ${moved.program} = ${tmp("program")}; }`, Prec.Postfix)
        : guarded(p, e.instance, printed(`${place(p, e.instance, slots)}.${fn}(${args})`, Prec.Postfix), slots)
  // a VAR_IN_OUT bound through a dereference is checked before the call, as the interpreter checks it when binding
  const checked = e.inouts.reduce((text, b) => ("kind" in b ? text : guarded(p, b, text, slots)), call)
  const lets = [inputLets, lentCopies(p, e.inouts, slots)].filter((l) => l !== "").join(" ")
  const back = copiesBack(p, e.inouts, slots)
  if (back !== "") return printed(yields ? `{ ${lets} let ${tmp("back")} = ${checked.text}; ${back} ${tmp("back")} }` : `{ ${lets} ${checked.text}; ${back} }`, Prec.Postfix)
  return lets === "" ? checked : printed(`{ ${lets} ${checked.text} }`, Prec.Postfix)
}

/** A generated call's arguments: `g`/`prg`, the inputs, each VAR_IN_OUT lent (`lend`), then each instance lent to the
 *  callee (design §24) — for a routine's invoke and an FB call alike. */
function callArguments(p: Printer, inputs: readonly string[], inouts: readonly IrBinding[], params: IrPou["slots"], lent: readonly Place[], slots: IrPou["slots"]): string {
  return [...globalsArgs(p), ...inputs, ...inouts.map((b, i) => lend(p, b, i, params[i]!, slots)), ...lent.map((l) => lendMut(p, l, slots))].join(", ")
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
    return isCopy(at.type) ? field : `${field}.clone()`
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
  const bound = callArguments(p, [], s.inouts, params, s.lent ?? [], slots)
  const instance = place(p, s.instance, slots)
  const lets = lentCopies(p, s.inouts, slots)
  const back = copiesBack(p, s.inouts, slots)
  // the binding this call makes, which the FB's METHODs called from outside dispatch on (`lower/calls/last-binding.ts`)
  if (s.bind !== undefined)
    push(p, `${place(p, s.bind.place, slots)} = ${expr(p, { kind: "const", value: s.bind.tag, type: s.bind.place.type, span: s.span }, slots, Prec.Block)};`, indent, s.span)
  // A PROGRAM's instance lives in `Programs`, which the call is handed too — `prg.p.call(g, prg)` would borrow it
  // twice (E0499) — so it runs moved out and back. Lowering refuses a program whose run reaches its own instance.
  if (s.instance.root === "global" && p.globals.slots[s.instance.slot]?.section === "program") {
    // an instance inside the program too (`callshape_program_instance_from_outside`): called on the moved-out value
    const moved = movedOut(p, s.instance, slots)
    push(p, `{ ${lets}${lets === "" ? "" : " "}let mut program = std::mem::take(&mut ${moved.program}); program${moved.member}.call(${bound}); ${moved.program} = program;${back === "" ? "" : ` ${back}`} }`, indent, s.span)
    return
  }
  push(p, lets === "" && back === "" ? `${instance}.call(${bound});` : `{ ${lets} ${instance}.call(${bound}); ${back} }`, indent, s.span)
  return
}
