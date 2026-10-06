/**
 * comparison checks (types/). A relational operator (`<`, `>`, `<=`, `>=`, `=`, `<>`) applied to operands that
 * can't be compared:
 *   C0066 incompatible-comparison — two operands neither of which converts to the other (`i > str`), and every pair with
 *                                   ONE array, a struct or a function block instance in it (`a = i`, `s1 = s2`, `t1 = t2`)
 *   C0068 compare-array           — two arrays of one type
 *   C0069 compare-array-mismatch  — two arrays of different types (`ARRAY[1..2]` vs `ARRAY[1..3]`)
 *   C0354 enum-comparison         — two different enumeration types (`ENUM1.A = ENUM2.X`), unless both are values
 *   a pointer against an integer  — refused, a change of sign, or silent by width (`types/compat` `pointerComparison`)
 *
 * Every operand is named as the compiler names its type (`renderType`): an array as its declaration writes it, `ARRAY
 * [1..2, 0..N] OF INT`, its bounds unfolded (`cmpop_array_two_dims`, `cmpop_array_constant_bound`, both vendors
 * 2026-10-06) but an operation in a bound parenthesized (`cmpop_array_bound_expression`); two arrays are one type by
 * their folded bounds (`cmpop_array_bound_spellings`). An interface, a pointer against a non-integer, a reference and an unknown operand are unmeasured and skip.
 */
import { classifyConversion, elementaryRef, inferExprType, isEnumValueRef, isSameType, pointerComparison, renderType, type ArrayTypeInfo, type Type } from "../../../frontend/types/index.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachExpr, targetOf } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { compilerExprText } from "../../shared/expr-echo.js"

const CMP_OPS = new Set(["<", ">", "<=", ">=", "=", "<>"])

export function checkComparison(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "binary" || !CMP_OPS.has(e.op)) return
    const left = inferExprType(e.left, scope, ctx.project)
    const right = inferExprType(e.right, scope, ctx.project)
    const push = (code: string, message: string): void => {
      out.push({ severity: "error", span: e.span, source: SOURCE, code, message })
    }

    // C0068 / C0069 — two arrays, of one type or of two
    if (left.kind === "array" && right.kind === "array") {
      // one type by the FOLDED bounds — `ARRAY[1..2]` and `ARRAY[1..N]` with N = 2 are one, and the message names the
      // left operand as written (`cmpop_array_bound_spellings`, both vendors 2026-10-06); unfoldable bounds compare as written
      const [ls, rs] = [operandText(left), operandText(right)]
      if (sameArray(left, right, ls, rs)) push("compare-array", ctx.messages.compareNotPossible(ls))
      else push("compare-array-mismatch", ctx.messages.compareNotPossibleTwo(ls, rs))
      return
    }
    // C0066 — ONE array, a struct or a function block instance against a named operand, either side: `a1 = i` is
    // "Cannot compare type 'ARRAY [1..2] OF INT' with type 'INT'", `s1 = s2` names the one struct twice (`cmpop_array_vs_scalar`,
    // `cmpop_struct_vs_struct`, `cmpop_struct_vs_int`, `cmpop_fb_vs_fb`, both vendors 2026-10-06)
    if (uncomparable(left) || uncomparable(right)) {
      if (named(left) && named(right)) push("incompatible-comparison", ctx.messages.cannotCompare(operandText(left), operandText(right)))
      return
    }

    // C0354 — two different enumeration types (the specific wording preempts the generic C0066), both names upper-cased
    // (conformance `cc_enum_compare_two_enums`). Two enum VALUES compare silently (`cc_enum_compare_two_enum_values`); a
    // variable against the other enum's value warns as two variables do (`cmpop_enum_var_vs_other_value`, both vendors
    // 2026-10-06); and one enum in two casings is the same enum (`cc_fp_enum_compare_same_enum_other_case`).
    if (left.kind === "enum" && right.kind === "enum" && !isSameType(left, right)) {
      if (!(isEnumValueRef(e.left, scope, ctx.project) && isEnumValueRef(e.right, scope, ctx.project)))
        out.push({
          severity: "warning",
          span: e.span,
          source: SOURCE,
          code: "enum-comparison",
          message: ctx.messages.enumComparison(renderType(left, { form: "compiler" }), renderType(right, { form: "compiler" })),
        })
      return
    }

    // A POINTER against an integer (`types/compat` `pointerComparison`): refused at 32 bits, a change of sign on the
    // POINTER where a signed integer meets it at LINT, silent otherwise — and only on the measured 64-bit target.
    const [ptr, ptrAt, int] = left.kind === "pointer" ? [left, e.left, right] : right.kind === "pointer" ? [right, e.right, left] : []
    if (ptr !== undefined && int?.kind === "elementary") {
      const rule = pointerComparison(int, targetOf(ctx.project))
      if (rule === "incompatible") push("incompatible-comparison", ctx.messages.cannotCompare(renderType(left), renderType(right)))
      else if (rule === "sign-change")
        out.push({
          severity: "warning",
          span: ptrAt!.span,
          source: SOURCE,
          code: "sign-change-conversion",
          message: ctx.messages.signChange("unsigned", renderType(ptr), "signed", renderType(elementaryRef("LINT"), { form: "compiler" })),
        })
      return
    }

    // C0066 — two incomparable scalars.
    if (!scalar(left) || !scalar(right)) return
    if (classifyConversion(left, right) !== "incompatible" || classifyConversion(right, left) !== "incompatible") return
    push("incompatible-comparison", ctx.messages.cannotCompare(left.name, right.name))
  })
}

/**
 * An operand's type as a refused comparison names it: `renderType`, but an array's bound written as an operation is
 * echoed as the compiler echoes one, parenthesized — `ARRAY[0..N-1]` is 'ARRAY [0..(N - 1)] OF INT'
 * (`cmpop_array_bound_expression`, both vendors 2026-10-06; `shared/expr-echo`).
 */
function operandText(t: Type): string {
  if (t.kind !== "array") return renderType(t)
  const bound = (b: Expr | undefined): string => (b === undefined ? "" : compilerExprText(b))
  return `ARRAY [${t.dims.map((d) => (d.dynamic ? "*" : `${bound(d.lower)}..${bound(d.upper)}`)).join(", ")}] OF ${operandText(t.element)}`
}

/** Two arrays of one type: equal folded bounds and one element type, or — a bound that does not fold — the same text. */
function sameArray(l: ArrayTypeInfo, r: ArrayTypeInfo, ls: string, rs: string): boolean {
  if (l.bounds === undefined || r.bounds === undefined) return ls === rs
  if (l.bounds.length !== r.bounds.length || l.bounds.some((b, i) => b.lower !== r.bounds![i]!.lower || b.upper !== r.bounds![i]!.upper)) return false
  const [le, re] = [l.element, r.element]
  return le.kind === "array" && re.kind === "array" ? sameArray(le, re, operandText(le), operandText(re)) : renderType(le) === renderType(re)
}

/** An operand no comparison takes: an array, a struct, a function block INSTANCE (a POU read by its name is unmeasured). */
function uncomparable(t: Type): boolean {
  return t.kind === "array" || t.kind === "struct" || (t.kind === "function_block" && t.byName !== true)
}

/** An operand the compiler names in a refused comparison — every kind the recordings show named. */
function named(t: Type): boolean {
  return scalar(t) || uncomparable(t)
}

function scalar(t: Type): t is Extract<Type, { kind: "elementary" | "enum" }> {
  return t.kind === "elementary" || t.kind === "enum"
}
