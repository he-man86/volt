/**
 * array-initializer checks (types/) against the declared type, using the parsed aggregate `elements`:
 *   C0074 unexpected-array-init — an array literal `[…]` on a non-array type (`x : INT := [1,2,3]`).
 *   C0232 array-init-nesting    — a flat scalar where a nested array is expected (`ARRAY OF ARRAY := [1,2,3]`).
 *   C0233 array-init-element    — a scalar where a struct-init list is expected (`ARRAY OF <struct> := [1,2,3]`).
 *   C0075 array-init-count      — more values than a single-dimension array holds (`ARRAY[1..5] := [..6..]`).
 *   C0162 array-init-count-non-const — a repeat count `n(v)` where `n` is a non-constant variable (`[1, i(7)]`).
 *
 * Zero-FP: the declared type is RESOLVED (an array ALIAS stays quiet; `unknown` skips). C0232/C0233 fire only
 * on a bare scalar LITERAL element (an ident could be a correctly-typed variable → skipped); enum element types
 * are skipped for C0233 (an enum accepts integer literals). C0075 fires only on a single dimension with
 * const-foldable bounds, all-countable elements, and a strict OVER-count (a short initializer is legal).
 */
import { type Scope } from "../../../symbols/index.js"
import { constancyOf, constEval, resolveTypeExpr } from "../../../types/index.js"
import type { AggregateElement } from "../../../syntax/index.js"
import type { Span } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

export function checkArrayInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    const init = decl.init
    if (init === undefined || init.kind !== "aggregate_init" || init.form !== "array") continue
    // C0162 — a repeat count `n(v)` that is a non-constant variable (independent of the declared type).
    for (const e of init.elements)
      if (e.kind === "repeat" && constancyOf(e.count, scope) === "variable")
        push(
          out,
          e.count.span,
          "array-init-count-non-const",
          ctx.messages.arrayInitCountNonConst(text(ctx.source, e.count.span)),
        )
    const t = resolveTypeExpr(decl.type, ctx.project)
    if (t.kind === "unknown") continue
    if (t.kind !== "array") {
      push(out, init.span, "unexpected-array-init", ctx.messages.unexpectedArrayInit()) // C0074
      continue
    }
    // C0232 / C0233 — a scalar literal where a nested array / struct-init is required (takes precedence over count).
    const scalar = firstScalarLiteral(init.elements)
    if (scalar !== undefined && t.element.kind === "array") {
      push(out, scalar.span, "array-init-nesting", ctx.messages.arrayInitExpected()) // C0232
      continue
    }
    if (scalar !== undefined && t.element.kind === "struct") {
      push(out, scalar.span, "array-init-element", ctx.messages.initListExpected(t.element.name)) // C0233
      continue
    }
    // C0075 — too many values for a single dimension.
    if (t.dims.length !== 1) continue
    const dim = t.dims[0]
    if (dim.lower === undefined || dim.upper === undefined) continue // dynamic bound → skip
    const lo = constEval(dim.lower, scope)
    const hi = constEval(dim.upper, scope)
    if (typeof lo !== "bigint" || typeof hi !== "bigint") continue
    const count = elementCount(init.elements, scope)
    if (count === undefined || BigInt(count) <= hi - lo + 1n) continue // indeterminate or fits → skip
    push(out, init.span, "array-init-count", ctx.messages.tooManyArrayInit()) // C0075
  }
}

/** The first top-level element that supplies a bare scalar LITERAL (directly or via a repeat), or undefined.
 *  A nested aggregate or a non-literal expression (possibly a correctly-typed variable) is not "scalar". */
function firstScalarLiteral(elements: readonly AggregateElement[]): AggregateElement | undefined {
  for (const e of elements) {
    if (e.kind === "value" && e.expr.kind === "literal") return e
    if (e.kind === "repeat" && e.value.kind === "value" && e.value.expr.kind === "literal") return e
  }
  return undefined
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

function push(out: DiagnosticItem[], span: Span, code: string, message: string): void {
  out.push({ severity: "error", span, source: SOURCE, code, message })
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
