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
 * running LSP while the conformance replay, which does pass it, stayed green. `computeSemanticDiagnostics` now
 * refuses to run when the project's dialect and the config's vendor disagree.
 */
export type Dialect = "codesys" | "twincat"

/**
 * The CODESYS extensions TwinCAT does NOT have — measured, one fixture family at a time, by asking both
 * compilers the same source (2026-09-20):
 *
 *   `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`  TwinCAT answers "Identifier '<name>' not defined"
 *   `__VECTOR`                                        "Type definition expected instead of '__VECTOR'" where a type
 *                                                     belongs (`parse/type-expr`), "not defined" where a name does
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
 * Keywords that are legal VARIABLE names outside the construct that reserves them — a variable or a parameter may be
 * called `GET`, `SET` or `OVERRIDE` (the Standard `RS` FB declares `SET : BOOL`). Measured one word per fixture
 * (`lex_soft_keyword_name_*`, 2026-09-30): these three build. The other access/inheritance modifiers — `PUBLIC`,
 * `PRIVATE`, `PROTECTED`, `INTERNAL`, `FINAL`, `ABSTRACT` — do NOT: CODESYS refuses each as a variable, "Unexpected
 * token 'public' found" and the broken-declaration cascade, and refuses it again where it is assigned, read, or named
 * as a call's parameter (`lex_keyword_operand_public`, `lex_soft_keyword_named_argument_*` — `NOT_AN_OPERAND`).
 */
export const SOFT_NAME_KEYWORDS: ReadonlySet<string> = new Set(["GET", "SET", "OVERRIDE"])

/**
 * Keywords a UNIT header may take as its name (a function block, method, property or interface): the variable names
 * above and the six modifiers too. Not because CODESYS accepts them there — it refuses to CREATE a method called
 * `public` ("The name 'public' is not valid for this object.", `lex_soft_keyword_method_name_*`), and an FB called
 * `Public` cannot be named as a type ("Type definition expected instead of 'Public'", `lex_soft_keyword_as_type_*`) —
 * but because the compiler says nothing about the HEADER: the object is refused by the IDE, or never compiled. There is
 * no compiler message for the LSP to give on the header, so it reads the name and the header's modifiers stay
 * unambiguous (`FUNCTION_BLOCK PUBLIC Final`).
 */
export const UNIT_NAME_KEYWORDS: ReadonlySet<string> = new Set([
  ...SOFT_NAME_KEYWORDS,
  "PUBLIC",
  "PRIVATE",
  "PROTECTED",
  "INTERNAL",
  "FINAL",
  "ABSTRACT",
])

/**
 * THE KEYWORDS REFUSED AS A NAME WHERE A STATEMENT STARTS — "Unexpected token 'w' found" on the word, then the resync
 * (`parse/statements.ts`). Every keyword was asked, one per fixture, assigned (`w := 1;`) and before a name (`w n := 2;`)
 * — `lex_keyword_assigned_*`, `lex_keyword_before_name_*` (CODESYS, 2026-09-30) — and 92 answered exactly that. The set
 * is every keyword but the ones below, so a keyword added to `KEYWORDS` is refused until a recording says otherwise:
 *
 *   the words a statement or an expression opens with — IF … JMP, `__TRY`, THIS/SUPER/TRUE/FALSE/NOT — and the names
 *   GET/SET/OVERRIDE (`SOFT_NAME_KEYWORDS`);
 *   NON_RETAIN — CODESYS has no such keyword. It is a NAME to it ("Identifier 'non_retain' not defined", "'non_retain'
 *   is no valid assignment target"); Volt keeps the keyword only to read `VAR NON_RETAIN`, which CODESYS refuses
 *   (`checks/declarations/var-section-placement.ts`);
 *   `__DELETE`, `__QUERYINTERFACE`, `__QUERYPOINTER` — an operator that opens a call: CODESYS takes the next token for
 *   its `(` ("'(' expected instead of ':='") and counts its operands (`CALL_OPERATOR_OPERANDS`), not a refused word;
 *   `__CURRENTTASK`, `__POOL` — each reads the next token as its member ("'__CURRENTTASK.n' is no valid assignment
 *   target"), the system operands' rule (E30, E34);
 *   the unit and declaration structure — the POU shells, TYPE/STRUCT/UNION, the VAR sections, NAMESPACE. Not asked: a
 *   body holding `END_VAR` is another object's text, and what the IDE answers for it is not measured.
 */
export const REFUSED_AT_STATEMENT_START: ReadonlySet<string> = (() => {
  const notRefused = new Set<string>([
    "IF", "CASE", "FOR", "WHILE", "REPEAT", "RETURN", "EXIT", "CONTINUE", "JMP", "__TRY",
    "THIS", "SUPER", "TRUE", "FALSE", "NOT",
    ...SOFT_NAME_KEYWORDS,
    "NON_RETAIN",
    "__DELETE", "__QUERYINTERFACE", "__QUERYPOINTER", "__CURRENTTASK", "__POOL",
    "FUNCTION_BLOCK", "END_FUNCTION_BLOCK", "PROGRAM", "END_PROGRAM", "FUNCTION", "END_FUNCTION", "METHOD", "END_METHOD",
    "ACTION", "END_ACTION", "PROPERTY", "END_PROPERTY", "END_GET", "END_SET", "INTERFACE", "END_INTERFACE",
    "TYPE", "END_TYPE", "STRUCT", "END_STRUCT", "UNION", "END_UNION",
    ...VAR_SECTION_KEYWORDS, "END_VAR", "NAMESPACE", "END_NAMESPACE",
  ])
  return new Set(KEYWORDS.filter((k) => !notRefused.has(k)))
})()

/**
 * THE KEYWORDS THAT ARE NO OPERAND — where a value belongs (`n := w;`, a call's argument) CODESYS answers "Expression
 * expected instead of 'w'", then resyncs as after a refused statement: "';' expected instead of 'w'", "Unexpected token
 * 'w' found", a pair for every token to the `;` (`lex_keyword_operand_*`, `lex_soft_keyword_named_argument_*`,
 * `lex_cal_declared_operand`; CODESYS, 2026-09-30). Every keyword was asked; these 49 answered that. The others are not
 * refused on the word: the binary operators (AND … MOD) are taken as the operator and their left operand is what is
 * missing (`parse/expression.ts`); the call operators (ABS, SEL, `__XADD` …) take the next token for their `(`
 * (`CALL_OPERATOR_OPERANDS`); `__NEW`, `__POSITION`, `__POUNAME`, `__CURRENTTASK` and `__POOL` each answer in a shape of
 * their own (rules E24–E34, task 2.5.6); and the words no fixture asked (the unit structure) are not claimed.
 *
 * ONLY THE BARE WORD. `ADD(a, b)` — the IL call form — is refused too, and with this cascade, but it is still
 * `checks/names/refused-name.ts`'s (`ST_OPERATOR_CALLS`) until the call form moves into the parser (task 2.5.5); and a
 * keyword before `(` is otherwise unmeasured.
 */
export const NOT_AN_OPERAND: ReadonlySet<string> = new Set([
  "CAL", "CONSTANT", "RETAIN", "PERSISTENT", "PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL", "ABSTRACT",
  "READ_ONLY", "READ_WRITE", "EXTENDS", "IMPLEMENTS", "ARRAY", "OF", "REFERENCE", "POINTER", "TO", "AT", "STRING",
  "WSTRING", "THEN", "ELSIF", "ELSE", "END_IF", "END_CASE", "BY", "DO", "END_FOR", "END_WHILE", "UNTIL", "END_REPEAT",
  "DIV", "ADD", "SUB", "MUL", "GT", "LT", "GE", "LE", "EQ", "NE", "PARAMS", "FROM", "__CATCH", "__FINALLY", "__ENDTRY",
  "__VECTOR",
] satisfies Keyword[])

/**
 * THE OPERATORS THAT ARE WRITTEN AS A CALL, AND HOW MANY OPERANDS EACH NEEDS. Without its `(` such an operator TAKES the
 * next token as if it were the `(` — `n := abs;` is "'(' expected instead of ';'" and "'ABS' needs exactly '1'
 * operands", and then, the `;` gone, "';' expected instead of end of POU" (`lex_keyword_operand_*`, one operator per
 * fixture, CODESYS 2026-09-30); `__queryinterface := 1;` takes the `:=` the same way (`lex_keyword_assigned_sys_*`).
 * The counts are the ones the vendor named. `__NEW` is not here — without its `(` it wants a type ("Type definition
 * expected as operand for __NEW") — nor `__POSITION`, `__CURRENTTASK` or `__POOL`, each its own shape
 * (`parse/expression.ts`, rules E24–E34).
 */
export const CALL_OPERATOR_OPERANDS: ReadonlyMap<string, { readonly count: number; readonly atLeast: boolean }> = new Map([
  ...operands(1, false, "ABS", "SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ADR", "BITADR",
    "MOVE", "INDEXOF", "SIZEOF", "XSIZEOF", "TRUNC", "TRUNC_INT", "TEST_AND_SET", "__ISVALIDREF", "__VARINFO", "__DELETE"),
  ...operands(2, false, "SHL", "SHR", "ROL", "ROR", "EXPT", "INI", "__QUERYINTERFACE", "__QUERYPOINTER", "__XADD"),
  ...operands(3, false, "SEL", "LIMIT", "__COMPARE_AND_SWAP"),
  ...operands(2, true, "MIN", "MAX"),
  ...operands(3, true, "MUX"),
])

function operands(count: number, atLeast: boolean, ...ops: Keyword[]): [string, { count: number; atLeast: boolean }][] {
  return ops.map((k) => [k, { count, atLeast }])
}

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
