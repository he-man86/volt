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
  parseErrorMessage,
  vendorReportsParseError,
  type DiagnosticItem,
  type Messages,
} from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "../network/index.js"
import { codesysCodeFor } from "../analysis/error-code-map.js"
import {
  isLibrarySymbol,
} from "../frontend/symbols/index.js"
import { pathToFileURL } from "node:url"
import { rangeFromSpan } from "../services/index.js"
import {
  isRetiredComment,
  allUnits,
  type BodySpan,
  IMPLEMENTATION_KEYWORD,
  isTrivia,
  type Span,
  type TopLevel,
  unitBodies,
} from "../frontend/syntax/index.js"
import type { WorkspaceStore } from "./workspace-store.js"
import type { Document } from "../services/shared/index.js"
import { MATERIALIZATION, MATERIALIZATION_FORMATS, materializationMismatch, newerLibraryManifests, staleLibraryManifests, type LibraryManifest } from "../frontend/library/index.js"

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
  // A body with no `IMPLEMENTATION` line states no language, so it is read by NEITHER reader — never ST by default
  // (spec: a missing language "is an LSP diagnostic … never guessed"). Its findings are quiet and ONE finding names it:
  //  - in this server's format: the push's own refusal (`StReader.Unmarked`), since the push refuses the same file
  //    naming `volt pull` — seen here first, not only when the push says no;
  //  - where an older Volt's `(* @volt-… *)` comment stands in the body, that comment is the finding
  //    (`reportRetiredComments`), naming the same repair;
  //  - in a workspace another materialization wrote (older: no body in it has a line; newer: it may state what this
  //    server cannot), the manifests say so ONCE (`libraryManifestDiagnostics`) — flagging every body as well would
  //    bury that one sentence under findings that all mean the same thing, so no network-text finding is given either.
  const otherFormat = materializationMismatch(store.workspaceRefs.libraryManifests)
  const unstated = unstatedBodies(d.parseResult.units)
  const retired = otherFormat
    ? []
    : unstated.flatMap(({ body }) => body.tokens.filter(isRetiredComment).map((t) => t.span))
  const missing = otherFormat
    ? []
    : unstated.filter(({ body }) => !body.tokens.some(isRetiredComment)).map(missingLanguage)
  const inUnstated = (span: Span): boolean =>
    unstated.some(({ body }) => span.start >= body.span.start && span.end <= body.span.end) &&
    !retired.some((r) => r.start === span.start && r.end === span.end)
  const quiet = (span: Span): boolean => inDeadMember(span, dm) || inUnstated(span)
  const items = dead
    ? []
    : computeSemanticDiagnostics({
        parseResult: d.parseResult,
        source: d.source,
        project: store.project(),
        config: store.config,
        uri: d.uri,
      }).filter((it) => !quiet(it.span))
  return [
    ...items.map(toLspDiagnostic),
    ...(dead || otherFormat ? [] : computeNetworkTextDiagnostics(d, store.project(), messages))
      .filter((it) => !inDeadMember(it.span, dm))
      .map(toLspDiagnostic),
    ...d.parseResult.errors
      .filter((e) => !inUnstated(e.span) && vendorReportsParseError(e, store.config.vendor))
      .map((e) => ({
        range: rangeFromSpan(e.span),
        severity: DiagnosticSeverity.Error,
        source: "volt-lsp-iec",
        message: parseErrorMessage(e, messages),
      })),
    ...missing,
  ]
}

/** The bodies that state no language — no `IMPLEMENTATION` line opens them — each with the item it belongs to, as
 *  the push names it. */
function unstatedBodies(units: readonly TopLevel[]): { body: BodySpan; what: string }[] {
  return allUnits(units).flatMap((u): { body: BodySpan; what: string }[] =>
    unitBodies(u)
      .filter((body) => body.implementation === undefined)
      .map((body) => ({
        body,
        what:
          u.kind === "property"
            ? `${u.name.text}'s ${body === u.getter?.body ? "getter" : "setter"}`
            : "name" in u
              ? u.name.text
              : u.kind,
      })),
  )
}

/** The finding for a body that states no language — the push's refusal of the same file (`StReader.Unmarked`), on the
 *  body's first line of code (or the body itself when it holds none). */
function missingLanguage({ body, what }: { body: BodySpan; what: string }): VoltDiagnostic {
  const first = body.tokens.find((t) => !isTrivia(t.kind) && t.kind !== "eof")
  return {
    range: rangeFromSpan(first?.span ?? body.span),
    severity: DiagnosticSeverity.Error,
    source: "volt-lsp-iec",
    message:
      `'${what}' states no language: its body opens with no '${IMPLEMENTATION_KEYWORD} <ST|LD|FBD>' line, so the file ` +
      "does not say where its declaration ends or what language its body is in, and neither reader reads it. " +
      "Run `volt pull` once to rewrite the workspace in the current format.",
  }
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
