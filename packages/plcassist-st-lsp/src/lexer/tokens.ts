/**
 * IEC 61131-3 Structured Text token model.
 *
 * Two-level encoding:
 * - `TokenKind` is the broad category the parser switches on
 *   (keyword vs identifier vs operator vs literal vs trivia).
 * - For `Keyword` tokens, `Token.keyword` carries the specific keyword
 *   that was matched. This split keeps the parser's switch tables
 *   manageable — most productions only care about a handful of
 *   keywords — while still letting us distinguish all ~80 ST keywords
 *   without a per-keyword TokenKind variant.
 *
 * Keywords are matched case-insensitively. The lexer preserves the
 * original casing in `Token.text` so error messages can echo what the
 * user wrote.
 */
import type { Span } from "./span.js";

/**
 * Broad token categories. The parser dispatches primarily on these.
 */
export type TokenKind =
	| "keyword"
	| "identifier"
	| "int_lit"
	| "real_lit"
	| "string_lit"
	| "wstring_lit"
	| "time_lit"
	| "date_lit"
	| "tod_lit"
	| "datetime_lit"
	| "typed_lit"
	| "address_lit"
	| "punct"
	| "line_comment"
	| "block_comment"
	| "pragma"
	| "whitespace"
	| "eof"
	| "unknown";

/**
 * Which token kinds are trivia (skipped between meaningful tokens).
 * The lexer still emits them so tools that need source fidelity
 * (formatters, refactoring) can see comments and whitespace.
 * The parser filters them out by default.
 */
export function isTrivia(kind: TokenKind): boolean {
	return (
		kind === "line_comment" ||
		kind === "block_comment" ||
		kind === "pragma" ||
		kind === "whitespace"
	);
}

/**
 * All ST keywords. Lexed case-insensitively, stored canonical (upper).
 *
 * Grouped here for readability — order within a group doesn't matter,
 * but new additions should land in the right group.
 */
export type Keyword =
	// POU shells
	| "FUNCTION_BLOCK"
	| "END_FUNCTION_BLOCK"
	| "PROGRAM"
	| "END_PROGRAM"
	| "FUNCTION"
	| "END_FUNCTION"
	| "METHOD"
	| "END_METHOD"
	| "ACTION"
	| "END_ACTION"
	| "PROPERTY"
	| "END_PROPERTY"
	| "END_GET"
	| "END_SET"
	| "INTERFACE"
	| "END_INTERFACE"
	// Type declarations
	| "TYPE"
	| "END_TYPE"
	| "STRUCT"
	| "END_STRUCT"
	| "UNION"
	| "END_UNION"
	// VAR sections
	| "VAR"
	| "VAR_INPUT"
	| "VAR_OUTPUT"
	| "VAR_IN_OUT"
	| "VAR_TEMP"
	| "VAR_STAT"
	| "VAR_INST"
	| "VAR_EXTERNAL"
	| "VAR_GLOBAL"
	| "VAR_CONFIG"
	| "VAR_ACCESS"
	| "END_VAR"
	// Modifiers
	| "CONSTANT"
	| "RETAIN"
	| "NON_RETAIN"
	| "PERSISTENT"
	| "PUBLIC"
	| "PRIVATE"
	| "PROTECTED"
	| "INTERNAL"
	| "FINAL"
	| "ABSTRACT"
	| "OVERRIDE"
	| "READ_ONLY"
	| "READ_WRITE"
	// Inheritance / interfaces
	| "EXTENDS"
	| "IMPLEMENTS"
	// Type expressions
	| "ARRAY"
	| "OF"
	| "REFERENCE"
	| "POINTER"
	| "TO"
	| "AT"
	| "WITH"
	| "STRING"
	| "WSTRING"
	// Control flow
	| "IF"
	| "THEN"
	| "ELSIF"
	| "ELSE"
	| "END_IF"
	| "CASE"
	| "END_CASE"
	| "FOR"
	| "BY"
	| "DO"
	| "END_FOR"
	| "WHILE"
	| "END_WHILE"
	| "REPEAT"
	| "UNTIL"
	| "END_REPEAT"
	| "RETURN"
	| "EXIT"
	| "CONTINUE"
	| "JMP"
	// Textual operators / boolean keywords
	| "AND"
	| "AND_THEN"
	| "OR"
	| "OR_ELSE"
	| "NOT"
	| "XOR"
	| "MOD"
	| "DIV"
	| "TRUE"
	| "FALSE"
	// Arithmetic operator-words (IEC 61131-3 standard)
	| "ADD"
	| "SUB"
	| "MUL"
	// Bit-shift operator-words
	| "SHL"
	| "SHR"
	| "ROL"
	| "ROR"
	// Selection operator-words
	| "SEL"
	| "MUX"
	| "MIN"
	| "MAX"
	| "LIMIT"
	// Comparison operator-words
	| "GT"
	| "LT"
	| "GE"
	| "LE"
	| "EQ"
	| "NE"
	// Math functions (IEC 61131-3 standard)
	| "ABS"
	| "SQRT"
	| "LN"
	| "LOG"
	| "EXP"
	| "EXPT"
	| "SIN"
	| "COS"
	| "TAN"
	| "ASIN"
	| "ACOS"
	| "ATAN"
	// Address / meta operators
	| "ADR"
	| "BITADR"
	| "CAL"
	| "MOVE"
	| "INDEXOF"
	| "SIZEOF"
	| "XSIZEOF"
	// Truncation
	| "TRUNC"
	| "TRUNC_INT"
	// Legacy / misc
	| "INI"
	// CODESYS system operators (all __-prefixed; reserved by language rule)
	| "__NEW"
	| "__DELETE"
	| "__ISVALIDREF"
	| "__QUERYINTERFACE"
	| "__QUERYPOINTER"
	| "__TRY"
	| "__CATCH"
	| "__FINALLY"
	| "__ENDTRY"
	| "__VARINFO"
	| "__CURRENTTASK"
	| "__POSITION"
	| "__POUNAME"
	| "__COMPARE_AND_SWAP"
	| "__XADD"
	| "__POOL"
	| "TEST_AND_SET"
	// Extended VAR section + export-format
	| "VAR_GENERIC"
	| "PARAMS"
	// Property accessors
	| "GET"
	| "SET"
	// Self-reference
	| "THIS"
	| "SUPER"
	// Reserved but rarely used
	| "FROM"
	| "USING"
	| "NAMESPACE"
	| "END_NAMESPACE";

/** All keyword strings — used by the lexer to build the lookup map. */
export const ALL_KEYWORDS: readonly Keyword[] = [
	"FUNCTION_BLOCK",
	"END_FUNCTION_BLOCK",
	"PROGRAM",
	"END_PROGRAM",
	"FUNCTION",
	"END_FUNCTION",
	"METHOD",
	"END_METHOD",
	"ACTION",
	"END_ACTION",
	"PROPERTY",
	"END_PROPERTY",
	"END_GET",
	"END_SET",
	"INTERFACE",
	"END_INTERFACE",
	"TYPE",
	"END_TYPE",
	"STRUCT",
	"END_STRUCT",
	"UNION",
	"END_UNION",
	"VAR",
	"VAR_INPUT",
	"VAR_OUTPUT",
	"VAR_IN_OUT",
	"VAR_TEMP",
	"VAR_STAT",
	"VAR_INST",
	"VAR_EXTERNAL",
	"VAR_GLOBAL",
	"VAR_CONFIG",
	"VAR_ACCESS",
	"END_VAR",
	"CONSTANT",
	"RETAIN",
	"NON_RETAIN",
	"PERSISTENT",
	"PUBLIC",
	"PRIVATE",
	"PROTECTED",
	"INTERNAL",
	"FINAL",
	"ABSTRACT",
	"OVERRIDE",
	"READ_ONLY",
	"READ_WRITE",
	"EXTENDS",
	"IMPLEMENTS",
	"ARRAY",
	"OF",
	"REFERENCE",
	"POINTER",
	"TO",
	"AT",
	"WITH",
	"STRING",
	"WSTRING",
	"IF",
	"THEN",
	"ELSIF",
	"ELSE",
	"END_IF",
	"CASE",
	"END_CASE",
	"FOR",
	"BY",
	"DO",
	"END_FOR",
	"WHILE",
	"END_WHILE",
	"REPEAT",
	"UNTIL",
	"END_REPEAT",
	"RETURN",
	"EXIT",
	"CONTINUE",
	"JMP",
	"AND",
	"AND_THEN",
	"OR",
	"OR_ELSE",
	"NOT",
	"XOR",
	"MOD",
	"DIV",
	"TRUE",
	"FALSE",
	"GET",
	"SET",
	"THIS",
	"SUPER",
	"FROM",
	"USING",
	"NAMESPACE",
	"END_NAMESPACE",
	"VAR_GENERIC",
	"PARAMS",
	// Arithmetic operator-words
	"ADD",
	"SUB",
	"MUL",
	// Bit-shift
	"SHL",
	"SHR",
	"ROL",
	"ROR",
	// Selection
	"SEL",
	"MUX",
	"MIN",
	"MAX",
	"LIMIT",
	// Comparison
	"GT",
	"LT",
	"GE",
	"LE",
	"EQ",
	"NE",
	// Math
	"ABS",
	"SQRT",
	"LN",
	"LOG",
	"EXP",
	"EXPT",
	"SIN",
	"COS",
	"TAN",
	"ASIN",
	"ACOS",
	"ATAN",
	// Address / meta
	"ADR",
	"BITADR",
	"CAL",
	"MOVE",
	"INDEXOF",
	"SIZEOF",
	"XSIZEOF",
	// Truncation
	"TRUNC",
	"TRUNC_INT",
	// Legacy
	"INI",
	// CODESYS system operators
	"__NEW",
	"__DELETE",
	"__ISVALIDREF",
	"__QUERYINTERFACE",
	"__QUERYPOINTER",
	"__TRY",
	"__CATCH",
	"__FINALLY",
	"__ENDTRY",
	"__VARINFO",
	"__CURRENTTASK",
	"__POSITION",
	"__POUNAME",
	"__COMPARE_AND_SWAP",
	"__XADD",
	"__POOL",
	"TEST_AND_SET",
];

/**
 * All multi-char punctuators. The lexer tries these *before* falling
 * back to single-char punctuation, so `:=` doesn't lex as `:` + `=`.
 * Order matters: longer matches first.
 */
export const MULTI_CHAR_PUNCT: readonly string[] = [
	"**", // exponent
	"<>", // not-equal
	"<=",
	">=",
	":=", // assignment
	"=>", // output assignment
	"..", // range
];

/**
 * Single-char punctuation that can stand on its own. Brackets/parens,
 * arithmetic, separators. `^` is dereference, `&` is reference-of in
 * vendor extensions.
 */
export const SINGLE_CHAR_PUNCT = "()[],.;:=+-*/<>^&%?" as const;

export interface Token {
	kind: TokenKind;
	/**
	 * For `keyword` tokens, the resolved canonical keyword. Undefined
	 * for non-keyword tokens. Use `token.keyword === "FUNCTION_BLOCK"`
	 * in the parser — comparing `token.text` would be wrong because
	 * the user may have written `function_block` and the lexer
	 * preserves the original casing in `text`.
	 */
	keyword?: Keyword;
	/** Source text, exactly as it appeared in the input. */
	text: string;
	/** Source span (start/end byte offsets + line/column for tooling). */
	span: Span;
}
