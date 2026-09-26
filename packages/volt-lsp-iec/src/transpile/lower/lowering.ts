/**
 * The state one POU's lowering shares — the frame being built, the layouts, bodies and routines its calls reach, the
 * globals — and the primitives every construct uses: report (`bail`), declare a slot, make a temp, resolve a type.
 */
import type { Expr, Identifier, Span, TopLevel, TypeExpr, VarSection } from "../../syntax/index.js"
import type { Scope } from "../../symbols/index.js"
import { resolveTypeExpr, type Type } from "../../types/index.js"
import {
  defaultValueOf,
  type IrCall,
  type IrExpr,
  type IrInit,
  type IrLayout,
  type IrRoutine,
  type IrSlot,
  type IrStmt,
  type LowerDiagnostic,
  type Place,
  lowerCodeKind,
} from "../ir/index.js"

/** A unit's, member's or declaration's attribute names, by its AST node. */
export interface AttributeLookup {
  get(node: object): ReadonlySet<string> | undefined
}

/** A STRING CURSOR parameter (`Lowering.cursors`): its hidden VAR_IN_OUT, what it points at, and whether it may stand
 *  past its string's first character. */
export interface Cursor {
  inout: number
  unit: Type
  offset: boolean
}

/** An FB whose storage is laid out and whose body is lowered at its first call, in the lowering that declared its fields. */
export interface PendingBody {
  lowering: Lowering
  unit: Extract<TopLevel, { kind: "function_block" | "program" }>
  /** The FILE the unit was written in — carried so a source-map entry from this body names its own source. */
  uri?: string
  /** `lowering` while its body lowers: reached again then, the body calls itself (through a program, say) — refused */
  state: "pending" | "lowering" | "lowered" | "failed"
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
  attributes: AttributeLookup
  /** GVL variables and called PROGRAMs' instances, by upper-cased name. */
  globals: { slots: IrSlot[]; byName: Map<string, number> }
  /** The POU being lowered: a PROGRAM that names it is the running frame, not a global instance. */
  root: string
  /**
   * Each pointer or reference variable's targets, by `pointerKey`, in the order they were recorded — the TAG a store
   * writes is the index + 1, and 0 is none. One target is form 1 and the deref erases to that place; several is form 3,
   * where the read selects on the tag (`IrSelect`).
   */
  pointers: Map<string, PointerTarget[]>
  /** The layouts that are a UNION's, by upper-cased name — their members overlay one another (`unions.ts`). */
  unions: Set<string>
  /** Every FB instance stored into an interface, at its tag - 1, with the frame its place indexes (`interfaces.ts`). */
  instances: { place: Place; context: string; fb: Extract<Type, { kind: "function_block" }> }[]
  /** What each interface variable may hold, by `pointerKey`: the tags stored into it, and the variables copied into it
   *  (`only`: through __QUERYINTERFACE, the instances implementing that interface). */
  //  `foreign`: the value arrived through a write reached through another instance (an in-out, a lent instance, a global)
  //  — which instance an instance-relative tag names is then not tracked (`interfaces.ts`).
  interfaces: Map<string, { tags: Map<number, boolean>; from: { key: string; only?: string; foreign: boolean }[] }>
  /** Each call through an interface, finished once the POU has lowered (`finishInterfaces`) — true when it reached more. */
  dispatches: ((root: Lowering) => boolean)[]
  /** Every variable bound AT an address, and every bare address, as the BIT RANGE it covers — one interpretation, the
   *  measured one (`addressBits`): its area, its range under byte and under word addressing, and the frame that
   *  declares it (`storage.ts` `bindAddress`). */
  addressed: { area: string; bits: readonly [number, number]; name: string; owner: string }[]
  /** Each routine's lowering, by key — whose `lends` a call of the routine must fill. */
  routineLowerings: Map<string, Lowering>
  /** Every call of an FB with VAR_IN_OUT, its instance and binding keyed — what a METHOD called from outside the FB's run
   *  dispatches over (`bindings.ts`). */
  bodyCalls: { call: IrCall; instance: string | undefined; binding: string | undefined; context: string }[]
  /** The FBs whose SUPER^ call binds a base in-out to a place other than that in-out passed on — what `lastBinding`
   *  refuses, as what the instance then holds is not recorded. */
  superRebinds: Set<string>
  /** The layouts being built right now, by upper-cased name — a type reached again while its own layout is being laid
   *  out CONTAINS itself, which has no size (`buildLayout`). */
  building: Set<string>
  /** Every top-level unit that came from a LIBRARY file rather than from project source — what `isBodylessLibrary`
   *  asks, so a signature with no statements is refused instead of lowering to a routine that does nothing. */
  libraryUnits: ReadonlySet<object>
}

export function newShared(
  attributes: AttributeLookup = new Map(),
  root = "",
  libraryUnits: ReadonlySet<object> = new Set(),
): Shared {
  return {
    layouts: new Map(),
    bodies: new Map(),
    routines: new Map(),
    attributes,
    globals: { slots: [], byName: new Map() },
    root,
    pointers: new Map(),
    unions: new Set(),
    instances: [],
    interfaces: new Map(),
    dispatches: [],
    addressed: [],
    routineLowerings: new Map(),
    bodyCalls: [],
    superRebinds: new Set(),
    building: new Set(),
    libraryUnits,
  }
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
  /** A place in a VAR_IN_OUT: the FB body binding it — the one body that may dereference it (`recordTarget`). */
  scopedTo?: Lowering
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
  /** How deep in an IF, CASE or loop body lowering is: a statement at 0 runs on every run of the body. */
  conditional = 0
  /** The pointers and references this body stores at depth 0, by `pointerKey` — so far, in source order. */
  readonly boundPointers = new Set<string>()
  /** The FB instances of other frames this body is lent per call, by tag — its `lent` places (`interfaces.ts`). */
  readonly lends: { tag: number; type: Extract<Type, { kind: "function_block" }> }[] = []

  // ─── byte layout (design §9 — the on-demand byte view) ─────────────────────

  // ─── pointers and references (design §9 form 1) ────────────────────────────

  /** A routine's VAR_STAT names → the global slot each is (one per declaring METHOD, shared by every instance). */
  readonly statics = new Map<string, number>()
  /** A routine's ANY / ANY_* inputs, upper-cased: each a hidden DINT holding the argument's `diSize` — the one part of
   *  the ANY value measured (conformance `state_any_input_sizes`); any other use of the parameter is refused. */
  readonly anyInputs = new Set<string>()
  /** Each ANY input whose call site named a variable, to the hidden VAR_IN_OUT bound to it — what `pValue` is. */
  readonly anyTargets = new Map<string, number>()
  /**
   * FORM 2 (`pointer-model.md` §8 step 1) — each `POINTER TO T` parameter this routine only DEREFERENCES, upper-cased,
   * to the hidden VAR_IN_OUT the call binds to whatever the caller took an `ADR` of.
   *
   * A pointer the callee never keeps is a borrow for the duration of the call, and a borrow is what the IR already
   * calls a VAR_IN_OUT: the callee addresses it as `root: "inout"`, the caller supplies a place, and the emitter
   * already prints it `&mut`. So `p^` becomes that place and the pointer value never exists — the same erasure
   * `anyTargets` above performs for an ANY input, and for the same reason.
   *
   * MEASURED FIRST (`memory/pointer-parameters.ts`): the callee's `p^ := 77` changes the CALLER's variable, so it is
   * a borrow and not a copy; and ONE parameter answers 11 and 22 at two call sites, which is exactly what form 1's
   * single recorded target per pointer cannot represent.
   */
  readonly borrowedPointers = new Map<string, number>()
  /**
   * A STRING CURSOR — `pointer-model.md` form 2 over a string's characters, not over a whole variable. Each
   * `POINTER TO BYTE` (`POINTER TO WORD`) parameter a caller filled with the address of a STRING (WSTRING), upper-cased,
   * to the hidden VAR_IN_OUT the call binds that string to, and the character type it walks.
   *
   * It is what the StringUtils library is written in (`libraries/StringUtils`): `StrLenA(ADR(s))` walks `s` byte by
   * byte through `pstData^`, `pstData[i]` and `pstData := pstData + 1`. Unlike a plain borrow the pointer VALUE is
   * kept — a byte offset + 1, exactly as an element pointer holds its index + 1 — and every dereference is a
   * character of the bound string (`char` / `setchar`). The routine is lowered once per string TYPE, so the capacity a
   * store is cut at is the caller's, in both backends. A `POINTER TO STRING` parameter binds the same way, by the
   * caller's own string type — its `unit` is then a string, `p^[i]` a character counted from where it stands, and `p^`
   * the whole bound string. `offset` marks one that may stand past the first character (handed a byte cursor that
   * walked), whose `p^` is no whole string — refused rather than read from the start.
   */
  readonly cursors = new Map<string, Cursor>()
  /** What `__POUNAME()` answers here, in SOURCE casing: the POU's name, or `POU.Member` inside a METHOD or ACTION
   *  (conformance `cp_pouname_operator`: 'FB_CP_named', 'FB_CP_named.Inner', 'FB_CP_named.Marked'). */
  displayName = ""
  /** The PROGRAM instances (global slots) this body reads or calls, and those of every body it calls. In Rust a program
   *  runs moved out of `Programs`, so a program whose run reaches its own instance would read a stand-in: refused. */
  readonly touched = new Set<number>()
  /** A `__QUERYINTERFACE` call an IF condition leads with, by its AST node → the hidden BOOL its query was taken into
   *  just before the IF (`queryCondition`); the call reads it where the condition lowers (`lowerBuiltin`). */
  readonly hoistedQueries = new Map<object, IrExpr>()
  /** The FB in-outs a routine would reach but a parameter or local of its own hides, by upper-cased name (`calls.ts`). */
  readonly shadowedInOuts = new Set<string>()

  /** A name this frame, its parameters or its routine hold — which wins over an enum value of the same name. */
  holds(name: string): boolean {
    const upper = name.toUpperCase()
    return this.localByName.has(upper) || this.statics.has(upper) || this.byName.has(upper) || this.inoutByName.has(upper)
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
  get attributes(): AttributeLookup {
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

  /**
   * A declaration whose initial value is NOT a constant — the slot takes its default and this runs in the init step.
   *
   * A CODESYS initializer is an initialisation SEQUENCE, measured on SP21 (`declarations/init-sequence.ts`): it runs
   * ONCE before the first scan, after the globals, in strict DECLARATION ORDER, and the expression may be anything —
   * `ADR(x)`, `THIS`, a struct member, a global, a call to a user FUNCTION. Declaration order is not decoration:
   * `other : INT := -7; i : INT := ABS(other);` gives 7 and the same pair written the other way round gives 0,
   * because `other` is still at its default when the earlier initializer reads it. Keeping these in the order they
   * were declared is what reproduces that, so nothing else has to.
   *
   * The EXPRESSION is kept, not a lowered value: it is lowered once every slot exists, so an initializer may name a
   * variable declared after it — which `ADR(x)` does 180 times in the corpus.
   */
  readonly pendingInits: { name: Identifier; type: Type; expr: Expr; span: Span; slot: number; op?: "REF=" }[] = []

  /** `pendingInits` lowered, memoized — built BEFORE any body, so a pointer this step fills is known to be filled
   *  when a body dereferences it (`shared.pointers`), and consumed by the init step at the end. `statements`
   *  undefined means the build failed or is in progress. */
  initSequence?: { statements: IrStmt[] | undefined }


  bail(code: string, message: string, span: Span): undefined {
    // THE TAXONOMY IS RESOLVED HERE, not at the call site. 98 literal codes and six templated families reach
    // this one method, so one lookup keeps every refusal classified consistently; a field each call site had to
    // remember is a field that ends up disagreeing with itself. An unregistered code answers "unclassified"
    // and `ir/codes.test.ts` fails on it by name — total, as lowering must be, and loud, as the registry is.
    this.diagnostics.push({ code, kind: lowerCodeKind(code) ?? "unclassified", message, span })
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

  /** Whether this frame already has a variable of that name — the same three places `slot` writes to. */
  declared(name: string): boolean {
    const key = name.toUpperCase()
    if (this.globalMode) return this.shared.globals.byName.has(`${this.globalPrefix}${name}`.toUpperCase())
    return this.routineMode ? this.localByName.has(key) : this.byName.has(key)
  }

  slot(name: Identifier, type: Type, section: VarSection["sectionKind"], init?: IrInit): void {
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

  /** `where` is the scope the declaration belongs to — this one by default; a type declared by another POU (an
   *  interface's METHOD, a library FUNCTION, a DUT) folds in the project's, never in whichever scope is calling it. */
  resolve(t: TypeExpr, where: Scope = this.scope): Type {
    // NO PLATFORM BRANCH HERE. It short-circuited `__XINT`/`__UXINT`/`__XWORD` to LINT/ULINT/LWORD from a local
    // copy of the alias table — and `resolveTypeExpr` already does exactly that, through `elementaryType` →
    // `canonicalElem`, which reads the one home. Two tables for one fact, and the redundant one is the copy.
    // bounds and capacities fold where the variable is declared — its own VAR CONSTANT included
    return resolveTypeExpr(t, this.project, 0, where)
  }

  // ─── places ────────────────────────────────────────────────────────────────

  // ─── expressions ───────────────────────────────────────────────────────────

  // ─── statements ────────────────────────────────────────────────────────────

}

export const ZERO_SPAN: Span ={ start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }

/** How many open dimensions an `ARRAY[*]` has — 0 for any other type, a sized array whose bounds did not fold included. */
export const openDims = (t: Type): number => (t.kind === "array" && t.bounds === undefined && t.dims.every((d) => d.lower === undefined && d.upper === undefined) ? t.dims.length : 0)

/** The hidden slot holding one bound of an `ARRAY[*]` in-out's dimension (design §26) — `__`, which CODESYS reserves. */
export const boundName = (inout: string, which: "lower" | "upper", dim: number): string => `__${inout}_${which}_${dim}`

// ─── entry points ────────────────────────────────────────────────────────────
