/**
 * THE IR CONSTANT FOLD. A declaration's initial value may be a call — `ANY_TO_DINT(16#80000000)`,
 * `(SHL(UINT_TO_DWORD(x), 16) OR 16#1)`, `SIZEOF(T)` — and CODESYS folds those to exactly what the same expression
 * computes at run time (`declarations/constant-folding.ts`, 29 probes, 2026-09-19). "Exactly" is a claim a second
 * implementation cannot keep, so lowering folds by evaluating the IR it just built, through the same functions the
 * interpreter runs.
 */
import type { IrExpr } from "../ir/index.js"
import type { Val } from "./value.js"
import { constValue, convertValue } from "./convert.js"
import { shortCircuit } from "./arith.js"
import { builtinValue } from "./builtins.js"
import { binaryValue, unaryValue } from "./operators.js"
import { LoweringBug } from "./faults.js"

/**
 * AN IR EXPRESSION WHOSE EVERY LEAF IS A CONSTANT — the value it has before anything runs, or undefined.
 *
 * Lowering uses it for a declaration's initial value. An expression that would read storage or call something
 * reaches a `load`, `invoke`, `dispatch` or `fresh` node, which cannot be answered without a frame: those are not
 * constant, and they are REJECTED rather than guessed at.
 *
 * A fold that FAULTS is not a value either — `1 / 0` in an initializer is the vendor's business, not a silent zero.
 * A `LoweringBug` is neither and is re-thrown: swallowing it would restore the silence it exists to break.
 */
export function constantValue(e: IrExpr): Val | undefined {
  try {
    return evaluate(e)
  } catch (error) {
    // a FAULT is not a value — `1 / 0` in an initializer is the vendor's business. A LoweringBug is not a fault.
    if (error instanceof LoweringBug) throw error
    return undefined
  }
}

function evaluate(e: IrExpr): Val | undefined {
  switch (e.kind) {
    case "const":
      return constValue(e.value, e.type)
    case "convert": {
      const inner = evaluate(e.value)
      return inner === undefined ? undefined : convertValue(inner, e.type, e.value.type)
    }
    case "unary": {
      const operand = evaluate(e.operand)
      return operand === undefined ? undefined : unaryValue(e.op, operand, e.type)
    }
    case "binary": {
      const l = evaluate(e.left)
      const r = evaluate(e.right)
      if (l === undefined || r === undefined) return undefined
      // the short-circuit forms are ordinary here: both sides are constants, so neither can have an effect to skip
      if (e.op === "and_then" || e.op === "or_else") return shortCircuit(e.op, () => l, () => r)(undefined)
      return binaryValue(e.op, l, r, e.type)
    }
    case "builtin": {
      const args: Val[] = []
      for (const a of e.args) {
        const v = evaluate(a)
        if (v === undefined) return undefined
        args.push(v)
      }
      return builtinValue(e.name, args, e.type, e.args.map((a) => a.type), e.bits)
    }
    default:
      return undefined
  }
}
