/** A LOWERED PROGRAM — its values, slots, layouts and routines: the frame every backend allocates. */
import type { Span, VarSectionKind } from "../../frontend/syntax/index.js"
import type { Type } from "../../frontend/types/index.js"
import type { IrStmt } from "./stmt.js"

/** A constant, in the same shape the interpreter computes with. A duration is a `bigint` in its type's unit — TIME in
 *  MILLISECONDS (32-bit), LTIME in nanoseconds (64-bit), as measured; not the nanoseconds for both this once said. */
export type IrValue = bigint | number | boolean | string

// ─── the frame ───────────────────────────────────────────────────────────────

/** One variable's storage. `temp` slots are lowering's own (a FOR bound evaluated once, etc.). */
export interface IrSlot {
  /** The ST name, source casing — the emitter's field name and the source map's anchor. */
  name: string
  type: Type
  /** `temp`: a lowering-owned slot. `program`: a called PROGRAM's one instance, in `IrPou.globals`. */
  section: VarSectionKind | "temp" | "program"
  /** The initial value: the declaration's folded constant, or — when the init step assigns it (a dynamic initializer, a
   *  constant after the frame's first step statement: the position rule, design.md §3.4) — the type's start
   *  (`lower/core` `zeroInit`). */
  init: IrInit
  /** A `temp` written at one site before every read, all in the block that write stands in (`lower/core/temps.ts`
   *  `TempWrite`): the interpreter keeps it a slot; the Rust holds it as a `let` of the fn that runs that block, not a
   *  field of the struct (lean 7.6.1). */
  scoped?: true
  /** A VAR_IN_OUT CONSTANT: no store into it lowers, however it is written (conformance `inout_const_write_5`). */
  constant?: boolean
  /** Lent as a shared `&`: a VAR_IN_OUT CONSTANT that holds no FB instance. One that does is lent `&mut`, as any in-out:
   *  CODESYS calls the instance and its METHODs through it (`inout_const_fb_method_12`, `inout_const_fb_call_13`), and
   *  each of those runs on `&mut self`. */
  readOnly?: boolean
  /** An FB's own VAR_IN_OUT reached from its METHOD or ACTION — a parameter the call binds to the in-out the FB's running
   *  body holds (conformance `callshape_inout_in_method_from_body`). */
  ofInstance?: boolean
  /** Stored in the program's byte image (design.md §3.3 step 4d): a POU or global slot at this ABSOLUTE address, a
   *  layout's field at this offset from its instance's `__base`, a struct's field at this offset from the struct. Such a
   *  slot is reached only through an `image` place; the Rust struct does not hold it. */
  image?: number
  /** A GVL variable whose name another list also declares: its list's name. The two are two globals (6.A.17), and the
   *  emitter names each Rust field `<list>_<name>` — by its list, never by which one a body reached first. */
  list?: string
  /** A CONSTANT whose slot is wider than its declared type, to hold its unwrapped fold (`constantSlotType`): the monitor
   *  shows that fold (`tr_a29_dint_constant_expression_overflow`: D DINT#2147483648), but every read of it is the value in
   *  this type — its declared type's run-time width (-2147483648; a SINT's 128 survives in DINT). Lowering converts each
   *  load (`places/access-guards.ts` `loadValue`); no backend reads it (transpile-restructure 6.A.29). */
  readAs?: Type
  /** Set with `readAs`: the constant's DECLARED type, which SIZEOF measures — SIZEOF(B) of `B : BYTE := KB + 1` held as 256
   *  in a WORD slot is 1, of `D : DINT := K + 1` 4 (`tr_a29_sizeof_bound_widened_*_constant`, both vendors, 6Af gate). */
  declared?: Type
  /** A BOOL HELD AS ITS BYTE (transpile-restructure 8.2, `lower/pointers/raw-bool.ts`): its address reaches a pointer of
   *  another type, or a flow that keeps the byte fills it from such a BOOL, and CODESYS keeps that whole byte — its type is
   *  BYTE, every operator on it lowered on the byte. It shows as the BOOL it is declared: 0 FALSE, 1 TRUE (any other byte
   *  the monitor cannot show). */
  rawBool?: true
}

/**
 * A slot's initial value, COMPLETE — no backend picks a default: a scalar; an array's stated `elements` in order and every
 * remaining one at `rest` (lowering states `rest`: the element type's start for an array declared without an
 * initializer — an enum's default, an alias's `:=`, an initialized alias-of-array's, a struct's own fields — and for a
 * partial initializer's tail the element type's start without an alias's `:=`: an alias of INT 0, an enum its default;
 * `array_element_type_default`, `array_element_enum_partial_tail`); or the fields of a struct or FB instance it names, by
 * upper-cased name (every other field at its TYPE's initial value). Conformance `array_initializers`,
 * `init_struct_by_field`, `init_array_of_structs`, `init_fb_instance_inputs`.
 */
export type IrInit = IrValue | IrArrayInit | { readonly fields: Readonly<Record<string, IrInit>> }

/** An array's initial value: `elements` stated, then every remaining element at `rest` (`IrInit`). */
export interface IrArrayInit {
  readonly elements: readonly IrInit[]
  readonly rest: IrInit
}

/**
 * The storage of a composite type — a DUT struct, or an FB instance's variables. A slot or field whose `type` is a
 * `struct`/`function_block` holds one of these by value (design §9: nested owned structs, no references), starting at
 * its fields' initial values. A base type's fields come first (`EXTENDS`).
 */
export interface IrLayout {
  /** The DUT or FB name, source casing — the Rust struct's name. */
  name: string
  kind: "struct" | "function_block"
  fields: readonly IrSlot[]
  /** An FB's body, once a call reached it — its places index `fields`, or `inouts` / `locals` when marked. */
  body?: readonly IrStmt[]
  /** The body's per-run storage — its VAR_TEMP (transpile-restructure 7.6.4) — each starting at its `init` on every run, as
   *  an `IrRoutine`'s locals do; absent when it has none. Its `local` places index these. Not fields: the instance does not
   *  carry them between runs. */
  locals?: readonly IrSlot[]
  /** The FILE that body was written in, for the source map — an FB declared in a GVL is not the main source. */
  bodyUri?: string
  /** An FB's VAR_IN_OUT parameters, in declaration order. */
  inouts?: readonly IrSlot[]
  /** An FB's VAR_STAT (its bases' included): not fields — one global each, which every instance shares (conformance
   *  `life_fb_var_stat_instances`) — named here so a path through an instance (`first.counter`) still reaches it. */
  statics?: readonly { name: string; global: number }[]
  /** The FB instances its body is lent per call (`lent` places), each an interface's tag of another frame (design §24). */
  lent?: readonly { tag: number; type: Type }[]
  /** A struct whose bytes the image holds: its measured size, the stride of an array of it (`semantics/memory.ts`). */
  size?: number
}

/**
 * THE PROGRAM'S BYTE IMAGE (design.md §3.3 step 4d): every variable whose address a program stores, laid out as CODESYS
 * lays it out, from `IMAGE_BASE` (`semantics/memory.ts`). Lowering allocates every region statically — a program's or
 * GVL's variable alone (where a program places its variables is not measured), an instance's measured runs of fields —
 * so a backend allocates nothing: it starts from `bytes` and checks every access against `regions`.
 */
export interface IrImage {
  /** Bytes from `IMAGE_BASE`. */
  size: number
  /** The initial bytes that are not 0, as runs: an offset from `IMAGE_BASE` and the bytes from there. */
  bytes: readonly (readonly [number, readonly number[]])[]
  /** Each region as `[start, end)` offsets from `IMAGE_BASE`; an access, an order or a difference stays inside one. */
  regions: readonly (readonly [number, number])[]
}

/**
 * A METHOD or ACTION of an FB, or a FUNCTION — a body with per-call locals. A METHOD's and ACTION's places index the
 * instance's fields (`IrLayout.fields`) when they have no `root`; every routine's `local` places index `locals`.
 */
export interface IrRoutine {
  /** `FB.Method` for a METHOD or ACTION, the name for a FUNCTION — source casing. */
  name: string
  /** `name` upper-cased — what an `IrInvoke` names. */
  key: string
  kind: "method" | "action" | "function"
  /** The FB whose instance a METHOD or ACTION runs on. */
  fb?: string
  /** The FILE this routine's body was written in — what a source-map entry from it indexes. A routine can come from a
   *  GVL or a library declaration rather than the main source, and a span alone cannot say which. */
  uri?: string
  /** Per-call storage, each starting at its `init` on every call: the result slot (first, when there is one), the
   *  VAR_INPUT, the VAR (a base body's run by `SUPER^()`: the base's VAR_TEMP), and lowering's temps. */
  locals: readonly IrSlot[]
  /** The VAR_INPUT locals, in declaration order — indices into `locals`. */
  inputs: readonly number[]
  inouts: readonly IrSlot[]
  /** The result slot's index in `locals`, for a METHOD or FUNCTION with a return type. */
  result?: number
  body: readonly IrStmt[]
  /** The FB instances the routine is lent per call (`lent` places) — see `IrLayout.lent`. */
  lent?: readonly { tag: number; type: Type }[]
}

/** A lowered POU: its frame, its body, the layout of every composite type its frame reaches (dependencies first), and
 *  every METHOD, ACTION and FUNCTION it calls. */
export interface IrPou {
  name: string
  slots: readonly IrSlot[]
  /** The scan's per-run storage — the POU's VAR_TEMP (7.6.4) — each starting at its `init` on every scan; absent when it
   *  has none. The body's `local` places index these. */
  locals?: readonly IrSlot[]
  body: readonly IrStmt[]
  layouts: readonly IrLayout[]
  routines: readonly IrRoutine[]
  /** The application's global storage the POU reaches: GVL variables, and the instance of every PROGRAM it calls — one
   *  each, shared by every body (conformance `fbcall_program_writes_global`: the called program's VAR persists). */
  globals: readonly IrSlot[]
  /** THE ORDERED INIT STEP, run once before the first scan (`lower/init/step.ts`, design.md §3.4): per frame in recorded
   *  order (the POU's, then the PROGRAMs it calls, in call order), per declaration a dynamic initializer, a constant after
   *  the frame's first statement (the position rule), or an instance's whole init — per class of its EXTENDS chain, base
   *  first, its own fields then its FB_Init; then its structured initializer; then every `call_after_global_init_slot`
   *  METHOD (conformance `state_call_after_global_init_counts` — once per instance, however many scans follow). */
  init?: readonly IrStmt[]
  /** The byte image, when any variable's address is stored. */
  image?: IrImage
  span: Span
}
