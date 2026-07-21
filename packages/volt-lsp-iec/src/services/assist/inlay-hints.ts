/**
 * inlay-hints (Layer E · E.3 · assist). Parameter-name hints at call sites: a POSITIONAL argument
 * `f(x)` gets a `paramName:` hint before it (a named arg `f(p := x)` already shows its name, so it's
 * skipped). Thin over the call resolution + the callee's VAR_INPUT params.
 */
import type { InlayHint } from "vscode-languageserver-protocol"
import { InlayHintKind } from "vscode-languageserver-protocol"
import {
  isGraphicalBody,
  parseStatements,
  unitBodies,
  varInputParams,
  walkAllExprs,
  type Method,
} from "../../syntax/index.js"
import { scopeForUnit, type Scope } from "../../symbols/index.js"
import { resolveMemberChain } from "../../types/index.js"
import type { Document } from "../shared/index.js"

export function inlayHints(doc: Document, project: Scope, startOffset: number, endOffset: number): InlayHint[] {
  const out: InlayHint[] = []
  for (const unit of doc.parseResult.units) {
    const scope = scopeForUnit(project, unit) ?? project
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body) || body.span.end < startOffset || body.span.start > endOffset) continue
      const parsed = parseStatements(body)
      if (!parsed.ok) continue
      walkAllExprs(parsed.statements, (e) => {
        if (e.kind !== "call") return
        const sym = resolveMemberChain(e.callee, scope, project)
        if (sym === undefined) return
        const sections = (sym.ast as Partial<Method>).varSections
        const params = Array.isArray(sections) ? varInputParams(sections) : []
        e.args.forEach((arg, i) => {
          if (arg.param !== undefined || arg.value === undefined) return // already named / empty
          const name = params[i]?.name.text
          const pos = arg.value.span.start
          if (name === undefined || pos < startOffset || pos > endOffset) return
          out.push({
            position: { line: arg.value.span.startLine - 1, character: arg.value.span.startCol },
            label: `${name}:`,
            kind: InlayHintKind.Parameter,
            paddingRight: true,
          })
        })
      })
    }
  }
  return out
}
