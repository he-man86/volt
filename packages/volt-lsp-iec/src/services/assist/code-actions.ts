/**
 * code-actions (Layer E · E.3 · assist). The quick fixes of the diagnostics the client passes back in a range — RENDERED,
 * never derived: the check that reports a finding produces its fixes as data (`DiagnosticItem.fixes`), the wire carries
 * them in `Diagnostic.data` (`server/document-diagnostics` `toLspDiagnostic`), and each becomes one `CodeAction` here
 * (openspec lsp-quick-fixes design.md §2). A diagnostic without that data gets no action: there is no recomputation to
 * fall back on, so a fix and its finding cannot drift apart.
 */
import type { CodeAction, Diagnostic, TextEdit } from "vscode-languageserver-protocol"
import { CodeActionKind } from "vscode-languageserver-protocol"
import type { Fix } from "../../analysis/index.js"
import { offsetFromPosition, rangeFromSpan } from "../shared/index.js"
import type { Document } from "../shared/index.js"

/** What `Diagnostic.data` holds on a finding that offers fixes. */
export interface FixData {
  fixes: readonly Fix[]
}

export function codeActions(doc: Document, diagnostics: readonly Diagnostic[]): CodeAction[] {
  return diagnostics.flatMap((diag) => fixesOf(diag).filter((fix) => current(doc, fix)).map((fix) => render(doc, diag, fix)))
}

/**
 * Does `doc` still hold, at each edit's range, the text the fix was made for? A client may hand back a diagnostic
 * published before its latest edit; applied to the new text, its ranges would overwrite whatever now sits there. An edit
 * in ANOTHER document cannot be checked here — that text is not at hand — so a fix with one is not offered (every quick
 * fix stays in the reporting file, design.md §1).
 */
function current(doc: Document, fix: Fix): boolean {
  return fix.edits.every((e) => {
    if (e.uri !== undefined && e.uri !== doc.uri) return false
    const { start, end } = rangeFromSpan(e.span)
    const [from, to] = [offsetFromPosition(doc.source, start), offsetFromPosition(doc.source, end)]
    return from >= 0 && to >= from && doc.source.slice(from, to) === e.replaces
  })
}

/** The fixes a diagnostic carries back — none when its `data` holds none (a client that drops `data`, or a finding with no fix). */
function fixesOf(diag: Diagnostic): readonly Fix[] {
  const data = diag.data as Partial<FixData> | undefined
  return Array.isArray(data?.fixes) ? data.fixes : []
}

function render(doc: Document, diag: Diagnostic, fix: Fix): CodeAction {
  const changes: Record<string, TextEdit[]> = {}
  for (const e of fix.edits) (changes[e.uri ?? doc.uri] ??= []).push({ range: rangeFromSpan(e.span), newText: e.newText })
  return {
    title: fix.title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diag],
    ...(fix.preferred === true ? { isPreferred: true } : {}),
    edit: { changes },
  }
}
