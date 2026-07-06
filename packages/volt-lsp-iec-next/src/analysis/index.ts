// Layer D — analysis. diagnostics orchestrator · messages (per-vendor) · checks/.
// Owns: diagnostic message building, the vendor-difference registry.
export * from "./config.js"
export * from "./messages.js"
export * from "./diagnostics.js"
export { SOURCE, type DiagnosticItem } from "./checks/_shared.js"
export { assignmentPairError } from "./checks/types/assignment.js"
