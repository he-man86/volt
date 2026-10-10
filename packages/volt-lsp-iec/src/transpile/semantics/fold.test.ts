/**
 * THE IR CONSTANT FOLD's one rule about throws (transpile-restructure 6.A.9): a FAULT is "not constant" — `1 / 0` in an
 * initializer is the vendor's business — and anything else is a defect that must surface. It swallowed every throw but a
 * `LoweringBug`, so a `TypeError` out of a value function (a node the fold cannot answer) read as "not constant".
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import type { IrExpr } from "../ir/index.js"
import { constantValue } from "./fold.js"

const dint = elementaryRef("DINT")
const span = undefined as never
const k = (value: bigint): IrExpr => ({ kind: "const", value, type: dint, span })

test("a fold that FAULTS is not a constant", () => {
  expect(constantValue({ kind: "binary", op: "div", left: k(1n), right: k(0n), type: dint, span })).toBeUndefined()
  // a character position outside the buffer is a fault too, with its own text (a RangeError, as every fault is)
  const str = { ...elementaryRef("STRING"), length: 3 }
  expect(constantValue({ kind: "builtin", name: "char", args: [{ kind: "const", value: "abc", type: str, span }, k(9n)], type: elementaryRef("BYTE"), span } as IrExpr)).toBeUndefined()
})

test("a fold that throws anything else re-throws it — a defect, not a missing constant", () => {
  // an operator the value functions do not know: `arith` throws a TypeError
  expect(() => constantValue({ kind: "binary", op: "pow" as never, left: k(2n), right: k(3n), type: dint, span })).toThrow(TypeError)
})
