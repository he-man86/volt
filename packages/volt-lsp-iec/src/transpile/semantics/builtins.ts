/**
 * WHAT A BUILTIN NODE MEANS over already-evaluated arguments. Lowering folds a declaration's initial value through it
 * (`fold.ts`) and the interpreter computes with it — one table, two callers, so a folded value and a computed one
 * cannot disagree (`declarations/constant-folding.ts`, 29 probes, 2026-09-19).
 */
import type { IrBuiltinName } from "../ir/index.js"
import { type Type, widthOf as typeWidth } from "../../frontend/types/index.js"
import { bool, num, type Val } from "./value.js"
import { ord } from "./arith.js"
import { fit } from "./store.js"
import { expt, MATH } from "./math.js"
import { charAt, setChar } from "./string.js"
import { LoweringBug } from "./faults.js"

/** A shift or rotate happens in the NODE's width. Lowering always types these from a promoted operand, so anything
 *  else is a lowering bug — reported as one rather than silently treated as 32 bits. */
function widthOf(type: Type, op: string): number {
  const bits = typeWidth(type)
  if (bits === undefined) throw new LoweringBug(`${op.toUpperCase()} on a ${type.kind}, which lowering should have typed`)
  return bits
}

/**
 * The one argument SEL or MUX evaluates after its selector — its index in the node's `args`. An out-of-range MUX K,
 * negative included, picks the LAST input (conformance `mux_out_of_range`). See `IrBuiltinName` for why only one.
 */
export function selectedArg(name: "sel" | "mux", selector: Val, arity: number): number {
  if (name === "sel") return bool(selector) ? 2 : 1
  const k = Number(num(selector))
  return k >= 0 && k < arity - 1 ? k + 1 : arity - 1
}

/** A builtin over ALREADY-EVALUATED arguments — `argTypes` their types, which `char` reads its string's capacity from. */
export function builtinValue(name: IrBuiltinName, args: readonly Val[], type: Type, argTypes: readonly Type[], rotateBits?: number): Val {
  // MAX(a, b) is `IF a > b THEN a ELSE b` and MIN(a, b) `IF a < b THEN a ELSE b`: the SECOND argument on a tie or a NaN
  // — MAX(NaN, 1) is 1, MAX(1, NaN) NaN, MAX(-0, +0) +0 and MAX(+0, -0) -0 (conformance
  // `tr_28_minmax_limit_nan_signed_zero_*`, recorded as bits; transpile-review-2026-09-29 task 28).
  const select = (op: "lt" | "gt", a: Val, b: Val): Val => (ord(op, a, b) ? a : b)
  switch (name) {
    case "max":
      return fit(args.reduce((a, b) => select("gt", a, b)), type)
    case "min":
      return fit(args.reduce((a, b) => select("lt", a, b)), type)
    case "limit": {
      // MIN(MAX(MN, IN), MX) — measured; with MN > MX that is MX for every IN, and LIMIT(0, 1, NaN) is NaN
      const [mn, value, mx] = args as [Val, Val, Val]
      return fit(select("lt", select("gt", mn, value), mx), type)
    }
    case "sel":
    case "mux":
      return fit(args[selectedArg(name, args[0]!, args.length)]!, type)
    case "trunc": {
      // Toward zero into a DINT whose out-of-range answer is DINT's MINIMUM — x86's "integer indefinite":
      // TRUNC(3.0E9) is -2147483648, where LREAL_TO_DINT(3.0E9) wraps to -1294967296 (conformance
      // `trunc_out_of_range`). TRUNC_INT then wraps that DINT into INT, as `fit` does for every integer.
      const t = Math.trunc(Number(num(args[0]!)))
      const inRange = Number.isFinite(t) && t >= -2147483648 && t <= 2147483647
      return fit(inRange ? BigInt(t) : -2147483648n, type)
    }
    case "shl":
    case "shr":
    case "rol":
    case "ror":
      return fit(bitValue(name, args, type, rotateBits), type)
    case "expt":
      // C's `pow` in float64 (`expt`: not `Math.pow`), narrowed by `fit` when lowering typed it REAL (both arguments REAL)
      return fit(expt(Number(num(args[0]!)), Number(num(args[1]!))), type)
    case "abs": {
      // in the promoted type lowering chose; `fit` wraps a signed minimum back to itself
      const v = args[0]!
      return fit(typeof v === "bigint" ? (v < 0n ? -v : v) : Math.abs(Number(v)), type)
    }
    case "char":
    case "setchar":
      return stringBuiltin(name, args, type, argTypes)
    // an order of two addresses needs the image they point into — the interpreter's machine computes it (`Memory.order`)
    case "address_order":
      throw new LoweringBug("address_order has no value without the program's image")
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

/**
 * SHL, SHR, ROL and ROR — the bits, before `fit` stores them at the node's type. THE WIDTH IS THE NODE'S, and lowering
 * always types these — a shift or rotate is built from a promoted operand, so a non-elementary type here is a lowering
 * bug, not a 32-bit value. Defaulting to 32 gave a BYTE or a LWORD the wrong mask and the wrong wrap, silently and only
 * for the case that never happens.
 */
function bitValue(name: "shl" | "shr" | "rol" | "ror", args: readonly Val[], type: Type, rotateBits: number | undefined): bigint {
  switch (name) {
    case "shl":
    case "shr": {
      // x86's count mask: SHL(DWORD 1, 33) is 2 and a count of -1 shifts by 31 (conformance `shift_count_*`,
      // `shift_negative_count`). The value is already promoted, and a bigint `>>` is arithmetic on a negative —
      // SHR(SINT -128, 1) is -64, as measured. The count is masked as the exact integer it is: a ULINT count above 2^53
      // went through `Number()` and lost its low bits (6.A.4).
      const bits = widthOf(type, name)
      const count = countOf(args[1]!) & BigInt(bits - 1)
      const value = num(args[0]!) as bigint
      return name === "shl" ? value << count : value >> count
    }
    case "rol":
    case "ror": {
      // in the value's own width, count modulo that width — ROL(BYTE 129, 9) is 3 (conformance `rotate_*`) — or in the
      // node's `bits`, the bits above them kept as they are (conformance `rotate_of_expression`). Its `asUintN` is the
      // pattern it rotates, not a store: `storeInteger` (6.B.2) would sign the result and drop the bits above
      const bits = rotateBits ?? widthOf(type, name)
      const width = BigInt(bits)
      const left = ((countOf(args[1]!) % width) + width) % width
      const by = name === "rol" ? left : (width - left) % width
      const value = num(args[0]!) as bigint
      const unsigned = BigInt.asUintN(bits, value)
      return (value - unsigned) | BigInt.asUintN(bits, (unsigned << by) | (unsigned >> ((width - by) % width)))
    }
  }
}

/** A shift or rotate count as the exact integer it is — never through `Number()`, which rounds one above 2^53 (6.A.4). */
const countOf = (v: Val): bigint => {
  const n = num(v)
  if (typeof n !== "bigint") throw new LoweringBug("a shift or rotate count that is not an integer, which lowering should have typed")
  return n
}

/** CHAR and SETCHAR — a string's byte read, or stored and cut at the capacity lowering stated. */
function stringBuiltin(name: "char" | "setchar", args: readonly Val[], type: Type, argTypes: readonly Type[]): Val {
  switch (name) {
    case "char": {
      const text = argTypes[0]!
      const capacity = text.kind === "elementary" ? text.length : undefined
      if (capacity === undefined) throw new LoweringBug("CHAR of a string whose capacity lowering did not state")
      return fit(charAt(args[0] as string, num(args[1]!) as bigint, capacity), type)
    }
    case "setchar": {
      // the capacity is where a store is cut, and lowering gives every `setchar` one (`lowerIndexed`) — a node without
      // it would let the interpreter append past the capacity the emitted Rust panics at
      const capacity = type.kind === "elementary" ? type.length : undefined
      if (capacity === undefined) throw new LoweringBug("SETCHAR on a string whose capacity lowering did not state")
      return setChar(args[0] as string, num(args[1]!) as bigint, num(args[2]!) as bigint, capacity)
    }
  }
}
