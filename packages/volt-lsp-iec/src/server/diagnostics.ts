/**
 * Diagnostics compute (Layer G) — the ONE function that turns a document into LSP diagnostics, shared by
 * the push transport (`textDocument/publishDiagnostics` on open/change) and the pull transport
 * (`textDocument/diagnostic` · `workspace/diagnostic`). Keeping it here means push and pull can never
 * diverge: both call `documentDiagnostics`.
 *
 * Suppression rules (mirroring the compiler): a structurally-dead unit emits no semantic diagnostics, and
 * excluded/uncalled members inside a live unit are filtered out. Parse errors always ride through.
 */
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol/node"
import {
  computeSemanticDiagnostics,
  inDeadMember,
  ownerPou,
  type DiagnosticItem,
  type Messages,
} from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "../network/index.js"
import { codesysCodeFor } from "../analysis/error-code-map.js"
import {
  isLibrarySymbol,
  MATERIALIZATION,
  materializationMismatch,
  newerLibraryManifests,
  staleLibraryManifests,
  type LibraryManifest,
} from "../symbols/index.js"
import { pathToFileURL } from "node:url"
import { rangeFromSpan } from "../services/index.js"
import type { Document } from "../syntax/index.js"
import type { WorkspaceStore } from "./workspace-store.js"

const SEVERITY: Record<DiagnosticItem["severity"], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

function toLspDiagnostic(item: DiagnosticItem): VoltDiagnostic {
  // Surface the CODESYS `Cnnnn` the check mirrors as the diagnostic code (users recognise it and can cross-
  // reference the IDE), with a link to its docs page. Falls back to our internal slug for codes with no mapping
  // (network text / parse errors). Config toggles still key on the slug server-side, so this is display-only.
  const mapped = codesysCodeFor(item.code)
  return {
    range: rangeFromSpan(item.span),
    severity: SEVERITY[item.severity],
    source: item.source,
    code: mapped?.code ?? item.code,
    ...(mapped ? { codeDescription: { href: mapped.url } } : {}),
    message: item.message,
  }
}

/** The full LSP diagnostic set for one document — semantic + network text + parse errors, with dead-code suppression. */
/** LSP 3.18 widened `Diagnostic.message` to `string | MarkupContent`. Volt only ever emits a string, and
 * saying so here is what keeps every consumer (conformance suites, the push/pull transports) from having to
 * narrow it back at each use. */
export type VoltDiagnostic = Diagnostic & { message: string }

export function documentDiagnostics(store: WorkspaceStore, messages: Messages, d: Document): VoltDiagnostic[] {
  // ROOT gate for the whole library-FP class: a referenced library is a precompiled blob the consuming
  // project never recompiles, so CODESYS runs no check on its materialized source — any error we emit on it is
  // a false positive the user can't act on. Library files are marked by their `Library Manager/` path (the
  // bridge materializes them there). Skip them in ONE place, so no per-check `isLibrarySymbol` guard can silently
  // drift and reintroduce the class (as the raw-vs-`%20` match did). Per-check guards still matter for a PROJECT
  // file that *references* a library symbol; this gate is for diagnosing the library file itself.
  if (isLibrarySymbol({ uri: d.uri })) return []
  const owner = ownerPou(d.parseResult)
  const dead = owner !== undefined && store.deadSet().has(owner)
  // Excluded/uncalled methods inside this (live) file — keyed by the resolved doc URI (matches the store map).
  const dm = dead ? undefined : store.deadMembers().get(d.uri)
  const items = dead
    ? []
    : computeSemanticDiagnostics({
        parseResult: d.parseResult,
        source: d.source,
        project: store.project(),
        config: store.config,
        references: store.workspaceRefs,
        uri: d.uri,
      }).filter((it) => !inDeadMember(it.span, dm))
  // A workspace another materialization wrote holds its graphical bodies in a form this server does not read — v1
  // from an older Volt, a later one from a newer. Its manifests say so once (`libraryManifestDiagnostics`); flagging
  // every body as well would bury that one sentence under a finding per POU that all mean the same thing.
  const otherFormat = materializationMismatch(store.workspaceRefs.libraryManifests)
  return [
    ...items.map(toLspDiagnostic),
    ...(dead || otherFormat ? [] : computeNetworkTextDiagnostics(d, store.project(), messages, store.workspaceRefs))
      .filter((it) => !inDeadMember(it.span, dm))
      .map(toLspDiagnostic),
    ...d.parseResult.errors.map((e) => ({
      range: rangeFromSpan(e.span),
      severity: DiagnosticSeverity.Error,
      source: "volt-lsp-iec",
      message: e.message,
    })),
  ]
}

/** What a workspace pulled by format `n` lacks against this server's — each format since, in its own words. */
const MISSING_SINCE: readonly (readonly [format: number, lacks: string])[] = [
  [2, "it skipped FUNCTIONs without a return type, so a call to one reads as undefined"],
  [3, "its graphical bodies are network text v1, which this language server does not read"],
]

/**
 * A WORKSPACE ANOTHER MATERIALIZATION WROTE, SAID ON ITS MANIFESTS — by file URI, one warning each, whichever side is
 * stale. Older (the manifest's format below `MATERIALIZATION`): the LSP knows the workspace only through what the pull
 * wrote, so what an older Volt did not write, or wrote in a form since replaced, reads wrong at every use; the answer
 * is a re-pull, never a list of names kept here instead. Newer: this server is the stale side — the volt-vscode bundle
 * carries its own LSP and can lag the CLI — and the answer is updating it. Either way the graphical bodies are not
 * flagged one by one (`documentDiagnostics`): the mismatch is named once, where its repair is decided.
 */
export function libraryManifestDiagnostics(manifests: readonly LibraryManifest[]): Map<string, VoltDiagnostic[]> {
  const warning = (code: string, message: string): VoltDiagnostic => ({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: DiagnosticSeverity.Warning,
    source: "volt-lsp-iec",
    code,
    message,
  })
  const older = staleLibraryManifests(manifests).map((m): [string, VoltDiagnostic[]] => {
    const lacks = MISSING_SINCE.filter(([format]) => m.materialization < format).map(([, what]) => what)
    return [
      pathToFileURL(m.uri).href,
      [
        warning(
          "library-stale",
          `${m.library} was materialized by an older Volt (format ${m.materialization}, now ${MATERIALIZATION}): ` +
            `${lacks.join("; and ")}. Run \`volt pull\` to re-materialize the workspace.`,
        ),
      ],
    ]
  })
  const newer = newerLibraryManifests(manifests).map((m): [string, VoltDiagnostic[]] => [
    pathToFileURL(m.uri).href,
    [
      warning(
        "materialization-newer",
        `${m.library} was materialized by a newer Volt (format ${m.materialization}) than this language server reads ` +
          `(format ${MATERIALIZATION}), so its graphical bodies are not checked. Update the language server (volt-vscode) ` +
          "to the version of the volt CLI that pulled the workspace.",
      ),
    ],
  ])
  return new Map([...older, ...newer])
}
