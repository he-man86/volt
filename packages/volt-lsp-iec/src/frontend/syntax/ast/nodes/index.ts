/**
 * The complete IEC 61131-3 Structured Text AST.
 *
 * The AST models the language *completely* so consumers read structured nodes and never re-parse spans
 * (`docs/data-model.md`). Concretely:
 *   - type-expr bounds are STRUCTURED: subrange `{ lo, hi }`, array dims as const-expr
 *     nodes, string length as an expr — not opaque `BodySpan`s re-parsed ad hoc.
 *   - literals carry a parsed `value`; the *type* is inferred in layer C (types/infer)
 *     from `literalKind` + `value`, so const-eval/overflow checks never re-lex `text`.
 *     (The literal Type is NOT stored here — that would be an upward import into C.)
 *   - initializers are expression trees (`Expr`), not `BodySpan`s.
 * `BodySpan` survives only for genuinely-opaque ranges: a POU body (parsed on demand)
 * and an `AT` address.
 *
 * Ownership: `syntax/ast/nodes/` owns every AST node type. Nobody redefines a node elsewhere. One file per family
 * (openspec lsp-same-standard design.md §8); this index is what the rest of `syntax/` imports.
 */

export * from "./expressions.js"
export * from "./statements.js"
export * from "./types.js"
export * from "./declarations.js"
export * from "./units.js"
