/**
 * The implementation boundary is the keyword line `IMPLEMENTATION <LANG>` (openspec `implementation-keyword`): it ends
 * every body's declaration — POU, method, action, property getter and setter — and states the body's language, ST
 * included. The stated language is the ONE signal for how a body is read: `ST` by the ST parser, `LD`/`FBD` by the
 * network-text parser. The retired comment `(* @volt-implementation … *)` is not recognised at all.
 *
 * The bridge's side of the same contract is `ImplementationKeywordTests` in volt-cli.
 */
import { expect, test } from "bun:test"
import {
  type BodySpan,
  graphicalMarkerLanguage,
  isGraphicalBody,
  isStBody,
  parseSource,
  parseStatements,
  unitBodies,
} from "./index.js"
import { STRUCTURE_ONLY, parseNetworkText } from "../network-text/parser.js"

const MOTOR = `FUNCTION_BLOCK FB_Motor
VAR
\tx : INT;
END_VAR
IMPLEMENTATION ST
x := x + 1;

END_FUNCTION_BLOCK

METHOD Reset : BOOL
VAR_INPUT
\tforce : BOOL;
END_VAR
IMPLEMENTATION ST
x := 0;
Reset := force;
END_METHOD

ACTION Step
IMPLEMENTATION ST
x := x + 2;
END_ACTION

PROPERTY Count : INT
GET
IMPLEMENTATION ST
Count := x;
END_GET
SET
IMPLEMENTATION ST
x := Count;
END_SET
END_PROPERTY
`

const NETWORK = "NETWORK\nout := a;\nEND_NETWORK"

/** A function block whose body is `impl` — its boundary line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

const bodiesOf = (src: string): BodySpan[] => parseSource(src).units.flatMap(unitBodies)

/** Every syntax error of a file: its declarations' (the top-level parse) and each ST body's (parsed on demand), as the
 *  `parse-errors` check drains them. A graphical body is the network parser's. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src)
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isGraphicalBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => parseStatements(b).errors)].map((e) => e.message)
}

// ── body splitting ────────────────────────────────────────────────────────────────────────────────

test("an ST file with IMPLEMENTATION ST on every body parses clean", () => {
  expect(syntaxErrors(MOTOR)).toEqual([])
  expect(parseSource(MOTOR).units.map((u) => u.kind)).toEqual(["function_block", "method", "action", "property"])
})

test("the keyword line belongs to no declaration and to no statement", () => {
  const { units } = parseSource(MOTOR)
  const method = units.find((u) => u.kind === "method")!
  // The method's inputs are its declaration; the keyword did not end up as a variable or a statement.
  if (method.kind !== "method") throw new Error("not a method")
  expect(method.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["force"])
  const statements = parseStatements(unitBodies(method)[0]!)
  expect(statements.errors).toEqual([])
  expect(statements.statements.map((s) => s.kind)).toEqual(["assign", "assign"]) // `x := 0;` and `Reset := force;`
  for (const body of bodiesOf(MOTOR)) expect(isGraphicalBody(body)).toBe(false)
})

test("the keyword is case-insensitive and its spacing is free, as ST keywords are", () => {
  expect(syntaxErrors(fb("  implementation   st  \na := TRUE;"))).toEqual([])
})

test("the retired comment is no boundary: a body behind it is not graphical", () => {
  for (const marker of ["(* @volt-implementation LD *)", "(* @volt-implementation FBD *)"]) {
    const bodies = bodiesOf(fb(`${marker}\n${NETWORK}`))
    expect(bodies.map(graphicalMarkerLanguage)).toEqual([undefined])
    expect(bodies.some(isGraphicalBody)).toBe(false)
  }
})

/** A keyword line inside a comment is the engineer's prose. `IMPLEMENTATION ST` is something an engineer can plausibly
 *  write in a documentation comment (the retired `@volt-implementation` tag was not), and a splitter that takes the
 *  first matching LINE would cut the file inside the comment — here, calling an ST body a ladder. */
test("a keyword line inside a declaration's block comment is no boundary", () => {
  const src = `FUNCTION_BLOCK F
(* notes:
IMPLEMENTATION LD
*)
VAR
\ta : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION ST
out := a;
END_FUNCTION_BLOCK
`
  expect(syntaxErrors(src)).toEqual([])
  const unit = parseSource(src).units[0]!
  if (unit.kind !== "function_block") throw new Error("not a function block")
  expect(unit.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["a", "out"])
  expect(bodiesOf(src).map(graphicalMarkerLanguage)).toEqual([undefined])
  expect(parseStatements(bodiesOf(src)[0]!).statements.map((s) => s.kind)).toEqual(["assign"])
})

/** The comment shapes a line-start scan misses, which the bridge pins in `ImplementationKeywordTests` too: a block
 *  comment opened AFTER code on its line (bakon-nano's `:= TRUE;(*NOT (`), and a NESTED one — the lexer nests
 *  comments, so the boundary is the first keyword line outside the outermost comment, and the two runtimes must agree
 *  on it. Every row's only real boundary is the last line before the body. */
test("a keyword line inside a comment opened mid-line or nested is no boundary", () => {
  for (const decl of [
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL; (* old layout:\nIMPLEMENTATION ST\n*)\n\tout : BOOL;\nEND_VAR",
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;(*NOT (\nIMPLEMENTATION LD\n*)\n\tout : BOOL;\nEND_VAR",
    "FUNCTION_BLOCK F\n(* outer (* inner *)\nIMPLEMENTATION LD\n*)\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR",
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL; (* a (* b *)\nIMPLEMENTATION FBD\n*)\n\tout : BOOL;\nEND_VAR",
  ]) {
    const src = `${decl}\nIMPLEMENTATION ST\nout := a;\nEND_FUNCTION_BLOCK\n`
    expect({ decl, errors: syntaxErrors(src) }).toEqual({ decl, errors: [] })
    const unit = parseSource(src).units[0]!
    if (unit.kind !== "function_block") throw new Error("not a function block")
    const names = unit.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))
    expect({ decl, names }).toEqual({ decl, names: ["a", "out"] })
    expect({ decl, languages: bodiesOf(src).map(graphicalMarkerLanguage) }).toEqual({ decl, languages: [undefined] })
  }
})

/** Only a WHOLE line holding exactly `IMPLEMENTATION <LANG>` is the boundary — the bridge's `ImplementationMarker`
 *  rule, so the two runtimes cannot disagree about where a body starts or what it is. A look-alike later in an ST body
 *  (in a comment, after code, as a statement) is part of that body and switches nothing. */
test("only a whole line is the boundary: a look-alike inside an ST body switches no reader", () => {
  // The positive half: the whole line does select the network reader.
  expect(bodiesOf(fb(`IMPLEMENTATION LD\n${NETWORK}`)).map(graphicalMarkerLanguage)).toEqual(["LD"])

  for (const body of [
    "out := a; (* was IMPLEMENTATION LD *)",
    "out := a;\n// IMPLEMENTATION FBD",
    "(*\nIMPLEMENTATION LD\n*)\nout := a;",
    "out := a;\n(* IMPLEMENTATION FBD *)",
  ]) {
    const src = fb(`IMPLEMENTATION ST\n${body}`)
    expect({ body, errors: syntaxErrors(src) }).toEqual({ body, errors: [] })
    expect({ body, languages: bodiesOf(src).map(graphicalMarkerLanguage) }).toEqual({ body, languages: [undefined] })
  }
})

test("only a whole line is the boundary: a keyword with anything else on its line states no language", () => {
  for (const line of [
    "IMPLEMENTATION LD;",
    "IMPLEMENTATION LD // note",
    "IMPLEMENTATION LD (* note *)",
    "IMPLEMENTATION LD out := a;",
    "x := IMPLEMENTATION LD;",
    "(* IMPLEMENTATION LD *)",
  ]) {
    const src = fb(`${line}\n${NETWORK}`)
    // Not graphical, so not handed to the network parser — and the file is not clean, because it has no boundary.
    expect({ line, languages: bodiesOf(src).map(graphicalMarkerLanguage) }).toEqual({ line, languages: [undefined] })
    expect({ line, clean: syntaxErrors(src).length === 0 }).toEqual({ line, clean: false })
  }
})

// ── language selection ───────────────────────────────────────────────────────────────────────────

test("IMPLEMENTATION LD and IMPLEMENTATION FBD select the network-text reader", () => {
  for (const language of ["LD", "FBD"] as const) {
    const src = fb(`IMPLEMENTATION ${language}\n${NETWORK}`)
    expect(syntaxErrors(src)).toEqual([]) // the ST parser routes around a graphical body
    const bodies = bodiesOf(src)
    expect(bodies.map(graphicalMarkerLanguage)).toEqual([language])
    const parsed = parseNetworkText(bodies[0]!, STRUCTURE_ONLY)
    expect(parsed.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
    expect(parsed.language).toBe(language)
    expect(parsed.networks).toHaveLength(1)
  }
})

test("a graphical body is graphical by its keyword alone, even with no network", () => {
  expect(bodiesOf(fb("IMPLEMENTATION LD")).map(graphicalMarkerLanguage)).toEqual(["LD"])
})

test("a method's and an accessor's stated language select their reader too", () => {
  const src = `FUNCTION_BLOCK F
VAR
\ta : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION ST

END_FUNCTION_BLOCK

METHOD Ladder
IMPLEMENTATION LD
${NETWORK}
END_METHOD

PROPERTY Ready : BOOL
GET
IMPLEMENTATION FBD
${NETWORK}
END_GET
SET
IMPLEMENTATION ST
out := Ready;
END_SET
END_PROPERTY
`
  expect(syntaxErrors(src)).toEqual([])
  expect(bodiesOf(src).map(graphicalMarkerLanguage)).toEqual([undefined, "LD", "FBD", undefined])
})

test("the stated language wins over what the text looks like: network text under ST is read as ST", () => {
  // Never re-read as the other language — the ST parser meets `NETWORK` and says so.
  const src = fb(`IMPLEMENTATION ST\n${NETWORK}`)
  expect(bodiesOf(src).some(isGraphicalBody)).toBe(false)
  expect(syntaxErrors(src).length).toBeGreaterThan(0)
})

test("…and ST under LD is read as network text, which refuses it", () => {
  const bodies = bodiesOf(fb("IMPLEMENTATION LD\nout := a;"))
  expect(bodies.map(graphicalMarkerLanguage)).toEqual(["LD"])
  expect(parseNetworkText(bodies[0]!, STRUCTURE_ONLY).diagnostics.length).toBeGreaterThan(0)
})

// ── hidden bodies (sections 2b and 3b: the line states a body Volt does not show) ─────────────────

test("an UNSUPPORTED line states a body read by neither parser, on every language but ST, and its empty body is clean", () => {
  for (const line of [
    "IMPLEMENTATION CFC UNSUPPORTED",
    "IMPLEMENTATION SFC UNSUPPORTED",
    "IMPLEMENTATION IL UNSUPPORTED",
    "IMPLEMENTATION LD UNSUPPORTED",
    "implementation  fbd  unsupported",
  ]) {
    const src = fb(`${line}\n`)
    expect({ line, errors: syntaxErrors(src) }).toEqual({ line, errors: [] })
    const bodies = bodiesOf(src)
    expect({ line, graphical: bodies.map(graphicalMarkerLanguage), st: bodies.map(isStBody) }).toEqual({
      line,
      graphical: [undefined],
      st: [false],
    })
    expect(bodies[0]!.implementation?.statement.kind).toBe("unsupported")
  }
})

/** Section 3b reverses 2b's bare `IMPLEMENTATION CFC|SFC|IL`: a body Volt does not show says so with UNSUPPORTED on
 *  every language, so the bare line states no body — the push refuses it naming the line to write
 *  (`ReadOnlyBodyTests`), and so does the LSP, on the line. Neither reader reads what is under it. */
test("a bare CFC, SFC or IL line is refused naming it and the UNSUPPORTED line to write", () => {
  for (const language of ["CFC", "SFC", "IL", "cfc"]) {
    const line = `IMPLEMENTATION ${language}`
    const errors = parseSource(fb(`${line}\n`)).errors.map((e) => e.message)
    expect({ line, named: errors.some((m) => m.includes(`'${line}'`) && m.includes(`IMPLEMENTATION ${language.toUpperCase()} UNSUPPORTED`)) }).toEqual({
      line,
      named: true,
    })
    expect({ line, reader: bodiesOf(fb(`${line}\n`)).map(isStBody) }).toEqual({ line, reader: [false] })
  }
})

test("UNSUPPORTED never stands after ST, and anything after an UNSUPPORTED line's words is refused naming the line", () => {
  for (const line of ["IMPLEMENTATION ST UNSUPPORTED", "IMPLEMENTATION CFC UNSUPPORTED x := 1;", "IMPLEMENTATION LD UNSUPPORTED;"]) {
    const errors = parseSource(fb(`${line}\n`)).errors.map((e) => e.message)
    expect({ line, named: errors.some((m) => m.includes(`'${line}'`)) }).toEqual({ line, named: true })
    expect({ line, reader: bodiesOf(fb(`${line}\n`)).map(isStBody) }).toEqual({ line, reader: [false] })
  }
})

test("a member's %FOLDER under its line is taken out with the line, whatever the line states", () => {
  for (const line of ["IMPLEMENTATION ST", "IMPLEMENTATION LD", "IMPLEMENTATION CFC UNSUPPORTED", "IMPLEMENTATION FBD UNSUPPORTED"]) {
    const code = line === "IMPLEMENTATION LD" ? NETWORK : line === "IMPLEMENTATION ST" ? "out := a;" : ""
    const src = `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\n${line}\n%FOLDER Sub/Deep\n${code}\nEND_METHOD\n`
    expect({ line, errors: syntaxErrors(src) }).toEqual({ line, errors: [] })
    const method = bodiesOf(src)[1]!
    expect({ line, folderInBody: method.tokens.some((t) => t.text === "%") }).toEqual({ line, folderInBody: false })
    if (line === "IMPLEMENTATION LD")
      expect(parseNetworkText(method, STRUCTURE_ONLY).diagnostics.map((d) => d.message)).toEqual([])
  }
})

test("a member's %FOLDER is read where the push peels it, and nowhere else — elsewhere it is code the IDE would get", () => {
  // The push (`StReader.PeelFolderUnder`) takes `%FOLDER ` — that spelling, case and all, with a path — off the FIRST
  // line under a METHOD's or an ACTION's line, and nowhere else: a POU's own body and a property accessor have no
  // folder there, and a blank line or a comment above the directive leaves it in the body. Wherever the push leaves
  // it, it is pushed into the IDE as ST statement text — so the LSP reads it as the body's, and does not hide it.
  for (const [member, end] of [["METHOD M", "END_METHOD"], ["ACTION A", "END_ACTION"]] as const) {
    const src = `${fb("IMPLEMENTATION ST\n")}\n${member}\nIMPLEMENTATION ST\n%FOLDER  Sub/Deep \nout := a;\n${end}\n`
    expect({ member, errors: syntaxErrors(src) }).toEqual({ member, errors: [] })
    expect({ member, folder: bodiesOf(src)[1]!.implementation?.folder }).toEqual({ member, folder: "Sub/Deep" })
  }
  const left = {
    "a POU's own body": "PROGRAM PRG\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n%FOLDER Sub\nx := 1;\nEND_PROGRAM\n",
    "a property accessor": `${fb("IMPLEMENTATION ST\n")}\nPROPERTY P : INT\nGET\nIMPLEMENTATION ST\n%FOLDER Sub\nP := 1;\nEND_GET\nEND_PROPERTY\n`,
    "another case": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n%folder Sub\nout := a;\nEND_METHOD\n`,
    "a blank line above it": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n\n%FOLDER Sub\nout := a;\nEND_METHOD\n`,
    "a comment above it": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n(* note *)\n%FOLDER Sub\nout := a;\nEND_METHOD\n`,
    "no path": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n%FOLDER\nout := a;\nEND_METHOD\n`,
  }
  for (const [where, src] of Object.entries(left)) {
    const body = bodiesOf(src).at(-1)!
    expect({ where, folder: body.implementation?.folder, inBody: body.tokens.some((t) => t.text === "%") }).toEqual({
      where,
      folder: undefined,
      inBody: true,
    })
    expect({ where, reported: syntaxErrors(src).length > 0 }).toEqual({ where, reported: true })
  }
})

test("a (* @volt-… *) comment is an older Volt's, reported naming `volt pull` wherever it stands — as the push refuses it", () => {
  // No Volt writes one any more (the push: `ImplementationMarker.FindRetiredComment`). A comment only — outermost or
  // nested — and in any case; the same characters after `//` or in a string are text.
  const reported = {
    "the retired boundary": fb("(* @volt-implementation LD *)\nNETWORK\nout := a;\nEND_NETWORK\n"),
    "the retired marker": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n(* @volt-graphical: CFC *)\nEND_METHOD\n`,
    "nested, another case": fb("IMPLEMENTATION ST\n(* doc (*  @VOLT-implementation *) *)\nout := a;\n"),
    "in a declaration": "FUNCTION_BLOCK F\nVAR\n\ta : BOOL; (* @volt-implementation *)\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\nEND_FUNCTION_BLOCK\n",
  }
  for (const [where, src] of Object.entries(reported))
    expect({ where, named: syntaxErrors(src).filter((m) => m.includes("volt pull")).length }).toEqual({ where, named: 1 })
  const text = {
    "a line comment": fb("IMPLEMENTATION ST\n// (* @volt-implementation *)\nout := a;\n"),
    "a string": "FUNCTION_BLOCK F\nVAR\n\ts : STRING := '(* @volt-implementation *)';\nEND_VAR\nIMPLEMENTATION ST\ns := '';\nEND_FUNCTION_BLOCK\n",
  }
  for (const [where, src] of Object.entries(text)) expect({ where, errors: syntaxErrors(src) }).toEqual({ where, errors: [] })
})

test("a line sharing its line with END_VAR is no boundary", () => {
  const src = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR IMPLEMENTATION LD\nNETWORK\nEND_NETWORK\nEND_FUNCTION_BLOCK\n"
  expect(bodiesOf(src).map((b) => b.implementation)).toEqual([undefined])
  expect(syntaxErrors(src).length).toBeGreaterThan(0)
})

test("the line is taken out of the body: the code starts under it, and it is not ST", () => {
  const body = bodiesOf(fb("IMPLEMENTATION ST\nout := a;"))[0]!
  expect(body.tokens.map((t) => t.text).join("").trim()).toBe("out := a;")
  expect(body.implementation?.text).toBe("IMPLEMENTATION ST")
})
