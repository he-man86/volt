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
  // Modifiers. NON_RETAIN is NOT one: both vendors build a variable called `NON_RETAIN`, and read `VAR NON_RETAIN x : T;`
  // as a declaration of that name followed by a stray `x` — "',, AT or :' expected instead of 'x'"
  // (`decl_non_retain_as_name`, `var_non_retain`, `decl_non_retain_in_*`, 2026-10-01).
  "CONSTANT",
  "RETAIN",
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
  // The Instruction List call. CODESYS reserves it in ST: a statement opening with it is refused on the word
  // (`lex_cal_keyword`: "Unexpected token 'CAL' found", then `t();` parses on its own) and so is a variable of that
  // name, declared, assigned (`cc_il_name_cal`) or read (`lex_keyword_operand_cal`, `lex_cal_declared_operand`:
  // "Expression expected instead of 'cal'" — `NOT_AN_OPERAND`). It was here once and was taken out because the name
  // then echoed upper-cased and its use said "not defined"; the echo is as written now, and every position a use can
  // stand in is refused by the parser in the vendor's words.
  "CAL",
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
  // CODESYS's vector type. A KEYWORD: `__vector` is refused where a statement starts and where a value belongs, as every
  // reserved word is (`lex_keyword_*_sys_vector`, `lex_codesys_only_keyword_twincat_names`, CODESYS 2026-09-30);
  // `parse/type-expr` reads it where a type belongs. CODESYS-only (`CODESYS_ONLY_KEYWORDS`).
  "__VECTOR",
  // Extended VAR section + export-format
  "VAR_GENERIC",
  "PARAMS",
  // Property accessors
  "GET",
  "SET",
  // Self-reference
  "THIS",
  "SUPER",
  // Reserved words no grammar rule consumes — CODESYS refuses each as a name (`lex_reserved_unused_keyword_as_name_*`,
  // 2026-09-30). `USING` and `WITH` are NOT here: CODESYS builds a variable called either, `USING` with the C0543
  // warning (`checks/names/reserved-keyword.ts`), so they are identifiers.
  "FROM",
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
 * running LSP while the conformance replay, which does pass it, stayed green. `computeDiagnostics` now
 * refuses to run when the project's dialect and the config's vendor disagree.
 */
export type Dialect = "codesys" | "twincat"

/**
 * The CODESYS extensions TwinCAT does NOT have — measured, one fixture family at a time, by asking both
 * compilers the same source (2026-09-20):
 *
 *   `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`  TwinCAT answers "Identifier '<name>' not defined"
 *   `XSIZEOF`                                         the same, called (`ar_xsizeof_type`, frontend-conformance 4.3.4)
 *   `__VECTOR`                                        "Type definition expected instead of '__VECTOR'" where a type
 *                                                     belongs (`parse/type-expr`), "not defined" where a name does
 *   `UCHAR#`, `UTF8#`, `LDATE#`, `LDT#`, `LTOD#`      the prefix cascades: "Unexpected Token 'LDATE#' found" — and so
 *                                                     does every `<word>#` TwinCAT has no literal for
 *                                                     (`TWINCAT_LITERAL_PREFIXES`)
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
  "XSIZEOF",
  "__VECTOR",
  // TwinCAT reads `VAR_GENERIC` as a declaration's NAME ("',, AT or :' expected instead of 'CONSTANT'", `decl_var_generic*`
  // on TwinCAT, 2026-10-01); CODESYS opens a section with it.
  "VAR_GENERIC",
])


