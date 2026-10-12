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
import { decodeStringLiteral, compilerTypeText, walkStatements, type AggregateElement, type Expr, type Initializer, type TypeExpr } from "../../../frontend/syntax/index.js"
import { constEval, inferExprType, renderType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { bodies, forEachDecl, lookup } from "../../../frontend/symbols/index.js"
import { pushForDeclaration, SOURCE, withFixes, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, replaceText } from "../../shared/fixes.js"

export function checkStringConstant(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope, section, unit } of forEachDecl(ctx.parseResult, ctx.project)) {
    // The sized string a declaration stores into — its own type, or an array's ELEMENT type.
    const sized = decl.type.kind === "array_type" ? decl.type.element : decl.type
    if (sized.kind !== "string_type" || sized.length === undefined) continue
    const size = constEval(sized.length, scope)
    if (typeof size !== "bigint") continue
    const wide = sized.wide === true
    const rendered = compilerTypeText(sized)
    if (decl.type.kind === "array_type") {
      // One destination per element, in source order. `repeat` (`3('abc')`) wraps its value and is unwrapped —
      // the count does not change whether the constant fits; `unparsed` is skipped, as everywhere else here.
      for (const value of aggregateValues(decl.init)) {
        const diag = tooLong(value, wide, Number(size), rendered, ctx)
        if (diag !== undefined) pushForDeclaration(out, unit, section, diag)
      }
      continue
    }
    const diag = tooLong(decl.init, wide, Number(size), rendered, ctx)
    if (diag !== undefined && decl.init !== undefined && decl.init.kind !== "aggregate_init")
      pushForDeclaration(out, unit, section, withFixes(diag, lengthFixes(ctx, decl.init, sized, Number(size))))
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
        // …but not a VAR_IN_OUT: the literal into one builds unwarned on both vendors, a FUNCTION's or an FB's
        // (`string_inout_wider_stores`, `string_literal_into_fb_inout_too_long`, 2026-10-11; lsp-transpile-review-gaps 2.6) —
        // as through a REFERENCE (whose type is no STRING here); a dereferenced POINTER warns
        // (`string_literal_through_pointer_too_long`)
        if (place.kind === "ident_expr" && lookup(scope, place.name)?.symbol.varSection === "VAR_IN_OUT") return
        const dest = inferExprType(place, scope, ctx.project)
        if (dest.kind !== "elementary" || dest.length === undefined) return
        if (dest.name !== "STRING" && dest.name !== "WSTRING") return
        const value = places[i + 1] ?? s.value
        const diag = tooLong(value, dest.name === "WSTRING", dest.length, renderType(dest, { form: "compiler" }), ctx)
        // the destination's declaration, when it is a plain variable this document declares (the widen edits it there)
        const sym = place.kind === "ident_expr" ? lookup(scope, place.name)?.symbol : undefined
        const declared = sym !== undefined && sym.uri === ctx.uri && sym.typeExpr?.kind === "string_type" ? sym.typeExpr : undefined
        if (diag !== undefined) out.push(withFixes(diag, lengthFixes(ctx, value, declared, dest.length)))
      })
    })
  }
}

/**
 * C0198's fixes (design.md §4 F5), two meanings — keep the text or keep the size — so neither is `preferred`:
 * - "Change the type to STRING(<n>)": the destination's declared length, written as a number, becomes the literal's
 *   (`qf_c0198_widen_assign`, `_widen_init`) — only where `sized` is the declaration and its length a number, not a constant;
 * - "Shorten to '<prefix>'": the literal cut to the size (`qf_c0198_shorten_assign`, `_shorten_init`) — only a literal
 *   without `$` escapes, whose characters are what it is written with.
 */
function lengthFixes(ctx: CheckContext, value: Expr, sized: TypeExpr | undefined, size: number): Fix[] {
  if (value.kind !== "literal" || typeof value.value !== "string") return []
  const fixes: Fix[] = []
  const wide = sized?.kind === "string_type" && sized.wide
  const decoded = decodeStringLiteral(value.value, wide)
  const length = sized?.kind === "string_type" ? sized.length : undefined
  if (decoded !== undefined && length !== undefined && length.kind === "literal" && typeof length.value === "bigint") {
    const keyword = wide ? "WSTRING" : "STRING"
    fixes.push(fixOf(`Change the type to ${keyword}(${decoded.length})`, [replaceText(ctx.source, length.span.start, length.span.end, String(decoded.length))]))
  }
  const written = ctx.source.slice(value.span.start, value.span.end)
  const quote = written[0]
  if ((quote === "'" || quote === '"') && written.length >= 2 && written.endsWith(quote) && !written.includes("$")) {
    const shortened = `${quote}${written.slice(1, 1 + size)}${quote}`
    fixes.push(fixOf(`Shorten to ${shortened}`, [replaceText(ctx.source, value.span.start, value.span.end, shortened)]))
  }
  return fixes
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
function tooLong(value: Initializer | Expr | undefined, wide: boolean, size: number, type: string, ctx: CheckContext): DiagnosticItem | undefined {
  if (value === undefined || value.kind !== "literal" || typeof value.value !== "string") return undefined
  // the shared decoder's length — an escape it does not know has no measured length, so nothing is reported. A WSTRING
  // counts UTF-16 code units and prints its prefix by the same rule (conformance `wstring_code_units`,
  // `cc_wstring_init_too_long_2`/`_7`: `'"a...'`, `'"abc...'`).
  const decoded = decodeStringLiteral(value.value, wide)
  if (decoded === undefined || decoded.length <= size) return undefined
  // TWINCAT CANNOT PRINT THIS ONE BELOW STRING(3), and says so itself. The message shows a prefix of
  // `size - 3` characters; with nothing to subtract from, CODESYS falls back to `size` and TwinCAT's builder
  // throws — `xo4_string_constant_too_long` records, verbatim, `Internal error in _IStatement: one := 'ab';`
  // followed by `Exception text: System.ArgumentOutOfRangeException: Length cannot be less than zero.`, and
  // the isolated fixtures at those capacities record NOTHING AT ALL (`cc_string_prefix_len_1`/`_2`,
  // `cc_wstring_init_too_long_2`, all four `cc_string_escape_*_too_long`, `esc_high_only_one`). So there is no
  // warning to agree with: the LSP stays quiet rather than inventing one or reproducing a stack trace.
  if (ctx.config.vendor === "twincat" && size < 3) return undefined
  return {
    // a WARNING, recorded twice (`cc_string_plain_init_too_long`, `cc_string_escape_init_too_long`) — the documentation
    // catalog this check was written from said error
    severity: "warning",
    span: value.span,
    source: SOURCE,
    code: "string-constant-too-long",
    // the literal as written (quotes and escapes included) — the compiler prints a prefix of that text, not the value
    message: ctx.messages.stringConstantTooLong(value.text, size, type),
  }
}
