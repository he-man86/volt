// Layer D — analysis. diagnostics orchestrator · messages (per-vendor) · checks/.
// Owns: diagnostic message building, the vendor-difference registry.
//
// THE PUBLIC API, as an explicit list (openspec analysis-conformance design.md §2 "Index contents", task 1.3): nothing
// outside src/analysis imports any other analysis file (gate A2, `scripts/check-layering.ts`), so a name not exported
// here is analysis-internal.

// the pipeline
export {
  computeDiagnostics,
  computeSemanticDiagnostics,
  runRegistry,
  CHECK_REGISTRY,
  type DiagnosticsArgs,
} from "./pipeline/diagnostics.js"
export type { Check, CheckContext } from "./pipeline/context.js"
export type { CheckGroup } from "./pipeline/registry.js"
export { initializerWarnedTwice, SOURCE, type DiagnosticItem } from "./shared/diagnostic-item.js"
// configuration
export {
  resolveConfig,
  CONFIGURABLE_CODES,
  projectDiagnosticsFrom,
  type AnalysisInitOptions,
  type ConfigurableCode,
  type DiagnosticState,
  type ResolvedConfig,
  type Vendor,
  type VendorSetting,
} from "./config.js"
// wording
export { messagesFor, type Messages } from "./messages.js"
export { codesysCodeFor, CODESYS_CODE_MAP } from "./error-code-map.js"
// the parse-error codes the server keeps in a dead member (task 2.5); the wording and the vendor rule the front-end's
// parse-error dumps read (`test/frontend/dumps.ts`) — the server's raw stream that also read them is gone (2.5)
export { PARSE_ERROR_CODES, parseErrorMessage, vendorReportsParseError } from "./checks/syntax/parse-errors.js"
// the shared rules the network-text check and the census tools read
export { assignmentPairError, binaryOpError, conversionArgError, narrowingPairError, stringLiteralMessageType } from "./shared/rules.js"
export { unresolvedInExprs, unresolvedMembers, type BareRef, type MemberRef } from "./shared/resolution.js"
export { compilerExprText, structEcho } from "./shared/expr-echo.js"
export { bareConversionArgument, isHole, reported } from "./shared/hole.js"
export { isStructInit } from "./checks/types/struct-init.js"
