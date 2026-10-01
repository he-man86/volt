/**
 * SYNTAX — ST text to a tree: the vocabulary and the lexer, the AST and its walks, the parser, literal values, pragmas,
 * and the Volt workspace file format (openspec frontend-conformance design.md §2 "Index contents"). This file names
 * exactly what the rest of the package imports; consumers import it, never a file beside it.
 */

// source positions, identifiers
export { spanContains, zeroSpan, type Span } from "./span.js"
export { isSelfRef, sameName, selfRefKind } from "./identifier.js"

// the vocabulary and the lexer
export { CODESYS_ONLY_KEYWORDS, TWINCAT_LITERAL_PREFIXES, KEYWORDS, type Dialect } from "./lex/vocabulary.js"
export { isTrivia, type Token, type TokenKind } from "./lex/tokens.js"
export { lex } from "./lex/lexer.js"

// the tree
export type {
  Action,
  AggregateElement,
  AggregateInit,
  ArrayDim,
  Assignment,
  BinaryExpr,
  BodySpan,
  CallArg,
  CallExpr,
  CaseArm,
  CaseStatement,
  EnumBody,
  EnumValue,
  Expr,
  Function,
  FunctionBlock,
  GlobalVarList,
  IdentExpr,
  Identifier,
  Initializer,
  Interface,
  InterfaceMethod,
  InterfaceProperty,
  Literal,
  MemberExpr,
  Method,
  Namespace,
  ParseError,
  ParseResult,
  Program,
  Property,
  PropertyAccessor,
  RefusedInit,
  Statement,
  StatementList,
  StructBody,
  TopLevel,
  TypeDecl,
  TypeExpr,
  UnionBody,
  VarDecl,
  VarSection,
  VarSectionKind,
} from "./ast/nodes.js"
export { REFUSED_PLACEHOLDER } from "./ast/nodes.js"
export {
  allUnits,
  exprChildren,
  stmtChildLists,
  stmtExprs,
  walkAllExprs,
  walkExpr,
  walkStatements,
} from "./ast/walk.js"
export { varInputParams } from "./ast/declarations.js"

// parsing
export { parseDocument, parseSource, type ParseOptions } from "./parse/parser.js"
export { parseActive, parseStatements } from "./parse/body-parse.js"
export { BINARY_PRECEDENCE, REFUSED_OPERATORS, parseExprFromTokens } from "./parse/expression.js"
export { parseTypeExprFromTokens } from "./parse/type-expr.js"

// literal values
export { DURATION_UNITS_NS, typedLiteralForm, type TypedLiteralForm } from "./literal/value.js"
export { decodeStringLiteral, decodeUtf8Literal } from "./literal/string.js"
export { addressShape, type AddressShape } from "./literal/address.js"
export { calendarNanoseconds } from "./literal/calendar.js"

// pragmas
export { declarationAttributes, memberAttributes, unitAttributes } from "./pragmas/attributes.js"

// the Volt workspace file format
export {
  bodyReader,
  IMPLEMENTATION_KEYWORD,
  implementationLine,
  implementationWords,
  isNeverShown,
  statedLine,
} from "./format/implementation-line.js"
export { isRetiredComment } from "./format/retired-comments.js"
export { sourceObjectOf } from "./format/source-object.js"
export { graphicalBodies, graphicalMarkerLanguage, isGraphicalBody, isStBody, unitBodies } from "./format/bodies.js"

// printing a declared type or an expression
export { dimText, exprText, initOperatorText, renderTypeExpr } from "./print.js"
