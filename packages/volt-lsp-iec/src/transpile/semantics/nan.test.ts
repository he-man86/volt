/**
 * A NaN's BITS through every operation CODESYS recorded (`nan.cases.ts`, transpile-restructure 8.2): the operands loaded
 * from their bits as the image loads them (`floatFromBits`), the operation as the interpreter runs it, the answer stored back
 * as bits (`floatBitsOf`). A REAL was a JavaScript number, whose every NaN is 16#7FC00000 — a signalling NaN, a payload,
 * a sign, all lost (`reinterpret_dint_as_real_edges`, `tr_28_minmax_limit_nan_signed_zero_*`).
 */
import { describe, expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import type { IrBuiltinName } from "../ir/index.js"
import { builtinValue } from "./builtins.js"
import { convertValue } from "./convert.js"
import { NAN_CASES, type NaNInput } from "./nan.cases.js"
import { floatBitsOf, floatFromBits, NaNBits } from "./nan.js"
import { binaryValue, unaryValue } from "./operators.js"
import { storeAs, type Val } from "./value.js"

const REAL = elementaryRef("REAL")
const LREAL = elementaryRef("LREAL")
const BOOL = elementaryRef("BOOL")
const DINT = elementaryRef("DINT")

/** The width an operand of the cell is loaded at: a conversion's source, else the operation's own. */
const widthOf = (input: NaNInput): 32 | 64 =>
  input.op === "widen" ? 32 : input.op === "narrow" ? 64 : input.type === "REAL" ? 32 : 64

/** One cell, run as the interpreter runs it: the answer's bits in hex. */
function run(input: NaNInput): string {
  const type = input.type === "REAL" ? REAL : LREAL
  const args = input.args.map((b) => floatFromBits(b, widthOf(input)) as Val)
  const result = ((): Val => {
    switch (input.op) {
      case "add":
      case "sub":
      case "mul":
      case "div":
        return binaryValue(input.op, args[0]!, args[1]!, type)
      case "neg":
        return unaryValue("neg", args[0]!, type)
      case "copy":
        return storeAs(args[0]!, type)
      case "widen":
        return convertValue(args[0]!, LREAL, REAL)
      case "narrow":
        return convertValue(args[0]!, REAL, LREAL)
      case "sel":
        return builtinValue("sel", [true, ...args], type, [BOOL, type, type])
      case "mux":
        return builtinValue("mux", [1n, ...args], type, [DINT, type, type])
      default:
        return builtinValue(input.op as IrBuiltinName, args, type, args.map(() => type))
    }
  })()
  if (typeof result !== "number" && !(result instanceof NaNBits)) throw new TypeError(`a REAL operation answered ${typeof result}`)
  return floatBitsOf(result, input.type === "REAL" ? 32 : 64).toString(16)
}

describe("a NaN's bits through every recorded operation", () => {
  for (const [rule, cases] of Object.entries(NAN_CASES))
    test(rule, () => {
      expect(cases.map((c) => `${c.name}: ${run(c.input)}`)).toEqual(cases.map((c) => `${c.name}: ${c.expected.toString(16)}`))
    })
})

test("the table holds every recorded cell but the four that mix a REAL with an LREAL", () => {
  expect(Object.values(NAN_CASES).flat()).toHaveLength(87)
})

test("a NaN is no number: one that is not a NaN's bits is refused by name", () => {
  expect(() => new NaNBits(0x7f800000n, 32)).toThrow("7f800000 is no 32-bit NaN")
  expect(floatFromBits(0x7f800000n, 32)).toBe(Infinity)
  expect(floatFromBits(0xffc00000n, 32)).toBeInstanceOf(NaNBits)
})
