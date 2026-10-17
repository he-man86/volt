/**
 * Diagnostics to the wire (Layer G) — the LSP conversion of what analysis finds, and nothing else (openspec
 * lsp-server-scheduling 2.4 moved the composition — the library gate, the dead-code and unstated-body quiet, the
 * missing-language finding — to `analysis/pipeline/document.ts`, and the manifest warnings to
 * `analysis/checks/workspace/materialization.ts`). `documentDiagnostics` reads the store's inputs for one document and
 * converts its findings; `libraryManifestDiagnostics` converts the manifests' warnings and names them by URI. The
 * `DiagnosticsPublisher` is the one caller in the server; the corpus and census suites read the same bytes a client gets.
 */
import { pathToFileURL } from "node:url"
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol/node"
import {
  codesysCodeFor,
  documentFindings,
  materializationFindings,
  MISSING_LANGUAGE,
  type DiagnosticItem,
} from "../analysis/index.js"
import type { LibraryManifest } from "../frontend/library/index.js"
import { rangeFromSpan, type Document, type FixData } from "../services/index.js"
import type { WorkspaceStore } from "../workspace/workspace-store.js"

const SEVERITY: Record<DiagnosticItem["severity"], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

/** LSP 3.18 widened `Diagnostic.message` to `string | MarkupContent`. Volt only ever emits a string, and
 * saying so here is what keeps every consumer (conformance suites, the push/pull transports) from having to
 * narrow it back at each use. */
type VoltDiagnostic = Diagnostic & { message: string }

export function toLspDiagnostic(item: DiagnosticItem): VoltDiagnostic {
  // Surface the CODESYS `Cnnnn` the check mirrors as the diagnostic code (users recognise it and can cross-
  // reference the IDE), with a link to its docs page. Falls back to our internal slug for codes with no mapping
  // (network text / parse errors). Config toggles still key on the slug server-side, so this is display-only. The
  // missing-language finding carries no code on the wire (`test/corpus/support/diagnostic-codes.ts`).
  if (item.code === MISSING_LANGUAGE)
    return { range: rangeFromSpan(item.span), severity: SEVERITY[item.severity], source: item.source, message: item.message }
  const mapped = codesysCodeFor(item.code)
  return {
    range: rangeFromSpan(item.span),
    severity: SEVERITY[item.severity],
    source: item.source,
    code: mapped?.code ?? item.code,
    ...(mapped ? { codeDescription: { href: mapped.url } } : {}),
    message: item.message,
    // the finding's fixes ride in `data`, which a client hands back unchanged with a code-action request (LSP 3.16), so
    // `services/assist/code-actions` renders them without re-deriving anything (openspec lsp-quick-fixes design.md §2)
    ...(item.fixes !== undefined ? { data: { fixes: item.fixes } satisfies FixData } : {}),
  }
}

/** The LSP diagnostics of one document, from what the store holds: its findings in every table it is analysed against
 *  (`WorkspaceStore.projectsFor` — one, or each application's for a document of the POU pool). Across tables a finding
 *  another table already gave folds, as CODESYS folds what two applications' builds both report on one object; what
 *  ONE table gives twice stays twice (a later table adds a finding only as often as it repeats it beyond the most an
 *  earlier one did). */
export function documentDiagnostics(store: WorkspaceStore, d: Document): VoltDiagnostic[] {
  const perTable = store.projectsFor(d.uri).map((project) =>
    documentFindings({
      doc: d,
      project,
      config: store.config,
      dead: store.deadSet(),
      deadMembers: store.deadMembers(),
      manifests: store.workspaceRefs.libraryManifests,
    }).map(toLspDiagnostic),
  )
  if (perTable.length === 1) return perTable[0]!
  const most = new Map<string, number>()
  const out: VoltDiagnostic[] = []
  for (const table of perTable) {
    const here = new Map<string, number>()
    for (const x of table) {
      const key = JSON.stringify(x)
      const n = (here.get(key) ?? 0) + 1
      here.set(key, n)
      if (n <= (most.get(key) ?? 0)) continue
      most.set(key, n)
      out.push(x)
    }
  }
  return out
}

/** Each manifest another materialization wrote, by file URI, with its one warning. */
export function libraryManifestDiagnostics(manifests: readonly LibraryManifest[]): Map<string, VoltDiagnostic[]> {
  return new Map(
    [...materializationFindings(manifests)].map(([path, items]) => [pathToFileURL(path).href, items.map(toLspDiagnostic)]),
  )
}
