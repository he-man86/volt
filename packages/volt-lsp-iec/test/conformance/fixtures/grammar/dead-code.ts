/**
 * THE PARSER'S VERDICT IN CODE NOBODY COMPILES — openspec analysis-conformance 2.5 (review of the server merge).
 *
 * A POU no PROGRAM reaches, and a method nothing calls, is dead code: the compiler checks none of its semantics
 * (`check-coverage-three.ts`, `types.ts` `plcPrgVar`), and the server suppresses the semantic findings in it
 * (`src/server/reachability.ts`). Whether the vendor still reports a SYNTAX error there is a separate question, and
 * these fixtures put it: a statement parse error and a declaration parse error in an FB nothing instantiates, a
 * statement parse error in a method nothing calls (a declaration parse error in one is `sig_empty_type`, already
 * recorded), and the out-of-body `hasattribute` operand check (C0051) in a method nothing calls.
 *
 * The dead FBs set NO `plcPrgVar`/`plcPrgBody` — that is the question. The FB holding the uncalled method is
 * instantiated and called, so only the method is dead. One question per fixture, as in `recovery.ts`.
 */
import type { LanguageTest } from "../../types.js"

const doc = "analysis-conformance 2.5 (parse errors in dead code)"

const xOut = "\tx : BOOL;\n\tout : INT;"

/** An FB `FB_LANG_<name>` nothing instantiates: PLC_PRG is left as it is. */
function deadFb(name: string, feature: string, vars: string, body: string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
    execSkip: "NOTHING TO MEASURE — nothing instantiates the FB (that is the question): the build compiles none of it and no cycle runs it (recorded 2026-10-06, both vendors build clean)",
  }
}

/** A live FB `FB_LANG_<name>` (instantiated and called in PLC_PRG) holding `method`, which nothing calls. */
function deadMethod(name: string, feature: string, method: string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${xOut}\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n\n${method}`,
  }
}

export const DEAD_CODE_TESTS: readonly LanguageTest[] = [
  deadFb("dead_fb_missing_then", "a statement parse error (IF without THEN) in an FB nothing instantiates", xOut,
    "IF x\n\tout := 1;\nEND_IF"),
  deadFb("dead_fb_declaration_parse_error", "a declaration parse error (a variable without a type) in an FB nothing instantiates",
    "\tx : ;\n\tout : INT;", "out := 1;"),
  deadMethod("dead_method_missing_then", "a statement parse error (IF without THEN) in a method nothing calls",
    "METHOD Unused\nIF x\n\tout := 2;\nEND_IF\nEND_METHOD\n"),
  deadMethod("dead_method_hasattribute_unquoted", "an unquoted `hasattribute` attribute in a pragma outside the body of a method nothing calls",
    "METHOD Unused\nVAR\n{IF hasattribute (pou: FB_LANG_dead_method_hasattribute_unquoted, volt_marked)}\n\tn : INT;\n{END_IF}\nEND_VAR\nout := 2;\nEND_METHOD\n"),
]
