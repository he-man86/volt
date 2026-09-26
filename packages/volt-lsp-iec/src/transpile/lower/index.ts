// AST → IR. The only place ST semantics are decided; every backend downstream is a printer.
export * from "./lower.js"
/** The global `TIME()` reads — what a harness sets before a scan. */
export { CLOCK } from "./builtins.js"
