/**
 * THE LITERAL PREFIXES AND THE PUNCTUATION — the words that open a `#`-typed or quoted literal, and the symbols the
 * lexer reads as punctuators. Split from `vocabulary.ts` (openspec lsp-same-standard design.md §2.2), which keeps the
 * keyword list itself.
 */
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
])

/** The typed prefixes whose body is an INTEGER — optional `-`, digits, an unsigned base (`lexer.ts` `lexTypedIntegerBody`):
 *  the integers and the bit strings, BOOL aside (its body is one character). */
export const TYPED_INTEGER_PREFIXES: ReadonlySet<string> = new Set([
  "BYTE", "WORD", "DWORD", "LWORD", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT",
])

/**
 * The named types whose parentheses hold a SUBRANGE (`INT(0..100)`): the integers and the bit strings, and the platform
 * integers that stand for them. After any OTHER type the parentheses are an argument list (FB_Init's) — `REAL(0..1)`,
 * `BOOL(0..1)` and an alias of INT are "',' or ')' expected instead of '..'", and `REAL(5)` builds; after one of these,
 * `INT(5)` is "'..' expected instead of ')'" (`decl_subrange_*`, both vendors 2026-10-01; INT, UINT, BYTE, __XINT,
 * __UXINT, __XWORD measured as subranges, TIME and DATE as argument lists).
 */
export const SUBRANGE_BASE_TYPES: ReadonlySet<string> = new Set([...TYPED_INTEGER_PREFIXES, "__XINT", "__UXINT", "__XWORD"])

/**
 * CODESYS's two QUOTED literal prefixes — `UCHAR#'A'` (a character code) and `UTF8#'…'` (a STRING of UTF-8 bytes). The
 * lexer reads either in any case, with a SINGLE quote only: `uchar#'A'` builds, `UCHAR#"A"` is "'\"A\"' is no
 * component of 'UCHAR'" (`lit_uchar_*`, `lit_utf8_*`, CODESYS 2026-10-01). What the token MEANS is `literal/value`'s.
 */
export const QUOTED_LITERAL_PREFIXES: ReadonlySet<string> = new Set(["UCHAR", "UTF8"])

/**
 * The words before `#` that are no literal and no operand: `STRING#'abc'` is "Unexpected token 'STRING#' found", the
 * word and its `#` one token, on both vendors (`lit_string_typed*`, `lit_wstring_typed*`, 2026-10-01).
 */
export const REFUSED_LITERAL_PREFIXES: ReadonlySet<string> = new Set(["STRING", "WSTRING"])

/**
 * The `<prefix>#` literals TwinCAT reads. ANY OTHER `<word>#` is one identifier token there, `#` included, and cascades
 * — "Unexpected Token 'CHAR#' found" for `CHAR#'A'`, `CHAR#65`, `XYZ#'abc'`, `UTF8#'a'`, `E_Mode#Running` alike, and
 * `UCHAR#`/`LDATE#`/`LDT#`/`LTOD#` before them (`lit_*`, `xf_l*`, `operand_uchar_literal`, TwinCAT 2026-09-20 and
 * 2026-10-01). It was a list of the CODESYS-only prefixes; the measurement says the rule is the other way round.
 */
export const TWINCAT_LITERAL_PREFIXES: ReadonlySet<string> = new Set([
  ...TIME_PREFIXES,
  "D", "DATE", "TOD", "TIME_OF_DAY", "DT", "DATE_AND_TIME",
  ...TYPED_PREFIXES,
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
