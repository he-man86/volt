// Layer D — analysis. diagnostics orchestrator · messages (per-vendor) · checks/.
// Owns: diagnostic message building, the vendor-difference registry.
export * from "./config.js"
export * from "./messages.js"
export * from "./diagnostics.js"
export {
  deadPous,
  deadMemberSpans,
  deadPousFromInfos,
  deadMemberSpansFromInfos,
  fileReachInfo,
  deadNameUniverse,
  reachDeadEquivalent,
  inDeadMember,
  ownerPou,
  type ReachabilityInput,
  type FileReachInfo,
} from "./reachability.js"
export { SOURCE, type DiagnosticItem } from "./diagnostic-item.js"
export { assignmentPairError, binaryOpError, conversionArgError, narrowingPairError } from "./rules.js"
export { unresolvedInExprs, unresolvedMembers, type BareRef, type MemberRef } from "./resolution.js"
