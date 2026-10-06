/**
 * constant-context (declarations/) — declaration positions that require a compile-time constant, flagged via
 * `constancyOf` (so an enum member / `VAR CONSTANT` is fine; only a genuine mutable variable is flagged):
 *   C0161 array-bound-non-const — a non-constant array dimension bound (`ARRAY[1..i]`).
 *   C0227 const-init-non-const  — a `VAR CONSTANT` variable initialized with a non-constant (`k : INT := i`).
 *   string-length-non-const     — a non-constant STRING length (`STRING(n)`).
 *
 * Zero-FP: only a `variable` verdict fires; literals, constants, and unresolved/library names never do.
 */
import { constancyOf } from "../../../frontend/types/index.js"
import type { Expr, Span } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkConstantContext(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    const bound = (e: Expr | undefined) => {
      if (e !== undefined && constancyOf(e, scope) === "variable")
        emit(out, e.span, "array-bound-non-const", ctx.messages.arrayBoundNonConst(text(ctx.source, e.span)))
    }
    // a STRING/WSTRING length is a constant as a bound is: "String length 'n' is no constant value"
    // (`decl_string_length_variable`, both vendors 2026-10-01)
    if (decl.type.kind === "string_type" && decl.type.length !== undefined && constancyOf(decl.type.length, scope) === "variable")
      emit(out, decl.type.length.span, "string-length-non-const", ctx.messages.stringLengthNonConst(text(ctx.source, decl.type.length.span)))
    if (decl.type.kind === "array_type")
      for (const dim of decl.type.dims) {
        bound(dim.lower) // C0161
        bound(dim.upper)
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
      section.sectionKind === "VAR_INPUT" &&
      decl.init !== undefined &&
      decl.init.kind !== "aggregate_init" &&
      constancyOf(decl.init, scope) === "variable"
    )
      emit(out, decl.init.span, "default-not-constant", ctx.messages.defaultNotConstant())
  }
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
