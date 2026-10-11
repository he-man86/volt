/**
 * A VALUE'S BYTES READ AT ANOTHER TYPE (`IrReinterpret`, lean 7.8.4) — what a UNION member holds once another one was
 * stored, as Rust says it: `self.u.halves = self.u.whole.to_le_bytes();`, `self.u.whole = u16::from_le_bytes(self.u.halves);`.
 * A byte array IS its bytes; an array of wider elements goes through `iec_bytes` / `iec_elements` (`runtime/bytes.ts`), and
 * two members of different lengths through `iec_overlay`, which lays the shorter's bytes over the longer's. The twin of
 * `semantics/memory.ts` `reinterpret`, held to `memory.cases.ts` by the twin harness.
 */
import type { IrExpr } from "../../ir/index.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import { at, Prec, printed, type Printed } from "./precedence.js"
import { type Printer, use } from "./printer.js"
import type { RuntimeId } from "./runtime/index.js"
import { rustType } from "./types.js"

/** Each Rust scalar a member can be, with its bytes. */
const BYTES: Readonly<Record<string, number>> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, u64: 8, i64: 8, f64: 8 }

/** A member's shape: a scalar of `size` bytes, or an array of `count` such elements (`bytes`: its element is a byte). */
function shape(t: Type): { scalar: string; size: number; count?: number; bytes: boolean } {
  const array = peelArray(t)
  const scalar = rustType(array?.element ?? t)
  const size = BYTES[scalar]
  if (size === undefined) throw new Error(`reinterpret: no byte width for ${scalar}`)
  return array === undefined ? { scalar, size, bytes: false } : { scalar, size: size * array.length, count: array.length, bytes: scalar === "u8" }
}

/** `value` (as Rust text, any precedence) of `from`, read at `to` over its bytes — laid over `over`'s where given (`to`
 *  the longer). `need` records each runtime helper the text calls. */
export function reinterpretText(value: Printed, from: Type, to: Type, over: Printed | undefined, need: (id: RuntimeId) => void): string {
  const [f, t] = [shape(from), shape(to)]
  const bytesOf = (v: Printed, s: ReturnType<typeof shape>): string => {
    if (s.count === undefined) return `${at(v, Prec.Postfix)}.to_le_bytes()`
    if (s.bytes) return at(v, Prec.Block)
    need("iec_bytes")
    return `iec_bytes::<_, ${s.count}, ${s.size}>(${at(v, Prec.Block)})`
  }
  let bytes = bytesOf(value, f)
  if (f.size !== t.size) {
    need("iec_overlay")
    bytes = `iec_overlay(${over === undefined ? `[0u8; ${t.size}]` : bytesOf(over, t)}, ${bytes})`
  }
  if (t.count === undefined) return `${t.scalar}::from_le_bytes(${bytes})`
  if (t.bytes) return bytes
  need("iec_elements")
  return `iec_elements(${bytes})`
}

/** `e` printed (`expr.ts`'s dispatch), its operands by `print`. Two byte arrays of one length are the one value. */
export function exprReinterpret(p: Printer, e: Extract<IrExpr, { kind: "reinterpret" }>, print: (e: IrExpr) => Printed): Printed {
  const value = print(e.value)
  const [f, t] = [shape(e.value.type), shape(e.type)]
  if (f.bytes && t.bytes && f.size === t.size) return value
  const over = e.over === undefined ? undefined : print(e.over)
  return printed(reinterpretText(value, e.value.type, e.type, over, (id) => use(p, id)), Prec.Postfix)
}
