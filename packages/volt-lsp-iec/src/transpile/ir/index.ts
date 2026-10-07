/**
 * The transpiler IR — what every backend consumes, and the one place ST semantics are resolved. This barrel is its
 * contract: `expr.ts` (places and expressions), `stmt.ts`, `program.ts` (the frame), and `walk.ts`.
 *
 * Two decisions shape it, and both are load-bearing:
 *
 * **1. Places, not names.** A variable is a SLOT in a frame — the POU's, an instance's, a routine's locals, the
 * globals — reached through a `Place.path` of fields, indices and bits, never an identifier looked up at run time.
 * ST declares all storage up front, so every alias is one of three forms (design §9): the place itself, a
 * VAR_IN_OUT that never outlives its call (a `&mut` in Rust), or a POINTER / REFERENCE naming its one target (an
 * index, checked at every dereference). Lowering refuses whatever would need two live `&mut` at once, so the Rust
 * stays safe.
 *
 * **2. The IR carries semantics; a backend carries none.** Implicit widening is an explicit `convert` node,
 * CASE ranges are resolved bounds, all three loop forms are one `loop`, and every type is a resolved `Type`
 * from `types/` — not a name, and not a second type model. If a backend ever has to *decide* something, the
 * lowering was incomplete and that is the bug to fix.
 *
 * The IR is a typed tree, not SSA: the targets are source languages, not machine code.
 */
export * from "./expr.js"
export * from "./stmt.js"
export * from "./program.js"
// the walks are the transpiler's own (`ir/walk.ts`, imported by path); only `holdsCall` is on the public surface (§2.1.1
// removes it there)
export { holdsCall } from "./walk.js"
