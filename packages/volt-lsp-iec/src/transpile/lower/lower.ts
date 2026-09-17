/**
 * AST → IR. The ONLY place ST semantics are decided; every backend downstream is a printer.
 *
 * Lowering is **total**: it never throws. A construct it cannot represent becomes a `LowerDiagnostic` with a
 * stable code and the POU lowers to nothing — so an untestable POU is reported, never silently wrong, and
 * `scripts/lower-completeness.ts` can count exactly what blocks the corpus.
 *
 * Its input is code CODESYS COMPILES (the contract in `../index.ts`): a rule here exists for valid programs only.
 *
 * It resolves names and types by CONSUMING the frontend, never by re-deriving:
 *   names   → `symbols/` (`lookup`) decides what an identifier IS; lowering decides only where it lives
 *   types   → `types/` (`resolveTypeExpr`, `inferExprType`) — the IR carries the resulting `Type` itself
 *   consts  → `types/` (`constEval`) folds initializers and CASE labels
 *   IEC facts → `types/elementary` (bits · signed · family · rank), the source of truth a backend maps from
 *
 * One file per concern, each a set of `function f(lw: Lowering, …)` over the frame being built:
 *   lower.ts        the entry points (this file)
 *   lowering.ts     the shared state and the `Lowering` frame — bail, slots, temps, type resolution
 *   storage.ts      a type's storage and layout; declarations          constants.ts  literals, enums, folding
 *   places.ts       where a name, field, element or bit lives          convert.ts    conversion nodes
 *   expressions.ts  operators and their promotion                      builtins.ts   value functions, strings
 *   statements.ts   assignment, IF, CASE, loops                        calls.ts      FB bodies, routines, in-outs
 *   pointers.ts     POINTER / REFERENCE (design §9 form 1)             bytes.ts      SIZEOF, ADR differences
 */
import {
  type CallArg,
  declarationAttributes,
  type Expr,
  isGraphicalBody,
  memberAttributes,
  parseSource,
  parseActive,
  type Span,
  type TopLevel,
  unitAttributes,
} from "../../syntax/index.js"
import { buildSymbolTable, lookup, lookupMember, parseLibraryManifest, type Scope, scopeForUnit, type Symbol, isLibrarySymbol } from "../../symbols/index.js"
import { convert, stored, valueAs } from "./convert.js"
import { foldConstant } from "./constants.js"
import { lowerPlace } from "./places.js"
import { resolveNamedType, type Type, UNKNOWN } from "../../types/index.js"
import { defaultValueOf, holdsCall, type IrExpr, type IrInit, type IrPou, type IrRoutine, type IrSlot, type IrStmt, type LoweredPou, peelArray, type Place, lowerDiagnostic } from "../ir/index.js"
import { baseOf, Lowering, newShared, openDims } from "./lowering.js"
import { declareVars, storageOf, tempResets } from "./storage.js"
import { lowerBlock } from "./statements.js"
import { calledLayout, calledRoutine, programReentrant } from "./calls.js"
import { finishInterfaces } from "./interfaces.js"

/** A type a backend can store: elementary, a laid-out struct or FB instance, or a sized array of those. */
function representable(t: Type): boolean {
  // a pointer or reference holds its one target's index (design §9 form 1) — a plain integer in both backends
  // an interface holds its instance's tag (design §22) — a plain integer too
  if (t.kind === "elementary" || t.kind === "struct" || t.kind === "function_block" || t.kind === "pointer" || t.kind === "reference" || t.kind === "interface") return true
  // an `ARRAY[*]` — only ever a VAR_IN_OUT — is the array its call lends: a Rust slice (design §26)
  if (openDims(t) > 0) return representable((t as Extract<Type, { kind: "array" }>).element)
  const array = peelArray(t)
  return array !== undefined && representable(array.element)
}

/** Lower one already-bound unit. The workspace path: the caller owns the project scope and its index. */
export function lowerUnit(
  unit: TopLevel,
  scope: Scope,
  project: Scope,
  /** Each POU's `{attribute '…'}` names (`syntax/unitAttributes`), for the ones lowering must refuse. */
  attributes: ReadonlyMap<object, ReadonlySet<string>> = new Map(),
  /** The units that came from LIBRARY files — a bodyless one of these is refused (`isBodylessLibrary`). */
  libraryUnits: ReadonlySet<object> = new Set(),
): LoweredPou {
  if (unit.kind !== "program" && unit.kind !== "function_block")
    return { diagnostics: [lowerDiagnostic("unit-kind", `${unit.kind} is not lowered yet`, unit.span)] }

  // A graphical body holds no statements, so `parseActive` returns an empty list rather than an error —
  // which would lower to a POU that "succeeds" and does nothing. Refuse it explicitly; FBD/LD reach the
  // backend through network text, not through here.
  if (isGraphicalBody(unit.body))
    return { diagnostics: [lowerDiagnostic("graphical-body", "a graphical body is not lowered here", unit.span)] }

  const lowering = new Lowering(scope, project, newShared(attributes, unit.name.text, libraryUnits))
  lowering.isRoot = true
  lowering.displayName = unit.name.text
  lowering.frameContext = `POU:${unit.name.text.toUpperCase()}`
  let body: IrStmt[]
  // A PROGRAM with METHODs, ACTIONs or PROPERTIES runs them on its one instance (conformance `fbcall_program_own_members`),
  // so it lowers as one, as an FB does — its bare `M()` was `call-this`, having no instance to run on. Others keep their
  // slots. A PROPERTY counts for exactly the reason a METHOD does: its accessor is a routine that runs on the instance.
  // Leaving it out meant a PROGRAM whose ONLY own member is a property was not an instance, and reading that property
  // from its body reported `place-not-local` — while adding any METHOD beside it made the same program lower.
  const ownMembers =
    unit.kind === "program" &&
    [...scope.symbols.values()].flat().some((s) => s.kind === "method" || s.kind === "action" || s.kind === "property")
  const asInstance = unit.kind === "function_block" || ownMembers
  if (asInstance) body = rootInstance(lowering, unit)
  else {
    // A PROGRAM's VAR_IN_OUT is the caller's variable — and a root has no caller, so the harness owns it, as a root FB's
    // in-outs are owned beside its instance (`rootInstance`). `declareVars` gives it an ordinary slot. Only an `ARRAY[*]`
    // stays refused: its size comes from the caller's array, and there is none.
    const open = unit.varSections
      .filter((s) => s.sectionKind === "VAR_IN_OUT")
      .flatMap((s) => s.decls)
      .find((d) => openDims(lowering.resolve(d.type)) > 0)
    if (open !== undefined)
      return {
        diagnostics: [
          lowerDiagnostic(
            "root-inout",
            `${unit.name.text} has the ARRAY[*] VAR_IN_OUT ${open.names.map((n) => n.text).join(", ")}, whose size only a caller's array gives`,
            open.span,
          ),
        ],
      }
    declareVars(lowering, unit.varSections)
    const parsed = parseActive(unit.body)
    if (!parsed.ok)
      return { diagnostics: [lowerDiagnostic("parse", parsed.firstError ?? "body did not parse", unit.span)] }
    // its VAR_TEMP starts over on every scan (conformance `life_program_var_temp_runs`)
    body = [...(tempResets(lowering, unit.varSections, unit.span) ?? []), ...lowerBlock(lowering, parsed.statements)]
  }
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  const init = initStep(lowering, unit.span)
  // every store into an interface has lowered by now: each call through one gets its instances (`interfaces.ts`)
  finishInterfaces(lowering, [...body, ...(init ?? [])])
  if (init === undefined || lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  // Every construct lowered — but every SLOT (and every field of a layout) also needs a runtime representation. An unused
  // `p : POINTER TO INT` lowered cleanly, then the Rust emitter threw on its type: a backend must accept whatever lowering
  // accepts (transpiler review 2026-09-14). Checked only here, so a POU another construct blocks keeps that blocker's
  // category in the coverage report.
  const layouts = [...lowering.layouts.values()]
  const routines = [...lowering.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine] : []))
  const sharedAddress = addressSharedByInstances(lowering, [...lowering.frame, ...lowering.globals, ...routines.flatMap((r) => r.locals)])
  if (sharedAddress !== undefined)
    return { diagnostics: [lowerDiagnostic("var-at-instances", `${sharedAddress} binds a variable AT an address and has several instances, which would share it`, unit.span)] }
  const unrepresentable = [
    ...lowering.frame,
    ...layouts.flatMap((l) => [...l.fields, ...(l.inouts ?? [])]),
    ...routines.flatMap((r) => [...r.locals, ...r.inouts]),
    ...lowering.globals,
  ].find((s) => !representable(s.type))
  if (unrepresentable !== undefined) {
    const kind = unrepresentable.type.kind
    return { diagnostics: [lowerDiagnostic(`slot-${kind}`, `${unrepresentable.name} is a ${kind} variable, which has no runtime representation yet`, unit.span)] }
  }

  // an FB's own struct already carries its name, so the POU that holds one instance of it is named apart
  const name = asInstance ? `${unit.name.text}__root` : unit.name.text
  const pou: IrPou = { name, slots: lowering.frame, body, layouts, routines, globals: lowering.globals, ...(init.length > 0 ? { init } : {}), span: unit.span }
  return { pou, diagnostics: [] }
}

/**
 * An FB whose own or inherited field is bound AT an address, and of which the POU holds more than one instance — each one
 * would be storage of its own, where the address is one place (review 2026-09-15). Instances are counted through fields,
 * arrays (by length), globals and routine locals; an instance of a derived FB counts for each of its bases.
 */
function addressSharedByInstances(lw: Lowering, slots: readonly { type: Type }[]): string | undefined {
  const addressed = new Set(lw.shared.addressed.filter((a) => a.owner.startsWith("FB:")).map((a) => a.owner.slice(3)))
  if (addressed.size === 0) return undefined
  const count = new Map<string, number>()
  const walk = (t: Type, times: number): void => {
    const array = peelArray(t)
    if (array !== undefined) return walk(array.element, times * array.length)
    if (t.kind !== "struct" && t.kind !== "function_block") return
    const key = t.name.toUpperCase()
    for (let unit = lw.bodies.get(key)?.unit; unit !== undefined; ) {
      const name = unit.name.text.toUpperCase()
      count.set(name, (count.get(name) ?? 0) + times)
      const base = baseOf(unit)
      unit = base === undefined ? undefined : lw.bodies.get(base.text.toUpperCase())?.unit
    }
    for (const field of lw.layouts.get(key)?.fields ?? []) walk(field.type, times)
  }
  for (const slot of slots) walk(slot.type, 1)
  return [...addressed].find((fb) => (count.get(fb) ?? 0) > 1)
}

const INIT_ATTRIBUTE = "call_after_global_init_slot"

/**
 * The init step: each instance's `call_after_global_init_slot` METHOD, run once before the first scan (conformance
 * `state_call_after_global_init_counts` — once per instance, however many scans follow). Instances are found through the
 * frame, nested instances and struct fields included, and the method is resolved by the instance's own type. One the walk
 * does not reach — an array element, a global, a routine's local — is refused: whether and when it would run is not
 * measured. Neither is the order between instances; the frame's is taken, as no recorded case can tell them apart.
 */
function initStep(lw: Lowering, span: Span): IrStmt[] | undefined {
  type Fb = Extract<Type, { kind: "function_block" }>
  const initMethod = (fb: Fb) => {
    for (let s = fb.scope; s !== undefined; s = s.baseScope)
      for (const list of s.symbols.values())
        for (const sym of list)
          if (sym.kind === "method" && lw.attributes.get(sym.ast as TopLevel)?.has(INIT_ATTRIBUTE)) return lookupMember(fb.scope!, sym.name)
    return undefined
  }
  // {attribute 'instance-path'} (user decision 2026-09-15): the STRING holds the instance's path from the project tree —
  // the device folder (before `Plc Logic`), the application folder (after it), then the instance hierarchy from the POU.
  // The simulator's own reads `Device.Sim.Device.Application…`, a segment the tree does not hold.
  const root = lookup(lw.project, lw.shared.root)?.symbol
  const tree = (root?.uri ?? "").split(/[\\/]/)
  const logic = tree.findIndex((segment) => segment.toLowerCase() === "plc logic")
  const application = logic > 0 && logic + 2 < tree.length ? `${tree[logic - 1]}.${tree[logic + 1]}` : undefined
  const pathFields = (fb: Fb): string[] => {
    const names: string[] = []
    for (let unit = lw.bodies.get(fb.name.toUpperCase())?.unit; unit !== undefined; ) {
      for (const section of unit.varSections)
        for (const decl of section.decls) if (lw.attributes.get(decl)?.has("instance-path")) names.push(...decl.names.map((n) => n.text))
      const base = unit.kind === "function_block" ? unit.extends : undefined
      unit = base === undefined ? undefined : lw.bodies.get(base.text.toUpperCase())?.unit
    }
    return names
  }
  // FB_Init (conformance `fb_init_runs_with_declared_arguments`, `fb_init_base_and_derived`): once per instance before the
  // first cycle, after the fields' own initial values (35, not 5), with bInitRetains TRUE and bInCopyCode FALSE at a cold
  // start and the arguments the instance is declared with — every FB_Init of the EXTENDS chain, the base's first (order
  // 12). It was an ordinary METHOD nothing called, so every instance started as if it had none, with no diagnostic.
  const fbInits = (fb: Fb): Symbol[] => {
    const chain: Symbol[] = []
    for (let s = fb.scope; s !== undefined; s = s.baseScope) {
      const own = (s.symbols.get("fb_init") ?? []).find((sym) => sym.kind === "method" && sym.owner === s)
      if (own !== undefined) chain.unshift(own)
    }
    return chain
  }
  // whether a value of `t` holds, at any depth, an instance running FB_Init
  const fbInitHeld = new Map<string, boolean>()
  const holdsFbInit = (t: Type): boolean => {
    const array = peelArray(t)
    if (array !== undefined) return holdsFbInit(array.element)
    if (t.kind !== "function_block" && t.kind !== "struct") return false
    const key = t.name.toUpperCase()
    if (fbInitHeld.has(key)) return fbInitHeld.get(key)!
    fbInitHeld.set(key, false)
    const result = (t.kind === "function_block" && fbInits(t).length > 0) || (lw.layouts.get(key)?.fields ?? []).some((f) => holdsFbInit(f.type))
    fbInitHeld.set(key, result)
    return result
  }
  // What the recordings cover as a variable FB_Init argument (`fb_init_argument_from_variable`, `_from_global`): a plain
  // elementary variable whose initial value arrives — the POU's own VAR or VAR_INPUT declared before the instance, or a
  // global. The review of that batch found the rest accepted unrecorded — a struct field's declaration read in the POU's
  // scope, a later or VAR_TEMP variable, an instance's field, a global an FB_Init writes (checked after the walk).
  const globalArguments = new Set<number>()
  // A PROGRAM with METHODs or ACTIONs lowers as its one instance (`rootInstance`): the frame's slot that IS the program.
  const ownProgram = (place: Place): boolean => {
    // ...or a PROGRAM this POU calls: its one instance among the globals
    if (place.root === "global") return lw.globals[place.slot]?.section === "program"
    const slot = lw.frame[place.slot]
    return place.root === undefined && root?.kind === "program" && slot?.type.kind === "function_block" && slot.type.name.toUpperCase() === root.name.toUpperCase()
  }
  /** `declaring` lowers the argument where the instance is declared; `holder`, in a PROGRAM lowered as its instance, is that
   *  instance — the variable read is then its field (review: the recorded case was refused once the program had a METHOD). */
  const recordedArgument = (expr: Expr, instanceSlot: number, declaring: Lowering = lw, holder?: Place): Place | undefined => {
    if (expr.kind !== "ident_expr") return undefined
    const read = lowerPlace(declaring, expr)
    if (read === undefined || read.path.length > 0 || read.type.kind !== "elementary") return undefined
    if (read.root === undefined) {
      const declared = declaring.frame[read.slot]
      if (!(read.slot < instanceSlot && (declared?.section === "VAR" || declared?.section === "VAR_INPUT"))) return undefined
      return holder === undefined ? read : { ...holder, path: [{ kind: "field", name: declared!.name }], type: read.type }
    }
    if (read.root !== "global" || lw.globals[read.slot]?.section === "program") return undefined
    globalArguments.add(read.slot)
    return read
  }
  // whether init statements write a global, through any routine or FB body they call
  const writesGlobal = (node: unknown, seen: Set<string> = new Set()): boolean => {
    if (node === null || typeof node !== "object") return false
    if (Array.isArray(node)) return node.some((n) => writesGlobal(n, seen))
    const n = node as { kind?: string; target?: Place; routine?: string; fb?: string }
    if (n.kind === "assign" && n.target?.root === "global") return true
    if (n.kind === "invoke" && n.routine !== undefined && !seen.has(n.routine)) {
      seen.add(n.routine)
      const called = lw.routines.get(n.routine)
      if (called?.state === "lowered" && writesGlobal(called.routine.body, seen)) return true
    }
    if (n.kind === "call" && n.fb !== undefined && !seen.has(`FB:${n.fb}`)) {
      seen.add(`FB:${n.fb}`)
      if (writesGlobal(lw.layouts.get(n.fb.toUpperCase())?.body, seen)) return true
    }
    return Object.entries(node).some(([key, child]) => key !== "span" && key !== "type" && writesGlobal(child, seen))
  }
  // the FB_Init arguments a field is declared with, by the unit (or struct) declaring it — its base FBs' too
  const declaredArgs = (owner: TopLevel | undefined, name: string): readonly CallArg[] => {
    for (let unit = owner; unit !== undefined; ) {
      const decls =
        unit.kind === "function_block" || unit.kind === "program" ? unit.varSections.flatMap((s) => s.decls)
        : unit.kind === "type_decl" && unit.body.kind === "struct" ? unit.body.fields
        : []
      const decl = decls.find((d) => d.names.some((n) => n.text.toUpperCase() === name.toUpperCase()))
      if (decl !== undefined) return decl.type.kind === "named_type" ? (decl.type.initArgs ?? []) : []
      const base = unit.kind === "function_block" ? unit.extends : undefined
      unit = base === undefined ? undefined : lookup(lw.project, base.text)?.symbol.ast as TopLevel | undefined
    }
    return []
  }
  const known = new Map<string, boolean>()
  const reaches = (t: Type): boolean => {
    const array = peelArray(t)
    if (array !== undefined) return reaches(array.element)
    if (t.kind !== "function_block" && t.kind !== "struct") return false
    const key = t.name.toUpperCase()
    if (known.has(key)) return known.get(key)!
    known.set(key, false)
    const own = t.kind === "function_block" && (initMethod(t) !== undefined || pathFields(t).length > 0 || fbInits(t).length > 0)
    const result = own || (lw.layouts.get(key)?.fields ?? []).some((f) => reaches(f.type))
    known.set(key, result)
    return result
  }
  const unreached = (where: string): undefined =>
    lw.bail("attr-init-unreached", `an instance with a ${INIT_ATTRIBUTE} method or an instance-path in ${where}, which the init step does not reach`, span)
  const out: IrStmt[] = []
  // Recorded (`fb_init_before_slot_method_nested`: 5, `fb_init_before_slot_method_sibling`: 7): every FB_Init runs before
  // any call_after_global_init_slot method, a holder's and a sibling's declared earlier alike; and a structured
  // initializer on an instance running FB_Init applies AFTER it (`fb_init_and_structured_initializer`: FB_Init saw 0, the
  // 9 stayed). They were interleaved per instance, in declaration order, the initializer first — an order no recording
  // showed (review of the FB_Init batch). So: the FB_Init calls, then those initializers, then the slot methods.
  const fbInitCalls: IrStmt[] = []
  const reapplied: IrStmt[] = []
  const slotCalls: IrStmt[] = []
  const declaredInits = new Map<string, IrInit[]>()
  /** `args`: the FB_Init arguments the place is declared with, lowered in `declaring`; `init` / `clearInit`: the declaring
   *  slot's initial value, and a way to take a structured initializer out of it — to be applied after FB_Init instead. */
  const visit = (place: Place, args: readonly CallArg[], declaring: Lowering, init: IrInit, clearInit: () => void): boolean => {
    const t = place.type
    if (!reaches(t)) return true
    if (peelArray(t) !== undefined) return unreached("an array") ?? false
    if (t.kind !== "function_block" && t.kind !== "struct") return true
    // A PROGRAM's own FB_Init leaves its variables as they were (`fb_init_program_own`: 1) — whether it runs at all, before
    // their initial values, is not recorded, so one that calls anything or writes a global is refused. Its init-slot METHOD
    // runs (`init_slot_program_own`: 101), as an FB's does.
    const program = t.kind === "function_block" && place.path.length === 0 && ownProgram(place)
    if (program)
      for (const sym of fbInits(t)) {
        const routine: IrRoutine | undefined = calledRoutine(lw, sym, t, span)
        if (routine === undefined) return false
        if (holdsCall(routine.body) || writesGlobal(routine.body))
          return lw.bail("fb-init-program", `${t.name} is a PROGRAM whose FB_Init calls or writes beyond its own variables — whether it runs is not recorded`, span) ?? false
      }
    const inits = t.kind === "function_block" && !program ? fbInits(t) : []
    const mine: IrStmt[] = []
    if (t.kind === "function_block" && inits.length > 0) {
      // Inner first is recorded for a holder with no EXTENDS (`fb_init_nested_in_fb_init`). With a base chain, whether a
      // field's FB_Init runs before the base's or the derived's is not — the review of that batch found it guessed.
      if (t.scope?.baseScope !== undefined && (lw.layouts.get(t.name.toUpperCase())?.fields ?? []).some((f) => holdsFbInit(f.type)))
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
          const slot = routine.locals[index]!
          const name = slot.name.toUpperCase()
          const expr = given.get(name)
          const folded = name === "BINITRETAINS" ? true : name === "BINCOPYCODE" ? false : expr === undefined ? undefined : foldConstant(declaring, expr)
          let input: IrExpr | undefined = folded === undefined ? undefined : { kind: "const", value: stored(valueAs(folded, slot.type), slot.type), type: slot.type, span }
          // A variable gives its value when FB_Init runs — its initial value, recorded (`fb_init_argument_from_variable`: 4,
          // `fb_init_argument_from_global`: 6). Only in a declaration of the POU's own, where the name means the same place
          // in the init step; inside an FB it names that FB's field. An interface would need its instances tracked.
          if (input === undefined && expr !== undefined && declaring === lw && place.path.length === 0) {
            const read = recordedArgument(expr, place.slot)
            if (read !== undefined) input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
          }
          const held = place.path[0]
          if (input === undefined && expr !== undefined && place.path.length === 1 && held?.kind === "field" && ownProgram(place)) {
            const holder: Place = { ...place, path: [], type: (place.root === "global" ? lw.globals : lw.frame)[place.slot]!.type }
            const read = recordedArgument(expr, declaring.frame.findIndex((f) => f.name.toUpperCase() === held.name.toUpperCase()), declaring, holder)
            if (read !== undefined) input = convert({ kind: "load", place: read, type: read.type, span }, slot.type)
          }
          if (input === undefined) return lw.bail("fb-init-argument", `${t.name}'s FB_Init input ${slot.name} is given nothing lowering can pass`, span) ?? false
          inputs.push(input)
        }
        if (programReentrant(lw, routine, place))
          return lw.bail("call-program-reentrant", `${sym.owner.name}'s FB_Init may reach the PROGRAM its instance lives in, which it runs moved out of`, span) ?? false
        mine.push({ kind: "eval", value: { kind: "invoke", routine: routine.key, instance: place, inputs, inouts: [], type: UNKNOWN, span }, span })
      }
      if (typeof init === "object" && "fields" in init) {
        const fields = lw.layouts.get(t.name.toUpperCase())?.fields ?? []
        for (const [name, value] of Object.entries(init.fields)) {
          const field = fields.find((f) => f.name.toUpperCase() === name)
          if (field === undefined || typeof value === "object")
            return lw.bail("fb-init-order", `${t.name} declared with FB_Init arguments and a nested structured initializer — applied after FB_Init, not modelled`, span) ?? false
          reapplied.push({ kind: "assign", target: { ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }, value: { kind: "const", value, type: field.type, span }, span })
        }
        clearInit()
      }
    }
    const paths = t.kind === "function_block" ? pathFields(t) : []
    if (paths.length > 0) {
      if (application === undefined) return lw.bail("attr-instance-path", `${t.name}'s instance-path needs the project tree (Device/Plc Logic/Application), which this source is not in`, span) ?? false
      if (root?.kind !== "program") return lw.bail("attr-instance-path", `an FB lowered on its own has no instance path`, span) ?? false
      // The program the instance lives in, then its path: the root's own slot; a PROGRAM lowered as its one instance, whose
      // slot IS the program (review); or a PROGRAM this POU calls, its instance among the globals.
      const top = place.root === "global" ? [lw.globals[place.slot]!.name] : ownProgram(place) ? [root.name] : [root.name, lw.frame[place.slot]!.name]
      const text = [application, ...top, ...place.path.flatMap((step) => (step.kind === "field" ? [step.name] : []))].join(".")
      for (const name of paths) {
        const field = lw.layouts.get(t.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === name.toUpperCase())
        if (field === undefined || field.type.kind !== "elementary" || field.type.elem.family !== "string")
          return lw.bail("attr-instance-path", `${name} carries instance-path but is not a STRING`, span) ?? false
        const target: Place = { ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }
        out.push({ kind: "assign", target, value: { kind: "const", value: stored(text, field.type), type: field.type, span }, span })
      }
    }
    const sym = t.kind === "function_block" ? initMethod(t) : undefined
    if (t.kind === "function_block" && sym !== undefined) {
      const routine: IrRoutine | undefined = calledRoutine(lw, sym, t, span)
      if (routine === undefined) return false
      if (routine.inputs.length > 0 || routine.inouts.length > 0) return lw.bail("attr-init-inputs", `${sym.name} takes arguments`, span) ?? false
      if (programReentrant(lw, routine, place))
        return lw.bail("call-program-reentrant", `${sym.name} may reach the PROGRAM its instance lives in, which it runs moved out of`, span) ?? false
      slotCalls.push({ kind: "eval", value: { kind: "invoke", routine: routine.key, instance: place, inputs: [], inouts: [], type: UNKNOWN, span }, span })
    }
    const owner = lookup(lw.project, t.name)?.symbol.ast as TopLevel | undefined
    const nested = lw.bodies.get(t.name.toUpperCase())?.lowering ?? declaring
    const layoutFields = (lw.layouts.get(t.name.toUpperCase())?.fields ?? []) as IrSlot[]
    // every instance of the layout sees its initializers as declared: the first one's clearInit emptied them for the next,
    // which then started from 0 where the 9 is re-applied (review of the fixture batch)
    const declared = declaredInits.get(t.name.toUpperCase()) ?? layoutFields.map((f) => f.init)
    declaredInits.set(t.name.toUpperCase(), declared)
    for (const [i, field] of [...layoutFields].entries()) {
      const clear = () => void (layoutFields[i] = { ...layoutFields[i]!, init: defaultValueOf(field.type) })
      if (!visit({ ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }, declaredArgs(owner, field.name), nested, declared[i]!, clear)) return false
    }
    // an instance's own FB_Init runs after those of the instances inside it (`fb_init_nested_in_fb_init`: the outer's saw 5)
    fbInitCalls.push(...mine)
    return true
  }
  const frame = lw.frame as IrSlot[]
  for (const [slot, frameSlot] of [...frame].entries()) {
    const clear = () => void (frame[slot] = { ...frame[slot]!, init: defaultValueOf(frameSlot.type) })
    if (!visit({ slot, path: [], type: frameSlot.type, span }, declaredArgs(root?.ast as TopLevel | undefined, frameSlot.name), lw, frameSlot.init, clear)) return undefined
  }
  // A PROGRAM this POU calls is an instance among the globals, visited as the frame's slots are — its FB_Init arguments, an
  // instance-path, an init-slot METHOD. They were `attr-init-unreached` (`fb_init_argument_in_program_with_method`: 4,
  // `init_slot_program_own`: 101). Any other global reaching one still is.
  const globals = lw.globals as IrSlot[]
  // by index: visiting one program can lower a METHOD that reaches another for the first time (review — it was skipped)
  for (let slot = 0; slot < globals.length; slot++) {
    const global = globals[slot]!
    if (global.section !== "program") continue
    const clear = () => void (globals[slot] = { ...globals[slot]!, init: defaultValueOf(global.type) })
    if (!visit({ slot, path: [], type: global.type, span, root: "global" }, [], lw, global.init, clear)) return undefined
  }
  if (lw.globals.some((g) => g.section !== "program" && reaches(g.type))) return unreached("the globals")
  for (const r of lw.routines.values()) if (r.state === "lowered" && r.routine.locals.some((l) => reaches(l.type))) return unreached(`${r.routine.name}'s locals`)
  // a global an FB_Init argument reads while an FB_Init of this init step writes globals: which value arrives is not recorded
  if (globalArguments.size > 0 && writesGlobal(fbInitCalls))
    return lw.bail("fb-init-argument", "an FB_Init argument reads a global while an FB_Init writes globals — which value arrives is not recorded", span)
  return [...out, ...fbInitCalls, ...reapplied, ...slotCalls]
}

/**
 * An FB lowered on its own runs as what it only ever is — an instance: the POU holds one, named as the FB, and each scan
 * calls it. Its body then sees THIS^, its bases' fields, SUPER^ and its own methods exactly as a called instance's does
 * (phase 3½). It was lowered as if it were a PROGRAM, where none of those exist, so every derived FB the corpus holds
 * stopped at its `SUPER^()` (128 of them).
 *
 * Its VAR_IN_OUT is the CALLER's variable, and a root has no caller — so the harness is the caller: one variable per
 * in-out, owned by the POU frame beside the instance and bound to every scan's call. That is the same binding a real
 * caller makes (the recorded semantics are unchanged: the callee reads and writes the caller's storage), and it is what
 * a test needs — write the variable, run a scan, read it back. An `ARRAY[*]` has no size to own, so it stays refused.
 */
function rootInstance(lw: Lowering, unit: Extract<TopLevel, { kind: "function_block" | "program" }>): IrStmt[] {
  const type = storageOf(lw, resolveNamedType(unit.name.text, lw.project))
  // A POU THAT SUCCEEDS AND DOES NOTHING IS THE ONE OUTCOME THIS FILE REFUSES EVERYWHERE ELSE. An empty body was
  // returned with no diagnostic when the unit resolved to something that is not an FB — which cannot happen for a
  // PROGRAM or FUNCTION_BLOCK that bound, so it is a lowering bug, and it was reported as a clean run.
  // `calledLayout` bails for itself; only the non-FB arm was silent.
  if (type.kind !== "function_block") {
    lw.bail("root-type", `${unit.name.text} resolves to a ${type.kind}, not a function block lowering can instance`, unit.span)
    return []
  }
  const layout = calledLayout(lw, type.name, unit.span)
  if (layout === undefined) return []
  const open = (layout.inouts ?? []).find((s) => openDims(s.type) > 0)
  if (open !== undefined) {
    lw.bail("root-inout", `${unit.name.text} has the ARRAY[*] VAR_IN_OUT ${open.name}, whose size only a caller's array gives`, unit.span)
    return []
  }
  const inouts: Place[] = (layout.inouts ?? []).map((slot) => {
    lw.slot({ ...unit.name, text: slot.name }, slot.type, "VAR")
    return { slot: lw.frame.length - 1, path: [], type: slot.type, span: unit.span }
  })
  lw.slot(unit.name, type, "VAR")
  return [{ kind: "call", instance: { slot: lw.frame.length - 1, path: [], type, span: unit.span }, fb: layout.name, inouts, span: unit.span }]
}

/** A referenced library's materialized declaration file — `uri` must keep its `Library Manager/<library>/` path. */
export interface LibraryFile {
  uri: string
  source: string
}

/** Parse, bind and lower one source string, against the library files a project would reference. The test/CLI path.
 *  `uri` places the source in a project tree — where an `instance-path` takes its device and application from. */
export function lowerSource(source: string, name?: string, libraries: readonly LibraryFile[] = [], uri = "transpile://source"): LoweredPou {
  const parseResult = parseSource(source)
  if (parseResult.errors.length > 0) {
    const first = parseResult.errors[0]!
    return { diagnostics: [lowerDiagnostic("parse", first.message, first.span)] }
  }
  const manifests = libraries.flatMap((l) => parseLibraryManifest(l.uri, l.source) ?? [])
  const declarations = libraries.filter((l) => parseLibraryManifest(l.uri, l.source) === undefined)
  // A DECLARATION FILE THAT DOES NOT PARSE IS REPORTED, not built on. The main source's errors return above; a
  // library's or a GVL's were dropped, and the half-parsed file went into the symbol table anyway — so the failure
  // resurfaced downstream wearing someone else's name. A GVL whose `gN : INT := 7` is missing its semicolon reported
  // `aggregate-init: an aggregate initializer of a shape lowering does not recognise` and `place-not-local: gN is a
  // gvl_var, which has no frame slot yet`, neither of which is true and neither of which names the file.
  const parsedDeclarations = declarations.map((l) => ({ uri: l.uri, parseResult: parseSource(l.source), source: l.source }))
  const unparsed = parsedDeclarations.find((f) => f.parseResult.errors.length > 0)
  if (unparsed !== undefined) {
    const first = unparsed.parseResult.errors[0]!
    return { diagnostics: [lowerDiagnostic("parse", `${unparsed.uri} did not parse: ${first.message}`, first.span)] }
  }
  const files = [{ uri, parseResult, source }, ...parsedDeclarations]
  const project = buildSymbolTable(files, manifests)
  const runnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
    u.kind === "program" || u.kind === "function_block"
  const unit = parseResult.units
    .filter(runnable)
    .find((u) => name === undefined || u.name.text.toUpperCase() === name.toUpperCase())
  if (unit === undefined) {
    const span = parseResult.units[0]?.span ?? { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
    return {
      diagnostics: [
        lowerDiagnostic("no-unit", `no PROGRAM or FUNCTION_BLOCK${name === undefined ? "" : ` named ${name}`}`, span),
      ],
    }
  }
  const scope = scopeForUnit(project, unit)
  if (scope === undefined)
    return { diagnostics: [lowerDiagnostic("no-scope", `${unit.name.text} did not bind`, unit.span)] }
  // Every file's `{attribute …}`s: a GVL's or a library's unit carries its own. Only the main source's were read, so the
  // call_after_global_init_slot method of an FB in `fb_init_before_slot_method_sibling`'s GVL file never ran (seen 0, 7
  // recorded) — and any other attribute outside the main source was silently unread.
  const attributes = new Map<object, Set<string>>(
    files.flatMap((f) => [...unitAttributes(f.parseResult, f.source), ...memberAttributes(f.parseResult, f.source), ...declarationAttributes(f.parseResult, f.source)]),
  )
  // Which units' bodies are the VENDOR's. The `libraries` channel is not the discriminator — it carries a project's
  // other files too (a GVL, sibling POUs), and `fb_init_before_slot_method_sibling` puts real FBs in a GVL through it.
  // `isLibrarySymbol` is: a referenced library is materialized under `Library Manager/<library>/`, which is what
  // `LibraryFile.uri` is documented to keep, and it is the same predicate the analyzer gates error-checking on.
  const libraryUnits = new Set(files.filter((f) => isLibrarySymbol(f)).flatMap((f) => f.parseResult.units))
  return lowerUnit(unit, scope, project, attributes, libraryUnits)
}
