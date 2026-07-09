/**
 * constant-too-large (C0001 · types/). A literal constant whose value CANNOT be represented by its own
 * type — the zero-FP subset that needs no type inference of the assignment target:
 *   (a) a typed literal past its own prefix type       — `INT#123456`  → type `INT`
 *   (b) an untyped integer past the widest IEC integer — `999…911`     → type `ANY_INT`
 *   (c) a real literal past LREAL magnitude            — `10E500`      → type `ANY_REAL`
 *
 * We deliberately do NOT flag "fits some type but not the assignment target" (that is C0032, ambiguous and
 * target-dependent). Only provable overflows are reported, so it stays quiet on the corpus. Message is the
 * literal's own text (`INT#123456`, `10E500`), matching the compiler.
 */
import type { Literal } from "../../../syntax/index.js"
import { elementaryType, REAL_MAX_MAGNITUDE } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

// The widest IEC integer range: no integer type holds a value outside [LINT.min .. ULINT.max].
const ANY_INT_MIN = elementaryType("LINT")!.range!.min
const ANY_INT_MAX = elementaryType("ULINT")!.range!.max
const LREAL_MAX = REAL_MAX_MAGNITUDE.get("LREAL")!

export function checkConstantOverflow(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    if (e.kind !== "literal") return
    const type = overflowType(e)
    if (type === undefined) return
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "constant-too-large",
      message: ctx.messages.constantTooLarge(e.text, type),
    })
  })
}

/** The type name a literal overflows, or undefined if it is representable. */
function overflowType(lit: Literal): string | undefined {
  if (lit.literalKind === "typed" && lit.prefix !== undefined) {
    const et = elementaryType(lit.prefix)
    if (et?.range !== undefined && typeof lit.value === "bigint")
      return lit.value < et.range.min || lit.value > et.range.max ? et.name : undefined
    const mag = REAL_MAX_MAGNITUDE.get(lit.prefix) // REAL#/LREAL#
    if (mag !== undefined && typeof lit.value === "number")
      return !Number.isFinite(lit.value) || Math.abs(lit.value) > mag ? lit.prefix : undefined
    return undefined
  }
  if (lit.literalKind === "int" && typeof lit.value === "bigint")
    return lit.value < ANY_INT_MIN || lit.value > ANY_INT_MAX ? "ANY_INT" : undefined
  if (lit.literalKind === "real" && typeof lit.value === "number")
    return !Number.isFinite(lit.value) || Math.abs(lit.value) > LREAL_MAX ? "ANY_REAL" : undefined
  return undefined
}
