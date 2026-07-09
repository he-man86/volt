/**
 * comparison checks (types/). A relational operator (`<`, `>`, `<=`, `>=`, `=`, `<>`) applied to operands that
 * can't be compared:
 *   C0066 incompatible-comparison — two scalars neither of which converts to the other (`i > str`).
 *   C0068 compare-array           — an array operand (arrays have no comparison); both same type.
 *   C0069 compare-array-mismatch  — two arrays of different types (`ARRAY[1..2]` vs `ARRAY[1..3]`).
 *   C0354 enum-comparison         — two different enumeration types (`ENUM1.A = ENUM2.X`).
 *
 * C0066 reuses the ONE conversion relation (flag only when BOTH directions are `incompatible`). C0068/C0069
 * fire when either operand is an array, rendering the CODESYS-exact `ARRAY [lo..hi]` form; a non-foldable bound
 * skips (zero-FP). Struct/FB/pointer/unknown operands are still undecidable → skipped.
 */
import { classifyConversion, constEval, inferExprType, type ArrayTypeInfo, type Type } from "../../../types/index.js"
import type { Scope } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

const CMP_OPS = new Set(["<", ">", "<=", ">=", "=", "<>"])

export function checkComparison(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "binary" || !CMP_OPS.has(e.op)) return
    const left = inferExprType(e.left, scope, ctx.project)
    const right = inferExprType(e.right, scope, ctx.project)
    const push = (code: string, message: string): void => {
      out.push({ severity: "error", span: e.span, source: SOURCE, code, message })
    }

    // C0068 / C0069 — an array operand.
    if (left.kind === "array" || right.kind === "array") {
      const ls = left.kind === "array" ? renderArray(left, scope) : undefined
      const rs = right.kind === "array" ? renderArray(right, scope) : undefined
      if (left.kind === "array" && right.kind === "array") {
        if (ls === undefined || rs === undefined) return
        if (ls === rs) push("compare-array", ctx.messages.compareNotPossible(ls))
        else push("compare-array-mismatch", ctx.messages.compareNotPossibleTwo(ls, rs))
        return
      }
      const one = ls ?? rs
      if (one !== undefined) push("compare-array", ctx.messages.compareNotPossible(one))
      return
    }

    // C0354 — two different enumeration types (the specific wording preempts the generic C0066).
    if (left.kind === "enum" && right.kind === "enum" && left.name !== right.name) {
      push("enum-comparison", ctx.messages.enumComparison(left.name, right.name))
      return
    }

    // C0066 — two incomparable scalars.
    const ln = namedType(left)
    const rn = namedType(right)
    if (ln === undefined || rn === undefined) return
    if (classifyConversion(left, right) !== "incompatible" || classifyConversion(right, left) !== "incompatible") return
    push("incompatible-comparison", ctx.messages.cannotCompare(ln, rn))
  })
}

/** The name to render for an operand type, or undefined for undecidable (composite / unknown) types. */
function namedType(t: Type): string | undefined {
  return t.kind === "elementary" || t.kind === "enum" ? t.name : undefined
}

/** The compiler-exact `ARRAY [lo..hi]` render (space, no element type), or undefined if a bound doesn't fold. */
function renderArray(t: ArrayTypeInfo, scope: Scope): string | undefined {
  const parts: string[] = []
  for (const d of t.dims) {
    if (d.lower === undefined || d.upper === undefined) return undefined
    const lo = constEval(d.lower, scope)
    const hi = constEval(d.upper, scope)
    if (typeof lo !== "bigint" || typeof hi !== "bigint") return undefined
    parts.push(`${lo}..${hi}`)
  }
  return `ARRAY [${parts.join(",")}]`
}
