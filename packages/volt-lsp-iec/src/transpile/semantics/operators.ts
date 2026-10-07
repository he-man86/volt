/** WHAT A UNARY OR BINARY NODE MEANS over already-evaluated operands. */
import type { IrBinOp } from "../ir/index.js"
import type { Type } from "../../frontend/types/index.js"
import { bool, type Val } from "./value.js"
import { arith, eq, logic, ord } from "./arith.js"
import { fit } from "./store.js"

/** A unary over an ALREADY-EVALUATED operand. */
export function unaryValue(op: "neg" | "not", operand: Val, type: Type): Val {
  // A REAL IS NEGATED, not subtracted from zero. IEEE-754 says -(0.0) is -0.0 while 0.0 - 0.0 is +0.0, so
  // computing it as a subtraction silently dropped the sign — where the emitter prints `-x` and keeps it.
  // An INTEGER keeps the subtraction: that is what wraps at the width's minimum, matching `wrapping_neg`
  // (`unary_minus_at_the_edge`, a DINT at its minimum, which Rust's own `-` panics on in a debug build).
  if (op === "neg") return typeof operand === "number" ? fit(-operand, type) : fit(arith("sub", 0n, operand), type)
  return typeof operand === "bigint" ? fit(~operand, type) : !bool(operand)
}

/**
 * A binary over TWO ALREADY-EVALUATED operands — so `and_then` and `or_else` are not here: the only reason those
 * are distinct nodes is that they must not evaluate the right side, which is the caller's business.
 */
export function binaryValue(op: IrBinOp, l: Val, r: Val, type: Type): Val {
  switch (op) {
    case "eq":
      return eq(l, r)
    case "ne":
      return !eq(l, r)
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return ord(op, l, r)
    case "and":
    case "or":
    case "xor":
      return logic(op, l, r)
    default:
      return fit(arith(op, l, r, type), type)
  }
}
