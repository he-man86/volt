/**
 * case-labels (flow/) — CASE-selector-label rules, one traversal, six codes:
 *   C0216 duplicate single label · C0217 single label inside a range · C0219 overlapping ranges ·
 *   C0218 a label that is a non-constant variable · a literal label outside the selector's type (C0032's
 *   "Cannot convert") · an inverted range ("Lower border must be lower than upper border").
 *
 * C0216/C0217/C0219 use pure const-eval (a label participates only when it folds to a `bigint`). C0218 uses
 * `constancyOf` — flagging ONLY a label that resolves to a genuine mutable variable; an enum member or a
 * `VAR CONSTANT` (both valid labels) classify as `constant`, and a library/unresolved name as `unknown`, so
 * neither false-positives (this is what an earlier `constEval`-only attempt got wrong — 207 corpus FPs on
 * enum-driven CASEs).
 *
 * NOT here: C0426 empty arm lives in the `empty-block` check — a WARNING (`stmt_case_empty_arm`, both vendors
 * 2026-10-02); a comma list `1, 2:` shares a body.
 */
import { walkStatements, type CaseStatement, type Expr } from "../../../frontend/syntax/index.js"
import { bodies, type Scope } from "../../../frontend/symbols/index.js"
import { constancyOf, constEval, elemOf, inferExprType, isAssignable, literalErrorType, renderType, type Type } from "../../../frontend/types/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { enumTypedLiteral } from "../../hole.js"

export function checkCaseLabels(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "case") checkOneCase(s, scope, ctx, out)
    })
  }
}

interface Point {
  v: bigint
  span: Span
}
interface Range {
  lo: bigint
  hi: bigint
  span: Span
}

function checkOneCase(s: CaseStatement, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  const push = (code: string, span: Span, message: string) =>
    out.push({ severity: "error", span, source: SOURCE, code, message })

  const points: Point[] = []
  const ranges: Range[] = []
  const seen = new Map<string, true>()

  const nonConst = (e: Expr) => {
    // C0218 — a label that is a genuine non-constant variable (enum members / VAR CONSTANT are fine).
    // An enum's `Type#Value` is no constant either: CODESYS gives it no type (`analysis/hole`), and as a label it says
    // exactly this (`lit_enum_typed_case_label`, 2026-10-01).
    const enumLiteral = e.kind === "literal" && e.literalKind === "typed" && enumTypedLiteral(e.text, ctx.project)
    if (enumLiteral || constancyOf(e, scope) === "variable") push("case-label-non-const", e.span, ctx.messages.caseLabelNonConst())
  }
  // The selector's type, when it is an elementary integer or bit string: a label is a value OF it (transpile-review 37,
  // `tr_37_case_*`). A literal outside it does not wrap in — `300` / `-212` on a SINT are "Cannot convert type 'INT' to
  // type 'SINT'" — and a range's bounds are read in it, so `0..200` on a SINT is inverted (200 is -56 there) exactly as
  // `5..1` is: "Lower border must be lower than upper border".
  const selector: Type = inferExprType(s.selector, scope, ctx.project)
  const sel = elemOf(selector)
  const typed = sel?.range !== undefined && (sel.family === "int" || sel.family === "bitstring") ? sel : undefined
  const inType = (v: bigint): bigint => (typed === undefined ? v : typed.signed ? BigInt.asIntN(typed.bits, v) : BigInt.asUintN(typed.bits, v))
  const outOfType = (e: Expr): boolean => {
    if (typed === undefined) return false
    // …and a TYPED literal of a type the selector does not take: `DINT#2:` on an INT is "Cannot convert type 'DINT' to
    // type 'INT'", `INT#2:` on a DINT builds (`stmt_case_typed_label_other_type`, `_narrower`, both vendors 2026-10-02)
    const rhs = literalErrorType(e, selector) ?? typedLiteralType(e)
    if (rhs === undefined || isAssignable(selector, rhs)) return false
    push("case-label-type", e.span, ctx.messages.cannotConvert(renderType(rhs, { form: "compiler" }), renderType(selector, { form: "compiler" })))
    return true
  }
  const typedLiteralType = (e: Expr): Type | undefined => {
    if (e.kind !== "literal" || e.literalKind !== "typed") return undefined
    const t = inferExprType(e, scope, ctx.project)
    return t.kind === "elementary" ? t : undefined
  }
  for (const arm of s.arms) {
    for (const label of arm.labels) {
      const lo = constEval(label.value, scope)
      if (label.upper !== undefined) {
        const hi = constEval(label.upper, scope)
        if (typeof lo === "bigint" && typeof hi === "bigint") {
          if (inType(lo) > inType(hi)) push("case-range-inverted", label.span, ctx.messages.caseRangeInverted())
          ranges.push({ lo, hi, span: label.span })
        } else {
          nonConst(label.value)
          nonConst(label.upper)
        }
      } else if (typeof lo === "bigint") {
        if (outOfType(label.value)) continue
        if (seen.has(lo.toString())) push("case-label-duplicate", label.span, ctx.messages.caseLabelDuplicate()) // C0216
        else seen.set(lo.toString(), true)
        points.push({ v: lo, span: label.span })
      } else {
        nonConst(label.value)
      }
    }
  }

  // C0217 — a single label contained in a range.
  for (const p of points)
    for (const r of ranges)
      if (p.v >= r.lo && p.v <= r.hi) {
        push("case-label-in-range", p.span, ctx.messages.caseLabelInRange(p.v.toString(), r.lo.toString(), r.hi.toString()))
        break
      }

  // C0219 — two ranges overlap (rendered lowest-first, matching the compiler).
  for (let i = 0; i < ranges.length; i++)
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]
      const b = ranges[j]
      const overlapLo = a.lo > b.lo ? a.lo : b.lo
      const overlapHi = a.hi < b.hi ? a.hi : b.hi
      if (overlapLo > overlapHi) continue // disjoint
      const [x, y] = a.lo <= b.lo ? [a, b] : [b, a]
      push(
        "case-overlapping-ranges",
        b.span,
        ctx.messages.caseOverlappingRanges(x.lo.toString(), x.hi.toString(), y.lo.toString(), y.hi.toString()),
      )
    }
}
