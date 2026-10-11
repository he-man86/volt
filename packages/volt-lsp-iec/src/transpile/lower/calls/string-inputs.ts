/**
 * READ-ONLY STANDARD STRING INPUTS (transpile-restructure 7.4.6, design.md §3.2 7.4c): a Standard string FUNCTION reads
 * a caller's STRING(N <= 255) where it lies, not a STRING(255) copy of it.
 *
 * LEN, CONCAT, LEFT, RIGHT, MID, FIND, INSERT, DELETE and REPLACE declare their strings `STR : STRING(255)` VAR_INPUTs,
 * so a call copied its argument into 256 bytes — `len(self.hello.to::<255>())`. Each body only READS that input, at
 * k <= LEN_INTERNAL(STR) <= N (every index is bounded by the length it counted, or stops at the first 0), and reads it
 * whole only into its own fresh result; so a borrow of the caller's N units reads what the copy reads, unit for unit.
 * That is a proof by test, not by prose: `test/libraries/standard.test.ts` runs every one of them over every short buffer
 * passed as a STRING(N) and as the same buffer in a STRING(255), and requires the two to agree with no fault.
 *
 * Every such input is lowered as a VAR_IN_OUT CONSTANT — the read-only in-out both backends already have
 * (`IrSlot.readOnly`: `&IecString<N>`) — of the type the call hands it, one variant per capacity, whose Rust is one
 * generic fn (`sharedVariants` merges them):
 *
 *   argument                                  lent                                  Rust
 *   a place `lendable` takes, STRING(N<=255)  the place, at N                       len(&self.hello)
 *   a literal, a FUNCTION's result, any       a copy at its own N, taken as the     len(&IecString::<3>::lit(b"abc"))
 *     other STRING(N<=255) place — a STRING   input copy took it                    len(&concat(&self.a, &self.b))
 *     VAR_IN_OUT bound wider among them, read                                       len(&io.to::<10>())
 *     through its declared capacity
 *   anything else: a STRING wider than 255,   a copy CUT to STRING(255) — exactly   len(&self.wide.to::<255>())
 *     a conversion, a METHOD's result          the input copy (`string_input_truncation`)
 *
 * so no argument keeps a by-value input, and nothing is lowered twice to find its type (a conversion's or a METHOD's
 * result is converted to the declared STRING(255), as the input was). A whole STRING VAR_IN_OUT is lent as its value, the
 * copy at the capacity it declares (`string_input_lent_inout_wider`: LEN(io) 10 of 'abcdefghijkl'): bound wider, it is the
 * caller's buffer seen through that capacity (`string-inouts.ts`); bound at its own, the copy reads what a borrow would,
 * but its Rust type is generic over the capacity (`emit/rust/types.ts` `inoutType`), which a temp of the declared type
 * cannot take as it is (`wholeInOut`). Where the order could show — a later argument's call
 * changes the string, or both it and a later argument could fault — a lent string is taken where it is written, as the
 * copy was (`inputWhereWritten`). A body that writes such an input, lends it writable or takes its address is a
 * library-repo defect, refused by name (`input-borrow-written`) — never a silent copy.
 */

import { elemOf, parseConversionName, type Type } from "../../../frontend/types/index.js"
import type { CallArg, Expr, Span, TopLevel } from "../../../frontend/syntax/index.js"
import { childScopesByName, findChildScope, targetOf } from "../../../frontend/symbols/index.js"
import { libraryOf } from "../../../frontend/library/index.js"
import { fieldIn, type IrBinding, type IrExpr, type IrFreeze, type Place } from "../../ir/index.js"
import { type Lowering, type RoutineSymbol, zeroInit } from "../core/lowering.js"
import { tempPlace } from "../core/temps.js"
import { lowerExpr } from "../expressions/expressions.js"
import { lowerPlace } from "../places/places.js"
import { lentInputSlotsOf, slotOf } from "../places/access-guards.js"
import { storageOf } from "../storage/layout.js"
import { refuseImplicitString } from "../statements/assign.js"
import { convert } from "../values/convert.js"
import { BUILTIN_ARITY } from "../builtins/arity.js"
import { type IrNode, isPlace, someNode, writesOnlyLocals } from "../../ir/walk.js"
import { cannotFault } from "../../ir/faults.js"
import { LoweringBug } from "../../semantics/faults.js"
import { functionCalled } from "./invoke.js"
import { routineFacts } from "./facts.js"
import { positionalParameters } from "./parameters.js"

/** The capacity a Standard string function declares its inputs with, and the widest argument a borrow reads alike. */
const DECLARED = 255

/** Each routine's read-only string inputs: the in-out index each is bound through (`bindArgument`). */
export const stringInputsOf = routineFacts<ReadonlySet<number>>()

/** A lent string input of a call: its parameter, as declared, and the type it is lent at. */
export interface StringInput {
  name: string
  type: Type
}

/**
 * THE STRING INPUTS THIS CALL LENDS, by upper-cased parameter name — the variant in the routine's name (`calledRoutine`):
 * every `STRING(255)` VAR_INPUT of a FUNCTION of the Standard library the call binds, at the type `lentType` gives it.
 */
export function stringInputArguments(lw: Lowering, sym: RoutineSymbol, call: Extract<Expr, { kind: "call" }>): Map<string, StringInput> {
  const out = new Map<string, StringInput>()
  const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
  if (ast.kind !== "function" || libraryOf(sym) !== "Standard") return out
  const scope = findChildScope(sym.owner, sym.name) ?? lw.scope
  const parameters = positionalParameters(ast.varSections)
  for (const [position, arg] of call.args.entries()) {
    const name = arg.param?.name.toUpperCase() ?? parameters[position]?.name.toUpperCase()
    const prm = name === undefined ? undefined : fieldIn(parameters, name)
    if (prm?.sectionKind !== "VAR_INPUT" || arg.output || arg.value === undefined) continue
    const declared = lw.resolve(prm.type, scope)
    if (!isString(declared) || declared.length !== DECLARED) continue
    out.set(name!, { name: prm.name, type: lentType(lw, arg.value, declared) })
  }
  return out
}

/** A STRING (not a WSTRING) with a capacity. */
const isString = (t: Type | undefined): t is Extract<Type, { kind: "elementary" }> & { length: number } =>
  t?.kind === "elementary" && elemOf(t)?.name === "STRING" && t.length !== undefined

/** What a string argument is: a literal, a call, or something to be read as a place first. */
function argumentKind(value: Expr): { kind: "literal" | "call" | "place"; value: Expr } {
  while (value.kind === "paren") value = value.inner
  if (value.kind === "literal" && value.literalKind === "string") return { kind: "literal", value }
  return { kind: value.kind === "call" ? "call" : "place", value }
}

/**
 * The type an argument is lent at: its own STRING(N <= 255) — a place's (a view's, `string-inouts.ts`, the capacity it
 * declares), a literal's, a FUNCTION result's declared one — or else the declared STRING(255), which the copy is cut to.
 * A probe: nothing it reports stays reported.
 */
function lentType(lw: Lowering, value: Expr, declared: Type): Type {
  const arg = argumentKind(value)
  const before = lw.diagnostics.length
  const own = lw.inArgument(() =>
    arg.kind === "literal" ? lowerExpr(lw, arg.value)?.type : arg.kind === "call" ? resultType(lw, arg.value as Extract<Expr, { kind: "call" }>) : readType(lw, lowerPlace(lw, arg.value)),
  )
  lw.diagnostics.length = before
  return isString(own) && own.length <= DECLARED ? own : declared
}

/** The declared result type of the FUNCTION a call names — what its lowered call is typed (`calledRoutine`) — or undefined
 *  for any other callee (a METHOD, a conversion, which lowering builds as no call). */
function resultType(lw: Lowering, call: Extract<Expr, { kind: "call" }>): Type | undefined {
  const name = call.callee.kind === "ident_expr" ? call.callee.name : undefined
  if (name !== undefined && (parseConversionName(name, targetOf(lw.project)) !== undefined || BUILTIN_ARITY[name.toUpperCase()] !== undefined)) return undefined
  const sym = functionCalled(lw, call.callee)
  const ast = sym?.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }> | undefined
  if (sym === undefined || ast?.kind !== "function" || ast.returnType === undefined) return undefined
  const scope = childScopesByName(lw.project, sym.name).find((s) => s.defUri === sym.uri)
  return storageOf(lw, lw.resolve(ast.returnType, scope), ast.returnType.span)
}

/** The type a place's VALUE has: a view's declared type (`string-inouts.ts`), any other place's own. */
const readType = (lw: Lowering, place: Place | undefined): Type | undefined => (place === undefined ? undefined : (slotOf(lw, place)?.readAs ?? place.type))

/** A place a read-only `&` may borrow beside everything else the call holds, and read as the input copy read it: none of
 *  a global (every body holds the globals as one `&mut`), a dereference, a byte-image place, a lent instance's, a bit, or
 *  a whole STRING VAR_IN_OUT (`wholeInOut`). */
function lendable(lw: Lowering, place: Place | undefined): Place | undefined {
  if (place === undefined || place.guard !== undefined || place.at !== undefined || wholeInOut(lw, place)) return undefined
  if (place.root === "global" || place.root === "image" || place.root === "lent") return undefined
  return place.path.some((s) => s.kind === "bit") ? undefined : place
}

/**
 * A WHOLE STRING VAR_IN_OUT OF THE ROUTINE — not one of its own lent inputs, which is bound at the capacity it is lent at
 * (`lentType`) and lent on as it is. It is lent as its VALUE, a copy at the capacity it declares: bound wider, that is its
 * view's copy (`string-inouts.ts`, `loadValue`); bound at its own capacity, the copy reads what a borrow would, but its
 * Rust type is generic over the capacity (`inoutType`), so a temp the call freezes it into (`inputWhereWritten`) takes it
 * only converted — `io.to::<10>()`.
 */
function wholeInOut(lw: Lowering, place: Place): boolean {
  return place.root === "inout" && place.path.length === 0 && !lentInputSlotsOf(lw).has(place.slot)
}

/**
 * The routine's lent string inputs, declared as its read-only in-outs of the type each is lent at — before
 * `routineInputs` declares the rest, which then skips them (the names returned). Recorded under `key` for its callers.
 */
export function declareStringInputs(lw: Lowering, r: Lowering, lent: ReadonlyMap<string, StringInput>, key: string): ReadonlySet<string> {
  const inouts = new Set<number>()
  for (const [upper, { name, type }] of lent) {
    const at = r.inoutSlots.length
    r.inoutByName.set(upper, at)
    r.inoutSlots.push({ name, type, section: "VAR_IN_OUT", init: zeroInit(type), constant: true, readOnly: true })
    lentInputSlotsOf(r).add(at)
    inouts.add(at)
  }
  stringInputsOf(lw).set(key, inouts)
  return new Set(lent.keys())
}

/**
 * A READ-ONLY STRING INPUT BOUND at the variant's type (`lentType`): a place `lendable` takes, of that capacity, lent as it
 * is; anything else lent as a copy taken as the input took it — the argument converted to the parameter, which cuts only
 * where the parameter is the declared STRING(255) (a view's value is already its declared copy, `loadValue`).
 */
export function bindStringInput(lw: Lowering, arg: CallArg, param: { name: string; type: Type }): IrBinding | undefined {
  const given = argumentKind(arg.value!)
  if (given.kind === "place") {
    const before = lw.diagnostics.length
    const place = lendable(lw, lw.inArgument(() => lowerPlace(lw, given.value)))
    lw.diagnostics.length = before
    if (place !== undefined && isString(place.type) && isString(param.type) && place.type.length === param.type.length) return place
  }
  // a literal is read as a VAR_IN_OUT CONSTANT reads one (`bindInOut`); a call runs where it is written, among the inputs
  const value = given.kind === "literal" ? lw.inArgument(() => lowerExpr(lw, given.value, param.type)) : lowerExpr(lw, given.value, param.type)
  if (value === undefined || refuseImplicitString(lw, value, param.type, arg.span)) return undefined
  // below the declared STRING(255) the variant was typed from the argument itself: a lowered value of another capacity
  // would be a cut the input copy never made
  const capacity = isString(value.type) ? value.type.length : undefined
  if (isString(param.type) && param.type.length !== DECLARED && capacity !== param.type.length)
    throw new LoweringBug(`${param.name} is lent a STRING(${param.type.length}) and given a ${elemOf(value.type)?.name ?? value.type.kind}(${String(capacity)})`)
  // a whole STRING VAR_IN_OUT's value is the copy at its declared capacity, a conversion even where the two types read
  // alike (`wholeInOut`: `io.to::<10>()`); a view's is one already (`loadValue`)
  const copied: IrExpr = value.kind === "load" && wholeInOut(lw, value.place) ? { kind: "convert", value, type: param.type, span: value.span } : convert(value, param.type)
  return { kind: "copy", value: copied, type: param.type, span: arg.span }
}

/**
 * WHETHER `node` HOLDS A CALL THAT COULD CHANGE ANYTHING — anything but a FUNCTION whose body writes only its own locals
 * and calls nothing, every in-out of it read-only and no instance lent to it (`writesOnlyLocals`): `LEN(txt)`,
 * `CONCAT(a, b)`, `DELETE(s, 1, 2)` change nothing, so where they run cannot show. A routine the cache does not hold as
 * lowered counts as one that could.
 */
function holdsEffect(lw: Lowering, node: IrNode | readonly IrNode[]): boolean {
  return someNode(node, (n) => {
    if (isPlace(n) || (n.kind !== "invoke" && n.kind !== "dispatch" && n.kind !== "call")) return false
    if (n.kind !== "invoke" || n.instance !== undefined) return true
    const cached = lw.routines.get(n.routine)
    const routine = cached?.state === "lowered" ? cached.routine : undefined
    return routine === undefined || routine.kind !== "function" || (routine.lent ?? []).length > 0 || !routine.inouts.every((s) => s.readOnly === true) || !writesOnlyLocals(routine.body)
  })
}

/**
 * A LENT STRING INPUT, TAKEN WHERE IT IS WRITTEN WHEN ANYTHING COULD SEE THE DIFFERENCE (`bindWhereWritten`). Both
 * backends evaluate the inputs in written order and bind the in-outs after them (and the copies after the inputs), while
 * the input copy this replaces was taken at its own position. So, into a temp the call lends instead:
 *   - a place, or a copy of one, a LATER argument's call could change — `MID(txt, Shrink(), 1)`: the copy read `txt`
 *     before `Shrink` ran, and a borrow would read it after (and, in Rust, beside the call's own `&mut self`);
 *   - a copy whose own call could change something — it ran in its place among the inputs, before a later one;
 *   - one that could fault, where a later argument could fault too — `MID(arr[i], 10 / j, 1)`: the copy faulted on the
 *     index before the division ran (`cannotFault`).
 * `later`: the arguments written after it, inputs and in-out bindings alike. A literal is a constant: nothing changes
 * it, it cannot fault, and it stays as it is; and a call that changes nothing runs wherever it is put
 * (`MID(txt, LEN(txt) - 1, 2)` lends `txt`).
 */
export function inputWhereWritten(lw: Lowering, binding: IrBinding, type: Type, later: readonly IrNode[], span: Span): { freeze?: IrFreeze; binding: IrBinding } {
  if ("kind" in binding && binding.value.kind === "const") return { binding }
  const value: IrExpr = "kind" in binding ? binding.value : { kind: "load", place: binding, type, span }
  const visible = holdsEffect(lw, value) || later.some((n) => holdsEffect(lw, n)) || (!cannotFault(value) && later.some((n) => !cannotFault(n)))
  if (!visible) return { binding }
  const temp = tempPlace(lw, "input_copy", type, span, "statement")
  return { freeze: { kind: "freeze", temp, value }, binding: temp }
}
