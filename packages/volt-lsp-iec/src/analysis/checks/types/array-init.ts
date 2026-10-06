/**
 * array-initializer checks (types/) against the declared type, using the parsed aggregate `elements`:
 *   C0074 unexpected-array-init — an array literal `[…]` on a non-array type (`x : INT := [1,2,3]`), with the conversion
 *                                 of the literal the compiler cannot type, "Cannot convert type 'Unknown type: '[1, 2]''
 *                                 to type 'INT'" (`arrinit_on_scalar`, `arrinit_on_struct`, both vendors 2026-10-06).
 *   C0232 array-init-nesting    — EACH flat scalar where a nested array is expected (`ARRAY OF ARRAY := [1,2,3]`), with
 *                                 its conversion into the inner array (`arrinit_flat_into_nested`).
 *   C0233 array-init-element    — EACH scalar where a struct-init list is expected (`ARRAY OF <struct> := [1,2,3]`), with
 *                                 its conversion into the struct (`arrinit_scalar_into_struct_array`).
 *   C0075 array-init-count      — more values than the array holds, over every dimension (`arrinit_too_many_two_dims`) and
 *                                 beside C0232 (a flat list counts each scalar as one element of the outer array).
 *   C0162 array-init-count-non-const — a repeat count `n(v)` where `n` is a non-constant variable (`[1, i(7)]`).
 *
 * Zero-FP: the declared type is RESOLVED (an array ALIAS stays quiet; `unknown` skips). C0232/C0233 fire only
 * on a bare scalar LITERAL element (an ident could be a correctly-typed variable → skipped); enum element types
 * are skipped for C0233 (an enum accepts integer literals). C0075 fires only with const-foldable bounds, all-countable
 * elements, and a strict OVER-count (a short initializer is legal).
 */
import { forEachDecl, type Scope } from "../../../frontend/symbols/index.js"
import { constancyOf, constEval, literalErrorType, renderType, resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { AggregateElement, Expr } from "../../../frontend/syntax/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { arrayEcho } from "../../shared/expr-echo.js"

export function checkArrayInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    const init = decl.init
    if (init === undefined || init.kind !== "aggregate_init" || init.form !== "array") continue
    // C0162 — a repeat count `n(v)` that is a non-constant variable (independent of the declared type).
    for (const e of init.elements)
      if (e.kind === "repeat" && constancyOf(e.count, scope) === "variable")
        emit(
          out,
          e.count.span,
          "array-init-count-non-const",
          ctx.messages.arrayInitCountNonConst(text(ctx.source, e.count.span)),
        )
    const t = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    if (t.kind === "unknown") continue
    if (t.kind !== "array") {
      emit(out, init.span, "unexpected-array-init", ctx.messages.unexpectedArrayInit()) // C0074
      const echo = arrayEcho(init)
      if (echo !== undefined) emit(out, init.span, "assignment-type-mismatch", ctx.messages.cannotConvert(ctx.messages.unknownType(echo), renderType(t)))
      continue
    }
    // C0074 again — a MULTI-dimensional array is initialized flat (`decl_nested_aggregate_flat` builds), so a nested list
    // there is an array initializer where an element belongs: "Unexpected array initialisation" (TwinCAT,
    // `decl_nested_aggregate`, 2026-10-01; CODESYS SP21's compiler throws a NullReferenceException on it instead).
    const nested = t.dims.length > 1 ? init.elements.find((e) => e.kind === "nested" && e.init.form === "array") : undefined
    if (nested !== undefined) {
      emit(out, nested.span, "unexpected-array-init", ctx.messages.unexpectedArrayInit()) // C0074
      continue
    }
    // C0232 / C0233 — EACH scalar literal where a nested array / a struct-init is required, and its conversion
    const element = t.element
    if (element.kind === "array" || element.kind === "struct") {
      const [code, message] =
        element.kind === "array"
          ? (["array-init-nesting", ctx.messages.arrayInitExpected()] as const)
          : (["array-init-element", ctx.messages.initListExpected(element.name)] as const)
      for (const scalar of scalarLiterals(init.elements)) {
        emit(out, scalar.span, code, message)
        const from = literalErrorType(scalar.expr, element)
        if (from !== undefined) emit(out, scalar.span, "assignment-type-mismatch", ctx.messages.cannotConvert(renderType(from), renderType(element)))
      }
    }
    // C0075 — too many values for every dimension together.
    const capacity = elementCapacity(t, scope)
    const count = elementCount(init.elements, scope)
    if (capacity === undefined || count === undefined || BigInt(count) <= capacity) continue // indeterminate or fits → skip
    emit(out, init.span, "array-init-count", ctx.messages.tooManyArrayInit()) // C0075
  }
}

/** How many elements the array holds over all its dimensions, or undefined when a bound is dynamic or does not fold. */
function elementCapacity(t: Extract<Type, { kind: "array" }>, scope: Scope): bigint | undefined {
  let n = 1n
  for (const dim of t.dims) {
    if (dim.lower === undefined || dim.upper === undefined) return undefined
    const lo = constEval(dim.lower, scope)
    const hi = constEval(dim.upper, scope)
    if (typeof lo !== "bigint" || typeof hi !== "bigint") return undefined
    n *= hi - lo + 1n
  }
  return n
}

/** Every top-level element that supplies a bare scalar LITERAL (directly or through a repeat), with its literal. A nested
 *  aggregate or a non-literal expression (possibly a correctly-typed variable) is not "scalar". */
function scalarLiterals(elements: readonly AggregateElement[]): { span: Span; expr: Expr }[] {
  const out: { span: Span; expr: Expr }[] = []
  for (const e of elements) {
    if (e.kind === "value" && e.expr.kind === "literal") out.push({ span: e.span, expr: e.expr })
    else if (e.kind === "repeat" && e.value.kind === "value" && e.value.expr.kind === "literal") out.push({ span: e.span, expr: e.value.expr })
  }
  return out
}

/** Total values an array literal supplies, expanding `n(v)` repeats; undefined if any element isn't countable. */
function elementCount(elements: readonly AggregateElement[], scope: Scope): number | undefined {
  let n = 0
  for (const e of elements) {
    if (e.kind === "unparsed") return undefined
    if (e.kind === "repeat") {
      const c = constEval(e.count, scope)
      if (typeof c !== "bigint") return undefined
      n += Number(c)
    } else n += 1
  }
  return n
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
