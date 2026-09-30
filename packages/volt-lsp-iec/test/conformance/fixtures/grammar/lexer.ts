/**
 * THE LEXER, RULE BY RULE — design.md §4 2.1 of openspec `frontend-conformance` (L1–L15), each rule put to the vendor
 * by a fixture of its own and recorded with `record:language`. Rows already decided by a recorded fixture elsewhere
 * (L5 case-insensitive keywords, L6 a leading underscore, L7 backtick identifiers, L9 reserved type names, L10 the
 * CODESYS-only operators on TwinCAT, L12 soft keywords in real code) keep those fixtures; what is here is what no
 * recording decided before task 2.1.
 *
 * ONE QUESTION PER FIXTURE: the IDE stops reporting after a few parse errors, so a fixture holding two refusals
 * measures the stop, not the rule (`check-coverage-four.ts`). A refused name is declared AND used, in the shape the
 * recorded IL-operator family (`cc_il_name_*`) established, so the declaration's cascade and the use's are both
 * recorded. And nothing ELSE is asked: a body assigns constants (`n := 2;`, never `n := n + 1;`), so a fixture's answer
 * is its rule's alone — the front-end measures (openspec frontend-conformance 0.3/0.4) read every expression a fixture
 * holds, and an arithmetic nobody asked about would be measured as this rule's.
 */
import type { LanguageTest } from "../../types.js"
import { KEYWORDS } from "../../../../src/frontend/syntax/index.js"

const doc = "frontend-conformance design.md §4 2.1 (lexer)"

/** A function block `FB_LANG_<name>` with `decl` in its VAR block and `body` as its implementation. */
function fb(name: string, feature: string, decl: string, body: string, extra: Partial<LanguageTest> = {}): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${decl}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
    ...extra,
  }
}

/** A name declared as a variable and assigned: the shape every recorded refused-name fixture has. */
function nameFixture(name: string, feature: string, word: string): LanguageTest {
  return fb(name, feature, `\t${word} : INT;\n\tn : INT;`, `${word} := 1;\nn := 2;`)
}

/** `text` with every line break written as CRLF — how both vendors store an object's text. */
const crlf = (text: string): string => text.replace(/\r?\n/g, "\r\n")

/**
 * The keywords a statement can hold as a NAME — every one in `KEYWORDS` but the words a statement opens with, the three
 * soft names, and the unit and declaration structure (see the fixtures that use it). Derived from the vocabulary, so a
 * keyword added there is asked here, and is unrecorded until someone asks the vendor.
 */
const NOT_STATEMENT_NAMES: ReadonlySet<string> = new Set([
  // statements and expressions
  "IF", "CASE", "FOR", "WHILE", "REPEAT", "RETURN", "EXIT", "CONTINUE", "JMP", "__TRY",
  "THIS", "SUPER", "TRUE", "FALSE", "NOT",
  // soft names
  "GET", "SET", "OVERRIDE",
  // unit and declaration structure
  "FUNCTION_BLOCK", "END_FUNCTION_BLOCK", "PROGRAM", "END_PROGRAM", "FUNCTION", "END_FUNCTION", "METHOD", "END_METHOD",
  "ACTION", "END_ACTION", "PROPERTY", "END_PROPERTY", "END_GET", "END_SET", "INTERFACE", "END_INTERFACE",
  "TYPE", "END_TYPE", "STRUCT", "END_STRUCT", "UNION", "END_UNION",
  "VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT", "VAR_INST", "VAR_EXTERNAL", "VAR_GLOBAL",
  "VAR_CONFIG", "VAR_ACCESS", "END_VAR", "VAR_GENERIC", "NAMESPACE", "END_NAMESPACE",
])
const STATEMENT_POSITION_WORDS: readonly string[] = KEYWORDS.filter((k) => !NOT_STATEMENT_NAMES.has(k)).map((k) => k.toLowerCase())

export const LEXER_TESTS: readonly LanguageTest[] = [
  // ─── L1–L4 comments and line endings (task 2.1.1) ─────────────────────────────────────────────────────────────────
  // L1: a `//` comment runs to the end of its line and hides everything on it — code, and a `(*` that would otherwise
  // open a block comment and swallow the rest of the body.
  fb(
    "lex_line_comment_in_body",
    "L1 — `//` line comments in a declaration and a body, one hiding a statement and one hiding a `(*`",
    "\tn : INT; // a trailing comment on a declaration",
    "n := 1; // n := 2;\n// n := 3;\nn := 4; // (* not a block comment\n",
  ),
  // L2: `(* *)` spans lines, and may stand inside an expression.
  fb(
    "lex_block_comment",
    "L2 — `(* *)` block comments: across lines in a declaration, hiding a statement, inside a statement",
    "\tn : INT; (* a block comment\n\tthat spans two lines *)",
    "n := 1; (* n := 2; *)\nn := (* inside a statement *) 3;",
  ),
  // L3: a `(*` inside a block comment opens a NESTED one. If the vendor does not nest, the inner `*)` closes the
  // comment and `n := 99; still inside *)` is code — a refusal — so the recording decides it either way.
  fb(
    "lex_nested_block_comment",
    "L3 — a nested block comment: `(* outer (* inner *) … *)` — does the inner `*)` close the outer one?",
    "\tn : INT;",
    "n := 1;\n(* outer (* inner *) n := 99; still inside the outer comment *)\nn := 2;",
  ),
  // L4: CRLF line endings — how both vendors store text — through a declaration, a body and a comment.
  {
    ...fb(
      "lex_crlf_body",
      "L4 — a POU whose every line ends in CRLF: declaration, body, a line comment and a block comment",
      "\tn : INT; // CRLF after a line comment\n\tm : INT; (* a block comment\n\tacross a CRLF *)",
      "n := 1;\nm := 2;",
    ),
    source: crlf(
      "FUNCTION_BLOCK FB_LANG_lex_crlf_body\nVAR\n\tn : INT; // CRLF after a line comment\n\tm : INT; (* a block comment\n\tacross a CRLF *)\nEND_VAR\nn := 1;\nm := 2;\nEND_FUNCTION_BLOCK\n",
    ),
  },
  // L4: the Volt `IMPLEMENTATION ST` line terminated by CRLF, stated by the fixture itself (the recorder adds none).
  {
    ...fb("lex_crlf_implementation_line", "L4 — CRLF line endings around a stated `IMPLEMENTATION ST` line", "\tn : INT;", "n := 1;"),
    source: crlf(
      "FUNCTION_BLOCK FB_LANG_lex_crlf_implementation_line\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n",
    ),
  },

  // ─── L8 a character no token starts with (task 2.1.2) ─────────────────────────────────────────────────────────────
  // Each in the operator position of `n := 1 <c> 2;`, one character per fixture. `?` and `%` are in the lexer's
  // punctuation set and `$` and `#` start other tokens, so they are asked too, not assumed.
  ...(
    [
      ["lex_unknown_character", "!"],
      ["lex_unknown_character_at", "@"],
      ["lex_unknown_character_tilde", "~"],
      ["lex_unknown_character_backslash", "\\"],
      ["lex_unknown_character_pipe", "|"],
      ["lex_unknown_character_dollar", "$"],
      ["lex_unknown_character_question", "?"],
      ["lex_unknown_character_hash", "#"],
      ["lex_unknown_character_percent", "%"],
    ] as const
  ).map(([name, c]) =>
    fb(name, `L8 — the character \`${c}\` between two operands: \`n := 1 ${c} 2;\``, "\tn : INT;", `n := 1 ${c} 2;`),
  ),

  // ─── L13 reserved words no grammar rule consumes, as names (task 2.1.2) ───────────────────────────────────────────
  ...(["read_only", "read_write", "from", "using", "with", "params"] as const).map((w) =>
    nameFixture(
      `lex_reserved_unused_keyword_as_name_${w}`,
      `L13 — \`${w}\` (a keyword no grammar rule consumes) as a variable name`,
      w,
    ),
  ),
  // L13: DIV is in the keyword table; is it an infix operator?
  fb("lex_div_as_operator", "L13 — `DIV` as an infix integer-division operator: `n := 7 DIV 2;`", "\tn : INT;", "n := 7 DIV 2;"),

  // ─── L15 the deprecated keywords CAL and INI (task 2.1.2) ─────────────────────────────────────────────────────────
  // `cal` as a NAME is `cc_il_name_cal`, INI as an OPERATOR is `operand_ini_deprecated`; these are the other halves.
  {
    name: "lex_cal_keyword",
    pouName: "FB_LANG_lex_cal_keyword",
    kind: "function_block",
    feature: "L15 — `CAL inst();`, the IL call keyword, as an ST statement",
    fromDoc: doc,
    plcPrgVar: "inst_lex_cal_keyword : FB_LANG_lex_cal_keyword;",
    plcPrgBody: "inst_lex_cal_keyword();",
    source:
      "FUNCTION_BLOCK FB_LANG_lex_cal_target\nVAR\n\tn : INT;\nEND_VAR\nn := 1;\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_lex_cal_keyword\nVAR\n\tt : FB_LANG_lex_cal_target;\nEND_VAR\nCAL t();\nEND_FUNCTION_BLOCK\n",
  },
  nameFixture("lex_ini_keyword", "L15 — `ini` (the V2.3 initialisation operator) as a variable name", "ini"),

  // ─── L14 the selection functions as names (task 2.1.3) ────────────────────────────────────────────────────────────
  ...(["limit", "min", "sel", "mux", "max"] as const).map((w) =>
    nameFixture(`lex_${w}_as_variable`, `L14 — \`${w}\` (a standard selection function) as a variable name`, w),
  ),
  // L12: each soft keyword as a variable name, one word per fixture.
  ...(["get", "set", "public", "private", "protected", "internal", "final", "abstract", "override"] as const).map((w) =>
    nameFixture(
      `lex_soft_keyword_name_${w}`,
      `L12 — \`${w}\` (a keyword outside the construct that reserves it) as a variable name`,
      w,
    ),
  ),
  // L12: each soft keyword as a METHOD name — the other name position real code uses them in (`Set`, `Override`).
  // Declared and not called, so the answer is the name's alone. The six access/inheritance modifiers never reach the
  // compiler: CODESYS refuses to CREATE the object, "The name 'public' is not valid for this object.", and so does
  // TwinCAT, "Creating the child named 'public' is not possible on node (Name mismatch)" (push, 2026-09-30) — the
  // verdict the variable-name fixtures above record from the build. Both refusals are the fixture's data.
  ...(["get", "set", "public", "private", "protected", "internal", "final", "abstract", "override"] as const).map(
    (w): LanguageTest => ({
      ...(["get", "set", "override"].includes(w)
        ? {}
        : {
            vendorRefuses: {
              codesys: `The name '${w}' is not valid for this object.`,
              twincat: `Creating the child named '${w}' is not possible on node (Name mismatch)`,
            },
            execSkip: `NOTHING TO MEASURE — neither IDE creates a METHOD called '${w}' (CODESYS "The name '${w}' is not valid for this object.", TwinCAT "Name mismatch", 2026-09-30), so there is no program to run`,
          }),
      ...fb(
        `lex_soft_keyword_method_name_${w}`,
        `L12 — \`${w}\` as a METHOD name`,
        "\tn : INT;",
        "n := 1;",
      ),
      source:
        `FUNCTION_BLOCK FB_LANG_lex_soft_keyword_method_name_${w}\nVAR\n\tn : INT;\nEND_VAR\nn := 1;\nEND_FUNCTION_BLOCK\n\n` +
        `METHOD ${w}\nVAR_INPUT\nEND_VAR\nn := 2;\nEND_METHOD\n`,
    }),
  ),
  // L12: the six modifiers in a TYPE position — which is where CODESYS refuses an FB of that name. Pushing
  // `FUNCTION_BLOCK Public` (2026-09-30): CODESYS created the object and refused `inst : Public;` in PLC_PRG, "Type
  // definition expected instead of 'Public'"; TwinCAT refused to create it, "Creating the child named 'Public' is not
  // possible on node (Name mismatch)". The type position is the question the compiler answers, asked here without an
  // object of that name; the variable is declared and not used, so the declaration's answer is the whole answer.
  ...(["Public", "Private", "Protected", "Internal", "Final", "Abstract"] as const).map((w) =>
    fb(
      `lex_soft_keyword_as_type_${w.toLowerCase()}`,
      `L12 — \`${w}\` where a TYPE belongs: \`v : ${w};\``,
      `\tv : ${w};\n\tn : INT;`,
      "n := 1;",
    ),
  ),
  // L12: a soft keyword CODESYS accepts as a name, met by the cascade after a refused word — does the cascade stop at
  // it, as it stops at the identifier after `CAL` (`lex_cal_keyword`), or echo it as an unexpected token? One word per
  // fixture; `limit` is the refused word because its own cascade is recorded (`lex_limit_as_variable`). The name ends the
  // statement: `limit := set + 1;` (recorded first) also asked what the resumed `set + 1;` is — "'(set + 1);' is no
  // valid statement", the bare-expression rule's (ST5) — which is not this rule's question.
  ...(["get", "set", "override"] as const).map((w) =>
    fb(
      `lex_cascade_meets_soft_name_${w}`,
      `L12 — the cascade after a refused \`limit :=\` meeting \`${w}\`, a declared variable: \`limit := ${w};\``,
      `\t${w} : INT;\n\tn : INT;`,
      `limit := ${w};\nn := 2;`,
    ),
  ),
  // L12: the six modifiers CODESYS refuses as a variable, as a NAMED ARGUMENT — the third name position a call has.
  // No such parameter can be declared, so the question is only what the vendor says about the name there.
  ...(["Public", "Private", "Protected", "Internal", "Final", "Abstract"] as const).map((w) =>
    fb(
      `lex_soft_keyword_named_argument_${w.toLowerCase()}`,
      `L12 — \`${w}\` as a named argument: \`t(${w} := TRUE);\``,
      "\tt : TON;\n\tn : INT;",
      `t(${w} := TRUE);\nn := 2;`,
    ),
  ),

  // ─── L9/L13/L14 every reserved word in the three positions a statement gives a name (task 2.1.3) ───────────────
  // The statement-start refusal (`parse/statements.ts`) answers for EVERY keyword no statement opens with, so every one
  // is asked, one word and one position per fixture — never a sample the rule is then generalised from:
  //   assigned        `<w> := 1;`      the word as an assignment target;
  //   before a name   `<w> n := 2;`    the word as a statement of its own, a name after it (the `CAL t();` shape);
  //   operand         `n := <w>;`      the word where a value belongs.
  // Undeclared: a declaration is its own question (the `*_as_variable` fixtures above ask it). Not asked: the words a
  // statement opens with (IF … JMP, and THIS/SUPER/TRUE/FALSE/NOT as expressions), GET/SET/OVERRIDE (names), and the
  // unit and declaration structure (the POU shells, TYPE/STRUCT/UNION, the VAR sections, NAMESPACE) — a body holding
  // `END_FUNCTION_BLOCK` or `VAR` is a different object's text, not a statement.
  // A `__` word is named `sys_<rest>` in the fixture's name: both IDEs refuse an OBJECT whose name holds `__` ("The name
  // 'FB_LANG_lex_keyword_operand___new' is not valid for this object."), and the fixture name is the POU's.
  ...STATEMENT_POSITION_WORDS.flatMap((w) => {
    const slug = w.replace(/^__/, "sys_")
    return [
      fb(`lex_keyword_assigned_${slug}`, `L9 — the keyword \`${w}\` assigned where a statement starts: \`${w} := 1;\``, "\tn : INT;", `${w} := 1;\nn := 2;`),
      fb(`lex_keyword_before_name_${slug}`, `L9 — the keyword \`${w}\` alone before a name where a statement starts: \`${w} n := 2;\``, "\tn : INT;", `${w} n := 2;`),
      fb(`lex_keyword_operand_${slug}`, `L9 — the keyword \`${w}\` where an operand belongs: \`n := ${w};\``, "\tn : INT;", `n := ${w};`),
    ]
  }),
  // L15: `cal` DECLARED and used as an operand — the use a refused declaration leaves behind (`cc_il_name_cal` assigns
  // it; this reads it).
  fb("lex_cal_declared_operand", "L15 — a variable `cal`, declared and read as an operand: `n := cal;`", "\tcal : INT;\n\tn : INT;", "n := cal;"),

  // L12: the three soft keywords CODESYS accepts as names, together in one fixture — an accepted source, so nothing
  // cascades (the six it refuses are one per fixture above: together they measure the vendor's recovery, not the rule).
  fb(
    "lex_soft_keyword_names",
    "L12 — GET, SET and OVERRIDE, together, as variable names outside the construct that reserves them",
    "\tget : INT;\n\tset : INT;\n\toverride : INT;",
    "get := 1;\nset := 2;\noverride := 3;",
  ),
]
