// @volt/lsp-iec — public API barrel.
//
// The layer stack (imports point DOWNWARD only, lint-enforced by scripts/check-layering.ts):
//   frontend (syntax ← symbols ← types, library beside them) ← network-text ← reference ← analysis ← services
//     ← network ← workspace files ← server;  transpile consumes the front-end
//
// Re-export each layer's public surface as it fills in. Consumers of the package
// import from here or from a layer barrel — never a deep file.
export * from "./frontend/index.js"
export * from "./analysis/index.js"
export * from "./services/index.js"
export * from "./reference/index.js"
export * from "./network/index.js"
export * from "./server/index.js"

// THERE IS NO WORKSPACE-INIT SURFACE HERE ANY MORE. `installCorpus` and `detectVendor` were exported for
// volt-git's `volt init`, a package that was absorbed into the C# CLI — which never called either. See
// `openspec/changes/consolidate-lsp-structure` C8 for what each was and why it went.

// Workspace reference-file scan — library namespaces + device instances the unresolved-identifier
// check skips. FS I/O; sits above the pure analysis layer (server + tests load it, pass it to diagnostics).
export { loadWorkspaceRefs, loadLibraryNamespaces, loadDeviceInstances, loadTaskRoots } from "./workspace-refs.js"
