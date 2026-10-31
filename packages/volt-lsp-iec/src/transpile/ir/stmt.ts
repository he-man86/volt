/** THE IR'S STATEMENTS. See `ir/index.ts` for the two decisions behind the IR. */
import type { Span } from "../../frontend/syntax/index.js"
import type { IrBinding, IrDispatch, IrExpr, IrInvoke, IrSelect, Place } from "./expr.js"
import type { IrValue } from "./program.js"

// ─── statements ──────────────────────────────────────────────────────────────

export type IrStmt = IrAssign | IrIf | IrSwitch | IrLoop | IrBreak | IrContinue | IrReturn | IrCall | IrEval | IrLabeled | IrJump

/** A METHOD, ACTION or FUNCTION called as a statement — directly or through an interface; its result, if any, is dropped. */
export interface IrEval {
  kind: "eval"
  value: IrInvoke | IrDispatch | IrSelect
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
   *  from outside the FB's run dispatches on (`lower/calls/last-binding.ts`). Filled once the POU has lowered, when one does. */
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
/**
 * A BODY WHOSE TOP LEVEL HOLDS A LABEL A JMP NAMES (openspec lower-jumps-and-labels): its statements cut at each such
 * label into segments, run in order — a segment that ends normally goes on to the next, and a `jump` anywhere inside goes
 * on at the segment it names. Labels stand only here, at a body's top level; a network body's labels are its one
 * statement list's, so a jump crosses networks as it crosses ST lines. A RETURN leaves the body as anywhere.
 */
export interface IrLabeled {
  kind: "labeled"
  segments: readonly IrSegment[]
  span: Span
}
/** A segment of a `labeled` body: the label it starts at (none for the statements before the first one), and its run. */
export interface IrSegment {
  label?: string
  body: readonly IrStmt[]
}
/** `JMP l;`: go on at segment `target` of the `labeled` body around it — one past its last segment (a label at the body's
 *  end) leaves the body. A conditional jump is an IF holding one. */
export interface IrJump {
  kind: "jump"
  target: number
  label: string
  span: Span
}
