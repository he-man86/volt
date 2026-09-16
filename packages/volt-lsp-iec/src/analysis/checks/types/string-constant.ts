/**
 * string-constant-too-long (C0198 · types/). A string literal longer than its `STRING(n)`/`WSTRING(n)` destination,
 * whether that destination is a declaration's initializer (`str : STRING(4) := '12345'`) or an assignment's target
 * (`str := '12345';`).
 *
 * Zero-FP: the length compared is the DECODED character count — IEC `$` escapes (`$T` tab, `$$`, `$0D` hex, …)
 * are one character each, so `STRING(1) := '$T'` is fine. Only a sized destination with a const-foldable length
 * and a string-literal source fires, on a strict over-length; a sizeless `STRING` is skipped.
 */
import { decodeStringLiteral, renderTypeExpr, walkStatements, type Expr, type Initializer } from "../../../syntax/index.js"
import { constEval, inferExprType, type Type } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import { pushForDeclaration, SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkStringConstant(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope, section, unit } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.type.kind !== "string_type" || decl.type.length === undefined) continue
    const size = constEval(decl.type.length, scope)
    if (typeof size !== "bigint") continue
    const diag = tooLong(decl.init, decl.type.wide === true, Number(size), renderTypeExpr(decl.type), ctx.messages)
    if (diag !== undefined) pushForDeclaration(out, unit, section, diag)
  }
  // An assignment's target is the same destination: `eight : STRING(8); eight := 'seventeen';` warns exactly as the
  // declaration form does (conformance `xo4_string_constant_too_long`, ten capacities across STRING and WSTRING).
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign") return
      // each `:=` link is its own store, so `a := b := 'toolong'` warns for the link that takes the literal
      const places = [s.target, ...(s.chained ?? [])]
      const ops = [s.op, ...(s.chainOps ?? [])]
      places.forEach((place, i) => {
        if (ops[i] !== undefined) return
        const dest = inferExprType(place, scope, ctx.project)
        if (dest.kind !== "elementary" || dest.length === undefined) return
        if (dest.name !== "STRING" && dest.name !== "WSTRING") return
        const diag = tooLong(places[i + 1] ?? s.value, dest.name === "WSTRING", dest.length, renderType(dest), ctx.messages)
        if (diag !== undefined) out.push(diag)
      })
    })
  }
}

/** The warning for one literal → sized-string destination pair, or undefined when it fits (or is not a literal). */
function tooLong(value: Initializer | Expr | undefined, wide: boolean, size: number, type: string, messages: Messages): DiagnosticItem | undefined {
  if (value === undefined || value.kind !== "literal" || typeof value.value !== "string") return undefined
  // the shared decoder's length — an escape it does not know has no measured length, so nothing is reported. A WSTRING
  // counts UTF-16 code units and prints its prefix by the same rule (conformance `wstring_code_units`,
  // `cc_wstring_init_too_long_2`/`_7`: `'"a...'`, `'"abc...'`).
  const decoded = decodeStringLiteral(value.value, wide)
  if (decoded === undefined || decoded.length <= size) return undefined
  return {
    // a WARNING, recorded twice (`cc_string_plain_init_too_long`, `cc_string_escape_init_too_long`) — the documentation
    // catalog this check was written from said error
    severity: "warning",
    span: value.span,
    source: SOURCE,
    code: "string-constant-too-long",
    // the literal as written (quotes and escapes included) — the compiler prints a prefix of that text, not the value
    message: messages.stringConstantTooLong(value.text, size, type),
  }
}

/** `STRING(8)` — an inferred destination's spelling, which the declaration form gets from `renderTypeExpr`. */
function renderType(t: Extract<Type, { kind: "elementary" }>): string {
  return `${t.name}(${String(t.length)})`
}
