/**
 * FB_Init and the instance walk: each instance's FB_Init calls with the arguments it is declared with, its field
 * initializers interleaved by declaration, and the instances inside it.
 */

import { type Fb, initFrame, type InitStep, pendingInitsOf } from "./state.js"
import { lookup, type Symbol } from "../../../frontend/symbols/index.js"
import { peelArray, type Type, typeZero, UNKNOWN } from "../../../frontend/types/index.js"
import type { CallArg, Expr, TopLevel } from "../../../frontend/syntax/index.js"
import type { Lowering } from "../core/lowering.js"
import type { IrExpr, IrInit, IrRoutine, IrSlot, IrStmt, Place } from "../../ir/index.js"
import { lowerPlace } from "../places/places.js"
import { INIT_ATTRIBUTE, initMethod, instancePaths, pathFields, slotMethodCall } from "./attributes.js"
import { chainNamesOf, declaredChain, scopeChain } from "../core/chain.js"
import { ownProgram, programReentrant, programTarget, routineCallee } from "../calls/reentrancy.js"
import { calledRoutine } from "../calls/routines.js"
import { holdsCall, type IrNode, isPlace, someNode } from "../../ir/walk.js"
import { foldConstant } from "../values/fold.js"
import { convert, stored, valueAs } from "../values/convert.js"
import { instanceInitRoutine } from "./instance-init.js"
import { fieldIn, fieldIndex } from "../places/path.js"

/**
 * Every FB_Init of an FB type's EXTENDS chain, the base's first. FB_Init (conformance `fb_init_runs_with_declared_arguments`,
 * `fb_init_base_and_derived`): once per instance before the first cycle, after the fields' own initial values (35, not 5),
 * with bInitRetains TRUE and bInCopyCode FALSE at a cold start and the arguments the instance is declared with — every
 * FB_Init of the EXTENDS chain, the base's first (order 12). It was an ordinary METHOD nothing called, so every instance
 * started as if it had none, with no diagnostic.
 */
function fbInits(fb: Fb): Symbol[] {
  const chain: Symbol[] = []
  for (const s of scopeChain(fb.scope)) {
    const own = (s.symbols.get("fb_init") ?? []).find((sym) => sym.kind === "method" && sym.owner === s)
    if (own !== undefined) chain.unshift(own)
  }
  return chain
}

/**
 * Whether a value of `t` holds, at any depth — an array's elements, a struct's or an FB's fields — an instance the init
 * step has something to do on (transpile-restructure 1.7.13, lean 10.1: `holdsFbInit` and `reaches` were this walk twice).
 * `what` is the question: `"fb-init"` — an instance running FB_Init; `"init-step"` — anything at all for the step (an
 * init-slot METHOD, an instance-path, an FB_Init, a field initializer that runs, the base's included). Memoized per
 * type and question in the step (`fbInitHeld`, `known`); a type reached again while it is asked answers false.
 */
export function reachesFbInit(st: InitStep, t: Type, what: "fb-init" | "init-step"): boolean {
  const array = peelArray(t)
  if (array !== undefined) return reachesFbInit(st, array.element, what)
  if (t.kind !== "function_block" && t.kind !== "struct") return false
  const memo = what === "fb-init" ? st.fbInitHeld : st.known
  const key = t.name.toUpperCase()
  if (memo.has(key)) return memo.get(key)!
  memo.set(key, false)
  const result = (t.kind === "function_block" && ownInitWork(st.lw, t, what)) || (st.lw.layouts.get(key)?.fields ?? []).some((f) => reachesFbInit(st, f.type, what))
  memo.set(key, result)
  return result
}

/** What an FB type itself gives the init step to do, for `reachesFbInit`'s question. */
function ownInitWork(lw: Lowering, t: Fb, what: "fb-init" | "init-step"): boolean {
  if (what === "fb-init") return fbInits(t).length > 0
  return (
    initMethod(lw, t) !== undefined ||
    pathFields(lw, t).length > 0 ||
    fbInits(t).length > 0 ||
    // A field whose initial value RUNS — the walk has to reach the instance to run it there. The whole EXTENDS
    // chain, for the same reason the invoke below walks it: a DERIVED FB whose own fields all fold still has to
    // be reached, or its base's initializers never run on it and the field silently keeps its default.
    chainNamesOf(t).some((name) => pendingInitsOf(lw, name) > 0)
  )
}

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

/** Whether init statements write a global, through any routine or FB body they call. */
export function writesGlobal(lw: Lowering, root: readonly IrStmt[], seen: Set<string> = new Set()): boolean {
  const visit = (n: IrNode): boolean => {
    if (isPlace(n)) return false
    if (n.kind === "assign" && n.target.root === "global") return true
    if (n.kind === "invoke" && !seen.has(n.routine)) {
      seen.add(n.routine)
      const called = lw.routines.get(n.routine)
      if (called?.state === "lowered" && someNode(called.routine.body, visit)) return true
    }
    if (n.kind === "call" && !seen.has(`FB:${n.fb}`)) {
      seen.add(`FB:${n.fb}`)
      if (someNode(lw.layouts.get(n.fb.toUpperCase())?.body ?? [], visit)) return true
    }
    return false
  }
  return someNode(root, visit)
}

/** The FB_Init arguments a field is declared with, by the unit (or struct) declaring it — its base FBs' too. */
export function declaredArgs(lw: Lowering, owner: TopLevel | undefined, name: string): readonly CallArg[] {
  for (const unit of declaredChain(lw, owner)) {
    const decls =
      unit.kind === "function_block" || unit.kind === "program" ? unit.varSections.flatMap((s) => s.decls)
      : unit.kind === "type_decl" && unit.body.kind === "struct" ? unit.body.fields
      : []
    const decl = decls.find((d) => d.names.some((n) => n.text.toUpperCase() === name.toUpperCase()))
    if (decl !== undefined) return decl.type.kind === "named_type" ? (decl.type.initArgs ?? []) : []
  }
  return []
}

/** An instance the init step would have to reach where its walk does not go: refused. */
export function unreached(st: InitStep, where: string): undefined {
  return st.lw.bail("attr-init-unreached", `an instance with a ${INIT_ATTRIBUTE} method or an instance-path in ${where}, which the init step does not reach`, st.span)
}

/**
 * One instance (or struct value) the init step walks: its FB_Inits, its instance-path fields, its init-slot METHOD, and —
 * recursively, field by field — the instances inside it, with its type's field initializers interleaved. `args`: the
 * FB_Init arguments the place is declared with, lowered in `declaring`; `init` / `clearInit`: the declaring slot's initial
 * value, and a way to take a structured initializer out of it — to be applied after FB_Init instead.
 */
export function visit(st: InitStep, place: Place, args: readonly CallArg[], declaring: Lowering, init: IrInit, clearInit: () => void, holder?: Place): boolean {
  const t = place.type
  if (!reachesFbInit(st, t, "init-step")) return true
  if (peelArray(t) !== undefined) return unreached(st, "an array") ?? false
  if (t.kind !== "function_block" && t.kind !== "struct") return true
  // A PROGRAM's own FB_Init leaves its variables as they were (`fb_init_program_own`: 1) — whether it runs at all, before
  // their initial values, is not recorded, so one that calls anything or writes a global is refused. Its init-slot METHOD
  // runs (`init_slot_program_own`: 101), as an FB's does.
  const program = t.kind === "function_block" && place.path.length === 0 && ownProgram(st, place)
  if (program && !programFbInitsQuiet(st, t)) return false
  const inits = t.kind === "function_block" && !program ? fbInits(t) : []
  const mine: IrStmt[] = []
  if (t.kind === "function_block" && inits.length > 0 && !callFbInits(st, place, t, inits, args, declaring, init, clearInit, mine, holder)) return false
  if (t.kind === "function_block" && !instancePaths(st, place, t)) return false
  if (t.kind === "function_block" && !slotMethodCall(st, place, t)) return false
  return visitFields(st, place, t, inits, declaring, mine)
}

/** A PROGRAM's own FB_Inits, allowed only while they call nothing and write no global. */
function programFbInitsQuiet(st: InitStep, t: Fb): boolean {
  for (const sym of fbInits(t)) {
    const routine: IrRoutine | undefined = calledRoutine(st.lw, sym, t, st.span)
    if (routine === undefined) return false
    if (holdsCall(routine.body) || writesGlobal(st.lw, routine.body))
      return st.lw.bail("fb-init-program", `${t.name} is a PROGRAM whose FB_Init calls or writes beyond its own variables — whether it runs is not recorded`, st.span) ?? false
  }
  return true
}

/** The instance's FB_Init calls into `mine`, each input from the declaration's arguments; then a structured initializer on
 *  it re-applied after FB_Init (`st.reapplied`) and taken out of the declaration (`clearInit`). */
function callFbInits(st: InitStep, place: Place, t: Fb, inits: readonly Symbol[], args: readonly CallArg[], declaring: Lowering, init: IrInit, clearInit: () => void, mine: IrStmt[], holder: Place | undefined): boolean {
  const { lw, span } = st
  // Inner first is recorded for a holder with no EXTENDS (`fb_init_nested_in_fb_init`). With a base chain, whether a
  // field's FB_Init runs before the base's or the derived's is not — the review of that batch found it guessed.
  if (t.scope?.baseScope !== undefined && (lw.layouts.get(t.name.toUpperCase())?.fields ?? []).some((f) => reachesFbInit(st, f.type, "fb-init")))
    return lw.bail("fb-init-order", `${t.name} extends a base and holds an instance running FB_Init — their order is not recorded`, span) ?? false
  const given = new Map<string, Expr>()
  for (const arg of args) {
    if (arg.param === undefined || arg.output || arg.value === undefined) return lw.bail("fb-init-argument", `${t.name} declared with a positional FB_Init argument`, span) ?? false
    given.set(arg.param.name.toUpperCase(), arg.value)
  }
  for (const sym of inits) {
    const routine: IrRoutine | undefined = calledRoutine(lw, sym, t, span, sym.owner === t.scope ? sym.name : `SUPER_${sym.owner.name}_${sym.name}`)
    if (routine === undefined) return false
    if (routine.inouts.length > 0) return lw.bail("fb-init-argument", `${sym.owner.name}'s FB_Init has a VAR_IN_OUT or VAR_OUTPUT`, span) ?? false
    const inputs: IrExpr[] = []
    for (const index of routine.inputs) {
      const input = fbInitInput(st, place, t, routine.locals[index]!, given, args, declaring, holder)
      if (input === false) return false
      inputs.push(input)
    }
    if (programReentrant(lw, routineCallee(lw, routine), programTarget(place)) !== undefined)
      return lw.bail("call-program-reentrant", `${sym.owner.name}'s FB_Init may reach the PROGRAM its instance lives in, which it runs moved out of`, span) ?? false
    mine.push({ kind: "eval", value: { kind: "invoke", routine: routine.key, instance: place, inputs, inouts: [], type: UNKNOWN, span }, span })
  }
  if (typeof init === "object" && "fields" in init) {
    const fields = lw.layouts.get(t.name.toUpperCase())?.fields ?? []
    for (const [name, value] of Object.entries(init.fields)) {
      const field = fieldIn(fields, name)
      if (field === undefined || typeof value === "object")
        return lw.bail("fb-init-order", `${t.name} declared with FB_Init arguments and a nested structured initializer — applied after FB_Init, not modelled`, span) ?? false
      st.reapplied.push({ kind: "assign", target: { ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }, value: { kind: "const", value, type: field.type, span }, span })
    }
    clearInit()
  }
  return true
}

/** One FB_Init input: `bInitRetains` TRUE, `bInCopyCode` FALSE, a declared argument that folds, or a variable the
 *  recordings cover — `false` (the refusal reported) when none applies. */
function fbInitInput(st: InitStep, place: Place, t: Fb, slot: IrSlot, given: ReadonlyMap<string, Expr>, args: readonly CallArg[], declaring: Lowering, holder: Place | undefined): IrExpr | false {
  const { lw, span } = st
  const name = slot.name.toUpperCase()
  const expr = given.get(name)
  const folded = name === "BINITRETAINS" ? true : name === "BINCOPYCODE" ? false : expr === undefined ? undefined : foldConstant(declaring, expr)
  let input: IrExpr | undefined = folded === undefined ? undefined : { kind: "const", value: stored(valueAs(folded, slot.type), slot.type), type: slot.type, span }
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
  const last = place.path.at(-1)
  if (input === undefined && expr !== undefined && holder?.type.kind === "function_block" && last?.kind === "field" && lw.bodies.get(holder.type.name.toUpperCase())?.lowering === declaring) {
    const read = recordedArgument(st, expr, fieldIndex(declaring.slots, last.name), declaring, holder)
    if (read !== undefined) input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
  }
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
  if (input === undefined && args.length === 0 && rootsOwn)
    return (
      lw.bail(
        "fb-init-root",
        `${t.name}'s FB_Init input ${slot.name} has no argument in the instance the HARNESS declares — ` +
          "lowering a POU on its own synthesizes a bare declaration, and the vendor never sees it",
        span,
      ) ?? false
    )
  if (input === undefined)
    return (
      lw.bail(
        "fb-init-argument",
        `${t.name}'s FB_Init input ${slot.name} is given nothing lowering can pass` +
          (args.length === 0 ? " — it is declared with no argument at all, which the vendor refuses too" : ""),
        span,
      ) ?? false
    )
  return input
}

/**
 * The instances inside one (field by field, recursively), with the type's own field initializers interleaved — then the
 * instance's own FB_Init calls (`mine`), after those of the instances inside it (`fb_init_nested_in_fb_init`: the outer's
 * saw 5) — all into `st.fbInitCalls`.
 */
function visitFields(st: InitStep, place: Place, t: Fb | Extract<Type, { kind: "struct" }>, inits: readonly Symbol[], declaring: Lowering, mine: readonly IrStmt[]): boolean {
  const { lw, span, fbInitCalls } = st
  const owner = lookup(lw.project, t.name)?.symbol.ast as TopLevel | undefined
  const nested = lw.bodies.get(t.name.toUpperCase())?.lowering ?? declaring
  // THE INSTANCE'S OWN FIELD INITIALIZERS, run HERE rather than baked into the layout — measured per instance and
  // in declaration order (`declarations/init-sequence.ts`). Lowered once per FB TYPE into an implicit routine,
  // because a routine is already the thing that runs a body on an instance; `invoke` binds this one.
  //
  // FUNCTION BLOCKS ONLY, and the whole EXTENDS chain, BASE FIRST. Both halves were wrong and both were silent:
  //   - a STRUCT has no entry in `lw.bodies`, so a `?? declaring` fallback handed this the DECLARING POU's
  //     lowering and built `STRUCT.__INIT` out of the POU's own pending inits, whose slot indices index the POU's
  //     frame. It wrote into an unrelated struct field, ran the statement twice, and where the index was out of
  //     range it threw out of the interpreter;
  //   - a DERIVED FB got only its own, so a base's `p : POINTER TO INT := ADR(m)` left `d.p` at 0 with no
  //     diagnostic — the exact "silently started at its default" failure `init-not-constant` exists to prevent.
  // The base's statements are valid on a derived instance because `inherit` pushes the base's fields FIRST, at the
  // same indices they have in the base's own frame.
  //
  // BEFORE the instance's FB_Init (transpile-review 22): CODESYS completes the implicit initialization first — FB_Init
  // dereferences an `ADR(m)` field and reads a call-initialized one (`tr_22_fb_init_reads_adr_field`,
  // `tr_22_fb_init_reads_call_field`: seen = 7), and its own write is not undone. Whether a DERIVED type's initializers
  // run before its BASE's FB_Init is not recorded: refused.
  //
  // INTERLEAVED with the instances inside it, by declaration (transpile-review 23): a field running FB_Init does so at
  // its own position, so the initializers declared before it have run and those after it have not
  // (`tr_23_fb_init_argument_from_pending_init{,_reversed}`: 4, 0). The sequence is split there, one routine per part.
  const chain = t.kind === "function_block" ? chainNamesOf(t) : []
  // the depth of the most basic FB_Init in the chain — a type below it initializes after a base's FB_Init could run
  const firstFbInit = Math.min(...inits.map((sym) => chain.findIndex((name) => name.toUpperCase() === sym.owner.name.toUpperCase())))
  const initialized = chain.filter((type) => pendingInitsOf(lw, type) > 0)
  const below = initialized.find((type) => chain.indexOf(type) > firstFbInit)
  if (below !== undefined) return lw.bail("fb-init-order", `${below}'s field initializers and a base's FB_Init — which runs first is not recorded`, span) ?? false
  const ordered: IrStmt[] = []
  const run = { from: 0 }
  const layoutFields = (lw.layouts.get(t.name.toUpperCase())?.fields ?? []) as IrSlot[]
  // every instance of the layout sees its initializers as declared: the first one's clearInit emptied them for the next,
  // which then started from 0 where the 9 is re-applied (review of the fixture batch)
  const declared = st.declaredInits.get(t.name.toUpperCase()) ?? layoutFields.map((f) => f.init)
  st.declaredInits.set(t.name.toUpperCase(), declared)
  for (const [i, field] of [...layoutFields].entries()) {
    const clear = () => void (layoutFields[i] = { ...layoutFields[i]!, init: typeZero(field.type) })
    const start = fbInitCalls.length
    if (!visit(st, { ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }, declaredArgs(lw, owner, field.name), nested, declared[i]!, clear, place)) return false
    const inside = fbInitCalls.splice(start)
    if (inside.length === 0) continue
    if (!initializeUpTo(st, place, initialized, run, ordered, i + 1)) return false
    ordered.push(...inside)
  }
  if (!initializeUpTo(st, place, initialized, run, ordered, Number.POSITIVE_INFINITY)) return false
  // an instance's own FB_Init runs after those of the instances inside it (`fb_init_nested_in_fb_init`: the outer's saw 5)
  fbInitCalls.push(...ordered, ...mine)
  return true
}

/** The initializers of the fields from `run.from` up to `to`, each type's part run on the instance (into `ordered`). */
function initializeUpTo(st: InitStep, place: Place, initialized: readonly string[], run: { from: number }, ordered: IrStmt[], to: number): boolean {
  for (const type of initialized) {
    const routine = instanceInitRoutine(st.lw, type, run.from, to)
    if (routine === null) return false
    if (routine !== undefined) ordered.push({ kind: "eval", value: { kind: "invoke", routine, instance: place, inputs: [], inouts: [], type: UNKNOWN, span: st.span }, span: st.span })
  }
  run.from = to
  return true
}
