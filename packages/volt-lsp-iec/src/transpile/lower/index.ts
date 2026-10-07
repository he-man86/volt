// AST → IR. The only place ST semantics are decided; every backend downstream is a printer.
export * from "./lower.js"
/** The global `TIME()` reads — what a harness sets before a scan. */
export { CLOCK } from "./builtins.js"
/** What lowering answers with, and the refusal registry (`kind`: "is this my bug or yours?"). */
export * from "./diagnostics/codes.js"
export * from "./diagnostics/diagnostic.js"
