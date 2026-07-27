// fallow-ignore-file unused-file -- documented barrel placeholder (docs/architecture.md §Backend); print.ts is the real, tested content. Re-exports nothing yet, by design.
// Backend — transpile. Sibling consumer of the frontend (syntax ← symbols ← types), not the LSP.
// Lowers AST → IR → Rust for headless test execution. Consumes A·B·C only.
export {}
