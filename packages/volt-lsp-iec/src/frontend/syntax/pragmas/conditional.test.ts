import { describe, expect, test } from "bun:test"
import { parseSource } from "../parse/parser.js"
import { bodyStatements, sourceStatements } from "../parse/body-parse.js"
import { directiveOf, evaluateCondition, type ConditionNames, type ConditionWorld } from "./conditional.js"

/**
 * The world of a project that sets NO compile define — the recording projects', as measured (`prag_define_upper_case`,
 * `prag_else_twice`, … read a name the body does not define as FALSE). Without it that name is refused: a compile define
 * of the application would make it TRUE, and the LSP does not hold them.
 */
const NO_COMPILE_DEFINES: ConditionWorld = { project: { defines: new Set() } }

/** The statements a METHOD body compiles under its conditional pragmas, as their source text — or the refusal. */
function kept(body: string, world: ConditionWorld = NO_COMPILE_DEFINES): string[] | string {
  const source = `FUNCTION_BLOCK FB\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\n${body}\nEND_METHOD\n`
  const unit = parseSource(source, { networkText: true }).units[1]
  if (unit?.kind !== "method") throw new Error("no method")
  const parsed = bodyStatements(unit.body, world)
  if (parsed.refused !== undefined) return parsed.refused
  return parsed.ok ? parsed.statements.map((s) => source.slice(s.span.start, s.span.end).trim()) : parsed.errors.map((e) => e.message).join(" ; ")
}

/** A METHOD whose body is `body`, and its source. */
function methodOf(body: string) {
  const source = `FUNCTION_BLOCK FB\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\n${body}\nEND_METHOD\n`
  const unit = parseSource(source, { networkText: true }).units[1]
  if (unit?.kind !== "method") throw new Error("no method")
  return { source, body: unit.body }
}

/** The one `{IF}` condition of `text` evaluated against `world`, with the body's own defines `defines`. */
function holds(condition: string, world: ConditionWorld = NO_COMPILE_DEFINES, defines: Record<string, string | undefined> = {}): boolean | string {
  const d = directiveOf(`{IF ${condition}}`)
  if (d?.kind !== "if") throw new Error("no IF")
  if ("refused" in d.condition) return d.condition.refused
  if ("errors" in d.condition) return d.condition.errors.map((e) => e.message).join(" ; ")
  const v = evaluateCondition(d.condition.ok, world, new Map(Object.entries(defines)))
  if (typeof v === "boolean") return v
  return "refused" in v ? v.refused : v.errors.map((e) => e.message).join(" ; ")
}

// The branches the `conditional_*` recordings took: a branch not taken may hold text that is no statement at all.
describe("conditional pragmas", () => {
  test("{define} then {IF defined} keeps the IF branch and drops the ELSE text", () => {
    expect(kept("{define F}\n{IF defined (F)}\nn := 42;\n{ELSE}\nnot valid st at all;\n{END_IF}")).toEqual(["n := 42;"])
  })

  test("an undefined name takes ELSE; an ELSIF chain takes its first true branch; {undefine} removes a define", () => {
    expect(kept("{IF defined (NEVER)}\ngibberish here;\n{ELSE}\nn := 1;\n{END_IF}")).toEqual(["n := 1;"])
    expect(kept("{define MID}\n{IF defined (NEVER)}\nbroken one;\n{ELSIF defined (MID)}\nn := 2;\n{ELSE}\nbroken two;\n{END_IF}")).toEqual(["n := 2;"])
    expect(kept("{define T}\n{undefine T}\n{IF defined (T)}\nbroken;\n{ELSE}\nn := 3;\n{END_IF}")).toEqual(["n := 3;"])
  })

  test("a define inside a branch not taken is not made, and a nested chain follows its outer one", () => {
    expect(kept("{IF defined (NO)}\n{define X}\n{END_IF}\n{IF defined (X)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}")).toEqual(["n := 2;"])
    expect(kept("{define A}\n{IF defined (A)}\n{IF defined (B)}\nbad;\n{ELSE}\nn := 5;\n{END_IF}\n{END_IF}")).toEqual(["n := 5;"])
  })

  test("text that does not parse in an untaken branch says nothing (prag_untaken_branch_syntax_error)", () => {
    expect(kept("n := 1;\n{IF defined (NEVER)}\nn := := ;\n{END_IF}")).toEqual(["n := 1;"])
  })

  test("the directives stand only where a statement may start: inside an expression they are trivia (prag_if_in_expression_statement, prag_if_whole_operand, prag_if_statement_starts_inside)", () => {
    expect(kept("n := n\n{IF defined (NEVER)}\n+ 10\n{ELSE}\n+ 20\n{END_IF}\n;")).toEqual(["n := n\n{IF defined (NEVER)}\n+ 10\n{ELSE}\n+ 20\n{END_IF}\n;"])
    expect(kept("n :=\n{IF defined (NEVER)}\n10\n{ELSE}\n20\n{END_IF}\n;")).toContain("';' expected instead of '20'")
    expect(kept("n := 5;\n{IF defined (NEVER)}\nn := n\n{END_IF}\n+ 20;")).toBe("Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected")
  })

  test("a chain belongs to its statement list: one opened at the top and closed inside an IF statement is never closed (prag_if_crossing_statement)", () => {
    expect(kept("{IF defined (NEVER)}\nIF n > 0 THEN\n{ELSE}\nIF n > 1 THEN\n{END_IF}\nn := 1;\nEND_IF")).toBe(
      "Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected",
    )
    expect(kept("IF n > 0 THEN\n{IF defined (NEVER)}\nn := 2;\n{ELSE}\nn := 1;\n{END_IF}\nEND_IF")).toEqual(["IF n > 0 THEN\n{IF defined (NEVER)}\nn := 2;\n{ELSE}\nn := 1;\n{END_IF}\nEND_IF"])
  })

  test("an unbalanced chain is the vendor's error (prag_unbalanced_end_if, prag_else_twice, prag_elsif_after_else, cc_unterminated_if)", () => {
    const orphan = (word: string) => `Unexpected pragma: '${word}' found without matching 'if'`
    expect(kept("{IF defined (X)}\nn := 2;\n{END_IF}\nn := 1;\n{END_IF}")).toBe(orphan("END_IF"))
    expect(kept("{IF defined (X)}\nn := 2;\n{ELSE}\nn := 1;\n{ELSE}\nn := 3;\n{END_IF}")).toBe(orphan("ELSE"))
    expect(kept("{IF defined (X)}\nn := 2;\n{ELSE}\nn := 1;\n{ELSIF defined (X)}\nn := 3;\n{END_IF}")).toBe(orphan("ELSIF"))
    expect(kept("{IF defined (X)}\nn := 1;")).toBe("Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected")
    expect(kept("{ELSE}\nn := 1;\n{END_IF}")).toBe(`${orphan("ELSE")} ; ${orphan("END_IF")}`)
  })

  test("the directive words are case-sensitive: `{if}`, `{DEFINE}`, `DEFINED (X)` are not the directive (prag_if_lower_case_*, prag_define_upper_case, prag_if_mixed_case_condition)", () => {
    expect(directiveOf("{if defined (X)}")).toBeUndefined()
    expect(directiveOf("{end_if}")).toBeUndefined()
    expect(directiveOf("{DEFINE X}")).toBeUndefined()
    expect(kept("n := 2;\n{if defined (NEVER)}\nn := 1;\n{end_if}")).toEqual(["n := 2;", "n := 1;"])
    expect(holds("DEFINED (X)")).toBe("Unexpected token '(' found ; '!!!'ERROR'!!!' is no valid condition for pragma")
  })

  test("a define is case-sensitive, local to its body, and a define inside an expression is trivia (prag_define_case_insensitive, prag_define_inside_expression)", () => {
    expect(kept("{define MIXED}\n{IF defined (mixed)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}")).toEqual(["n := 2;"])
    expect(kept("n := n + {define MID} 0;\n{IF defined (MID)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}")).toEqual(["n := n + {define MID} 0;", "n := 2;"])
  })

  test("a message pragma is said only where a statement may start, and only in a branch taken (prag_warning_*)", () => {
    const messages = (body: string): string[] => {
      const source = `FUNCTION_BLOCK FB\nVAR n : INT; END_VAR\n${body}\nEND_FUNCTION_BLOCK\n`
      const unit = parseSource(source, { networkText: true }).units[0]
      if (unit?.kind !== "function_block") throw new Error("no FB")
      return bodyStatements(unit.body!).messages.map((m) => `${m.severity}:${m.text}`)
    }
    expect(messages("{warning 'top'}\nn := 1;")).toEqual(["warning:top"])
    expect(messages("n := n + {warning 'mid'} 2;")).toEqual([])
    expect(messages("IF {warning 'kw'} n > 0 THEN\nn := 1;\nEND_IF")).toEqual([])
    expect(messages("IF n > 0 THEN\nn := 1;\n{warning 'last'}\nEND_IF")).toEqual(["warning:last"])
    expect(messages("n := 1;\n{IF defined (NEVER)}\n{warning 'untaken'}\n{END_IF}")).toEqual([])
  })
})

describe("the {IF} condition grammar and its operators (P10–P12)", () => {
  test("NOT binds before AND, AND before OR (prag_if_not_and_or, prag_if_and_or_precedence, prag_if_not_precedence)", () => {
    expect(holds("NOT defined (A) AND (defined (B) OR defined (C))", NO_COMPILE_DEFINES, { C: undefined })).toBe(true)
    expect(holds("defined (A) OR defined (B) AND defined (C)", NO_COMPILE_DEFINES, { A: undefined })).toBe(true)
    expect(holds("NOT defined (A) OR defined (A)", NO_COMPILE_DEFINES, { A: undefined })).toBe(true)
  })

  test("a define with a value is defined; hasvalue compares the value, and a define without one has none (prag_define_with_value, prag_if_hasvalue*)", () => {
    expect(holds("defined (V)", NO_COMPILE_DEFINES, { V: "123" })).toBe(true)
    expect(holds("hasvalue (V, '123')", NO_COMPILE_DEFINES, { V: "123" })).toBe(true)
    expect(holds("hasvalue (V, '124')", NO_COMPILE_DEFINES, { V: "123" })).toBe(false)
    expect(holds("hasvalue (B, '')", NO_COMPILE_DEFINES, { B: undefined })).toBe(false)
    expect(directiveOf("{define V '123'}")).toEqual({ kind: "define", name: "V", value: "123" })
  })

  test("the names a project declares answer from the world, and a world without them refuses by name", () => {
    const world: ConditionWorld = {
      names: {
        variable: (n) => n === "v",
        type: (n) => n === "DUT",
        pou: (n) => n === "F",
        hasAttribute: (kind, n, a) => kind === "pou" && n === "F" && a === "marked",
        typeOf: (n) => (n === "v" ? "INT" : undefined),
        constantValue: (n) => (n === "c" ? 5n : undefined),
      },
    }
    expect(holds("defined (variable: v)", world)).toBe(true)
    expect(holds("defined (variable: w)", world)).toBe(false)
    expect(holds("defined (type: DUT)", world)).toBe(true)
    expect(holds("defined (pou: F)", world)).toBe(true)
    expect(holds("defined (pou: G)", world)).toBe(false)
    expect(holds("hasattribute (pou: F, 'marked')", world)).toBe(true)
    expect(holds("hastype (variable: v, INT)", world)).toBe(true)
    expect(holds("hastype (variable: v, DINT)", world)).toBe(false)
    expect(holds("hasconstantvalue (c, 5, =)", world)).toBe(true)
    // the constant stands left of the operator: `c < 7` (prag_if_hasconstantvalue_order)
    expect(holds("hasconstantvalue (c, 7, <)", world)).toBe(true)
    expect(holds("defined (pou: F)")).toContain("defined (pou: F)")
  })

  test("a fact of the device or the project is the world's, refused by name without one; resource: is never defined", () => {
    const device = { littleEndian: true, simulation: true, fpu: true, registerSize: 64, packMode: 8 }
    expect(holds("defined (IsLittleEndian)", { device })).toBe(true)
    expect(holds("defined (IsSimulationMode)", { device })).toBe(true)
    expect(holds("hasvalue (RegisterSize, '64')", { device })).toBe(true)
    expect(holds("hasvalue (RegisterSize, '32')", { device })).toBe(false)
    expect(holds("hasvalue (PackMode, '8')", { device })).toBe(true)
    expect(holds("defined (IsSimulationMode)")).toContain("IsSimulationMode")
    expect(holds("defined (task: MainTask)", { project: { defines: new Set(), tasks: new Set(["MainTask"]) } })).toBe(true)
    expect(holds("project_defined (D)", { dialect: "codesys", project: { defines: new Set(), tasks: new Set() } })).toBe(false)
    expect(holds("project_defined (D)", { dialect: "twincat" })).toBe("Unexpected token '(' found ; '!!!'ERROR'!!!' is no valid condition for pragma")
    expect(holds("project_defined (D)")).toContain("project_defined (D)")
    expect(holds("defined (resource: R)")).toBe(false)
    // whether a constant is replaced is the project's compile option — refused by name
    expect(holds("hasconstanttype (c, TRUE)")).toContain("hasconstanttype")
  })

  test("a device fact asked the way no recording measured is refused by name — not answered by the project's defines", () => {
    // `defined` is measured for the device's flags, `hasvalue` for its values (2.7.1, exec device); the crossed shapes
    // are not (0 occurrences in the corpora): FALSE from the empty project defines would contradict `hasvalue (RegisterSize, '64')`
    const world: ConditionWorld = { device: { littleEndian: true, simulation: true, fpu: true, registerSize: 64, packMode: 8 }, project: { defines: new Set() } }
    expect(holds("defined (RegisterSize)", world)).toContain("defined (RegisterSize)")
    expect(holds("defined (PackMode)", world)).toContain("defined (PackMode)")
    expect(holds("hasvalue (IsSimulationMode, 'TRUE')", world)).toContain("hasvalue (IsSimulationMode, 'TRUE')")
    // a body's own define of the name is still the body's
    expect(holds("defined (RegisterSize)", world, { RegisterSize: undefined })).toBe(true)
  })

  test("a word that is no operator before `(` is the vendor's two errors (prag_if_unknown_operator)", () => {
    expect(holds("volt_unknown (X)")).toBe("Unexpected token '(' found ; '!!!'ERROR'!!!' is no valid condition for pragma")
  })
})

describe("a question the world cannot answer is refused, never defaulted (frontend-conformance 2.7 review)", () => {
  test("a name the body does not define is the project's compile define: refused without the project's defines, TRUE when the application sets it", () => {
    expect(holds("defined (APP_DEFINE)", {})).toContain("compile defines")
    expect(holds("hasvalue (APP_DEFINE, '1')", {})).toContain("compile defines")
    const app: ConditionWorld = { project: { defines: new Set(["APP_DEFINE"]) } }
    expect(holds("defined (APP_DEFINE)", app)).toBe(true)
    expect(holds("project_defined (APP_DEFINE)", { ...app, dialect: "codesys" })).toBe(true)
    // the define's VALUE is the application's, which no world holds
    expect(holds("hasvalue (APP_DEFINE, '1')", app)).toContain("value of a project compile define")
    expect(holds("hasvalue (OTHER, '1')", app)).toBe(false)
    // the defines known says nothing of the tasks
    expect(holds("defined (task: MainTask)", app)).toContain("task configuration")
    // a body's own define answers without the project
    expect(holds("defined (MINE)", {}, { MINE: undefined })).toBe(true)
  })

  test("hastype is answered for an elementary spec of a variable of an elementary type only: a generic spec or an alias is refused", () => {
    const names: ConditionNames = {
      variable: (n) => n === "v" || n === "m",
      type: () => false,
      pou: () => false,
      hasAttribute: () => undefined,
      typeOf: (n) => (n === "v" ? "INT" : n === "m" ? "MYINT" : undefined),
      constantValue: () => undefined,
    }
    expect(holds("hastype (variable: v, INT)", { names })).toBe(true)
    expect(holds("hastype (variable: v, ANY_INT)", { names })).toContain("ANY_INT")
    expect(holds("hastype (variable: m, INT)", { names })).toContain("MYINT")
  })

  test("a define in an undecided branch leaves its name undecided, until a define outside it decides it again", () => {
    const d = directiveOf("{IF defined (SIM)}")
    if (d?.kind !== "if" || !("ok" in d.condition)) throw new Error("no IF")
    expect(evaluateCondition(d.condition.ok, NO_COMPILE_DEFINES, new Map(), new Set(["SIM"]))).toEqual({
      refused: "defined (SIM) asks a define made or removed in a branch Volt could not decide",
    })
    expect(kept("{IF defined (IsSimulationMode)}\n{define SIM}\n{END_IF}\n{IF defined (SIM)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}\nn := 3;")).toContain(
      "IsSimulationMode",
    )
    const undecided = (body: string) => {
      const source = `FUNCTION_BLOCK FB\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\n${body}\nEND_METHOD\n`
      const unit = parseSource(source, { networkText: true }).units[1]
      if (unit?.kind !== "method") throw new Error("no method")
      const parsed = bodyStatements(unit.body, NO_COMPILE_DEFINES)
      return { parsed, text: parsed.statements.map((s) => source.slice(s.span.start, s.span.end).trim()) }
    }
    expect(undecided("{IF defined (IsSimulationMode)}\n{define SIM}\n{END_IF}\n{IF defined (SIM)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}\nn := 3;").text).toEqual(["n := 3;"])
    expect(undecided("{IF defined (IsSimulationMode)}\n{define SIM}\n{END_IF}\n{define SIM}\n{IF defined (SIM)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}").text).toEqual(["n := 1;"])
  })
})

describe("an undecided chain leaves only its own branches out: the text outside it is compiled either way (frontend-conformance 2.7 review)", () => {
  const method = methodOf

  test("its syntax errors outside the chain are reported, its statements outside kept, and the body is refused by name", () => {
    const { source, body } = method("{IF defined (IsSimulationMode)}\nIF n > 0 THEN n := 1; END_IF\n{END_IF}\nIF n > 1 THEN n := 2; END_IF\nn := ;")
    const parsed = bodyStatements(body)
    expect(parsed.ok).toBe(false)
    expect(parsed.refused).toContain("IsSimulationMode")
    // the `n := ;` after the chain, which the vendor compiles whatever the device (before the review: no error at all)
    expect(parsed.errors.map((e) => [e.message, e.span.start >= source.indexOf("n := ;")])).toEqual([["expected expression, got punct ';'", true]])
    expect(parsed.statements.map((s) => source.slice(s.span.start, s.span.end).trim())[0]).toBe("IF n > 1 THEN n := 2; END_IF")
  })

  test("its message pragmas outside the chain are said, none inside it", () => {
    const { body } = method("{warning 'before'}\n{IF defined (IsSimulationMode)}\n{warning 'inside'}\n{ELSE}\n{warning 'else'}\n{END_IF}\n{warning 'after'}\nn := 1;")
    expect(bodyStatements(body).messages.map((m) => m.text)).toEqual(["before", "after"])
  })

  test("the chain's structure is still read: an orphan after it is the vendor's error, nothing inside it is", () => {
    const { body } = method("{IF defined (IsSimulationMode)}\nn := := ;\n{ELSE}\nn := 1;\n{ELSE}\n{END_IF}\n{END_IF}")
    expect(bodyStatements(body).errors.map((e) => e.message)).toEqual([
      "Unexpected pragma: 'ELSE' found without matching 'if'",
      "Unexpected pragma: 'END_IF' found without matching 'if'",
    ])
  })

  test("the body AS WRITTEN holds every branch, whatever the world (sourceStatements)", () => {
    const { source, body } = method("{IF defined (IsSimulationMode)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}\nn := 3;")
    const parsed = sourceStatements(body)
    expect(parsed.ok).toBe(true)
    expect(parsed.statements.map((s) => source.slice(s.span.start, s.span.end).trim())).toEqual(["n := 1;", "n := 2;", "n := 3;"])
  })

  test("the body AS WRITTEN: an error in a branch voids nothing (it builds when not taken); one outside every chain does", () => {
    // `prag_untaken_branch_syntax_error` builds on both vendors: the source reading keeps the body and the rest of it
    const branch = method("n := 1;\n{IF defined (NEVER)}\nn := ;\n{ELSIF defined (IsSimulationMode)}\nn := := ;\n{ELSE}\nn := 2;\n{END_IF}\nn := 3;")
    const parsed = sourceStatements(branch.body)
    expect(parsed.ok).toBe(true)
    // the broken statements are refused (no node); every other branch's are in the tree
    expect(parsed.statements.map((s) => branch.source.slice(s.span.start, s.span.end).trim())).toEqual(["n := 1;", "n := 2;", "n := 3;"])
    expect(sourceStatements(method("{IF defined (NEVER)}\nn := 1;\n{END_IF}\nn := ;").body).ok).toBe(false)
    // the chain's structure is the vendor's either way: an unterminated chain or an orphan voids the reading
    expect(sourceStatements(method("{IF defined (NEVER)}\nn := 1;").body).ok).toBe(false)
    expect(sourceStatements(method("n := 1;\n{END_IF}").body).ok).toBe(false)
  })
})

test("an unquoted hasattribute attribute is the vendor's error where the directive acts, and the branch is not taken (cc6_attribute_value_unquoted)", () => {
  expect(holds("hasattribute (pou: F, marked)")).toBe("Single byte string expected for an attribute value instead of 'marked'")
  // the body is DECIDED — not refused — and the rest of it is read: the vendor's error is a syntax error of the body
  expect(kept("{IF hasattribute (pou: FB, marked)}\nn := 1;\n{END_IF}\nn := 2;")).toBe("Single byte string expected for an attribute value instead of 'marked'")
})

test("an unquoted hasattribute attribute is the vendor's error where no condition is asked too (prag_hasattribute_unquoted_*)", () => {
  const unquoted = "Single byte string expected for an attribute value instead of 'marked'"
  // both vendors, 2026-10-02: on an {ELSIF} after a taken branch, on one whose condition is asked, on an {IF} in an untaken branch
  expect(kept("{IF NOT defined (VOLT_NEVER_DEFINED)}\nn := 1;\n{ELSIF hasattribute (pou: FB, marked)}\nn := 2;\n{END_IF}")).toBe(unquoted)
  expect(kept("{IF defined (VOLT_NEVER_DEFINED)}\nn := 2;\n{ELSIF hasattribute (pou: FB, marked)}\nn := 2;\n{ELSE}\nn := 1;\n{END_IF}")).toBe(unquoted)
  expect(kept("n := 1;\n{IF defined (VOLT_NEVER_DEFINED)}\n{IF hasattribute (pou: FB, marked)}\nn := 2;\n{END_IF}\n{END_IF}")).toBe(unquoted)
  // nested in a statement of an untaken branch, and in a branch the LSP cannot decide: the same text, the same error
  expect(kept("n := 1;\n{IF defined (VOLT_NEVER_DEFINED)}\nIF n > 0 THEN\n{IF hasattribute (pou: FB, marked)}\nn := 2;\n{END_IF}\nEND_IF;\n{END_IF}")).toBe(unquoted)
  const undecided = methodOf("{IF defined (IsSimulationMode)}\n{IF hasattribute (pou: FB, marked)}\nn := 2;\n{END_IF}\n{END_IF}")
  expect(bodyStatements(undecided.body, NO_COMPILE_DEFINES).errors.map((e) => e.message)).toEqual([unquoted])
  // the body AS WRITTEN is the services' reading: the error is the analysis', and voids nothing there
  expect(sourceStatements(undecided.body).ok).toBe(true)
})
