/**
 * inlay-hints (Layer E · E.3 · assist). Parameter-name hints at call sites: a POSITIONAL argument
 * `f(x)` gets a `paramName:` hint before it (a named arg `f(p := x)` already shows its name, so it's
 * skipped). Thin over `symbols/bodies` + `types/resolveCallee`, the same pair signature help and the call checks use.
 */
import type { InlayHint } from "vscode-languageserver-protocol"
import { InlayHintKind } from "vscode-languageserver-protocol"
import { walkAllExprs } from "../../syntax/index.js"
import { bodies, type Scope } from "../../symbols/index.js"
import { resolveCallee } from "../../types/index.js"
import type { Document } from "../shared/index.js"

export function inlayHints(doc: Document, project: Scope, startOffset: number, endOffset: number): InlayHint[] {
  const out: InlayHint[] = []
  // `bodies()` gives a property accessor its own scope, and `resolveCallee` a function-block instance its inputs
  // (inherited ones first). This rebuilt both — the unit scope, and the parameters from the callee's own AST — so an
  // accessor-local call and every FB-instance call got no hints (consolidate-lsp-structure A5, A6).
  for (const { body, scope, statements } of bodies(doc.parseResult.units, project)) {
    if (body.span.end < startOffset || body.span.start > endOffset) continue
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call") return
      const callee = resolveCallee(e, scope, project)
      if (callee === undefined) return
      e.args.forEach((arg, i) => {
        if (arg.param !== undefined || arg.value === undefined) return // already named / empty
        const name = callee.params[i]?.name.text
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
  return out
}
