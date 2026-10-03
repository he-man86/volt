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
  bodyStatements,
  unitBodies,
} from "../index.js"

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

const bodiesOf = (src: string): BodySpan[] => parseSource(src, { networkText: true }).units.flatMap(unitBodies)

/** Every syntax error of a file: its declarations' (the top-level parse) and each ST body's (parsed on demand), as the
 *  `parse-errors` check drains them. A graphical body is the network parser's. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true })
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isGraphicalBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => bodyStatements(b).errors)].map((e) => e.message)
}

// ── body splitting ────────────────────────────────────────────────────────────────────────────────

test("an ST file with IMPLEMENTATION ST on every body parses clean", () => {
  expect(syntaxErrors(MOTOR)).toEqual([])
  expect(parseSource(MOTOR, { networkText: true }).units.map((u) => u.kind)).toEqual(["function_block", "method", "action", "property"])
})

/** Found by the re-pulled pro2193 corpus (`LedFB.pou`): `METHOD PROTECTED Override` with no return type and no VAR, so
 *  its keyword line comes straight after the header. The header parser takes a modifier keyword as a modifier only when
 *  a name follows it, and `IMPLEMENTATION` is an identifier token — so `Override` became a modifier, the method was
 *  named `IMPLEMENTATION` (reserved) and `ST THIS^…` a syntax error. The retired comment was trivia and hid it. The
 *  keyword line is where a declaration ENDS, never a name. */
test("a method named after a modifier keyword keeps its name when its keyword line follows the header", () => {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\txOverride : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
    "METHOD PROTECTED Override\nIMPLEMENTATION ST\nTHIS^.xOverride := TRUE;\nEND_METHOD\n\n" +
    "METHOD PUBLIC Final\nIMPLEMENTATION ST\n;\nEND_METHOD\n"
  expect(syntaxErrors(src)).toEqual([])
  const methods = parseSource(src, { networkText: true }).units.filter((u) => u.kind === "method")
  expect(methods.map((m) => [m.kind === "method" && m.modifiers, m.name.text])).toEqual([
    [["PROTECTED"], "Override"],
    [["PUBLIC"], "Final"],
  ])
})

/** The function-block twin of the case above (implementation-keyword 4 review): the FB header ate every modifier
 *  keyword greedily, so an FB named after one, with no VAR, took its keyword line for the name — `IMPLEMENTATION`, a
 *  false "reserved" error and a wrong symbol. The header asks the method's question: a modifier is one only when a name
 *  follows it, and the keyword line is never a name. */
test("a function block named after a modifier keyword keeps its name when its keyword line follows the header", () => {
  for (const [header, access, name] of [
    ["FUNCTION_BLOCK PUBLIC Final", ["PUBLIC"], "Final"],
    ["FUNCTION_BLOCK Abstract", [], "Abstract"],
    ["FUNCTION_BLOCK INTERNAL Protected", ["INTERNAL"], "Protected"],
  ] as const) {
    const src = `${header}\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n`
    expect(syntaxErrors(src)).toEqual([])
    const units = parseSource(src, { networkText: true }).units
    expect(units.map((u) => (u.kind === "function_block" ? [u.name.text, u.modifiers] : [u.kind]))).toEqual([
      [name, [...access]],
    ])
  }
  // With a VAR section the same name was already a name; it stays one, and real modifiers stay modifiers.
  const withVar = parseSource("FUNCTION_BLOCK FINAL ABSTRACT FB_X\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n", { networkText: true })
  const fbx = withVar.units[0]!
  if (fbx.kind !== "function_block") throw new Error("not a function block")
  expect([fbx.name.text, fbx.modifiers]).toEqual(["FB_X", ["FINAL", "ABSTRACT"]])
})

test("the keyword line belongs to no declaration and to no statement", () => {
  const { units } = parseSource(MOTOR, { networkText: true })
  const method = units.find((u) => u.kind === "method")!
  // The method's inputs are its declaration; the keyword did not end up as a variable or a statement.
  if (method.kind !== "method") throw new Error("not a method")
  expect(method.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["force"])
  const statements = bodyStatements(unitBodies(method)[0]!)
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
  const unit = parseSource(src, { networkText: true }).units[0]!
  if (unit.kind !== "function_block") throw new Error("not a function block")
  expect(unit.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["a", "out"])
  expect(bodiesOf(src).map(graphicalMarkerLanguage)).toEqual([undefined])
  expect(bodyStatements(bodiesOf(src)[0]!).statements.map((s) => s.kind)).toEqual(["assign"])
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
    const unit = parseSource(src, { networkText: true }).units[0]!
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

// ── hidden bodies (sections 2b and 3b: the line states a body Volt does not show) ─────────────────

test("an UNSUPPORTED line states a body read by neither parser, on every language but ST, and its empty body is clean", () => {
  for (const line of [
    "IMPLEMENTATION CFC UNSUPPORTED",
    "IMPLEMENTATION SFC UNSUPPORTED",
    "IMPLEMENTATION IL UNSUPPORTED",
    "IMPLEMENTATION LD UNSUPPORTED",
    "implementation  fbd  unsupported",
    // a language Volt has never seen, under the vendor's own name (D27, bridge-refusal-review 4.27)
    "IMPLEMENTATION UML UNSUPPORTED",
    "implementation nwl unsupported",
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
    const errors = parseSource(fb(`${line}\n`), { networkText: true }).errors.map((e) => e.message)
    expect({ line, named: errors.some((m) => m.includes(`'${line}'`) && m.includes(`IMPLEMENTATION ${language.toUpperCase()} UNSUPPORTED`)) }).toEqual({
      line,
      named: true,
    })
    expect({ line, reader: bodiesOf(fb(`${line}\n`)).map(isStBody) }).toEqual({ line, reader: [false] })
  }
})

/** FMT2's other half: the body under an UNSUPPORTED line is EMPTY. The push refuses any text under it — a comment and a
 *  pragma too (`StReader.Body`: `code.Trim().Length > 0`), since the drivers write nothing for that body and the text
 *  would be dropped — so the parser refuses it, naming the line, and neither reader reads it. */
test("code, a comment or a pragma under an UNSUPPORTED line is refused naming the line, and read by neither reader", () => {
  for (const line of ["IMPLEMENTATION CFC UNSUPPORTED", "IMPLEMENTATION LD UNSUPPORTED"])
    for (const under of ["out := a;", "// a note", "(* a note *)", "{attribute 'x'}", NETWORK]) {
      const src = fb(`${line}\n${under}`)
      const errors = parseSource(src, { networkText: true }).errors.map((e) => e.message)
      expect({ line, under, named: errors.some((m) => m.includes(`under '${line}'`)) }).toEqual({ line, under, named: true })
      expect({ line, under, reader: bodiesOf(src).map((b) => [isStBody(b), isGraphicalBody(b)]) }).toEqual({
        line,
        under,
        reader: [[false, false]],
      })
    }
})

test("UNSUPPORTED never stands after ST, and anything after an UNSUPPORTED line's words is refused naming the line", () => {
  for (const line of [
    "IMPLEMENTATION ST UNSUPPORTED",
    "IMPLEMENTATION CFC UNSUPPORTED x := 1;",
    "IMPLEMENTATION LD UNSUPPORTED;",
    "IMPLEMENTATION UNSUPPORTED UNSUPPORTED", // UNSUPPORTED is no language
    "IMPLEMENTATION COBOL", //                  a language Volt has never seen is a line only as a hidden body
  ]) {
    const errors = parseSource(fb(`${line}\n`), { networkText: true }).errors.map((e) => e.message)
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
  }
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
