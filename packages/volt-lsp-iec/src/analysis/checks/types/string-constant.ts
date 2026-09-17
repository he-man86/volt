/**
 * string-constant-too-long (C0198 · types/). A string literal longer than its `STRING(n)`/`WSTRING(n)` destination,
 * whether that destination is a declaration's initializer (`str : STRING(4) := '12345'`) or an assignment's target
 * (`str := '12345';`).
 *
 * An `ARRAY … OF STRING(n)` is the same destination once per element: `texts : ARRAY[0..2] OF STRING(4) :=
 * ['a', 'bcdef']` warns about `'bcdef'` and nothing else (conformance `array_initializers`). The element type
 * carries the size, so the only new part is walking the aggregate.
 *
 * Zero-FP: the length compared is the DECODED character count — IEC `$` escapes (`$T` tab, `$$`, `$0D` hex, …)
 * are one character each, so `STRING(1) := '$T'` is fine. Only a sized destination with a const-foldable length
 * and a string-literal source fires, on a strict over-length; a sizeless `STRING` is skipped.
 */
import { decodeStringLiteral, renderTypeExpr, walkStatements, type AggregateElement, type Expr, type Initializer } from "../../../syntax/index.js"
import { constEval, inferExprType, type Type } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import { pushForDeclaration, SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkStringConstant(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope, section, unit } of forEachDecl(ctx.parseResult, ctx.project)) {
    // The sized string a declaration stores into — its own type, or an array's ELEMENT type.
    const sized = decl.type.kind === "array_type" ? decl.type.element : decl.type
    if (sized.kind !== "string_type" || sized.length === undefined) continue
    const size = constEval(sized.length, scope)
    if (typeof size !== "bigint") continue
    const wide = sized.wide === true
    const rendered = renderTypeExpr(sized)
    if (decl.type.kind === "array_type") {
      // One destination per element, in source order. `repeat` (`3('abc')`) wraps its value and is unwrapped —
      // the count does not change whether the constant fits; `unparsed` is skipped, as everywhere else here.
      for (const value of aggregateValues(decl.init)) {
        const diag = tooLong(value, wide, Number(size), rendered, ctx.messages)
        if (diag !== undefined) pushForDeclaration(out, unit, section, diag)
      }
      continue
    }
    const diag = tooLong(decl.init, wide, Number(size), rendered, ctx.messages)
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

/** Every scalar value an array initializer holds, flattened — nested `[…]` for a multi-dimensional array, and
 *  `n(<value>)` repeats unwrapped to the value they repeat. A `field` element belongs to a struct and is not
 *  reached from an array; `unparsed` is the parser's conservative skip signal and stays skipped. */
function aggregateValues(init: Initializer | undefined): Expr[] {
  if (init === undefined || init.kind !== "aggregate_init") return []
  const out: Expr[] = []
  const walk = (el: AggregateElement): void => {
    if (el.kind === "value") out.push(el.expr)
    else if (el.kind === "nested") for (const e of el.init.elements) walk(e)
    else if (el.kind === "repeat" || el.kind === "field") walk(el.value)
  }
  for (const el of init.elements) walk(el)
  return out
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
