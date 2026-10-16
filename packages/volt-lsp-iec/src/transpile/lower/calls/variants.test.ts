/**
 * `typeKey` — a routine variant's identity. Two types that store differently must never share a key: a shared key makes
 * the second call reuse the first's instantiation, its hidden in-out typed for the FIRST type (transpile-review 42, the
 * array case). It fell back to the bare kind for everything past ARRAY, so `POINTER TO INT` and `POINTER TO REAL` were
 * both `pointer`; no call reaches the key with one today (an ANY of a pointer is refused unmeasured, a REFERENCE passes
 * its target, an enum its base), which is why it could hide. A kind that can never reach a key is refused, not guessed.
 */
import { expect, test } from "bun:test"
import { elementaryRef, UNKNOWN, type Type } from "../../../frontend/types/index.js"
import { LoweringBug } from "../../semantics/faults.js"
import { typeKey } from "./variants.js"

const INT = elementaryRef("INT")
const REAL = elementaryRef("REAL")

test("a pointer and a reference are keyed by their target, recursively", () => {
  const ptr = (target: Type): Type => ({ kind: "pointer", target })
  const ref = (target: Type): Type => ({ kind: "reference", target })
  expect(typeKey(ptr(INT))).not.toBe(typeKey(ptr(REAL)))
  expect(typeKey(ptr(INT))).toBe(typeKey(ptr(elementaryRef("INT"))))
  expect(typeKey(ref(INT))).not.toBe(typeKey(ref(REAL)))
  expect(typeKey(ptr(INT))).not.toBe(typeKey(ref(INT)))
  expect(typeKey(ptr(ptr(INT)))).not.toBe(typeKey(ptr(ptr(REAL))))
})

test("an enum and an interface are keyed by their name", () => {
  expect(typeKey({ kind: "enum", name: "E_A" })).not.toBe(typeKey({ kind: "enum", name: "E_B" }))
  expect(typeKey({ kind: "interface", name: "I_A" })).not.toBe(typeKey({ kind: "interface", name: "I_B" }))
})

test("a type no variant can be named by is refused, not keyed by its bare kind", () => {
  expect(() => typeKey(UNKNOWN)).toThrow(LoweringBug)
  expect(() => typeKey({ kind: "static", denotes: "gvl", name: "GVL" })).toThrow(LoweringBug)
})
