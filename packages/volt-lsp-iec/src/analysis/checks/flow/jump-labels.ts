/**
 * jump-labels (flow/) — JMP/label rules within a POU body, four codes:
 *   C0114 invalid destination (JMP to a non-label) · C0116 duplicate label ·
 *   C0117 JMP to an undefined label · C0118 a label no JMP ever targets.
 *
 * Labels and JMPs are collected across the whole body (nested blocks included, via `walkStatements`). Matching
 * is case-insensitive (IEC identifiers).
 */
import { walkStatements, type Expr, type Span } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkJumpLabels(ctx: CheckContext, out: DiagnosticItem[]): void {
  const push = (code: string, span: Span, message: string) =>
    out.push({ severity: "error", span, source: SOURCE, code, message })

  for (const { statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const labels = new Map<string, { name: string; span: Span }[]>() // upper-cased name → occurrences
    const jmps: Expr[] = []
    walkStatements(statements, (s) => {
      if (s.kind === "label") {
        const key = s.name.text.toUpperCase()
        const occ = labels.get(key) ?? []
        occ.push({ name: s.name.text, span: s.name.span })
        labels.set(key, occ)
      } else if (s.kind === "jmp") {
        jmps.push(s.target)
      }
    })

    // C0116 — the same label declared twice (flag each occurrence after the first).
    for (const occ of labels.values())
      for (let i = 1; i < occ.length; i++) push("jump-label-duplicate", occ[i].span, ctx.messages.jumpLabelDuplicate(occ[i].name))

    // C0117 (JMP to undeclared) / C0114 (JMP to a non-label), and record which labels are referenced.
    const referenced = new Set<string>()
    for (const target of jmps) {
      if (target.kind === "ident_expr") {
        referenced.add(target.name.toUpperCase())
        if (!labels.has(target.name.toUpperCase()))
          push("jump-label-undefined", target.span, ctx.messages.jumpLabelUndefined(target.name))
      } else {
        push("jump-invalid-destination", target.span, ctx.messages.jumpInvalidDestination(ctx.source.slice(target.span.start, target.span.end)))
      }
    }

    // C0118 — a declared label no JMP targets.
    for (const [key, occ] of labels)
      if (!referenced.has(key)) push("jump-label-unreferenced", occ[0].span, ctx.messages.jumpLabelUnreferenced(occ[0].name))
  }
}
