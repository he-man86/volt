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
  MATERIALIZATION_FORMATS,
  materializationMismatch,
  newerLibraryManifests,
  staleLibraryManifests,
  type LibraryManifest,
} from "../symbols/index.js"
import { pathToFileURL } from "node:url"
import { rangeFromSpan } from "../services/index.js"
import { type BodySpan, type Document, isRetiredComment, type Span, type TopLevel, unitBodies } from "../syntax/index.js"
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
  // A workspace another materialization wrote holds bodies in a form this server does not read — an older Volt wrote
  // no `IMPLEMENTATION` line (its boundary was a comment, and a graphical body behind it was network text v1 or v2), a
  // newer one may state what this server cannot. Its manifests say so once (`libraryManifestDiagnostics`); flagging
  // every body as well would bury that one sentence under findings that all mean the same thing — and a line-less
  // ladder is ST to this server, so every rung would be a parse error. So under a mismatch the bodies that state no
  // language are quiet, and no network-text finding is given.
  //
  // With no manifest to say it (a workspace with no library), the file says it itself: an older Volt's
  // `(* @volt-… *)` comment is reported naming `volt pull` (`reportRetiredComments`), as the push refuses it. The
  // body such a comment stands in, stating no language, is quiet the same way — but for that one finding.
  const otherFormat = materializationMismatch(store.workspaceRefs.libraryManifests)
  const bodies = unstatedBodies(d.parseResult.units)
  const unstated = otherFormat ? bodies : bodies.filter((b) => b.tokens.some(isRetiredComment))
  const retired = otherFormat ? [] : unstated.flatMap((b) => b.tokens.filter(isRetiredComment).map((t) => t.span))
  const inUnstated = (span: Span): boolean =>
    unstated.some((b) => span.start >= b.span.start && span.end <= b.span.end) &&
    !retired.some((r) => r.start === span.start && r.end === span.end)
  const quiet = (span: Span): boolean => inDeadMember(span, dm) || inUnstated(span)
  const items = dead
    ? []
    : computeSemanticDiagnostics({
        parseResult: d.parseResult,
        source: d.source,
        project: store.project(),
        config: store.config,
        references: store.workspaceRefs,
        uri: d.uri,
      }).filter((it) => !quiet(it.span))
  return [
    ...items.map(toLspDiagnostic),
    ...(dead || otherFormat ? [] : computeNetworkTextDiagnostics(d, store.project(), messages, store.workspaceRefs))
      .filter((it) => !inDeadMember(it.span, dm))
      .map(toLspDiagnostic),
    ...d.parseResult.errors.filter((e) => !inUnstated(e.span)).map((e) => ({
      range: rangeFromSpan(e.span),
      severity: DiagnosticSeverity.Error,
      source: "volt-lsp-iec",
      message: e.message,
    })),
  ]
}

/** The bodies that state no language — no `IMPLEMENTATION` line opens them. */
function unstatedBodies(units: readonly TopLevel[]): BodySpan[] {
  return units.flatMap((u) =>
    u.kind === "namespace" ? unstatedBodies(u.units) : unitBodies(u).filter((b) => b.implementation === undefined),
  )
}

/**
 * A WORKSPACE ANOTHER MATERIALIZATION WROTE, SAID ON ITS MANIFESTS — by file URI, one warning each, whichever side is
 * stale. Older (the manifest's format below `MATERIALIZATION`): the LSP knows the workspace only through what the pull
 * wrote, so what an older Volt did not write, or wrote in a form since replaced, reads wrong at every use; the answer
 * is a re-pull, never a list of names kept here instead — by a CLI that writes this server's format: volt-vscode is
 * published on its own and bundles this server, so the extension can be AHEAD of the installed CLI, whose pull then
 * writes the old format back and the warning never clears. So the older-side warning names that stale side too. Newer: this server is the stale side — the volt-vscode bundle
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
    const lacks = MATERIALIZATION_FORMATS.filter(([format]) => m.materialization < format).map(([, what]) => what)
    return [
      pathToFileURL(m.uri).href,
      [
        warning(
          "library-stale",
          `${m.library} was materialized by an older Volt (format ${m.materialization}, now ${MATERIALIZATION}): ` +
            `${lacks.join("; and ")}. Run \`volt pull\` to re-materialize the workspace. If the pull leaves it at ` +
            `format ${m.materialization}, the volt CLI on PATH is the stale side (it writes format ${m.materialization}, ` +
            `this language server reads format ${MATERIALIZATION}): update the volt CLI, then pull.`,
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
