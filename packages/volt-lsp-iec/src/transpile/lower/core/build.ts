/** IR BUILDERS — the small node constructors every lowering folder shares: a cast, a binary node, the span of nothing. */

import type { IrBinOp, IrExpr } from "../../ir/index.js"
import type { Type } from "../../../frontend/types/index.js"
import type { Span } from "../../../frontend/syntax/index.js"

/** An explicit conversion node, even between a pointer and an integer — `convert` returns the value unchanged when either
 *  side is not elementary, and the emitted Rust then assigned an `i64` expression to a `usize` pointer field. */
export function cast(e: IrExpr, to: Type): IrExpr {
  return { kind: "convert", value: e, type: to, span: e.span }
}

/** A binary node of a type the caller states — pointer arithmetic, where no operator typing applies. */
export function binaryOf(op: IrBinOp, left: IrExpr, right: IrExpr, type: Type, span: Span): IrExpr {
  return { kind: "binary", op, left, right, type, span }
}

/** The span of nothing: a diagnostic about a source with no unit to point at. */
export const ZERO_SPAN: Span = { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
