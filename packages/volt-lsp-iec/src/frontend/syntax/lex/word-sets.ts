/**
 * THE PARSER'S NAMED WORD SETS — each parser rule that asks "is this one of …" asks here: VAR-section openers, unit
 * starters, refused names, call-operator operands, modifiers. Subsets of `vocabulary.ts`'s `KEYWORDS` (openspec
 * lsp-same-standard design.md §2.2).
 */
import { type Keyword, type Dialect, KEYWORDS } from "./vocabulary.js"

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
  // an access-path list at file scope (`parse/units/global-var-list` `parseAccessList`, `decl_var_access*`)
  "VAR_ACCESS",
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
 * THE WORDS THE PARSER REFUSES WHERE A NAME OR AN OPERAND BELONGS, though the lexer reads them as names — the Instruction
 * List operators and the elementary type names (frontend-conformance 2.8.3, rule R6: the analysis check `refused-name`
 * held them until then, with a cascade of its own). `ld : INT;` is "Unexpected token 'ld' found" and the declaration's
 * cascade (`cc_il_name_*`, `cc_reserved_name_*`, `cc4_type_name_*`, `rec_refused_name_cascade_declaration`); where a
 * statement starts `dword := n + 1;` is the same word and the statement's resync (`rec_refused_name_cascade_type_word_start`);
 * as an operand `n + dint + 1` is "Expression expected instead of 'dint'" and the resync from the word
 * (`rec_refused_name_cascade_type_word`); and the resync PAIRS each of them as the token no statement starts with that it
 * is, never resuming a statement there (`rec_refused_name_cascade_il_word`) — both vendors, 2026-09-20 and 2026-10-02.
 *
 * Not refused: a call's CALLEE (`LTIME()` reads the clock — corpus pro2193 `StopwatchFB`) and a lone ARGUMENT
 * (`XSIZEOF(DINT)` names a type), nor a member's name (`bx.INT`, rule E32). `CAL` is a keyword (`KEYWORDS`); `CALC` is
 * none of these — it parses as a conditional call (`analysis/checks/names/conditional-call.ts`).
 */
export const IL_OPERATOR_WORDS: ReadonlySet<string> = new Set([
  "R", "S", "LD", "LDN", "ST", "STN", "RET", "RETC", "RETCN", "JMPC", "JMPCN", "CALCN", "ANDN", "ORN", "XORN",
])

/** The elementary type names — their short and long forms, and the platform integers. `types/elementary.ts` holds what
 *  each type is; `types/elementary.test.ts` holds the two lists to each other. */
export const ELEMENTARY_TYPE_WORDS: ReadonlySet<string> = new Set([
  "BOOL", "BIT", "BYTE", "WORD", "DWORD", "LWORD", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT",
  "REAL", "LREAL", "TIME", "LTIME", "DATE", "TOD", "DT", "LDATE", "LTOD", "LDT", "STRING", "WSTRING",
  "TIME_OF_DAY", "DATE_AND_TIME", "LDATE_AND_TIME", "LTIME_OF_DAY", "__XINT", "__UXINT", "__XWORD",
])

/**
 * THE 64-BIT DATE TYPES ARE CODESYS'S ALONE. TwinCAT has `LTIME` and does NOT have `LDATE`, `LTOD`/`LTIME_OF_DAY` or
 * `LDT`/`LDATE_AND_TIME`: it answers "Unknown type: 'LDATE'" for a declaration, and "Identifier 'DATE_TO_LDATE' not
 * defined" for the conversions that would carry them (39 messages across 13 fixtures in its recording, and none in
 * CODESYS's — 2026-09-20) — and `ldate : INT;` is a name it declares. The lexer reads them alike on both vendors; type
 * resolution refuses them (`types/resolve.ts` `isDialectType`) and the parser lets them stand as names (`isRefusedWord`).
 */
export const CODESYS_ONLY_TYPE_WORDS: ReadonlySet<string> = new Set(["LDATE", "LTOD", "LTIME_OF_DAY", "LDT", "LDATE_AND_TIME"])

/** A word the parser refuses where a name or an operand belongs, in `dialect` (`IL_OPERATOR_WORDS`, `ELEMENTARY_TYPE_WORDS`):
 *  a type name only where the type exists. */
export function isRefusedWord(text: string, dialect: Dialect): boolean {
  const word = text.toUpperCase()
  if (IL_OPERATOR_WORDS.has(word)) return true
  return ELEMENTARY_TYPE_WORDS.has(word) && !(dialect === "twincat" && CODESYS_ONLY_TYPE_WORDS.has(word))
}

/** A name a DECLARATION refuses: a refused word (`isRefusedWord`), or one holding CONSECUTIVE UNDERSCORES (`foo__bar`,
 *  `__systemReserved`), which the compiler reserves for itself (`identifier_consecutive_underscores`,
 *  `identifier_double_underscore`, `rec_refused_name_cascade_initializer`, both vendors) — in a declaration only:
 *  `__NEW`, `__QUERYINTERFACE` and the rest are compiler operators whose uses are legitimate. */
export function isRefusedDeclaredName(text: string, dialect: Dialect): boolean {
  return isRefusedWord(text, dialect) || text.includes("__")
}

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
 * …AND THE IL CALL FORM. `ADD(a, b)`, `gt(a, b)` — a word of this set before `(` — is refused the same way, on the word
 * (`operator_call_form_*`, `expr_operator_call_form_lower_case`, both vendors; rule E31, frontend-conformance 2.5.5).
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

/** The access modifiers — the modifier that may stand only FIRST in a header (`parse/names` `refusedAccessModifier`). */
export const ACCESS_MODIFIERS: readonly Keyword[] = ["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL"]

/** The modifiers a FUNCTION_BLOCK header takes. */
export const FB_MODIFIERS: readonly Keyword[] = [...ACCESS_MODIFIERS, "FINAL", "ABSTRACT"]

/**
 * The modifiers a member header takes — a METHOD, a PROPERTY, and a METHOD or PROPERTY inside an INTERFACE: ONE set,
 * decided by recording (conformance 2.4.3, `fixtures/grammar/units.ts`, both vendors 2026-10-01). Each was asked on each
 * member kind: the six are read (PRIVATE and PROTECTED on an interface member are refused by a CHECK, "PRIVATE and
 * PROTECTED may only be applied on methods of function blocks", not by the grammar). OVERRIDE is NO modifier: CODESYS
 * reads `METHOD OVERRIDE M` as a method NAMED Override ("The name used in the signature is not identical to the object
 * name", `unit_method_override`; the property and interface twins alike, `record:exec` — the push refuses all of them
 * before the IDE sees them) — it is a name (`SOFT_NAME_KEYWORDS`), as it is for a variable.
 */
export const MEMBER_MODIFIERS: readonly Keyword[] = [...ACCESS_MODIFIERS, "FINAL", "ABSTRACT"]
