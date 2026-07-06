// Layer D — analysis. diagnostics orchestrator · messages (per-vendor) · checks/.
// Owns: diagnostic message building, the vendor-difference registry.
export * from "./config.js"
export * from "./messages.js"
export * from "./diagnostics.js"
export { deadPous, ownerPou, type ReachabilityInput } from "./reachability.js"
export { SOURCE, type DiagnosticItem } from "./checks/_shared.js"
export { assignmentPairError } from "./checks/types/assignment.js"
export { narrowingPairError } from "./checks/types/narrowing.js"
export { binaryOpError } from "./checks/types/binary-operators.js"
export { unresolvedInExprs, unresolvedMembers, type BareRef, type MemberRef } from "./checks/names/_identifier-resolution.js"
