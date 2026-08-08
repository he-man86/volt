/**
 * Diagnostics compute (Layer G) — the ONE function that turns a document into LSP diagnostics, shared by
 * the push transport (`textDocument/publishDiagnostics` on open/change) and the pull transport
 * (`textDocument/diagnostic` · `workspace/diagnostic`). Keeping it here means push and pull can never
 * diverge: both call `documentDiagnostics`.
 *
 * Suppression rules (mirroring the compiler): a structurally-dead unit emits no semantic diagnostics, and
 * excluded/uncalled members inside a live unit are filtered out. Parse errors always ride through.
 */
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol/node.js"
import {
  computeSemanticDiagnostics,
  inDeadMember,
  ownerPou,
  type DiagnosticItem,
  type Messages,
} from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "../graphical/index.js"
import { codesysCodeFor } from "../reference/error-code-map.js"
import { isLibrarySymbol } from "../symbols/index.js"
import { rangeFromSpan, type Document } from "../services/index.js"
import type { WorkspaceStore } from "./workspace-store.js"

const SEVERITY: Record<DiagnosticItem["severity"], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

function toLspDiagnostic(item: DiagnosticItem): Diagnostic {
  // Surface the CODESYS `Cnnnn` the check mirrors as the diagnostic code (users recognise it and can cross-
  // reference the IDE), with a link to its docs page. Falls back to our internal slug for codes with no mapping
  // (VG / parse errors). Config toggles still key on the slug server-side, so this is display-only.
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

/** The full LSP diagnostic set for one document — semantic + VG + parse errors, with dead-code suppression. */
export function documentDiagnostics(store: WorkspaceStore, messages: Messages, d: Document): Diagnostic[] {
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
      }).filter((it) => !inDeadMember(it.span, dm))
  return [
    ...items.map(toLspDiagnostic),
    ...(dead ? [] : computeNetworkTextDiagnostics(d, store.project(), messages, store.workspaceRefs))
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
