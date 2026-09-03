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

/** A constant, in the same shape the interpreter computes with. TIME is `bigint` nanoseconds. */
export type IrValue = bigint | number | boolean | string

// ─── places ──────────────────────────────────────────────────────────────────

/** One step from a slot toward a sub-location. Empty today; `field`/`index`/`deref` land here. */
export type Access = never

/** A resolved storage location: a slot in the frame, plus a path into it. */
export interface Place {
  slot: number
  path: readonly Access[]
  type: Type
  span: Span
}

// ─── expressions ─────────────────────────────────────────────────────────────

/** Arithmetic/comparison/logic operators, already resolved to ONE meaning per node. */
export type IrBinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "pow"
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

export type IrExpr = IrConst | IrLoad | IrBinary | IrUnary | IrConvert

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
/** An explicit type conversion. Lowering inserts every one of these — a backend never widens implicitly. */
export interface IrConvert {
  kind: "convert"
  value: IrExpr
  type: Type
  span: Span
}

// ─── statements ──────────────────────────────────────────────────────────────

export type IrStmt = IrAssign | IrIf | IrSwitch | IrLoop | IrBreak | IrContinue | IrReturn

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
  /** Constant-folded initial value; `undefined` means "the type's default". */
  init?: IrValue
}

/** A lowered POU: a flat frame plus a body. This IS the "one static memory image" decision, made concrete. */
export interface IrPou {
  name: string
  slots: readonly IrSlot[]
  body: readonly IrStmt[]
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
