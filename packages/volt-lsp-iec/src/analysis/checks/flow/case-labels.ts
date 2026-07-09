/**
 * case-labels (flow/) — CASE-selector-label rules, one traversal, four codes:
 *   C0216 duplicate single label · C0217 single label inside a range · C0219 overlapping ranges ·
 *   C0218 a label that is a non-constant variable.
 *
 * C0216/C0217/C0219 use pure const-eval (a label participates only when it folds to a `bigint`). C0218 uses
 * `constancyOf` — flagging ONLY a label that resolves to a genuine mutable variable; an enum member or a
 * `VAR CONSTANT` (both valid labels) classify as `constant`, and a library/unresolved name as `unknown`, so
 * neither false-positives (this is what an earlier `constEval`-only attempt got wrong — 207 corpus FPs on
 * enum-driven CASEs).
 *
 * NOT here (won't-fix): C0426 empty arm — CODESYS accepts consecutive labels with empty bodies (fall-through).
 */
import { walkStatements, type CaseStatement, type Expr } from "../../../syntax/index.js"
import { bodies, type Scope } from "../../../symbols/index.js"
import { constancyOf, constEval } from "../../../types/index.js"
import type { Span } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

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
    if (constancyOf(e, scope) === "variable") push("case-label-non-const", e.span, ctx.messages.caseLabelNonConst())
  }
  for (const arm of s.arms) {
    for (const label of arm.labels) {
      const lo = constEval(label.value, scope)
      if (label.upper !== undefined) {
        const hi = constEval(label.upper, scope)
        if (typeof lo === "bigint" && typeof hi === "bigint") ranges.push({ lo, hi, span: label.span })
        else {
          nonConst(label.value)
          nonConst(label.upper)
        }
      } else if (typeof lo === "bigint") {
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
