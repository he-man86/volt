/**
 * ONE DOCUMENT'S FINDINGS, COMPOSED (openspec lsp-server-scheduling 2.4; moved here from the server, whose layer G is
 * the LSP adapter and nothing else) — the semantic pass, the network-text pass and the missing-language finding, under
 * the suppression rules the compiler's recordings set:
 *
 * - a referenced library's materialized source gives nothing: CODESYS never recompiles a precompiled library, so any
 *   finding on it is a false positive the user cannot act on (ONE gate here, so no per-check guard can drift);
 * - a structurally DEAD POU gives nothing, parse errors included (`dead_fb_missing_then`, `dead_fb_declaration_parse_error`,
 *   recorded 2026-10-06 — the build never reads it);
 * - an object EXCLUDED FROM BUILD gives nothing, parse errors included, whether reachability finds it live or not and
 *   with `diagnoseDeadCode` on: CODESYS compiles none (DIALECT C2j; `reachability/exclusion` decides which, openspec
 *   lsp-excluded-from-build) — a whole file when its own object is excluded, else each excluded member;
 * - inside a live POU, the semantic findings of an uncalled member are quiet, its parse errors stay (both
 *   vendors report them: `dead_method_missing_then`, `sig_empty_type`; C0051 whichever check gave it,
 *   `dead_method_hasattribute_unquoted`);
 * - a body that states no language quiets everything in it, parse errors included (no reader read it), and ONE finding
 *   names it (`checks/syntax/missing-language.ts`). That finding follows the PUSH, not the build: it is NOT dead-gated
 *   (the push refuses the file whether or not anything calls it) and it is appended AFTER the quiet (its range lies
 *   inside the body). In a workspace another materialization wrote, the manifests say so once
 *   (`checks/workspace/materialization.ts`) and neither it nor any network-text finding is given.
 *
 * Takes what the store holds — `workspace` ranks above `analysis`, so not the store itself.
 */
import { isLibrarySymbol, type Scope } from "../../frontend/symbols/index.js"
import type { ParseResult, Span } from "../../frontend/syntax/index.js"
import { materializationMismatch, type LibraryManifest } from "../../frontend/library/index.js"
import { computeNetworkTextDiagnostics } from "../checks/network/network-analysis.js"
import { PARSE_ERROR_CODES } from "../checks/syntax/parse-errors.js"
import { missingLanguage, unstatedBodies } from "../checks/syntax/missing-language.js"
import type { ResolvedConfig } from "../config.js"
import { messagesFor } from "../messages/index.js"
import { effectivelyExcluded, inExcluded } from "../reachability/exclusion.js"
import { inDeadMember, ownerPou } from "../reachability/reachability.js"
import type { DiagnosticItem } from "../shared/diagnostic-item.js"
import { computeDiagnostics } from "./diagnostics.js"

/** What one document's findings are composed from. */
interface DocumentFindingsArgs {
  doc: { uri: string; source: string; parseResult: ParseResult }
  project: Scope
  config: ResolvedConfig
  /** The POUs nothing reaches (lowercased names). */
  dead: ReadonlySet<string>
  /** The uncalled members inside live POUs, by document URI. */
  deadMembers: ReadonlyMap<string, Span[]>
  manifests: readonly LibraryManifest[]
}

export function documentFindings(args: DocumentFindingsArgs): DiagnosticItem[] {
  const { doc, project, config } = args
  if (isLibrarySymbol({ uri: doc.uri })) return []
  const owner = ownerPou(doc.parseResult)
  const excluded = effectivelyExcluded(doc.parseResult)
  const silent = excluded.file || (owner !== undefined && args.dead.has(owner))
  const dm = silent ? undefined : args.deadMembers.get(doc.uri)
  const otherFormat = materializationMismatch(args.manifests)
  const unstated = unstatedBodies(doc.parseResult.units)
  const missing = otherFormat ? [] : unstated.map(missingLanguage)
  const inUnstated = (span: Span): boolean =>
    unstated.some(({ body }) => span.start >= body.span.start && span.end <= body.span.end)
  const quiet = (it: DiagnosticItem): boolean =>
    (inDeadMember(it.span, dm) && !PARSE_ERROR_CODES.has(it.code)) || inExcluded(it.span, excluded.objects) || inUnstated(it.span)
  const items = silent ? [] : computeDiagnostics({ parseResult: doc.parseResult, source: doc.source, project, config, uri: doc.uri })
  // The network pass stays its own call (analysis-conformance §3 is parked: network text is not rewired here).
  const network = silent || otherFormat ? [] : computeNetworkTextDiagnostics(doc, project, messagesFor(config.vendor))
  return [...[...items, ...network].filter((it) => !quiet(it)), ...missing]
}
