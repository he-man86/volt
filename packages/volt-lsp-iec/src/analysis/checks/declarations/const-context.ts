/**
 * constant-context (declarations/) — declaration positions that require a compile-time constant, flagged via
 * `constancyOf` (so an enum member / `VAR CONSTANT` is fine; only a genuine mutable variable is flagged):
 *   C0161 array-bound-non-const — a non-constant array dimension bound (`ARRAY[1..i]`), or a subrange's (`INT(0..i)`).
 *   C0227 const-init-non-const  — a `VAR CONSTANT` variable initialized with a non-constant (`k : INT := i`).
 *   string-length-non-const     — a non-constant STRING length (`STRING(n)`).
 *
 * Zero-FP: a `variable` verdict fires, and in a type's bound or length a bare name that resolves NOWHERE (the
 * `unresolved-identifier` bet); literals, constants and library names never do.
 */
import { constancyOf } from "../../../frontend/types/index.js"
import type { Expr, Span } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl, lookupLocal } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { nameResolves } from "../../shared/resolution.js"

export function checkConstantContext(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, section, decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    // a constant position holds no variable — and no NAME NOTHING DECLARES either, which the compiler cannot call a
    // constant (`tref_array_bound_name`, `tref_subrange_bound_name`, `tref_string_length_name`, CODESYS SP21 2026-10-30)
    // …a name nothing declares, where a name declared in THIS VERY LIST is one, `{attribute 'qualified_only'}` or not
    // (corpus pro2193 `GVL_IQ`: `inputs : ARRAY[InputSliceStart..InputSliceEnd] OF …`, as `unresolved-identifier` holds)
    const notConstant = (e: Expr): boolean =>
      constancyOf(e, scope) === "variable" ||
      (e.kind === "ident_expr" && !nameResolves(e.name, scope) && lookupLocal(scope, e.name).length === 0)
    const bound = (e: Expr | undefined) => {
      if (e !== undefined && notConstant(e))
        emit(out, e.span, "array-bound-non-const", ctx.messages.arrayBoundNonConst(text(ctx.source, e.span)))
    }
    // a STRING/WSTRING length is a constant as a bound is: "String length 'n' is no constant value"
    // (`decl_string_length_variable`, both vendors 2026-10-01)
    if (decl.type.kind === "string_type" && decl.type.length !== undefined && notConstant(decl.type.length))
      emit(out, decl.type.length.span, "string-length-non-const", ctx.messages.stringLengthNonConst(text(ctx.source, decl.type.length.span)))
    if (decl.type.kind === "array_type")
      for (const dim of decl.type.dims) {
        bound(dim.lower) // C0161
        bound(dim.upper)
      }
    // …and a SUBRANGE's bound is one too, in the array's words: "Border 'hi' of array is no constant value"
    // (`tref_subrange_bound_variable`, `tref_subrange_bound_name`, CODESYS SP21 2026-10-30)
    if (decl.type.kind === "named_type" && decl.type.subrange !== undefined) {
      bound(decl.type.subrange.lo)
      bound(decl.type.subrange.hi)
    }
    if (
      section.constant === true &&
      decl.init !== undefined &&
      decl.init.kind !== "aggregate_init" &&
      constancyOf(decl.init, scope) === "variable"
    )
      for (const name of decl.names)
        emit(out, name.span, "const-init-non-const", ctx.messages.constInitNonConst(name.text)) // C0227
    // C0526 — a VAR_INPUT default that is a mutable variable. NOT a plain "is it a call" test: `STRUCT(…)`,
    // `SIZEOF(…)`, `ADR(…)` are compile-time constants that also parse as calls, so only a `variable`
    // constancy (a definite mutable reference) is flagged; call/unknown defaults are left alone (zero-FP).
    if (
      ctx.config.vendor === "codesys" && // C0526 — live /build shows TwinCAT silently accepts a non-constant VAR_INPUT default
      // …and so does CODESYS for a FUNCTION BLOCK's and a PROGRAM's input, whose value the instance keeps between calls
      // (`dflt_fb_input_from_variable`, `dflt_program_input_from_variable` silent; `dflt_function_input_from_variable`
      // and `dflt_method_input_from_variable` warn — 2026-10-06)
      unit.kind !== "function_block" &&
      unit.kind !== "program" &&
      section.sectionKind === "VAR_INPUT" &&
      decl.init !== undefined &&
      decl.init.kind !== "aggregate_init" &&
      constancyOf(decl.init, scope) === "variable"
    )
      emit(out, decl.init.span, "default-not-constant", ctx.messages.defaultNotConstant())
  }
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
