/**
 * A WORKSPACE ANOTHER MATERIALIZATION WROTE, SAID ON ITS MANIFESTS — one warning per manifest, whichever side is stale,
 * keyed by the manifest's path (the server makes the URI). Older (the manifest's format below `MATERIALIZATION`): the LSP
 * knows the workspace only through what the pull wrote, so what an older Volt did not write, or wrote in a form since
 * replaced, reads wrong at every use; the answer is a re-pull, never a list of names kept here instead — by a CLI that
 * writes this server's format: volt-vscode is published on its own and bundles this server, so the extension can be
 * AHEAD of the installed CLI, whose pull then writes the old format back and the warning never clears. So the
 * older-side warning names that stale side too. Newer: this server is the stale side — the volt-vscode bundle carries
 * its own LSP and can lag the CLI — and the answer is updating it. Either way the graphical bodies are not flagged one
 * by one (`pipeline/document.ts`): the mismatch is named once, where its repair is decided.
 */
import {
  MATERIALIZATION,
  MATERIALIZATION_FORMATS,
  newerLibraryManifests,
  staleLibraryManifests,
  type LibraryManifest,
} from "../../../frontend/library/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { libraryStaleMessage, materializationNewerMessage } from "../../messages/workspace.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** Line 1, column 0: a manifest's warning stands at its top. */
const TOP: Span = { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }

const warning = (code: string, message: string): DiagnosticItem => ({ severity: "warning", span: TOP, source: SOURCE, code, message })

/** Each manifest another materialization wrote, by its path, with its one warning. */
export function materializationFindings(manifests: readonly LibraryManifest[]): Map<string, DiagnosticItem[]> {
  const older = staleLibraryManifests(manifests).map((m): [string, DiagnosticItem[]] => {
    const lacks = MATERIALIZATION_FORMATS.filter(([format]) => m.materialization < format).map(([, what]) => what)
    return [m.uri, [warning("library-stale", libraryStaleMessage(m.library, m.materialization, MATERIALIZATION, lacks))]]
  })
  const newer = newerLibraryManifests(manifests).map((m): [string, DiagnosticItem[]] => [
    m.uri,
    [warning("materialization-newer", materializationNewerMessage(m.library, m.materialization, MATERIALIZATION))],
  ])
  return new Map([...older, ...newer])
}
