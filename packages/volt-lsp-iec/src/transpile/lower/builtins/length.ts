/**
 * `Standard.LEN_INTERNAL(s)` — the units of a STRING before its first 0, as the IR builtin `length` (task 7.4.6).
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr } from "../../ir/index.js"
import { elementaryRef, elemOf } from "../../../frontend/types/index.js"
import { libraryOf } from "../../../frontend/library/index.js"
import { functionCalled } from "../calls/invoke.js"
import { bodyOf } from "../calls/body.js"
import { lowerPlace } from "../places/places.js"
import { loadValue } from "../places/access-guards.js"
import { LoweringBug } from "../../semantics/faults.js"

/** The most units a UINT counts: LEN_INTERNAL's result type. A longer string's count would wrap, and its ST loop never end. */
const UINT_COUNT = 65535

/**
 * LEN_INTERNAL AS A PRIMITIVE; `null` for any other call. The library repo writes it in ST (`WHILE STR[n] <> 0 DO n := n
 * + 1;`, `libraries/Standard/3.5.18.0/LEN_INTERNAL.pou`, kept — its declaration is the vendor's, held by `repo.test.ts`,
 * and `test/libraries/standard.test.ts` holds this primitive to it), and every Standard string function counts with it;
 * as a builtin it is one `units().len()` instead of a walk, and it only READS its VAR_IN_OUT, so a read-only string reaches
 * it (a Standard function's borrowed input, `calls/string-inputs.ts`). Only the repo's LEN_INTERNAL is: a project
 * FUNCTION of that name is its own, and a Standard version the repo has not written goes on to the call, which refuses
 * its bodyless declaration (`call-library`). Given no variable it stays refused as any in-out is (`lowerPlace`); a string
 * whose count a UINT cannot hold is `string-length-width`.
 */
export function lowerLength(lw: Lowering, e: Extract<Expr, { kind: "call" }>): IrExpr | undefined | null {
  const sym = functionCalled(lw, e.callee)
  if (sym === undefined || sym.name.toUpperCase() !== "LEN_INTERNAL" || libraryOf(sym) !== "Standard") return null
  const ast = sym.ast as Extract<Parameters<typeof bodyOf>[1], { kind: "function" }>
  if ("code" in bodyOf(lw, ast, ast.body, sym.name)) return null
  const arg = e.args.length === 1 ? e.args[0]! : undefined
  // its one argument, positional or `STR :=` — any other shape is the call's to refuse
  if (arg === undefined || arg.output || arg.value === undefined || (arg.param !== undefined && arg.param.name.toUpperCase() !== "STR")) return null
  const value = arg.value
  const place = lw.inArgument(() => lowerPlace(lw, value))
  if (place === undefined) return undefined
  if (elemOf(place.type)?.name !== "STRING") return lw.bail("call-inout-type", `LEN_INTERNAL's STR is a STRING bound to a ${elemOf(place.type)?.name ?? place.type.kind}`, arg.span)
  const capacity = place.type.kind === "elementary" ? place.type.length : undefined
  // every string Type carries its capacity (3.3) — one without is a bug upstream, never a count left unbounded
  if (capacity === undefined) throw new LoweringBug("LEN_INTERNAL of a STRING without a capacity")
  if (capacity > UINT_COUNT) return lw.bail("string-length-width", `LEN_INTERNAL of a STRING(${capacity}), whose length a UINT cannot count`, arg.span)
  const load = loadValue(lw, place, value.span)
  return load && { kind: "builtin", name: "length", args: [load], type: elementaryRef("UINT"), span: e.span }
}
