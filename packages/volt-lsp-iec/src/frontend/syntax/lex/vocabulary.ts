/**
 * THE VOCABULARY OF STRUCTURED TEXT — every word and symbol the lexer knows, and the named subsets the parser asks
 * about. One home (openspec frontend-conformance design.md §2 `lex/vocabulary.ts`): a keyword list, a VAR-section list
 * or a modifier set written anywhere else is a second copy.
 *
 * Keywords are matched case-insensitively. The lexer preserves the original casing in `Token.text` so error messages
 * can echo what the user wrote.
 */

/**
 * All ST keywords. Lexed case-insensitively, stored canonical (upper).
 *
 * Grouped here for readability — order within a group doesn't matter,
 * but new additions should land in the right group.
 */
export const KEYWORDS = [
  // POU shells
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
  // Type declarations
  "TYPE",
  "END_TYPE",
  "STRUCT",
  "END_STRUCT",
  "UNION",
  "END_UNION",
  // VAR sections
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
  // Modifiers
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
  // Inheritance / interfaces
  "EXTENDS",
  "IMPLEMENTS",
  // Type expressions
  "ARRAY",
  "OF",
  "REFERENCE",
  "POINTER",
  "TO",
  "AT",
  "WITH",
  "STRING",
  "WSTRING",
  // Control flow
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
  // Textual operators / boolean keywords
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
  // Arithmetic operator-words (IEC 61131-3 standard)
  "ADD",
  "SUB",
  "MUL",
  // Bit-shift operator-words
  "SHL",
  "SHR",
  "ROL",
  "ROR",
  // Selection operator-words
  "SEL",
  "MUX",
  "MIN",
  "MAX",
  "LIMIT",
  // Comparison operator-words
  "GT",
  "LT",
  "GE",
  "LE",
  "EQ",
  "NE",
  // Math functions (IEC 61131-3 standard)
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
  // Address / meta operators
  "ADR",
  "BITADR",
  "MOVE",
  "INDEXOF",
  "SIZEOF",
  "XSIZEOF",
  // Truncation
  "TRUNC",
  "TRUNC_INT",
  // Legacy / misc
  "INI",
  // CODESYS system operators (all __-prefixed; reserved by language rule)
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
  // Extended VAR section + export-format
  "VAR_GENERIC",
  "PARAMS",
  // Property accessors
  "GET",
  "SET",
  // Self-reference
  "THIS",
  "SUPER",
  // Reserved but rarely used
  "FROM",
  "USING",
  "NAMESPACE",
  "END_NAMESPACE",
] as const

/** One ST keyword, canonical (upper case) — derived from `KEYWORDS`, so there is one list. */
export type Keyword = (typeof KEYWORDS)[number]

/**
 * WHOSE ST IS THIS? The two vendors' vocabularies are not the same, and the difference is in the LEXER, not in
 * a check: a word CODESYS reserves is an ordinary identifier on TwinCAT, and a literal prefix it does not have
 * cascades as a parse error. Everything else about parsing is shared.
 *
 * AND IT HAS TO ARRIVE THREE WAYS, which is the harder half. `parseSource` carries it, `resolveConfig` carries
 * it, and `buildSymbolTable` carries it onto `project.dialect` — and that third one defaulted to codesys and was
 * never passed by the SERVER, so every rule keyed on `project.dialect` (the resolution and the operand rules) was dead in the
 * running LSP while the conformance replay, which does pass it, stayed green. `computeSemanticDiagnostics` now
 * refuses to run when the project's dialect and the config's vendor disagree.
 */
export type Dialect = "codesys" | "twincat"

/**
 * The CODESYS extensions TwinCAT does NOT have — measured, one fixture family at a time, by asking both
 * compilers the same source (2026-09-20):
 *
 *   `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`  TwinCAT answers "Identifier '<name>' not defined"
 *   `__VECTOR`                                        "Type definition expected instead of '__VECTOR'"
 *   `UCHAR#`, `LDATE#`, `LDT#`, `LTOD#`               the prefix cascades: "Unexpected Token 'LDATE#' found"
 *
 * And the ones it DOES have, listed because absence of evidence is not what this set is for: `__TRY`/`__CATCH`/
 * `__FINALLY`/`__ENDTRY`, `__NEW`/`__DELETE`, `__CURRENTTASK`, `__ISVALIDREF`, `__QUERYINTERFACE`,
 * `__QUERYPOINTER`, `__VARINFO`, `__SYSTEM`, `__XADD`, `__XINT`/`__UXINT`/`__XWORD`, and `LTIME#` — all
 * recorded on both, all agreeing.
 */
export const CODESYS_ONLY_KEYWORDS: ReadonlySet<string> = new Set([
  "__POSITION",
  "__POUNAME",
  "__COMPARE_AND_SWAP",
  "__VECTOR",
])

/** The `<prefix>#<value>` literal forms only CODESYS has — same measurement, same day. */
export const CODESYS_ONLY_LITERAL_PREFIXES: ReadonlySet<string> = new Set([
  "UCHAR",
  "LDATE",
  "LDT",
  "LDATE_AND_TIME",
  "LTOD",
  "LTIME_OF_DAY",
])

// ── named subsets — each parser rule that asks "is this one of …" asks here ─────────────────────────────────────────

/** The keywords that open a VAR section. */
export const VAR_SECTION_KEYWORDS: readonly Keyword[] = [
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
  "VAR_GENERIC",
]

/** The keywords a unit starts with at file scope — the parser's top-level dispatch, and where its recovery stops. */
export const UNIT_STARTERS = [
  "FUNCTION_BLOCK",
  "PROGRAM",
  "FUNCTION",
  "METHOD",
  "ACTION",
  "PROPERTY",
  "INTERFACE",
  "TYPE",
  "VAR_GLOBAL",
  "VAR_CONFIG",
  "NAMESPACE",
] as const satisfies readonly Keyword[]

/** A keyword a unit starts with. */
export type UnitStarter = (typeof UNIT_STARTERS)[number]

/**
 * Keywords that are legal NAMES outside the construct that reserves them. `GET`/`SET` (reserved only inside a
 * PROPERTY) and the access/inheritance modifiers (`PUBLIC`/`PRIVATE`/`PROTECTED`/`INTERNAL`/`FINAL`/`ABSTRACT`/
 * `OVERRIDE`) are all legal identifiers elsewhere — real code has methods named `Set`, `Override`, etc.
 */
export const SOFT_NAME_KEYWORDS: ReadonlySet<string> = new Set([
  "GET",
  "SET",
  "PUBLIC",
  "PRIVATE",
  "PROTECTED",
  "INTERNAL",
  "FINAL",
  "ABSTRACT",
  "OVERRIDE",
])

/**
 * Besides an `END_*`, the keywords that CLOSE a declaration list: another VAR section, and the start of the next unit —
 * recovery must never eat past one.
 */
export const DECL_LIST_ENDERS: ReadonlySet<string> = new Set([
  // the VAR sections — a new one ends the previous
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
  "VAR_GENERIC",
  // the unit starters (`parseTopLevel`'s dispatch set) — recovery must never eat past one
  "PROGRAM",
  "FUNCTION_BLOCK",
  "FUNCTION",
  "METHOD",
  "ACTION",
  "PROPERTY",
  "INTERFACE",
  "TYPE",
  "NAMESPACE",
])

/** The modifiers a FUNCTION_BLOCK header takes. */
export const FB_MODIFIERS: readonly Keyword[] = ["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL", "ABSTRACT"]

/** The modifiers a METHOD header takes. */
export const MEMBER_MODIFIERS: readonly Keyword[] = [
  "PUBLIC",
  "PRIVATE",
  "PROTECTED",
  "INTERNAL",
  "FINAL",
  "ABSTRACT",
  "OVERRIDE",
]

/** The modifiers a PROPERTY header takes (two named sets with the interface's until conformance 2.4.3 decides). */
export const PROPERTY_MODIFIERS: readonly Keyword[] = ["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "ABSTRACT", "FINAL"]

/** The modifiers an interface member (a METHOD or PROPERTY inside INTERFACE) takes — informational, but the file's
 *  text, so kept. */
export const INTERFACE_MEMBER_MODIFIERS: readonly Keyword[] = [
  "PUBLIC",
  "PRIVATE",
  "PROTECTED",
  "INTERNAL",
  "FINAL",
  "ABSTRACT",
  "OVERRIDE",
]

// Identifier prefixes that introduce a `#`-suffixed literal.
export const TIME_PREFIXES : ReadonlySet<string> = new Set(["T", "TIME", "LTIME"])
export const DATE_PREFIXES : ReadonlySet<string> = new Set(["D", "DATE", "LDATE"])
export const TOD_PREFIXES : ReadonlySet<string> = new Set(["TOD", "TIME_OF_DAY", "LTOD", "LTIME_OF_DAY"])
export const DATETIME_PREFIXES : ReadonlySet<string> = new Set(["DT", "DATE_AND_TIME", "LDT", "LDATE_AND_TIME"])
// Typed-literal prefixes (`INT#42`, `REAL#1.5`, `BOOL#TRUE`). These
// look like an identifier followed by `#` followed by a literal body.
// We lex the whole thing as a single `typed_lit` token.
export const TYPED_PREFIXES : ReadonlySet<string> = new Set([
  "BOOL",
  "BYTE",
  "WORD",
  "DWORD",
  "LWORD",
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
  "CHAR",
  "WCHAR",
])

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
]

/**
 * Single-char punctuation that can stand on its own. Brackets/parens,
 * arithmetic, separators. `^` is dereference, `&` is reference-of in
 * vendor extensions.
 */
export const SINGLE_CHAR_PUNCT = "()[],.;:=+-*/<>^&%?" as const
