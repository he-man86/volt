// Layer B — symbols. Symbol table, binder (AST → scope tree), scope-nav.
// Owns: Symbol, Scope, scope-tree navigation. Imports downward only (syntax).
export * from "./symbol.js"
export * from "./binder.js"
export * from "./scope-nav.js"
