/**
 * The transpiler IR — what every backend consumes, and the one place ST semantics are resolved.
 *
 * Two decisions shape it, and both are load-bearing:
 *
 * **1. Places, not names.** A variable is a SLOT in a frame — the POU's, an instance's, a routine's locals, the
 * globals — reached through a `Place.path` of fields, indices and bits, never an identifier looked up at run time.
 * ST declares all storage up front, so every alias is one of three forms (design §9): the place itself, a
 * VAR_IN_OUT that never outlives its call (a `&mut` in Rust), or a POINTER / REFERENCE naming its one target (an
 * index, checked at every dereference). Lowering refuses whatever would need two live `&mut` at once, so the Rust
 * stays safe.
 *
 * **2. The IR carries semantics; a backend carries none.** Implicit widening is an explicit `convert` node,
 * CASE ranges are resolved bounds, all three loop forms are one `loop`, and every type is a resolved `Type`
 * from `types/` — not a name, and not a second type model. If a backend ever has to *decide* something, the
 * lowering was incomplete and that is the bug to fix.
 *
 * The IR is a typed tree, not SSA: the targets are source languages, not machine code.
 */
import type { Span, VarSectionKind } from "../../syntax/index.js"

/**
 * THE ITERATION CAP — a loop that runs longer than this is a bug in the POU, and BOTH backends must say so.
 *
 * It lives in the IR because it is semantics, and the IR carries the semantics (decision 2 above). It used to
 * live in `interp/` alone as a private constant, which made it the only rule in the transpiler that one backend
 * obeyed and the other had never heard of: the interpreter threw after a million iterations, the emitted Rust
 * ran forever. Same IR, same program, one fails loud and one hangs — and hanging is the worse half, because the
 * emitted Rust is what a user runs under `cargo test`, where a hang is indistinguishable from a slow suite
 * until CI times out with nothing to show.
 *
 * Not a budget to raise. A PLC scan is bounded by the cycle it runs in; a POU that needs a million iterations
 * of one loop is not going to work on the hardware either.
 */
export const LOOP_ITERATION_CAP = 1_000_000

/** What both backends say when a loop passes {@link LOOP_ITERATION_CAP} — one message, so a divergence in the
 *  failure is as visible as a divergence in a value. */
export const LOOP_CAP_MESSAGE = "loop exceeded the iteration cap"
import type { Type } from "../../types/index.js"

// ─── values ──────────────────────────────────────────────────────────────────

/** A constant, in the same shape the interpreter computes with. A duration is a `bigint` in its type's unit — TIME in
 *  MILLISECONDS (32-bit), LTIME in nanoseconds (64-bit), as measured; not the nanoseconds for both this once said. */
export type IrValue = bigint | number | boolean | string

/**
 * A type's zero — the value a slot declared without one starts at: FALSE, 0, 0.0, an empty string, and 0 for a duration,
 * a date and a pointer (an index into the frame). Lowering stamps it on the slot, so no backend picks a default: the
 * interpreter and the Rust emitter each kept a copy, and the emitter's gave a WSTRING field a STRING
 * (consolidate-lsp-structure B8).
 */
export function defaultValueOf(type: Type): IrValue {
  const family = type.kind === "elementary" ? type.elem.family : undefined
  return family === "bool" || isBit(type) ? false : family === "real" ? 0 : family === "string" ? "" : 0n
}

/** A BIT (a struct field of one bit) holds a BOOLEAN: CODESYS reads `dut.bFlag` as TRUE/FALSE, starting at FALSE
 *  (conformance `type_dut_struct_with_bit_fields`) — so both backends store it as their boolean. */
export function isBit(type: Type): boolean {
  return type.kind === "elementary" && type.elem.name === "BIT"
}

/** An array's FIRST dimension — its element (the remaining dimensions, if any), lower bound and length — or undefined
 *  for anything else, or an array whose bounds do not fold. The one way every backend walks an array type. */
export function peelArray(t: Type): { element: Type; lower: bigint; length: number } | undefined {
  if (t.kind !== "array" || t.bounds === undefined || t.bounds.length === 0) return undefined
  const [dim, ...rest] = t.bounds
  const element: Type = rest.length === 0 ? t.element : { ...t, bounds: rest, dims: t.dims.slice(1) }
  return { element, lower: dim!.lower, length: Number(dim!.upper - dim!.lower + 1n) }
}

/** What one index step into `t` reaches — a sized array's element (`peelArray`), or an `ARRAY[*]`'s, its remaining open
 *  dimensions first. Undefined for anything that is not an array. */
export function elementOf(t: Type): Type | undefined {
  if (t.kind !== "array") return undefined
  if (t.bounds !== undefined) return peelArray(t)?.element
  return t.dims.length > 1 ? { ...t, dims: t.dims.slice(1) } : t.element
}

/** Whether an IR node holds a call (an invoke or a dispatch) — whose place in the evaluation order then shows. */
export function holdsCall(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(holdsCall)
  if (node === null || typeof node !== "object") return false
  const kind = (node as { kind?: string }).kind
  if (kind === "invoke" || kind === "dispatch") return true
  return Object.entries(node).some(([key, child]) => key !== "type" && key !== "span" && key !== "of" && holdsCall(child))
}

// ─── places ──────────────────────────────────────────────────────────────────

/**
 * One step from a slot toward a sub-location (design §9 — the application is one tree of owned values, so a place is a
 * root slot plus a path, never an address):
 *   - `field` — a struct's field or an FB instance's variable, by its ST name (`IrLayout.fields`);
 *   - `index` — ONE array dimension: the index expression, the dimension's lower bound and its length, so a backend
 *     normalises `arr[i]` to `i - lower` without deciding anything;
 *   - `bit`   — `x.3` on an integer (design §14), the last step; `of` is that integer's type, which a write stores at.
 */
export type Access =
  | { kind: "field"; name: string }
  /** `length` is absent on an `ARRAY[*]` in-out's dimension: its index is already offset by the bound the call was
   *  handed (`lower` 0), and the array it was bound to knows its own length. */
  | { kind: "index"; index: IrExpr; lower: bigint; length?: number }
  | { kind: "bit"; index: number; of: Type }

/** A resolved storage location: a slot in the frame, plus a path into it. */
export interface Place {
  /** An index into the frame — the POU's slots, or the instance's fields in an FB, METHOD or ACTION body — or, per `root`,
   *  into the body's VAR_IN_OUT parameters or its routine's per-call locals. */
  slot: number
  path: readonly Access[]
  type: Type
  span: Span
  /** `inout`: a VAR_IN_OUT parameter — the caller's variable, bound for the call (design §9 form 2, a `&mut`).
   *  `local`: a METHOD's, ACTION's or FUNCTION's local, which starts over on every call.
   *  `global`: the application's storage — a GVL variable, or a called PROGRAM's one instance (`IrPou.globals`).
   *  `this`: the instance an FB, METHOD or ACTION body runs on — `THIS^` (`slot` is unused).
   *  `lent`: an FB instance of another frame, lent to this body for the call by its caller (`IrRoutine.lent`,
   *  `IrLayout.lent`) — how a call through an interface reaches the instance its tag names (design §24). */
  root?: "inout" | "local" | "global" | "this" | "lent"
  /**
   * A DEREFERENCE: this place is a pointer's or reference's one target (design §9 form 1), reached through `guard`, the
   * pointer variable — which holds 0 when null, so a backend faults before the access (the interpreter throws, Rust
   * panics), as a null dereference stops the CODESYS application.
   */
  guard?: Place
}

// ─── expressions ─────────────────────────────────────────────────────────────

/** Arithmetic/comparison/logic operators, already resolved to ONE meaning per node. */
export type IrBinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "and"
  | "or"
  | "xor"
  /** Short-circuit forms — distinct nodes, because a backend must not fold them into the eager ones. */
  | "and_then"
  | "or_else"

export type IrUnOp = "neg" | "not"

export type IrExpr = IrConst | IrLoad | IrBinary | IrUnary | IrConvert | IrBuiltin | IrInvoke | IrDispatch

/**
 * A call through an interface variable (design §22): the variable holds which instance it names — 0 for none, else the
 * tag lowering gave that instance — and each arm is the METHOD or PROPERTY accessor invoked on one instance it may name.
 * A value no arm names faults, as a call through a null interface stops the CODESYS application.
 */
export interface IrDispatch {
  kind: "dispatch"
  tag: IrExpr
  arms: readonly { tag: bigint; call: IrInvoke }[]
  type: Type
  span: Span
}

/**
 * A METHOD, ACTION or FUNCTION invocation. Its locals start over on every call — measured for a METHOD's and a
 * FUNCTION's VAR (conformance `fbcall_method_locals`, `fbcall_function_locals`) — so its inputs are VALUES handed in, not
 * assignments in the caller's frame. `type` is the routine's result; a call without one only appears in an `eval`.
 */
export interface IrInvoke {
  kind: "invoke"
  /** The routine's `key` in `IrPou.routines`. */
  routine: string
  /** The instance a METHOD or ACTION runs on; absent for a FUNCTION. */
  instance?: Place
  /** One value per VAR_INPUT, in declaration order, already converted to it. */
  inputs: readonly IrExpr[]
  /** The order the inputs are evaluated in: as WRITTEN in the call (conformance `callshape_argument_order`: a reversed call
   *  runs its right argument first). Absent, declaration order. A freeze among them is an in-out's index taken where the
   *  in-out is written (`IrFreeze`). */
  order?: readonly (number | IrFreeze)[]
  /** The VAR_IN_OUT arguments, in declaration order. */
  inouts: readonly IrBinding[]
  /** The instances lent to the routine (`IrRoutine.lent`), in its order — filled once the POU has lowered. */
  lent?: readonly Place[]
  type: Type
  span: Span
}

/**
 * A VAR_IN_OUT's runtime index, stored into `temp` at the position its argument is written — CODESYS binds an in-out
 * where it is written (conformance `callshape_inout_binding_order`: 101 before a call that moves the index), so a call
 * in a later argument cannot move it. The binding indexes by `temp`.
 */
export interface IrFreeze {
  kind: "freeze"
  temp: Place
  value: IrExpr
}

/**
 * What a VAR_IN_OUT is bound to for a call: the caller's place (a `&mut`, or a `&` for a VAR_IN_OUT CONSTANT) — or, for a
 * VAR_IN_OUT CONSTANT only, a COPY of a value lent for the call (a `&{ value }` in Rust): a literal with no place of its
 * own, or a variable the call already holds mutably, where the callee provably changes nothing while it reads it.
 */
export type IrBinding = Place | IrCopy

export interface IrCopy {
  kind: "copy"
  value: IrExpr
  /** The parameter's type — the copy is stored as it. */
  type: Type
  /** A copy lent `&mut` and written back to this place after the call: an FB's own field lent to its own METHOD, which
   *  would otherwise be two `&mut` of one instance — exact because the callee reaches the field only through it. */
  back?: Place
  span: Span
}

/** The value functions. A name here is ONE fixed meaning, measured against the vendor — not a call to resolve.
 *  `trunc` is TRUNC/TRUNC_INT: toward zero, into its node's DINT/INT `type` — the one conversion that does not
 *  round, so it cannot be a `convert`. */
export type IrBuiltinName =
  | "max"
  | "min"
  | "limit"
  | "sel"
  | "trunc"
  | "abs"
  | "expt"
  /** `(value, count)`, value already promoted; the count is masked to the width's bits (design §14). */
  | "shl"
  | "shr"
  /** `(value, count)` in the value's OWN width; the count is taken modulo that width. */
  | "rol"
  | "ror"
  /** `(K, IN0, …)`: inputs already met; an out-of-range K — negative included — picks the LAST input. */
  | "mux"
  | IrMathName
  | IrStringName

/** The Standard library's string functions, argument order as its declarations give it — MID(STR, LEN, POS),
 *  DELETE(STR, LEN, POS), REPLACE(STR1, STR2, L, P); positions 1-based; FIND answers 0 when absent (design §18). */
export type IrStringName = "len" | "left" | "right" | "mid" | "concat" | "insert" | "delete" | "replace" | "find"

/** The one-argument math functions: the argument is already converted to the node's `type` (design §12). */
export type IrMathName = "sqrt" | "ln" | "log" | "exp" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan"

/**
 * A built-in value function, with every argument already converted to `type` by lowering — so a backend picks
 * nothing, not even a comparison type. Argument order is the IEC one: `max`/`min` take 1+ operands, `limit` is
 * `(MN, IN, MX)`, and `sel` is `(G, IN0, IN1)` with a BOOL selector that is the one argument NOT of `type`.
 */
export interface IrBuiltin {
  kind: "builtin"
  name: IrBuiltinName
  args: readonly IrExpr[]
  type: Type
  span: Span
}

export interface IrConst {
  kind: "const"
  value: IrValue
  type: Type
  span: Span
}
export interface IrLoad {
  kind: "load"
  place: Place
  type: Type
  span: Span
}
export interface IrBinary {
  kind: "binary"
  op: IrBinOp
  left: IrExpr
  right: IrExpr
  type: Type
  span: Span
}
export interface IrUnary {
  kind: "unary"
  op: IrUnOp
  operand: IrExpr
  type: Type
  span: Span
}
/**
 * A type conversion — implicit (lowering inserts every one; a backend never widens on its own) or explicit
 * (`X_TO_Y`, `TO_Y`). ONE meaning for both, measured on CODESYS (design §11): REAL → integer rounds half away from
 * zero, every integer result wraps to its width, BOOL → numeric is 1/0, numeric → BOOL is "not zero", → REAL is
 * float32. An implicit REAL → integer never reaches here from valid code — it does not compile.
 */
export interface IrConvert {
  kind: "convert"
  value: IrExpr
  type: Type
  span: Span
}

// ─── statements ──────────────────────────────────────────────────────────────

export type IrStmt = IrAssign | IrIf | IrSwitch | IrLoop | IrBreak | IrContinue | IrReturn | IrCall | IrEval

/** A METHOD, ACTION or FUNCTION called as a statement — directly or through an interface; its result, if any, is dropped. */
export interface IrEval {
  kind: "eval"
  value: IrInvoke | IrDispatch
  span: Span
}

/**
 * A call of a declared FB instance: run its layout's `body` on the instance. Its inputs and outputs are NOT here — lowering
 * places them as ordinary assignments around the call, which is what CODESYS measured (conformance `fbcall_*`): an input
 * given is stored before the body, one not given keeps its last value, and an output is read after the body.
 */
export interface IrCall {
  kind: "call"
  instance: Place
  /** The FB's layout name. */
  fb: string
  /** The VAR_IN_OUT arguments, in the FB's parameter order — the caller's places (or copies), bound for the call. */
  inouts: readonly IrBinding[]
  /** The instances lent to the FB's body (`IrLayout.lent`), in its order — filled once the POU has lowered. */
  lent?: readonly Place[]
  /** Which binding this call makes, stored into the instance's hidden field before the body runs — what a METHOD called
   *  from outside the FB's run dispatches on (`lower/bindings.ts`). Filled once the POU has lowered, when one does. */
  bind?: { place: Place; tag: bigint }
  span: Span
}

export interface IrAssign {
  kind: "assign"
  target: Place
  value: IrExpr
  span: Span
}
export interface IrIf {
  kind: "if"
  cond: IrExpr
  then: readonly IrStmt[]
  else: readonly IrStmt[]
  span: Span
}
/** A lowered CASE. Labels are resolved value ranges — `1..5` and `1` are the same shape. */
export interface IrSwitch {
  kind: "switch"
  selector: IrExpr
  arms: readonly IrArm[]
  else: readonly IrStmt[]
  span: Span
}
export interface IrArm {
  labels: readonly { lo: IrValue; hi: IrValue }[]
  body: readonly IrStmt[]
  span: Span
}
/**
 * The one loop. FOR, WHILE and REPEAT all lower here, so a backend emits exactly one loop shape:
 * `init` once, then repeat { `test` when !atEnd → body → `step` → `test` when atEnd }.
 */
export interface IrLoop {
  kind: "loop"
  init: readonly IrStmt[]
  test?: { cond: IrExpr; atEnd: boolean }
  body: readonly IrStmt[]
  step: readonly IrStmt[]
  span: Span
}
export interface IrBreak {
  kind: "break"
  span: Span
}
export interface IrContinue {
  kind: "continue"
  span: Span
}
export interface IrReturn {
  kind: "return"
  span: Span
}

// ─── the frame ───────────────────────────────────────────────────────────────

/** One variable's storage. `temp` slots are lowering's own (a FOR bound evaluated once, etc.). */
export interface IrSlot {
  /** The ST name, source casing — the emitter's field name and the source map's anchor. */
  name: string
  type: Type
  /** `temp`: a lowering-owned slot. `program`: a called PROGRAM's one instance, in `IrPou.globals`. */
  section: VarSectionKind | "temp" | "program"
  /** The initial value: the declaration's, constant-folded, or the type's zero (`defaultValueOf`). */
  init: IrInit
  /** A VAR_IN_OUT CONSTANT: no store into it lowers, however it is written (conformance `inout_const_write_5`). */
  constant?: boolean
  /** Lent as a shared `&`: a VAR_IN_OUT CONSTANT that holds no FB instance. One that does is lent `&mut`, as any in-out:
   *  CODESYS calls the instance and its METHODs through it (`inout_const_fb_method_12`, `inout_const_fb_call_13`), and
   *  each of those runs on `&mut self`. */
  readOnly?: boolean
  /** An FB's own VAR_IN_OUT reached from its METHOD or ACTION — a parameter the call binds to the in-out the FB's running
   *  body holds (conformance `callshape_inout_in_method_from_body`). */
  ofInstance?: boolean
}

/**
 * A slot's initial value: a scalar, or an aggregate initializer's — an array's elements in order (an element left out,
 * or `undefined`, starts at its type's own initial value), or the fields of a struct or FB instance it names, by
 * upper-cased name (every other field at its TYPE's initial value). Conformance `array_initializers`,
 * `init_struct_by_field`, `init_array_of_structs`, `init_fb_instance_inputs`.
 */
export type IrInit = IrValue | { readonly elements: readonly (IrInit | undefined)[] } | { readonly fields: Readonly<Record<string, IrInit>> }

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
  /** An FB's body, once a call reached it — its places index `fields`, or `inouts` when marked. */
  body?: readonly IrStmt[]
  /** An FB's VAR_IN_OUT parameters, in declaration order. */
  inouts?: readonly IrSlot[]
  /** An FB's VAR_STAT (its bases' included): not fields — one global each, which every instance shares (conformance
   *  `life_fb_var_stat_instances`) — named here so a path through an instance (`first.counter`) still reaches it. */
  statics?: readonly { name: string; global: number }[]
  /** The FB instances its body is lent per call (`lent` places), each an interface's tag of another frame (design §24). */
  lent?: readonly { tag: number; type: Type }[]
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
  /** Per-call storage, each starting at its `init` on every call: the result slot (first, when there is one), the
   *  VAR_INPUT, the VAR and VAR_TEMP, and lowering's temps. */
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
  body: readonly IrStmt[]
  layouts: readonly IrLayout[]
  routines: readonly IrRoutine[]
  /** The application's global storage the POU reaches: GVL variables, and the instance of every PROGRAM it calls — one
   *  each, shared by every body (conformance `fbcall_program_writes_global`: the called program's VAR persists). */
  globals: readonly IrSlot[]
  /** Run once before the first scan: each instance's `call_after_global_init_slot` METHOD (conformance
   *  `state_call_after_global_init_counts` — once per instance, however many scans follow). */
  init?: readonly IrStmt[]
  span: Span
}

// ─── codegen diagnostics ─────────────────────────────────────────────────────

/**
 * A construct the lowering could not represent. Lowering is TOTAL — it never throws — so an untestable POU
 * is reported, never silently wrong, and `scripts/lower-completeness.ts` can measure coverage over the corpus.
 */
export interface LowerDiagnostic {
  /** Stable slug for the blocking construct — what the coverage report groups by. */
  code: string
  message: string
  span: Span
}

export interface LoweredPou {
  /** Present only when the POU lowered with no diagnostics. */
  pou?: IrPou
  diagnostics: readonly LowerDiagnostic[]
}
