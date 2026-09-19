/**
 * WHAT AN IR NODE MEANS, for the nodes whose meaning does not depend on storage.
 *
 * `values.ts` beside this holds the value semantics — `fit`, `coerce`, `arith`, the math and string tables. This
 * holds the three SWITCHES that turn those into a node's answer: a builtin, a unary and a binary. They sat inside
 * the interpreter, which is where the only consumer was.
 *
 * There is a second consumer now. A declaration's initial value may be a call — `ANY_TO_DINT(16#80000000)`,
 * `(SHL(UINT_TO_DWORD(x), 16) OR 16#1)`, `SIZEOF(T)` — and CODESYS folds those to exactly what the same expression
 * computes at run time (`declarations/constant-folding.ts`, 29 probes, 2026-09-19). "Exactly" is a claim a second
 * implementation cannot keep, so lowering folds by evaluating the IR it just built, through these functions, and
 * the interpreter's `expr` delegates to the same ones. One table, two callers.
 *
 * It lives in `ir/` because that is the only folder inside `transpile/` that lowering and the backends share — and
 * because a node's meaning belongs with the node, not with one of the things that executes it.
 */
import type { IrBuiltinName, IrExpr } from "./ir.js"
import type { Type } from "../../types/index.js"
import { arith, bool, coerce, eq, fit, logic, MATH, num, ord, STRING_FUNCTIONS, type Val } from "./values.js"

/** A shift or rotate happens in the NODE's width. Lowering always types these from a promoted operand, so anything
 *  else is a lowering bug — reported as one rather than silently treated as 32 bits. */
function widthOf(type: Type, op: string): number {
  if (type.kind !== "elementary") throw new LoweringBug(`${op.toUpperCase()} on a ${type.kind}, which lowering should have typed`)
  return type.elem.bits
}

/**
 * A throw that means LOWERING IS WRONG, not that the program faulted — kept apart from an ordinary fault because
 * `constantValue` catches those. Caught there too, it would turn "lowering should have typed this" back into
 * "not a compile-time constant", which is the silence the throw exists to break.
 */
export class LoweringBug extends TypeError {}

/** A builtin over ALREADY-EVALUATED arguments. */
export function builtinValue(name: IrBuiltinName, args: readonly Val[], type: Type): Val {
  const pick = (op: "lt" | "gt"): Val => args.reduce((best, v) => (ord(op, v, best) ? v : best))
  switch (name) {
    case "max":
      return fit(pick("gt"), type)
    case "min":
      return fit(pick("lt"), type)
    case "limit": {
      // MIN(MAX(IN, MN), MX) — measured; with MN > MX that is MX for every IN
      const [mn, value, mx] = args as [Val, Val, Val]
      const raised = ord("gt", value, mn) ? value : mn
      return fit(ord("lt", raised, mx) ? raised : mx, type)
    }
    case "sel":
      return fit(bool(args[0]!) ? args[2]! : args[1]!, type)
    case "trunc": {
      // Toward zero into a DINT whose out-of-range answer is DINT's MINIMUM — x86's "integer indefinite":
      // TRUNC(3.0E9) is -2147483648, where LREAL_TO_DINT(3.0E9) wraps to -1294967296 (conformance
      // `trunc_out_of_range`). TRUNC_INT then wraps that DINT into INT, as `fit` does for every integer.
      const t = Math.trunc(Number(num(args[0]!)))
      const inRange = Number.isFinite(t) && t >= -2147483648 && t <= 2147483647
      return fit(inRange ? BigInt(t) : -2147483648n, type)
    }
    // THE WIDTH IS THE NODE'S, and lowering always types these — a shift or rotate is built from a promoted
    // operand, so a non-elementary type here is a lowering bug, not a 32-bit value. Defaulting to 32 gave a
    // BYTE or a LWORD the wrong mask and the wrong wrap, silently and only for the case that never happens.
    case "shl":
    case "shr": {
      // x86's count mask: SHL(DWORD 1, 33) is 2 and a count of -1 shifts by 31 (conformance `shift_count_*`,
      // `shift_negative_count`). The value is already promoted, and a bigint `>>` is arithmetic on a negative —
      // SHR(SINT -128, 1) is -64, as measured.
      const bits = widthOf(type, name)
      const count = BigInt(Number(num(args[1]!)) & (bits - 1))
      const value = num(args[0]!) as bigint
      return fit(name === "shl" ? value << count : value >> count, type)
    }
    case "rol":
    case "ror": {
      // in the value's own width, count modulo that width — ROL(BYTE 129, 9) is 3 (conformance `rotate_*`)
      const bits = widthOf(type, name)
      const width = BigInt(bits)
      const left = BigInt(((Number(num(args[1]!)) % bits) + bits) % bits)
      const by = name === "rol" ? left : (width - left) % width
      const unsigned = BigInt.asUintN(bits, num(args[0]!) as bigint)
      return fit(BigInt.asUintN(bits, (unsigned << by) | (unsigned >> ((width - by) % width))), type)
    }
    case "mux": {
      // an out-of-range K — negative included — picks the LAST input (conformance `mux_out_of_range`)
      const k = Number(num(args[0]!))
      const inputs = args.slice(1)
      return fit(k >= 0 && k < inputs.length ? inputs[k]! : inputs[inputs.length - 1]!, type)
    }
    case "expt":
      // float64, narrowed by `fit` when lowering typed it REAL (both arguments REAL) — matches CODESYS's digits
      return fit(Math.pow(Number(num(args[0]!)), Number(num(args[1]!))), type)
    case "abs": {
      // in the promoted type lowering chose; `fit` wraps a signed minimum back to itself
      const v = args[0]!
      return fit(typeof v === "bigint" ? (v < 0n ? -v : v) : Math.abs(Number(v)), type)
    }
    case "len":
    case "left":
    case "right":
    case "mid":
    case "concat":
    case "insert":
    case "delete":
    case "replace":
    case "find":
      return fit(STRING_FUNCTIONS[name]([...args]), type)
    case "sqrt":
    case "ln":
    case "log":
    case "exp":
    case "sin":
    case "cos":
    case "tan":
    case "asin":
    case "acos":
    case "atan":
      // computed in float64, then `fit` narrows a REAL to float32 — the oracle checks this matches CODESYS's digits
      return fit(MATH[name](Number(num(args[0]!))), type)
  }
}

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
export function binaryValue(op: string, l: Val, r: Val, type: Type): Val {
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
      return fit(e.value, e.type)
    case "convert": {
      const inner = evaluate(e.value)
      return inner === undefined ? undefined : fit(coerce(inner, e.type, e.value.type), e.type)
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
      if (e.op === "and_then") return bool(l) && bool(r)
      if (e.op === "or_else") return bool(l) || bool(r)
      return binaryValue(e.op, l, r, e.type)
    }
    case "builtin": {
      const args: Val[] = []
      for (const a of e.args) {
        const v = evaluate(a)
        if (v === undefined) return undefined
        args.push(v)
      }
      return builtinValue(e.name, args, e.type)
    }
    default:
      return undefined
  }
}
