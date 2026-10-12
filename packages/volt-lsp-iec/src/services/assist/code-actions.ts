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

/** The source action that applies every `fixAll` fix of a document (design.md §5). */
export const FIX_ALL_KIND = `${CodeActionKind.SourceFixAll}.volt`

/**
 * The actions for the diagnostics a client passes back (`diagnostics`, those in its range), as `only` asks for them:
 * - each quick fix they carry;
 * - beside a quick fix that is safe to apply with its kind's others (`fixAll`, F1's preferred wraps — design.md §5), "Fix
 *   all of this kind in the file", when the file holds more than one finding of that code with such a fix;
 * - `source.fixAll.volt`, every `fixAll` fix of the file at once, asked for by kind (editors run it on save).
 * The file's other findings are `all()` — every diagnostic of the document, asked only when one of the two needs it.
 */
export function codeActions(
  doc: Document,
  diagnostics: readonly Diagnostic[],
  all: () => readonly Diagnostic[] = () => diagnostics,
  only?: readonly string[],
): CodeAction[] {
  const wants = (kind: string): boolean => only === undefined || only.some((o) => kind === o || kind.startsWith(`${o}.`))
  const out: CodeAction[] = []
  let file: readonly Diagnostic[] | undefined
  const whole = (): readonly Diagnostic[] => (file ??= all())
  if (wants(CodeActionKind.QuickFix)) {
    const kinds = new Set<string>()
    for (const diag of diagnostics)
      for (const fix of fixesOf(diag).filter((f) => current(doc, f))) {
        out.push(render(doc, diag, fix))
        const code = String(diag.code ?? "")
        if (fix.fixAll !== true || kinds.has(code)) continue
        kinds.add(code)
        const ofKind = whole().filter((d) => String(d.code ?? "") === code)
        const batch = fixAllOf(doc, ofKind)
        if (batch.fixed.length > 1) out.push(fixAllAction(doc, `Fix all '${code}' in the file`, CodeActionKind.QuickFix, batch))
      }
  }
  if (only !== undefined && wants(FIX_ALL_KIND)) {
    const batch = fixAllOf(doc, whole())
    if (batch.fixed.length > 0) out.push(fixAllAction(doc, "Fix all in the file", FIX_ALL_KIND, batch))
  }
  return out
}

/**
 * Every `fixAll` fix among `diagnostics` that still applies, each finding's first one, in the document's order, leaving
 * out any fix whose edits overlap one already taken — two edits on one text cannot both apply (design.md §5). A finding
 * reported twice (an FB's initializer) carries the same fix twice: it is taken once.
 */
function fixAllOf(doc: Document, diagnostics: readonly Diagnostic[]): { fixed: Diagnostic[]; edits: Fix["edits"][number][] } {
  const taken: { start: number; end: number }[] = []
  const seen = new Set<string>()
  const fixed: Diagnostic[] = []
  const edits: Fix["edits"][number][] = []
  const candidates = diagnostics
    .map((d) => ({ d, fix: fixesOf(d).find((f) => f.fixAll === true && current(doc, f)) }))
    .filter((c): c is { d: Diagnostic; fix: Fix } => c.fix !== undefined)
    .sort((a, b) => a.fix.edits[0]!.span.start - b.fix.edits[0]!.span.start)
  for (const { d, fix } of candidates) {
    const key = JSON.stringify(fix.edits.map((e) => [e.span.start, e.span.end, e.newText]))
    if (seen.has(key)) continue
    const overlaps = fix.edits.some((e) => taken.some((t) => e.span.start < t.end && t.start < e.span.end))
    if (overlaps) continue
    seen.add(key)
    for (const e of fix.edits) taken.push({ start: e.span.start, end: e.span.end })
    fixed.push(d)
    edits.push(...fix.edits)
  }
  return { fixed, edits }
}

function fixAllAction(doc: Document, title: string, kind: string, all: { fixed: Diagnostic[]; edits: Fix["edits"][number][] }): CodeAction {
  return {
    title,
    kind,
    diagnostics: all.fixed,
    edit: { changes: { [doc.uri]: all.edits.map((e) => ({ range: rangeFromSpan(e.span), newText: e.newText })) } },
  }
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
