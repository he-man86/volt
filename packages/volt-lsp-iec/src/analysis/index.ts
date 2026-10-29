// Layer D — analysis. diagnostics orchestrator · messages (per-vendor) · checks/.
// Owns: diagnostic message building, the vendor-difference registry.
//
// THE PUBLIC API, as an explicit list (openspec analysis-conformance design.md §2 "Index contents", task 1.3): nothing
// outside src/analysis imports any other analysis file (gate A2, `scripts/check-layering.ts`), so a name not exported
// here is analysis-internal.

// the pipeline
export {
  computeDiagnostics,
  runRegistry,
  CHECK_REGISTRY,
} from "./pipeline/diagnostics.js"
// one document's findings, composed (the server adds only the LSP conversion — openspec lsp-server-scheduling 2.4)
export { documentFindings } from "./pipeline/document.js"
export { MISSING_LANGUAGE } from "./checks/syntax/missing-language.js"
export { materializationFindings } from "./checks/workspace/materialization.js"
export type { Check, CheckContext } from "./pipeline/context.js"
export { initializerWarnedTwice, SOURCE, type DiagnosticItem, type Fix, type FixEdit } from "./shared/diagnostic-item.js"
// configuration
export {
  resolveConfig,
  CONFIGURABLE_CODES,
  projectDiagnosticsFrom,
  projectUnicodeIdentifiersFrom,
  type AnalysisInitOptions,
  type ConfigurableCode,
  type DiagnosticState,
  type ResolvedConfig,
  type Vendor,
} from "./config.js"
// wording
export { messagesFor, type Messages } from "./messages/index.js"
export { codesysCodeFor, CODESYS_CODE_MAP } from "./error-code-map.js"
// the parse-error codes the server keeps in a dead member (task 2.5); the wording and the vendor rule the front-end's
// parse-error dumps read (`test/frontend/dumps.ts`) — the server's raw stream that also read them is gone (2.5)
export { PARSE_ERROR_CODES, parseErrorMessage, vendorReportsParseError } from "./checks/syntax/parse-errors.js"
// the shared rules the network-text check and the census tools read
export { assignmentPairError, binaryOpError, conversionArgError, narrowingPairError, stringLiteralMessageType } from "./shared/rules.js"
export { unresolvedInExprs, unresolvedMembers } from "./shared/resolution.js"
export { compilerExprText, structEcho } from "./shared/expr-echo.js"
export { bareConversionArgument, isHole, reported } from "./shared/hole.js"
export { isStructInit } from "./checks/types/struct-init.js"
// the network check — what an LD/FBD body's network may hold
export { networkDiagnostics } from "./checks/network/_plain-st.js"
// dead-code reachability (openspec lsp-same-standard 2.1): which units and members are dead is an analysis of the
// program; the policy — suppress diagnostics on dead code unless `diagnoseDeadCode` — is `pipeline/document` `documentFindings`
export {
  deadMemberSpans,
  deadMemberSpansFromInfos,
  deadPous,
  deadPousFromInfos,
  fileReachInfo,
  inDeadMember,
  ownerPou,
  type FileReachInfo,
} from "./reachability/reachability.js"
export { deadNameUniverse, reachDeadEquivalent } from "./reachability/dead-code-equivalence.js"
// excluded from build (openspec lsp-excluded-from-build): the one place that decides which objects the compiler does not build
export { effectivelyExcluded } from "./reachability/exclusion.js"
