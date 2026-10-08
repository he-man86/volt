/**
 * THE LOWERING FRAME — what one body's lowering is building: its slots (the frame's own, its in-outs, a routine's
 * locals), the modes it lowers in, and the primitives every construct uses: report (`bail`), declare a slot, resolve a
 * type. Everything a MODEL keeps per frame (pointers, interfaces, the init sequence, the touched programs) lives in that
 * model's own `state.ts`, keyed by the frame (`frameState`); what a whole POU's lowering shares is `shared.ts`.
 */
import type { Identifier, Span, TypeExpr, VarSection } from "../../../frontend/syntax/index.js"
import type { lookup, Scope } from "../../../frontend/symbols/index.js"
import { resolveTypeExpr, type Type, typeZero } from "../../../frontend/types/index.js"
import type { IrInit, IrLayout, IrSlot } from "../../ir/index.js"
import { emittedKind } from "../diagnostics/codes.js"
import type { LowerDiagnostic } from "../diagnostics/diagnostic.js"
import { type CalledRoutine, newShared, type PendingBody, type Shared } from "./shared.js"

export type FbType = Extract<Type, { kind: "function_block" }>

export type RoutineSymbol = NonNullable<ReturnType<typeof lookup>>["symbol"]

/**
 * A model's state per frame, kept beside the `Lowering` by reference — created empty at its first use, as a field of the
 * frame was created empty with it. The model's `state.ts` owns its shape, so the frame names no model.
 */
export function frameState<S>(make: () => S): (lw: Lowering) => S {
  const states = new WeakMap<Lowering, S>()
  return (lw) => {
    let state = states.get(lw)
    if (state === undefined) states.set(lw, (state = make()))
    return state
  }
}

export class Lowering {
  readonly diagnostics: LowerDiagnostic[] = []
  readonly slots: IrSlot[] = []
  readonly byName = new Map<string, number>()
  readonly inoutSlots: IrSlot[] = []
  readonly inoutByName = new Map<string, number>()
  readonly localSlots: IrSlot[] = []
  readonly localByName = new Map<string, number>()
  /** A routine's VAR_STAT names → the global slot each is (one per declaring METHOD, shared by every instance). */
  readonly statics = new Map<string, number>()
  /** Lowering a METHOD, ACTION or FUNCTION body: its declarations and temps are per-call locals, not fields. */
  routineMode = false
  /** Declaring a GVL variable: its slot is the application's, not this frame's. */
  globalMode = false
  /** Prefixed to a declared global's key: a `qualified_only` list's name, as its variables are reachable only through
   *  it — so two such lists may each declare a `gX` without sharing one slot. */
  globalPrefix = ""
  /** Lowering the POU's OWN body — the one place a PROGRAM is called from (see `globalPlace`); set by `lowerUnit`. */
  isRoot = false
  /** The FB an FB, METHOD or ACTION body runs on — what `THIS^` names, and what a METHOD call resolves against. */
  selfType: Type | undefined
  /** The FB whose DECLARATION this code is. A base FB's body or method runs on a derived instance (`selfType`) yet still
   *  names ITS OWN base as `SUPER^` — the two differ exactly there. */
  codeOwner: Scope | undefined
  /** Which frame this body's plain slots belong to — the POU's or an FB's — so every body agrees on a pointer's key; the
   *  POU's is set by `lowerUnit`. */
  frameContext = "POU"
  /** Which routine this body's locals belong to. */
  routineContext = ""
  /** What `__POUNAME()` answers here, in SOURCE casing: the POU's name, or `POU.Member` inside a METHOD or ACTION
   *  (conformance `cp_pouname_operator`: 'FB_CP_named', 'FB_CP_named.Inner', 'FB_CP_named.Marked'). */
  displayName = ""
  /** How deep in a routine call's arguments this lowering is — a call there is refused (`call-nested`). */
  arguments = 0
  /** How deep in an IF, CASE or loop body lowering is: a statement at 0 runs on every run of the body. */
  conditional = 0
  /** How many loop bodies enclose this statement: an EXIT or CONTINUE at 0 has no loop to leave (transpile-review 39). */
  loops = 0

  constructor(
    readonly scope: Scope,
    readonly project: Scope,
    readonly shared: Shared = newShared(),
  ) {}

  /** Every composite type's storage, by upper-cased name. */
  get layouts(): Map<string, IrLayout> {
    return this.shared.layouts
  }
  get bodies(): Map<string, PendingBody> {
    return this.shared.bodies
  }
  /** Every METHOD, ACTION and FUNCTION a call reached, by upper-cased key. */
  get routines(): Map<string, CalledRoutine> {
    return this.shared.routines
  }
  get attributes(): Shared["attributes"] {
    return this.shared.attributes
  }
  get globals(): readonly IrSlot[] {
    return this.shared.globals.slots
  }

  bail(code: string, message: string, span: Span): undefined {
    // THE TAXONOMY IS RESOLVED HERE, not at the call site. Every literal code and the templated families reach
    // this one method, so one lookup keeps every refusal classified consistently; a field each call site had to
    // remember is a field that ends up disagreeing with itself. An unregistered code is a lowering bug and throws
    // (`emittedKind`); `diagnostics/codes.test.ts` names every literal one before it can.
    this.diagnostics.push({ code, kind: emittedKind(code), message, span })
    return undefined
  }

  inArgument<T>(lower: () => T): T {
    this.arguments++
    const lowered = lower()
    this.arguments--
    return lowered
  }

  /** A name this frame, its parameters or its routine hold — which wins over an enum value of the same name. */
  holds(name: string): boolean {
    const upper = name.toUpperCase()
    return this.localByName.has(upper) || this.statics.has(upper) || this.byName.has(upper) || this.inoutByName.has(upper)
  }

  /** A base type's fields, first in this frame — so a field's index here is its index in the layout. */
  inherit(fields: readonly IrSlot[]): void {
    for (const field of fields) {
      this.byName.set(field.name.toUpperCase(), this.slots.length)
      this.slots.push(field)
    }
  }

  /** Whether this frame already has a variable of that name — the same three places `slot` writes to. */
  declared(name: string): boolean {
    const key = name.toUpperCase()
    if (this.globalMode) return this.shared.globals.byName.has(`${this.globalPrefix}${name}`.toUpperCase())
    return this.routineMode ? this.localByName.has(key) : this.byName.has(key)
  }

  slot(name: Identifier, type: Type, section: VarSection["sectionKind"], init?: IrInit): void {
    if (this.globalMode) {
      this.shared.globals.byName.set(`${this.globalPrefix}${name.text}`.toUpperCase(), this.shared.globals.slots.length)
      this.shared.globals.slots.push({ name: name.text, type, section, init: init ?? typeZero(type) })
      return
    }
    if (this.routineMode) {
      this.localByName.set(name.text.toUpperCase(), this.localSlots.length)
      this.localSlots.push({ name: name.text, type, section, init: init ?? typeZero(type) })
      return
    }
    this.byName.set(name.text.toUpperCase(), this.slots.length)
    this.slots.push({ name: name.text, type, section, init: init ?? typeZero(type) })
  }

  /** `where` is the scope the declaration belongs to — this one by default; a type declared by another POU (an
   *  interface's METHOD, a library FUNCTION, a DUT) folds in the project's, never in whichever scope is calling it. */
  resolve(t: TypeExpr, where: Scope = this.scope): Type {
    // NO PLATFORM BRANCH HERE. It short-circuited `__XINT`/`__UXINT`/`__XWORD` to LINT/ULINT/LWORD from a local
    // copy of the alias table — and `resolveTypeExpr` already does exactly that, through `elementaryType` →
    // `canonicalElem`, which reads the one home. Two tables for one fact, and the redundant one is the copy.
    // bounds and capacities fold where the variable is declared — its own VAR CONSTANT included
    return resolveTypeExpr(t, this.project, 0, where)
  }
}
