/**
 * An FB_Init call's inputs: what each argument an instance is declared with gives when FB_Init runs — a constant, a
 * variable the recordings cover, a STRUCT field instance's argument in the struct's scope — or its refusal by name.
 */

import { initFrame, type Fb, type InitStep } from "./state.js"
import { lookup } from "../../../frontend/symbols/index.js"
import type { CallArg, Expr } from "../../../frontend/syntax/index.js"
import type { Lowering } from "../core/lowering.js"
import { fieldIndex, type IrExpr, type IrInit, type IrSlot, type Place } from "../../ir/index.js"
import { namedIn } from "./position.js"
import { lowerPlace } from "../places/places.js"
import { ownProgram } from "../calls/reentrancy.js"
import { foldConstant } from "../values/fold.js"
import { convert, stored, valueAs } from "../values/convert.js"
import { isBoolValued } from "../../../frontend/types/index.js"

/**
 * The variable an FB_Init argument reads, when the recordings cover it (`fb_init_argument_from_variable`, `_from_global`):
 * a plain elementary variable whose initial value arrives — the POU's own VAR or VAR_INPUT declared before the instance, or
 * a global. The review of that batch found the rest accepted unrecorded — a struct field's declaration read in the POU's
 * scope, a later or VAR_TEMP variable, an instance's field, a global an FB_Init writes (checked after the walk).
 * `declaring` lowers the argument where the instance is declared; `holder`, in a PROGRAM lowered as its instance, is that
 * instance — the variable read is then its field (review: the recorded case was refused once the program had a METHOD).
 */
function recordedArgument(st: InitStep, expr: Expr, instanceSlot: number, declaring: Lowering = st.lw, holder?: Place): Place | undefined {
  const lw = st.lw
  if (expr.kind !== "ident_expr") return undefined
  const read = lowerPlace(declaring, expr)
  if (read === undefined || read.path.length > 0 || read.type.kind !== "elementary") return undefined
  if (read.root === undefined) {
    const declared = declaring.slots[read.slot]
    // declared before the instance, its initializer has run; declared after it with one that RUNS, it has not, and the
    // variable is still at its default (`tr_23_fb_init_argument_from_pending_init{,_reversed}`: 4, 0). A later one
    // whose initializer folds starts at that value here, which is not recorded.
    const settled = read.slot < instanceSlot || initFrame(declaring).pendingInits.some((p) => p.slot === read.slot)
    if (!(settled && (declared?.section === "VAR" || declared?.section === "VAR_INPUT"))) return undefined
    return holder === undefined ? read : { ...holder, path: [...holder.path, { kind: "field", name: declared!.name }], type: read.type }
  }
  if (read.root !== "global" || lw.globals[read.slot]?.section === "program") return undefined
  st.globalArguments.add(read.slot)
  return read
}


/** One FB_Init input: `bInitRetains` TRUE, `bInCopyCode` FALSE, a declared argument that folds, or a variable the
 *  recordings cover — `false` (the refusal reported) when none applies. */
export function fbInitInput(st: InitStep, place: Place, t: Fb, slot: IrSlot, given: ReadonlyMap<string, Expr>, args: readonly CallArg[], declaring: Lowering, holder: Place | undefined): IrExpr | false {
  const { lw, span } = st
  const name = slot.name.toUpperCase()
  const expr = given.get(name)
  // A STRUCT FIELD INSTANCE's argument resolves in the STRUCT's scope (M5.1.2): an earlier field of the struct, else a global
  const last = place.path.at(-1)
  const structScope = holder?.type.kind === "struct" && last?.kind === "field"
  const inStruct = expr?.kind === "ident_expr" && structScope
  // ...any other expression naming something would fold in the DECLARING POU's scope, which is not the struct's (gate 5d:
  // a field named like a global constant gave the global's value, a POU constant the struct cannot see folded): refused,
  // as design.md §3.4 step 5d keeps any expression. niche: accepted loss (0 occurrences: every corpus argument is a literal)
  if (structScope && expr !== undefined && expr.kind !== "ident_expr" && namesSomething(expr))
    return lw.bail("fb-init-argument", `${last.name}'s FB_Init argument for ${slot.name} is an expression naming something, judged in no struct scope`, span) ?? false
  // bInitRetains / bInCopyCode are BOOL inputs the runtime hands TRUE / FALSE; declared as another type the vendor
  // refuses the FB (`oopb_fb_init_input_wrong_type`, both vendors) — refused by name, not handed a BOOL unconverted
  if ((name === "BINITRETAINS" || name === "BINCOPYCODE") && !isBoolValued(slot.type))
    return lw.bail("fb-init-argument", `${t.name}'s FB_Init input ${slot.name} is declared as no BOOL — the vendor refuses it too`, span) ?? false
  const field = inStruct ? structField(st, expr, holder!, last.name, declaring) : undefined
  if (field === false) return false
  const folded =
    name === "BINITRETAINS" ? true
    : name === "BINCOPYCODE" ? false
    : expr === undefined || field !== undefined ? undefined
    : foldConstant(declaring, expr)
  let input: IrExpr | undefined =
    field !== undefined ? convert({ kind: "load", place: field, type: field.type, span }, slot.type)
    : folded === undefined ? undefined
    : { kind: "const", value: stored(valueAs(folded, slot.type), slot.type), type: slot.type, span }
  // ...not a field and no constant: a global the struct sees, read as `fb_init_argument_from_global` reads one
  if (input === undefined && inStruct) {
    const read = recordedArgument(st, expr, -1, declaring)
    if (read?.root === "global") input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
  }
  // A variable gives its value when FB_Init runs — its initial value, recorded (`fb_init_argument_from_variable`: 4,
  // `fb_init_argument_from_global`: 6). Only in a declaration of the POU's own, where the name means the same place
  // in the init step; inside an FB it names that FB's field. An interface would need its instances tracked.
  if (input === undefined && expr !== undefined && declaring === lw && place.path.length === 0) {
    const read = recordedArgument(st, expr, place.slot)
    if (read !== undefined) input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
  }
  const held = place.path[0]
  if (input === undefined && expr !== undefined && place.path.length === 1 && held?.kind === "field" && ownProgram(st, place)) {
    const holder: Place = { ...place, path: [], type: (place.root === "global" ? lw.globals : lw.slots)[place.slot]!.type }
    const read = recordedArgument(st, expr, fieldIndex(declaring.slots, held.name), declaring, holder)
    if (read !== undefined) input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
  }
  // ...and an instance held by an FB instance: the variable is the HOLDER's field (transpile-review 23 — it was
  // refused, `tr_23_fb_init_argument_from_pending_init`)
  if (input === undefined && expr !== undefined && holder?.type.kind === "function_block" && last?.kind === "field" && lw.bodies.get(holder.type.name.toUpperCase())?.lowering === declaring) {
    const read = recordedArgument(st, expr, fieldIndex(declaring.slots, last.name), declaring, holder)
    if (read !== undefined) input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
  }
  return input ?? refuseInput(st, place, t, slot, args)
}

/** No input lowering can pass: `fb-init-root` for the harness's own bare declaration, else `fb-init-argument`. */
function refuseInput(st: InitStep, place: Place, t: Fb, slot: IrSlot, args: readonly CallArg[]): false {
  const { lw, span } = st
  // NO ARGUMENT AT ALL IS NOT A GAP IN LOWERING — the vendor refuses that declaration too: an FB whose
  // FB_Init takes an extra input cannot be instantiated without one ("Specified 'FB_Init' method requires
  // exactly 1 inputs", conformance `fb_init_argument_left_out`, and `checks/oop/fb-init-instantiation.ts`
  // reports it).
  //
  // EXCEPT WHERE THE BARE DECLARATION IS THE HARNESS'S OWN, which is the only place the corpus hits it.
  // `lowerUnit` lowers a POU by synthesizing `inst : ThatPOU;` and calling it (`rootInstance`), and that
  // declaration passes nothing — so an FB whose inherited FB_Init takes `invert` can never lower as a
  // root, however complete the transpiler becomes. Measured 2026-09-24: every corpus project builds with
  // ZERO errors, so CODESYS accepts the two POUs this was blocking; what it would refuse is Volt's own
  // scaffold, which it never sees. Filing that under `fb-init-argument` put a harness limit in the work
  // list with a 100% conversion rate — it reported `reach 2, sole 2`, the best ratio on the board, for
  // something no amount of lowering can close. Its own code, for the reason `pointer-root-input` has one.
  //
  // The note said "it is the ROOT" and was guarded by `lw.isRoot`, which is set on the one lowering that
  // reaches this and so discriminated nothing — an ordinary `inst : FB_Need;` inside a PROGRAM got the
  // same claim. What discriminates is the instance being the root's own, which is named for the POU.
  const rootsOwn =
    lw.isRoot &&
    place.root === undefined &&
    place.path.length === 0 &&
    lw.shared.root !== "" &&
    lw.slots[place.slot]?.name.toUpperCase() === lw.shared.root.toUpperCase()
  if (args.length === 0 && rootsOwn)
    return (
      lw.bail(
        "fb-init-root",
        `${t.name}'s FB_Init input ${slot.name} has no argument in the instance the HARNESS declares — ` +
          "lowering a POU on its own synthesizes a bare declaration, and the vendor never sees it",
        span,
      ) ?? false
    )
  return (
    lw.bail(
      "fb-init-argument",
      `${t.name}'s FB_Init input ${slot.name} is given nothing lowering can pass` +
        (args.length === 0 ? " — it is declared with no argument at all, which the vendor refuses too" : ""),
      span,
    ) ?? false
  )
}

/**
 * A STRUCT field instance's FB_Init argument naming a bare name, in the STRUCT's scope (design.md §3.4 step 5d, M5.1.2):
 * a field of that struct declared BEFORE the instance is read as `holder.field`, its value at that point of the walk
 * (`init_struct_field_fb_init_scope_sibling`: 4), before any global of the same name (`_shadow`: the field's 4, not the
 * global's 11); a LATER field is not initialized yet (`init-reads-later`). Not a field: undefined — a constant or a global,
 * judged by the caller — unless the name is a variable of the POU DECLARING the struct variable, which the struct cannot
 * see (`_local`: both vendors refuse, "Identifier not defined"): `fb-init-argument`. Where a GLOBAL shares its name the
 * struct's scope would give the global — not recorded, refused all the same (a conservative refusal; niche: accepted loss,
 * 0 occurrences in the corpora). `false` once a refusal is reported.
 */
function structField(st: InitStep, expr: Extract<Expr, { kind: "ident_expr" }>, holder: Place, instance: string, declaring: Lowering): Place | false | undefined {
  const fields = st.lw.layouts.get(holder.type.kind === "struct" ? holder.type.name.toUpperCase() : "")?.fields
  const at = fieldIndex(fields, expr.name)
  if (at >= 0) {
    const field = fields![at]!
    if (at >= fieldIndex(fields, instance))
      return st.lw.bail("init-reads-later", `${instance}'s FB_Init argument reads ${field.name}, a field of the struct declared after it — not initialized yet`, st.span) ?? false
    // a STRUCT or an instance is no value for an elementary input — the vendor refuses it; refused by name (gate 5d)
    if (field.type.kind !== "elementary")
      return st.lw.bail("fb-init-argument", `${instance}'s FB_Init argument reads ${field.name}, a field that is not an elementary value`, st.span) ?? false
    return { ...holder, path: [...holder.path, { kind: "field", name: field.name }], type: field.type }
  }
  const sym = lookup(declaring.scope, expr.name)?.symbol
  if (sym !== undefined && (sym.kind === "var" || sym.kind === "method_param") && sym.varSection !== "VAR_EXTERNAL")
    return st.lw.bail("fb-init-argument", `${instance}'s FB_Init argument names ${expr.name}, a variable of the POU declaring the struct — no name in the struct's scope`, st.span) ?? false
  return undefined
}

/** Whether an expression names anything — a variable, a constant, an enum value, a call — rather than being literals only. */
function namesSomething(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false
  if (Array.isArray(node)) return node.some(namesSomething)
  if ((node as Expr).kind === "ident_expr") return true
  return Object.entries(node).some(([key, child]) => key !== "span" && namesSomething(child))
}

/**
 * A STRUCT field instance whose FB_Init argument reads a sibling field an ENCLOSING structured initializer sets — the
 * struct variable's own (`rec : DUT := (first := 7)`), an FB field's, an outer struct field's default: that value is in
 * the slot at construction, where on an FB instance's own declaration it is applied after FB_Init
 * (`fb_init_and_structured_initializer`: 0). Not recorded for a struct: refused `fb-init-order`, as `enclosingStructuredFree`
 * refuses one reaching the instance itself (gate 5d). niche: accepted loss (0 STRUCT fields with FB_Init arguments in the corpora).
 */
export function siblingsUnset(st: InitStep, instance: string, args: readonly CallArg[], structured: Readonly<Record<string, IrInit>> | undefined): boolean {
  for (const arg of args)
    if (arg.value?.kind === "ident_expr" && namedIn(structured, arg.value.name) !== undefined)
      return st.lw.bail("fb-init-order", `${instance}'s FB_Init argument reads ${arg.value.name}, a field an enclosing structured initializer sets — whether FB_Init sees it is not recorded`, st.span) ?? false
  return true
}
