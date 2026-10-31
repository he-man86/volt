/**
 * jump-labels (flow/) — JMP/label rules within a POU body, four codes:
 *   C0114 invalid destination (JMP to a non-label) · C0116 duplicate label ·
 *   C0117 JMP to an undefined label · C0118 a label no JMP ever targets.
 *
 * Labels and JMPs are collected across the whole body (nested blocks included, via `walkStatements`). Matching
 * is case-insensitive (IEC identifiers).
 */
import { stmtExprs, walkExpr, walkStatements, type Expr, type Span } from "../../../frontend/syntax/index.js"
import { isJumpLabel } from "../../shared/resolution.js"
import { bodiesThroughErrors } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, removeConstruct } from "../../shared/fixes.js"
import { changeToFixes } from "../../shared/near-miss.js"

export function checkJumpLabels(ctx: CheckContext, out: DiagnosticItem[]): void {
  const push = (code: string, span: Span, message: string, fixes?: readonly Fix[]) =>
    emit(out, span, code, message, "error", fixes)

  // a body that did not parse cleanly too: the vendor checks its labels (`bodiesThroughErrors`)
  for (const { statements } of bodiesThroughErrors(ctx.parseResult.units, ctx.project)) {
    const labels = new Map<string, { name: string; span: Span }[]>() // upper-cased name → occurrences
    const jmps: Expr[] = []
    walkStatements(statements, (s) => {
      if (s.kind === "label") {
        const key = s.name.text.toUpperCase()
        const occ = labels.get(key) ?? []
        occ.push({ name: s.name.text, span: s.name.span })
        labels.set(key, occ)
      } else if (s.kind === "jmp" && s.refusedDestination !== undefined) {
        // the token the vendor took for the destination (`JMP;`): an invalid one, and the label it names is "INVALID: ;"
        // (`rec_jmp_without_label`, both vendors 2026-10-02)
        push("jump-invalid-destination", s.target.span, ctx.messages.jumpInvalidDestination(s.refusedDestination))
        push("jump-label-undefined", s.target.span, ctx.messages.jumpLabelUndefined(`INVALID: ${s.refusedDestination}`))
      } else if (s.kind === "jmp") {
        jmps.push(s.target)
      }
      // a network's jump inside a tree, `(JMP.label := value)`, read as the call `JMP(label, value)` (plain-ST network text)
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind === "call" && x.args[0]?.value !== undefined && isJumpLabel(x, x.args[0].value)) jmps.push(x.args[0].value)
        })
    })

    // C0116 — the same label declared twice (flag each occurrence after the first).
    for (const occ of labels.values())
      for (let i = 1; i < occ.length; i++) push("jump-label-duplicate", occ[i].span, ctx.messages.jumpLabelDuplicate(occ[i].name))

    // C0117 (JMP to undeclared) / C0114 (JMP to a non-label), and record which labels are referenced.
    const referenced = new Set<string>()
    for (const target of jmps) {
      if (target.kind === "ident_expr") {
        referenced.add(target.name.toUpperCase())
        // its fix: each near-miss label of the body (`qf_c0117_change`)
        if (!labels.has(target.name.toUpperCase()))
          push(
            "jump-label-undefined",
            target.span,
            ctx.messages.jumpLabelUndefined(target.name),
            changeToFixes(ctx.source, target.span.start, target.span.end, [...labels.values()].map((occ) => occ[0]!.name)),
          )
      } else {
        push("jump-invalid-destination", target.span, ctx.messages.jumpInvalidDestination(ctx.source.slice(target.span.start, target.span.end)))
      }
    }

    // C0118 — a declared label no JMP targets.
    for (const [key, occ] of labels)
      if (!referenced.has(key)) push("jump-label-unreferenced", occ[0].span, ctx.messages.jumpLabelUnreferenced(occ[0].name), removeLabel(ctx.source, occ[0]))
  }
}

/**
 * "Remove the label '<name>'" (design.md §4 F9, `qf_c0118_remove`): the label, its `:` and the blanks after it — the
 * statement it stands before stays. Nothing jumps to it, so removing it changes nothing the program does (`preferred`).
 */
function removeLabel(source: string, label: { name: string; span: Span }): Fix[] {
  let colon = label.span.end
  while (source[colon] === " " || source[colon] === "	") colon++
  if (source[colon] !== ":") return []
  return [fixOf(`Remove the label '${label.name}'`, [removeConstruct(source, label.span.start, colon + 1)], true)]
}
