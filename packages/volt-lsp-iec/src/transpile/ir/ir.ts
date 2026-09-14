/**
 * The transpiler IR — what every backend consumes, and the one place ST semantics are resolved.
 *
 * Two decisions shape it, and both are load-bearing:
 *
 * **1. Places, not names.** A variable is a SLOT INDEX into the POU's flat frame, never an identifier looked
 * up at run time. ST's memory model is one static image: instances are fixed allocations, `VAR_IN_OUT` is a
 * pointer, `POINTER TO`/`REFERENCE TO` are real aliases, GVLs are global mutable state. Mapping any of that
 * onto Rust `&mut` loses to the borrow checker the moment two aliases live at once — so nothing here ever
 * becomes a Rust reference. A pointer will lower to an index into the same flat frame, which is both safe
 * Rust and what a PLC's memory actually is. `Place.path` is empty today; fields, array indices and derefs
 * append to it without changing a single consumer.
 *
 * **2. The IR carries semantics; a backend carries none.** Implicit widening is an explicit `convert` node,
 * CASE ranges are resolved bounds, all three loop forms are one `loop`, and every type is a resolved `Type`
 * from `types/` — not a name, and not a second type model. If a backend ever has to *decide* something, the
 * lowering was incomplete and that is the bug to fix.
 *
 * The IR is a typed tree, not SSA: the targets are source languages, not machine code.
 */
import type { Span, VarSectionKind } from "../../syntax/index.js"
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
  | { kind: "index"; index: IrExpr; lower: bigint; length: number }
  | { kind: "bit"; index: number; of: Type }

/** A resolved storage location: a slot in the frame, plus a path into it. */
export interface Place {
  /** An index into the frame — or, when `inout`, into the enclosing FB body's VAR_IN_OUT parameters. */
  slot: number
  path: readonly Access[]
  type: Type
  span: Span
  /** Rooted at a VAR_IN_OUT parameter: the caller's variable, bound for the call (design §9 form 2 — a `&mut`). */
  inout?: boolean
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

export type IrExpr = IrConst | IrLoad | IrBinary | IrUnary | IrConvert | IrBuiltin

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

export type IrStmt = IrAssign | IrIf | IrSwitch | IrLoop | IrBreak | IrContinue | IrReturn | IrCall

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
  /** The VAR_IN_OUT arguments, in the FB's parameter order — the caller's places, bound for the call. */
  inouts: readonly Place[]
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
  section: VarSectionKind | "temp"
  /** The initial value: the declaration's, constant-folded, or the type's zero (`defaultValueOf`). */
  init: IrValue
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
  /** An FB's body, once a call reached it — its places index `fields`, or `inouts` when marked. */
  body?: readonly IrStmt[]
  /** An FB's VAR_IN_OUT parameters, in declaration order. */
  inouts?: readonly IrSlot[]
}

/** A lowered POU: its frame, its body, and the layout of every composite type its frame reaches — dependencies first. */
export interface IrPou {
  name: string
  slots: readonly IrSlot[]
  body: readonly IrStmt[]
  layouts: readonly IrLayout[]
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
