/**
 * ROUTINES AS RUST — a METHOD or ACTION as an `fn` in its FB's `impl`, a FUNCTION as a free `fn`, an FB's body as its
 * `call()`; their parameters built once (`bodyParams`).
 */
import type { IrLayout, IrPou, IrRoutine } from "../../ir/index.js"
import type { Type } from "../../../frontend/types/index.js"
import { fieldNames, globalsArgs, globalsParams, tmp } from "./names.js"
import { type Frame, holdsString, inFrame, type Printer, push, typeOf, use, withUri } from "./printer.js"
import { fnBody } from "./stmt.js"
import { genericList, inoutType } from "./types.js"
import { initOf } from "./values.js"

/**
 * A METHOD or ACTION as an `fn` in its FB's `impl`, or a FUNCTION as a free `fn`: the inputs are parameters, the VAR_IN_OUT
 * `&mut` parameters, every other local a `let mut` at its initial value — so each call starts over, as measured — and the
 * result local is handed back.
 */
export function printRoutine(p: Printer, routine: IrRoutine, fields: readonly string[], fieldSlots: IrPou["slots"], indent: number): void {
  // Every span this routine emits indexes the routine's OWN file, which need not be the main source — a body lowered
  // from a GVL or a library declaration maps to an offset in that file, and a consumer slicing the main one reads the
  // wrong text (or past its end). Restored after, so the POU's own body is not tagged with the last routine's file.
  withUri(p, routine.uri, () => printRoutineIn(p, routine, fields, fieldSlots, indent))
}

/** `printRoutine`, with its file's spans already selected. */
function printRoutineIn(p: Printer, routine: IrRoutine, fields: readonly string[], fieldSlots: IrPou["slots"], indent: number): void {
  // `g` and `prg`, as far as the program has them, are every body's first parameters — no local may take those names
  // INTERNAL: a routine's locals and in-outs are `let` bindings inside a generated fn. Nothing outside reads them, and
  // they legitimately collide with the `g` / `prg` parameters, so these may be renumbered.
  const names = fieldNames([...routine.locals, ...routine.inouts], globalsArgs(p), true)
  const localNames = names.slice(0, routine.locals.length)
  const inoutNames = names.slice(routine.locals.length)
  const { params: tail, typed } = bodyParams(p, routine.inouts, inoutNames, routine.lent ?? [])
  const params = [
    ...(routine.kind === "function" ? [] : ["&mut self"]),
    ...globalsParams(p),
    ...routine.inputs.map((i) => `mut ${localNames[i]}: ${typeOf(p, routine.locals[i]!.type)}`),
    ...tail,
  ]
  const result = routine.result === undefined ? undefined : localNames[routine.result]!
  const returns = routine.result === undefined ? "" : ` -> ${typeOf(p, routine.locals[routine.result]!.type)}`
  push(p, "", 0)
  // THE ALLOW LIST IS THE GATE'S BLIND SPOT, so it is only as wide as it has to be. Every generated function
  // used to carry `unreachable_code` and `non_snake_case` as well, which made `-D warnings` deny almost
  // nothing — and `unreachable_code` is the class the emitter has ALREADY paid for once (see the note at the
  // `panic!` arm: it made the match `!`-typed). Measured by dropping each in turn against the crate check and
  // against CamelCase ST: both come off clean — `rustName` already snake-cases every identifier, and the
  // struct carries its own `non_camel_case_types`.
  //
  // The three that stay are structural, not stylistic. Generated code binds what a body might not read
  // (`unused_variables`), takes `mut` it might not need (`unused_mut`), and initialises a slot a body then
  // overwrites (`unused_assignments`) — each verified load-bearing by the same experiment.
  // `unreachable_code` is not among them: a statement after a RETURN (`xo4_return_in_every_routine`) is legal ST, but
  // nothing after a statement control never comes out of is printed (lean 7.5.11, `block`), so no routine needs it.
  push(p, "#[allow(unused_mut, unused_variables, unused_assignments)]", indent)
  push(p, `pub fn ${p.fnNames.get(routine.key)!}${genericList(typed)}(${params.join(", ")})${returns} {`, indent)
  for (const [i, slot] of routine.locals.entries())
    if (!routine.inputs.includes(i)) push(p, `let mut ${localNames[i]}: ${typeOf(p, slot.type)} = ${initOf(p.layouts, slot.type, slot.init)};`, indent + 1)
  const frame: Frame = {
    inoutNames,
    inoutSlots: routine.inouts,
    localNames,
    localSlots: routine.locals,
    ...(result === undefined ? {} : { result }),
    ...(routine.fb === undefined ? {} : { selfType: { kind: "function_block", name: routine.fb } }),
  }
  // a body that never comes out of its bottom (an IF both of whose branches RETURN) hands its result back there; the
  // tail expression after it could not run (7.5.11)
  const diverged = inFrame(p, fields, frame, () => fnBody(p, routine.body, fieldSlots, indent + 1))
  if (result !== undefined && !diverged) push(p, result, indent + 1)
  push(p, "}", indent)
}

/**
 * The parameters a generated body takes after `g`/`prg` and its inputs: each VAR_IN_OUT (`inoutType`), then each FB
 * instance of another frame lent to it for the call (design §24) — for a routine and an FB's `call()` alike.
 */
function bodyParams(p: Printer, inouts: IrPou["slots"], inoutNames: readonly string[], lent: readonly { type: Type }[]): { params: string[]; typed: { param: string; generics: string[] }[] } {
  // a VAR_IN_OUT CONSTANT is lent read-only — rustc refuses a write through it, as CODESYS does
  const typed = inouts.map((slot, i) => inoutType(slot, inoutNames[i]!))
  if (inouts.some((slot) => holdsString(slot.type))) use(p, "string")
  return { params: [...typed.map((t) => t.param), ...lent.map((l, i) => `${tmp("lent", i)}: &mut ${typeOf(p, l.type)}`)], typed }
}

/** An FB's body as `pub fn call(&mut self, …)`: `g`/`prg`, its VAR_IN_OUT and the instances lent to it as parameters. */
export function printCall(p: Printer, layout: IrLayout, names: readonly string[]): void {
  // every generated body is handed the globals as `g`, so no parameter or local of its own may take that name
  const globalsParam = globalsParams(p)
  const reserved = globalsArgs(p)
  const inouts = layout.inouts ?? []
  const inoutNames = fieldNames(inouts, reserved, true) // parameters of a generated fn, not a surface a user reads
  const { params: tail, typed } = bodyParams(p, inouts, inoutNames, layout.lent ?? [])
  const params = [...globalsParam, ...tail].map((param) => `, ${param}`).join("")
  push(p, "", 0)
  // an in-out the body leaves to SUPER^ (or never reads) is unused too (review of the copy-back)
  if (globalsParam.length > 0 || inouts.length > 0 || (layout.lent ?? []).length > 0) push(p, "#[allow(unused_variables)]", 1)
  push(p, `pub fn call${genericList(typed)}(&mut self${params}) {`, 1)
  const selfType: Type = { kind: "function_block", name: layout.name }
  // this body's spans index the file it was WRITTEN in, which need not be the main source (an FB declared in a GVL)
  withUri(p, layout.bodyUri, () =>
    inFrame(p, names, { inoutNames, inoutSlots: inouts, localNames: [], localSlots: [], selfType }, () => fnBody(p, layout.body!, layout.fields, 2)),
  )
  push(p, "}", 1)
}
