// @opencode-ai/volt-lsp-iec — public API barrel.
//
// The layer stack (imports point DOWNWARD only, lint-enforced by scripts/check-layering.ts):
//   syntax ← symbols ← types ← analysis ← services ← reference/graphical ← server
//                                        ↖ transpile consumes syntax·symbols·types
//
// Re-export each layer's public surface as it fills in. Consumers of the package
// import from here or from a layer barrel — never a deep file.
export * from "./syntax/index.js"
export * from "./symbols/index.js"
export * from "./types/index.js"
export * from "./analysis/index.js"
export * from "./services/index.js"
export * from "./reference/index.js"
export * from "./graphical/index.js"
export * from "./server/index.js"

// Workspace init + vendor detection — the cross-package surface volt-git's `volt init` consumes
// (`installCorpus` + `DetectedVendor`). Not part of the layer stack; self-contained fs utilities.
export { detectVendor } from "./detect-vendor.js"
export type { DetectedVendor } from "./detect-vendor.js"
export { runInit as installCorpus } from "./init.js"
export type { InitOptions as InstallCorpusOptions, InitResult as InstallCorpusResult } from "./init.js"

// Workspace reference-file scan — library namespaces + device instances the unresolved-identifier
// check skips. FS I/O; sits above the pure analysis layer (server + tests load it, pass it to diagnostics).
export { loadWorkspaceRefs, loadLibraryNamespaces, loadDeviceInstances } from "./workspace-refs.js"
