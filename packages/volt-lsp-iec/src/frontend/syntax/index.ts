/**
 * SYNTAX — ST text to a tree: the vocabulary and the lexer, the AST and its walks, the parser, literal values, pragmas,
 * and the Volt workspace file format (openspec frontend-conformance design.md §2 "Index contents"). This file names
 * exactly what the rest of the package imports; consumers import it, never a file beside it.
 */

// source positions, identifiers
export { endsLineAt, lineBreakOf, lineColAt, lineStartOf, spanContains, splitLines, zeroSpan, type Span } from "./span.js"
export { isSelfRef, sameName, selfRefKind } from "./identifier.js"

// the vocabulary and the lexer
export { CODESYS_ONLY_KEYWORDS, KEYWORDS, type Dialect } from "./lex/vocabulary.js"
export { CODESYS_ONLY_TYPE_WORDS, ELEMENTARY_TYPE_WORDS } from "./lex/word-sets.js"
export { TWINCAT_LITERAL_PREFIXES } from "./lex/prefixes.js"
export { isTrivia, type Token, type TokenKind } from "./lex/tokens.js"
export { isIdentCont, isIdentStart } from "./lex/chars.js"
export { lex } from "./lex/lexer.js"
export { isRefusedDeclaredName } from "./lex/word-sets.js"

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
} from "./ast/nodes/index.js"
export { REFUSED_PLACEHOLDER } from "./ast/nodes/index.js"
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
export { bodyStatements, sourceStatements } from "./parse/body-parse.js"
export type { Attribute } from "./ast/nodes/index.js"
export type { BodyParse } from "./parse/statements.js"
export type { PragmaMessage } from "./parse/body-pragmas.js"
export { BINARY_PRECEDENCE, REFUSED_OPERATORS } from "./parse/precedence.js"
export { parseExprFromTokens } from "./parse/expression.js"

// literal values
export { DURATION_UNITS_NS, typedLiteralForm } from "./literal/value.js"
export { decodeStringLiteral, decodeUtf8Literal } from "./literal/string.js"
export { addressShape } from "./literal/address.js"
export { calendarNanoseconds } from "./literal/calendar.js"

// pragmas
export { declarationAttributes, hasFrontendAttribute, memberAttributes, readAttribute, unitAttributes } from "./pragmas/attributes.js"
export { attributeNames, isKnownAttribute } from "./pragmas/known-attributes.js"
export { directiveOf } from "./pragmas/conditional.js"
export type { CompileEnvironment, ConditionNames, ConditionWorld, DeviceFacts, Target } from "./pragmas/condition-eval.js"

// the Volt workspace file format
export { bodyReader, languageLineWords, retiredLine, statedLine } from "./format/language-line.js"
export { LANGUAGE_KEY, languageLine, retiredLineMessage } from "./format/object-properties.js"
export { baseNameOf, documentPath, objectNameOf, sourceObjectOf } from "./format/source-object.js"
export { graphicalMarkerLanguage, isPlainStNetworkBody, isStBody, unitBodies } from "./format/bodies.js"

// printing a declared type or an expression
export { compilerTypeText, dimText, exprText, initOperatorText, renderTypeExpr } from "./print.js"

// network text — an LD/FBD body as ST with `%` lines (`packages/volt-cli/docs/network-text.html`): its networks and
// the statement tokens the ST parser reads
export { closedString, EXECUTE, plainStText, UNNAMED, type PlainStExecute, type PlainStNetwork } from "./network/plain-st.js"
