/**
 * The state one POU's lowering shares — the frame being built, the layouts, bodies and routines its calls reach, the
 * globals — and the primitives every construct uses: report (`bail`), declare a slot, make a temp, resolve a type.
 */
import type { Identifier, Span, TopLevel, TypeExpr, VarSection } from "../../syntax/index.js"
import type { Scope } from "../../symbols/index.js"
import { resolveTypeExpr, type Type } from "../../types/index.js"
import {
  defaultValueOf,
  type IrLayout,
  type IrRoutine,
  type IrSlot,
  type IrValue,
  type LowerDiagnostic,
  type Place,
} from "../ir/index.js"

/** An FB whose storage is laid out and whose body is lowered at its first call, in the lowering that declared its fields. */
export interface PendingBody {
  lowering: Lowering
  unit: Extract<TopLevel, { kind: "function_block" | "program" }>
  state: "pending" | "lowered" | "failed"
}

/** An FB's base, if it EXTENDS one — a PROGRAM never does. */
export const baseOf = (unit: PendingBody["unit"]) => (unit.kind === "function_block" ? unit.extends : undefined)

/** A METHOD, ACTION or FUNCTION lowered once per POU — or the fact that it could not be. */
export type CalledRoutine = { state: "lowering" } | { state: "lowered"; routine: IrRoutine } | { state: "failed" }

/** What every lowering of one POU shares — the frames of the types, bodies and routines its calls reach, and the
 *  application's globals. */
export interface Shared {
  layouts: Map<string, IrLayout>
  bodies: Map<string, PendingBody>
  routines: Map<string, CalledRoutine>
  /** The `{attribute '…'}` names on each POU (`syntax/unitAttributes`) — the AST keeps no pragmas. */
  attributes: ReadonlyMap<TopLevel, ReadonlySet<string>>
  /** GVL variables and called PROGRAMs' instances, by upper-cased name. */
  globals: { slots: IrSlot[]; byName: Map<string, number> }
  /** The POU being lowered: a PROGRAM that names it is the running frame, not a global instance. */
  root: string
  /** Each pointer or reference variable's one target, by `pointerKey`. */
  pointers: Map<string, PointerTarget>
}

export function newShared(attributes: ReadonlyMap<TopLevel, ReadonlySet<string>> = new Map(), root = ""): Shared {
  return { layouts: new Map(), bodies: new Map(), routines: new Map(), attributes, globals: { slots: [], byName: new Map() }, root, pointers: new Map() }
}

/**
 * A pointer's or reference's ONE target (design §9 form 1): every address stored into the variable names the same place, or
 * elements of the same array. The pointer's value is 0 when null, 1 for its variable, and k + 1 for element k (from 0) —
 * so `p = 0` and `__ISVALIDREF` are plain comparisons, and `p[i]` / `p + n·SIZEOF(T)` step whole elements.
 */
export interface PointerTarget {
  /** The variable — or the array whose elements the value indexes. */
  base: Place
  /** The array's first dimension, when the pointer points at its elements. */
  element?: { lower: bigint; length: number; type: Type }
}

export class Lowering {
  readonly diagnostics: LowerDiagnostic[] = []
  readonly slots: IrSlot[] = []
  readonly byName = new Map<string, number>()
  readonly inoutSlots: IrSlot[] = []
  readonly inoutByName = new Map<string, number>()
  readonly localSlots: IrSlot[] = []
  readonly localByName = new Map<string, number>()
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
  /** How deep in a routine call's arguments this lowering is — a call there is refused (`call-nested`). */
  arguments = 0

  // ─── byte layout (design §9 — the on-demand byte view) ─────────────────────

  // ─── pointers and references (design §9 form 1) ────────────────────────────

  /** A name this frame, its parameters or its routine hold — which wins over an enum value of the same name. */
  holds(name: string): boolean {
    const upper = name.toUpperCase()
    return this.localByName.has(upper) || this.byName.has(upper) || this.inoutByName.has(upper)
  }

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
  get attributes(): ReadonlyMap<TopLevel, ReadonlySet<string>> {
    return this.shared.attributes
  }
  get globals(): readonly IrSlot[] {
    return this.shared.globals.slots
  }

  /** A temp as a place — a per-call local inside a routine, a field or slot elsewhere. */
  tempPlace(purpose: string, type: Type, span: Span): Place {
    if (!this.routineMode) return { slot: this.temp(purpose, type), path: [], type, span }
    this.localSlots.push({ name: `__${purpose}_${this.localSlots.length}`, type, section: "temp", init: defaultValueOf(type) })
    return { slot: this.localSlots.length - 1, path: [], type, span, root: "local" }
  }

  inArgument<T>(lower: () => T): T {
    this.arguments++
    const lowered = lower()
    this.arguments--
    return lowered
  }

  /** A base type's fields, first in this frame — so a field's index here is its index in the layout. */
  inherit(fields: readonly IrSlot[]): void {
    for (const field of fields) {
      this.byName.set(field.name.toUpperCase(), this.slots.length)
      this.slots.push(field)
    }
  }

  fail(pending: PendingBody, code: string, message: string, span: Span): undefined {
    pending.state = "failed"
    return this.bail(code, message, span)
  }

  bail(code: string, message: string, span: Span): undefined {
    this.diagnostics.push({ code, message, span })
    return undefined
  }

  get frame(): readonly IrSlot[] {
    return this.slots
  }

  // ─── slots ─────────────────────────────────────────────────────────────────

  /**
   * A lowering-owned slot, invisible to ST — a FOR bound evaluated once, a chain's value. Its name is UNIQUE and
   * starts with `__`, which CODESYS reserves, so no user variable can take it. It used to be the bare purpose: two FOR
   * loops in one POU made two `for_limit` fields — a Rust struct rustc rejects — and a variable the user called
   * `for_limit` would have collided with the temp. The interpreter reads slots by index, so only the emitter noticed.
   */
  temp(name: string, type: Type): number {
    this.slots.push({ name: `__${name}_${this.slots.length}`, type, section: "temp", init: defaultValueOf(type) })
    return this.slots.length - 1
  }

  slot(name: Identifier, type: Type, section: VarSection["sectionKind"], init?: IrValue): void {
    if (this.globalMode) {
      this.shared.globals.byName.set(`${this.globalPrefix}${name.text}`.toUpperCase(), this.shared.globals.slots.length)
      this.shared.globals.slots.push({ name: name.text, type, section, init: init ?? defaultValueOf(type) })
      return
    }
    if (this.routineMode) {
      this.localByName.set(name.text.toUpperCase(), this.localSlots.length)
      this.localSlots.push({ name: name.text, type, section, init: init ?? defaultValueOf(type) })
      return
    }
    this.byName.set(name.text.toUpperCase(), this.slots.length)
    this.slots.push({ name: name.text, type, section, init: init ?? defaultValueOf(type) })
  }

  resolve(t: TypeExpr): Type {
    return resolveTypeExpr(t, this.project)
  }

  // ─── places ────────────────────────────────────────────────────────────────

  // ─── expressions ───────────────────────────────────────────────────────────

  // ─── statements ────────────────────────────────────────────────────────────

}

export const ZERO_SPAN: Span = { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }

// ─── entry points ────────────────────────────────────────────────────────────
