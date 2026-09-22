// Layer A — syntax. Tokens, lexer, the complete AST, parser + treewalker.
// Public surface of the syntax layer. Consumers import from here, never deep files.
// See architecture.md → ownership map: `syntax/` owns Span, Token, AST node types.
export * from "./span.js"
export * from "./tokens.js"
export * from "./lexer.js"
export * from "./ast.js"
export * from "./bodies.js"
export * from "./parser.js"
export * from "./statements.js"
export * from "./ast-walk.js"
export * from "./print.js"
export * from "./token-at.js"
export * from "./type-refs.js"
export * from "./unit-attributes.js"
export { parseActive } from "./conditional-pragmas.js"
export { decodeStringLiteral, parseLiteralValue, DURATION_UNITS_NS } from "./literal-value.js"
export { parseExprFromTokens } from "./expression.js"
