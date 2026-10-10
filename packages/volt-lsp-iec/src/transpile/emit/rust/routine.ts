/**
 * ROUTINES AS RUST — a METHOD or ACTION as an `fn` in its FB's `impl`, a FUNCTION as a free `fn`, an FB's body as its
 * `call()`; their parameters built once (`bodyParams`).
 */
import type { IrLayout, IrPou, IrRoutine } from "../../ir/index.js"
import { lateInit, type LocalsBody, mustUse, storedFirstAtTop, storedTwice, unreadOf, writeSites } from "./locals.js"
import type { Type } from "../../../frontend/types/index.js"
import { printTail, resultTail } from "./tail.js"
import { fieldNames, globalsArgs, globalsParams, tmp } from "./names.js"
import { type Frame, holdsString, inFrame, type Printer, push, reachOfBody, typeOf, use, withUri } from "./printer.js"
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
  const { localNames, inoutNames } = bodyNames(p, routine)
  const { params: tail, typed } = bodyParams(p, routine.inouts, inoutNames, routine.lent ?? [], p.dead.get(routine.key)?.inouts)
  const stores = writeSites(p, routine.body)
  const params = [
    ...(routine.kind === "function" ? [] : ["&mut self"]),
    ...globalsParams(reachOfBody(p, routine.key)),
    // `mut` only on an input the body writes (7.7.1): a VAR_INPUT is a local of the call, and most only read it
    // and none for an input no run can see (7.7.7, `deadParamsOf`)
    ...routine.inputs.flatMap((i, k) => (p.dead.get(routine.key)?.inputs.has(k) === true ? [] : [`${stores.has(i) ? "mut " : ""}${localNames[i]}: ${typeOf(p, routine.locals[i]!.type)}`])),
    ...tail,
  ]
  const result = routine.result === undefined ? undefined : localNames[routine.result]!
  const returns = routine.result === undefined ? "" : ` -> ${typeOf(p, routine.locals[routine.result]!.type)}`
  push(p, "", 0)
  // NO ALLOW ON A GENERATED FN (lean 7.7.2). It carried `#[allow(unused_mut, unused_variables, unused_assignments)]`,
  // the gate's blind spot: what each would have excused is now decided before printing — `mut` only on what the body
  // stores again (7.7.1), `_name` for what it never uses, no initial value no read can see (`locals.ts`). And no
  // `unreachable_code`: nothing after a statement control never comes out of is printed (7.5.11, `block`).
  if (mustUse(p, routine)) push(p, "#[must_use]", indent)
  push(p, `pub fn ${p.fnNames.get(routine.key)!}${genericList(typed)}(${params.join(", ")})${returns} {`, indent)
  // the result stored by the body's last statement — or by the last of each branch of its final IF — is the tail (7.7.3)
  const tailed = resultTail(routine)
  const declareAt = printLocals(p, routine, localNames, (i) => routine.inputs.includes(i) || (tailed !== undefined && i === routine.result), indent + 1)
  const frame: Frame = {
    inoutNames,
    inoutSlots: routine.inouts,
    localNames,
    localSlots: routine.locals,
    ...(result === undefined ? {} : { result }),
    ...(routine.fb === undefined ? {} : { selfType: { kind: "function_block", name: routine.fb } }),
    declareAt,
  }
  // a body that never comes out of its bottom (an IF both of whose branches RETURN) hands its result back there; the
  // tail expression after it could not run (7.5.11)
  if (tailed !== undefined) {
    inFrame(p, fields, frame, () => printTail(p, tailed, fieldSlots, indent + 1))
    push(p, "}", indent)
    return
  }
  const diverged = inFrame(p, fields, frame, () => fnBody(p, routine.body, fieldSlots, indent + 1))
  if (result !== undefined && !diverged) push(p, result, indent + 1)
  push(p, "}", indent)
}

/**
 * The Rust names of a body's locals and in-outs — `let` bindings and parameters inside a generated fn, which nothing
 * outside reads, so they may be renumbered; never `g` / `prg` / `__mem`, every body's first parameters. A local or in-out
 * the body never reads is `_name` (7.7.2): what rustc's `unused_variables` / `unused_assignments` would say of it is true
 * of the ST — it declared a variable nobody reads. `unread` says which (an FB's `call()` leaves its in-outs to its allow).
 */
export function bodyNames(p: Printer, body: LocalsBody, unread: ReadonlySet<number> = unreadOf(body)): { localNames: string[]; inoutNames: string[] } {
  const named = fieldNames([...body.locals, ...body.inouts], globalsArgs(p), true)
  const names = named.map((n, i) => (unread.has(i) && !n.startsWith("_") && !named.includes(`_${n}`) ? `_${n}` : n))
  return { localNames: names.slice(0, body.locals.length), inoutNames: names.slice(body.locals.length) }
}

/**
 * A BODY'S PER-RUN LOCALS AS `let` BINDINGS at the top of its fn — a routine's, an FB's `call()`'s and the POU's `scan()`'s
 * VAR_TEMP alike (transpile-restructure 7.6.4), each starting at its initial value on every run; `skip` names the ones
 * that are not (a routine's inputs, its tail result). A LOCAL NO READ CAN SEE THE INITIAL VALUE OF has none printed (7.7.2,
 * `lateInit`): it was a value rustc reports is never read (`unused_assignments`), and Rust proves the local set before
 * every read instead. It is declared where it is first stored when that is at the body's top level (`let x: T = v;`, the
 * returned map), else bare at the top (`let x: T;`); `mut` only where it is stored again (`writeSites`), or in a loop.
 */
function printLocals(p: Printer, body: LocalsBody, localNames: readonly string[], skip: (i: number) => boolean, indent: number): Map<number, boolean> {
  const stores = writeSites(p, body.body)
  const late = lateInit(body)
  const twice = storedTwice(p, body)
  const declareAt = new Map<number, boolean>()
  for (const [i, slot] of body.locals.entries()) {
    if (skip(i)) continue
    const again = twice.has(i)
    if (!late.has(i)) push(p, `let ${stores.has(i) ? "mut " : ""}${localNames[i]}: ${typeOf(p, slot.type)} = ${initOf(p.layouts, slot.type, slot.init)};`, indent)
    else if (storedFirstAtTop(body, i)) declareAt.set(i, again)
    else push(p, `let ${again ? "mut " : ""}${localNames[i]}: ${typeOf(p, slot.type)};`, indent)
  }
  return declareAt
}

/** A body that is no routine — an FB's `call()`, the POU's `scan()` — printed with its VAR_TEMP as the fn's locals
 *  (`printLocals`) on `fields` / `fieldSlots`. */
export function printBody(p: Printer, body: LocalsBody, names: { fields: readonly string[]; localNames: readonly string[]; inoutNames: readonly string[] }, fieldSlots: IrPou["slots"], selfType: Type | undefined, indent: number): void {
  const declareAt = printLocals(p, body, names.localNames, () => false, indent)
  const frame: Frame = { inoutNames: names.inoutNames, inoutSlots: body.inouts, localNames: names.localNames, localSlots: body.locals, ...(selfType === undefined ? {} : { selfType }), declareAt }
  inFrame(p, names.fields, frame, () => fnBody(p, body.body, fieldSlots, indent))
}

/**
 * The parameters a generated body takes after `g`/`prg` and its inputs: each VAR_IN_OUT (`inoutType`), then each FB
 * instance of another frame lent to it for the call (design §24) — for a routine and an FB's `call()` alike.
 */
function bodyParams(p: Printer, inouts: IrPou["slots"], inoutNames: readonly string[], lent: readonly { type: Type }[], dead?: ReadonlySet<number>): { params: string[]; typed: { param: string; generics: string[] }[] } {
  // a VAR_IN_OUT CONSTANT is lent read-only — rustc refuses a write through it, as CODESYS does; one no run can see is
  // no parameter (7.7.9, `deadParamsOf`)
  const typed = inouts.flatMap((slot, i) => (dead?.has(i) === true ? [] : [inoutType(slot, inoutNames[i]!)]))
  if (inouts.some((slot, i) => dead?.has(i) !== true && holdsString(slot.type))) use(p, "string")
  return { params: [...typed.map((t) => t.param), ...lent.map((l, i) => `${tmp("lent", i)}: &mut ${typeOf(p, l.type)}`)], typed }
}

/** An FB's body as `pub fn call(&mut self, …)`: `g`/`prg`, its VAR_IN_OUT and the instances lent to it as parameters. */
export function printCall(p: Printer, layout: IrLayout, names: readonly string[]): void {
  // every generated body is handed the globals as `g`, so no parameter or local of its own may take that name
  const globalsParam = globalsParams(reachOfBody(p, `layout:${layout.name.toUpperCase()}`))
  const inouts = layout.inouts ?? []
  // its VAR_TEMP are the fn's locals (7.6.4); its in-outs are left to the allow below, so only a local may be `_name`
  const body: LocalsBody = { locals: layout.locals ?? [], inputs: [], inouts, body: layout.body! }
  const { localNames, inoutNames } = bodyNames(p, body, unreadOf({ ...body, inouts: [] }))
  const { params: tail, typed } = bodyParams(p, inouts, inoutNames, layout.lent ?? [])
  const params = [...globalsParam, ...tail].map((param) => `, ${param}`).join("")
  push(p, "", 0)
  // an in-out the body leaves to SUPER^ (or never reads) is unused too (review of the copy-back); `g` / `prg` / `__mem`
  // are handed only to a body that reaches them (7.7.5), so they need none
  if (inouts.length > 0 || (layout.lent ?? []).length > 0) push(p, "#[allow(unused_variables)]", 1)
  push(p, `pub fn call${genericList(typed)}(&mut self${params}) {`, 1)
  const selfType: Type = { kind: "function_block", name: layout.name }
  // this body's spans index the file it was WRITTEN in, which need not be the main source (an FB declared in a GVL)
  withUri(p, layout.bodyUri, () => printBody(p, body, { fields: names, localNames, inoutNames }, layout.fields, selfType, 2))
  push(p, "}", 1)
}

