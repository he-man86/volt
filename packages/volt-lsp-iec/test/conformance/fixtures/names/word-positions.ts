/**
 * EVERY WORD THE PARSER DECIDES BY ITS VOCABULARY, IN EVERY NAME POSITION (openspec lsp-field-false-positives 8, class 3).
 *
 * 6b measured one name position — the enum value — and found the LSP refusing what CODESYS builds (GET, SET, OVERRIDE)
 * and accepting what it refuses (the IL operator names and the elementary type names). A name's vocabulary is read in
 * every place a name is declared, so the same families are asked in each of them (`WORD_FAMILIES`: the soft names, the
 * modifiers, the IL operator names, the elementary type names) — one word of each family per position, and every word of
 * a family where that word disagreed with the compiler (`WHOLE_FAMILY`; owner 2026-10-29), one word and one position per
 * fixture, named `wp_<position>_<word>`:
 *
 *   a VARIABLE, in each section a POU declares one in (`VAR`, `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`, `VAR_TEMP`,
 *     `VAR_STAT`, `VAR CONSTANT`, a method's `VAR_INST`, `VAR_EXTERNAL`) and a global list's `VAR_GLOBAL`;
 *   a STRUCT and a UNION member;
 *   an OBJECT's name — a FUNCTION_BLOCK, a FUNCTION, a PROGRAM, an INTERFACE, a DUT, a GVL — and a member's — a METHOD,
 *     an ACTION, a PROPERTY;
 *   a call's NAMED ARGUMENT, and a jump LABEL.
 *
 * Each word is declared and nothing else is asked of it where that is possible: the variable is not read, the method not
 * called, the property set-only (a getter would assign the word), the FUNCTION's body does not assign its own name. An
 * object is reached from PLC_PRG the way a user reaches it (instanced, called, its type or its list named), because the
 * build compiles only what the application reaches. Not asked, because no push reaches them: a NAMESPACE's name (a
 * library's, from its manifest; the push refuses NAMESPACE blocks — `grammar/units-a.ts` U28) and an SFC transition's
 * (Volt reads no SFC body). An object or global named by such a word stands ALONE (`LanguageTest.alone`): beside the
 * other fixtures it would declare `INT` or `R` for all of them.
 */
import type { LanguageTest } from "../../types.js"
import { ENUM_VALUE_WORDS, enumValueSlug } from "../grammar/lexer.js"

const doc = "openspec lsp-field-false-positives 8 (class 3) — a vocabulary word in each name position"
const ALONE = "its object or global is named by a word every other fixture uses"

/** Each body states its language itself: the recorder writes the line where the LSP's parser finds the body, and a
 *  header the parser refuses (`FUNCTION GET`, `ACTION ABSTRACT`) would leave the body unmarked and the push refused. */
const ST = "%LANGUAGE ST\n"

type Position =(w: string, n: string) => Omit<LanguageTest, "name" | "feature" | "fromDoc">

const fbWith = (n: string, sections: string, body: string, members = ""): Omit<LanguageTest, "name" | "feature" | "fromDoc"> => ({
  pouName: `FB_LANG_${n}`,
  kind: "function_block",
  source: `FUNCTION_BLOCK FB_LANG_${n}\n${sections}VAR\n\tk : INT;\nEND_VAR\n${ST}${body}\nEND_FUNCTION_BLOCK\n${members}`,
  plcPrgVar: `inst_${n} : FB_LANG_${n};`,
  plcPrgBody: `inst_${n}();`,
})
const section = (keyword: string, decl: string): string => `${keyword}\n\t${decl}\nEND_VAR\n`

/** Each name position, as the text that declares `w` there, in the fixture named `n`. */
export const WORD_POSITIONS: Readonly<Record<string, Position>> = {
  var: (w, n) => fbWith(n, section("VAR", `${w} : INT;`), "k := 1;"),
  var_input: (w, n) => fbWith(n, section("VAR_INPUT", `${w} : INT;`), "k := 1;"),
  var_output: (w, n) => fbWith(n, section("VAR_OUTPUT", `${w} : INT;`), "k := 1;"),
  // not called: a call would have to name the parameter, which is the named-argument position
  var_in_out: (w, n) => ({ ...fbWith(n, section("VAR_IN_OUT", `${w} : INT;`), "k := 1;"), plcPrgBody: undefined }),
  var_temp: (w, n) => fbWith(n, section("VAR_TEMP", `${w} : INT;`), "k := 1;"),
  var_stat: (w, n) => fbWith(n, section("VAR_STAT", `${w} : INT;`), "k := 1;"),
  var_constant: (w, n) => fbWith(n, section("VAR CONSTANT", `${w} : INT := 1;`), "k := 1;"),
  var_inst: (w, n) => fbWith(n, "", "k := 1;", `\nMETHOD M_${n} : INT\nVAR_INST\n\t${w} : INT;\nEND_VAR\n${ST}M_${n} := 1;\nEND_METHOD\n`),
  var_external: (w, n) => fbWith(n, section("VAR_EXTERNAL", `${w} : INT;`), "k := 1;"),
  var_global: (w, n) => ({
    pouName: `GVL_LANG_${n}`,
    kind: "gvl",
    source: `VAR_GLOBAL\n\t${w} : INT;\n\tg_${n} : INT;\nEND_VAR\n`,
    plcPrgVar: `k_${n} : INT;`,
    plcPrgBody: `k_${n} := g_${n};`,
    alone: ALONE,
  }),
  struct_member: (w, n) => ({
    pouName: `DUT_LANG_${n}`,
    kind: "dut",
    source: `TYPE DUT_LANG_${n} :\nSTRUCT\n\t${w} : INT;\n\tother : INT;\nEND_STRUCT\nEND_TYPE\n`,
    plcPrgVar: `s_${n} : DUT_LANG_${n};`,
  }),
  union_member: (w, n) => ({
    pouName: `DUT_LANG_${n}`,
    kind: "dut",
    source: `TYPE DUT_LANG_${n} :\nUNION\n\t${w} : INT;\n\tother : INT;\nEND_UNION\nEND_TYPE\n`,
    plcPrgVar: `s_${n} : DUT_LANG_${n};`,
  }),
  fb_name: (w, n) => ({
    pouName: w,
    kind: "function_block",
    source: `FUNCTION_BLOCK ${w}\nVAR\n\tk : INT;\nEND_VAR\n${ST}k := 1;\nEND_FUNCTION_BLOCK\n`,
    plcPrgVar: `inst_${n} : ${w};`,
    plcPrgBody: `inst_${n}();`,
    alone: ALONE,
  }),
  function_name: (w, n) => ({
    pouName: w,
    kind: "function",
    source: `FUNCTION ${w} : INT\nVAR_INPUT\n\tv : INT;\nEND_VAR\nVAR\n\tk : INT;\nEND_VAR\n${ST}k := v;\nEND_FUNCTION\n`,
    plcPrgVar: `k_${n} : INT;`,
    plcPrgBody: `k_${n} := ${w}(1);`,
    alone: ALONE,
  }),
  program_name: (w, n) => ({
    pouName: w,
    kind: "program",
    source: `PROGRAM ${w}\nVAR\n\tk : INT;\nEND_VAR\n${ST}k := 1;\nEND_PROGRAM\n`,
    plcPrgVar: `unused_${n} : INT;`,
    plcPrgBody: `${w}();`,
    alone: ALONE,
  }),
  interface_name: (w, n) => ({
    pouName: w,
    kind: "interface",
    source: `INTERFACE ${w}\nMETHOD Run : INT\nEND_METHOD\nEND_INTERFACE\n`,
    plcPrgVar: `i_${n} : ${w};`,
    alone: ALONE,
  }),
  dut_name: (w, n) => ({
    pouName: w,
    kind: "dut",
    source: `TYPE ${w} :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n`,
    plcPrgVar: `s_${n} : ${w};`,
    alone: ALONE,
  }),
  gvl_name: (w, n) => ({
    pouName: w,
    kind: "gvl",
    source: `VAR_GLOBAL\n\tg_${n} : INT;\nEND_VAR\n`,
    plcPrgVar: `k_${n} : INT;`,
    plcPrgBody: `k_${n} := ${w}.g_${n};`,
    alone: ALONE,
  }),
  method_name: (w, n) => fbWith(n, "", "k := 1;", `\nMETHOD ${w} : INT\nVAR_INPUT\nEND_VAR\n${ST}k := 2;\nEND_METHOD\n`),
  action_name: (w, n) => fbWith(n, "", "k := 1;", `\nACTION ${w}\n${ST}k := 2;\nEND_ACTION\n`),
  property_name: (w, n) => fbWith(n, "", "k := 1;", `\nPROPERTY ${w} : INT\nSET\n${ST}k := 2;\nEND_SET\nEND_PROPERTY\n`),
  // no parameter of these names can be declared; what the call says about the NAME is the question
  // the callee is the fixture's own FB, so the answer is the name's alone (a library FB's call is no project code's)
  named_argument: (w, n) => {
    const t = fbWith(n, section("VAR", `t : FB_LANG_${n}_callee;`), `t(${w} := TRUE);\nk := 1;`)
    return { ...t, source: `FUNCTION_BLOCK FB_LANG_${n}_callee\nVAR_INPUT\n\ta : BOOL;\nEND_VAR\n${ST}a := NOT a;\nEND_FUNCTION_BLOCK\n\n${t.source}` }
  },
  // an unreferenced label is a warning of its own (C0118) on a name the vendor reads as one
  label: (w, n) => fbWith(n, "", `${w}:\nk := 1;`),
}

/** The word families, each with the words it holds; the FIRST word represents the family in every position. */
export const WORD_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  soft: ["GET", "SET", "OVERRIDE"],
  modifier: ["ABSTRACT", "PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL"],
  il: ["LD", "R", "S", "LDN", "ST", "STN", "RET", "RETC", "RETCN", "JMPC", "JMPCN", "CALCN", "ANDN", "ORN", "XORN"],
  type: ["INT", ...ENUM_VALUE_WORDS.slice(24).filter((w) => w !== "INT")],
}

/**
 * Where a family's representative DISAGREED with the compiler, every word of that family is asked in that position
 * (owner, 2026-10-29: a family is asked by one word, and wholly only where it disagrees). Keyed `<position>/<family>`.
 */
/**
 * The positions that name an OBJECT the IDE creates: CODESYS refuses to create one named by a modifier, an IL operator
 * name or an elementary type name ("The name 'INT' is not valid for this object.", 2026-10-29 — the IDE's create rule,
 * DIALECT C28, which measured every reserved word), so those fixtures have no build: their refusal is the data.
 */
const OBJECT_POSITIONS: ReadonlySet<string> = new Set([
  "fb_name", "function_name", "program_name", "interface_name", "dut_name", "gvl_name", "method_name", "action_name", "property_name",
])

const WHOLE_FAMILY: ReadonlySet<string> = new Set<string>([
  // GET builds as each of these names; the LSP refused it as all but a METHOD's, a PROPERTY's and a GVL's (2026-10-29)
  ...["fb_name", "function_name", "program_name", "interface_name", "dut_name", "action_name"].map((p) => `${p}/soft`),
  // a named argument of a refused word, and of GET (no input), the LSP accepted silently
  "named_argument/soft",
  "named_argument/il",
  "named_argument/type",
  // GET is a label to CODESYS; ABSTRACT as a label is refused on the word, where the LSP read an expression first
  "label/soft",
  "label/modifier",
])

/** Words of no family asked beside them: a label spelled by a keyword the statement start refuses (`LIMIT`, `ABS`), as
 *  the modifiers' refusal there is that rule's (`REFUSED_AT_STATEMENT_START`). */
const EXTRA_WORDS: Readonly<Record<string, readonly string[]>> = { label: ["LIMIT", "ABS"] }

const wordsAt = (position: string): string[] => [
  ...Object.entries(WORD_FAMILIES).flatMap(([family, words]) => (WHOLE_FAMILY.has(`${position}/${family}`) ? [...words] : [words[0]!])),
  ...(EXTRA_WORDS[position] ?? []),
]

export const WORD_POSITION_TESTS: readonly LanguageTest[] = Object.entries(WORD_POSITIONS).flatMap(([position, at]) =>
  wordsAt(position).map((w): LanguageTest => {
    const name = `wp_${position}_${enumValueSlug(w)}`
    const refused = OBJECT_POSITIONS.has(position) && !WORD_FAMILIES.soft!.includes(w)
    const t = {
      name,
      feature: `\`${w}\` as ${position.replace(/_/g, " ")}`,
      fromDoc: doc,
      ...at(w, name),
      ...(refused
        ? {
            vendorRefuses: {
              codesys: `The name '${w}' is not valid for this object.`,
              twincat: `Creating the child named '${w}' is not possible on node (Name mismatch)`,
            },
            execSkip: `NOTHING TO MEASURE — neither IDE creates an object called '${w}' (CODESYS "The name '${w}' is not valid for this object.", TwinCAT "Name mismatch", 2026-10-29), so there is no program to run`,
          }
        : {}),
    }
    if (t.plcPrgBody === undefined) delete t.plcPrgBody
    return t
  }),
)
