/**
 * A body's boundary is the property line `%LANGUAGE <LANG>` (openspec `language-line`): it ends every body's declaration —
 * POU, method, action, property getter and setter — and states the body's language, ST included. The stated language is
 * the ONE signal for how a body is read: `ST` by the ST parser, `LD`/`FBD` by the network-text parser. A METHOD or an
 * accessor with no body slot has no line and nothing after its declaration.
 *
 * The bridge's side of the same contract is `LanguageLineTests` in volt-cli.
 */
import { expect, test } from "bun:test"
import {
  type BodySpan,
  graphicalMarkerLanguage,
  isPlainStNetworkBody,
  isStBody,
  parseDocument,
  parseSource,
  retiredLine,
  bodyStatements,
  unitBodies,
} from "../index.js"

const MOTOR = `FUNCTION_BLOCK FB_Motor
VAR
\tx : INT;
END_VAR
%LANGUAGE ST
x := x + 1;

END_FUNCTION_BLOCK

METHOD Reset : BOOL
VAR_INPUT
\tforce : BOOL;
END_VAR
%LANGUAGE ST
x := 0;
Reset := force;
END_METHOD

ACTION Step
%LANGUAGE ST
x := x + 2;
END_ACTION

PROPERTY Count : INT
GET
%LANGUAGE ST
Count := x;
END_GET
SET
%LANGUAGE ST
x := Count;
END_SET
END_PROPERTY
`

const NETWORK = "%NETWORK\nout := a;"

/** A function block whose body is `impl` — its line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

const bodiesOf = (src: string): BodySpan[] => parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").units.flatMap(unitBodies)

/** Every syntax error of a file: its declarations' (the top-level parse) and each ST body's (parsed on demand), as the
 *  `parse-errors` check drains them. A graphical body is the network parser's. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isPlainStNetworkBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => bodyStatements(b).errors)].map((e) => e.message)
}

// ── body splitting ────────────────────────────────────────────────────────────────────────────────

test("an ST file with %LANGUAGE ST on every body parses clean", () => {
  expect(syntaxErrors(MOTOR)).toEqual([])
  expect(parseSource(MOTOR, { networkText: true, unicodeIdentifiers: false }, "codesys").units.map((u) => u.kind)).toEqual(["function_block", "method", "action", "property"])
})

/** `METHOD PROTECTED Override` with no return type and no VAR (pro2193's `LedFB.pou`): its line comes straight after the
 *  header, and a `%` is no name — the method keeps its name and its modifier. */
test("a method named after a modifier keyword keeps its name when its line follows the header", () => {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\txOverride : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
    "METHOD PROTECTED Override\n%LANGUAGE ST\nTHIS^.xOverride := TRUE;\nEND_METHOD\n\n" +
    "METHOD PUBLIC Final\n%LANGUAGE ST\n;\nEND_METHOD\n"
  expect(syntaxErrors(src)).toEqual([])
  const methods = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").units.filter((u) => u.kind === "method")
  expect(methods.map((m) => [m.kind === "method" && m.modifiers, m.name.text])).toEqual([
    [["PROTECTED"], "Override"],
    [["PUBLIC"], "Final"],
  ])
})

test("a function block named after a modifier keyword keeps its name when its line follows the header", () => {
  for (const [header, access, name] of [
    ["FUNCTION_BLOCK PUBLIC Final", ["PUBLIC"], "Final"],
    ["FUNCTION_BLOCK Abstract", [], "Abstract"],
    ["FUNCTION_BLOCK INTERNAL Protected", ["INTERNAL"], "Protected"],
  ] as const) {
    const src = `${header}\n%LANGUAGE ST\nx := 1;\nEND_FUNCTION_BLOCK\n`
    expect(syntaxErrors(src)).toEqual([])
    const units = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").units
    expect(units.map((u) => (u.kind === "function_block" ? [u.name.text, u.modifiers] : [u.kind]))).toEqual([
      [name, [...access]],
    ])
  }
})

test("the line belongs to no declaration and to no statement", () => {
  const { units } = parseSource(MOTOR, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const method = units.find((u) => u.kind === "method")!
  if (method.kind !== "method") throw new Error("not a method")
  expect(method.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["force"])
  const statements = bodyStatements(unitBodies(method)[0]!)
  expect(statements.errors).toEqual([])
  expect(statements.statements.map((s) => s.kind)).toEqual(["assign", "assign"]) // `x := 0;` and `Reset := force;`
  for (const body of bodiesOf(MOTOR)) expect(isPlainStNetworkBody(body)).toBe(false)
})

test("the language word is read in any case, and the line's spacing is free", () => {
  expect(syntaxErrors(fb("  %LANGUAGE   st  \na := TRUE;"))).toEqual([])
  // Whitespace ends the key, a tab as a space — the push's `PropertyLines.KeyOf`, for every %-line.
  expect(syntaxErrors(fb("%LANGUAGE\tST\na := TRUE;"))).toEqual([])
  expect(bodiesOf(fb("%LANGUAGE\tLd\n" + NETWORK)).map(graphicalMarkerLanguage)).toEqual(["LD"])
  expect(bodiesOf(fb("%LANGUAGE Ld\n" + NETWORK)).map(graphicalMarkerLanguage)).toEqual(["LD"])
})

/** The line is the boundary WHEREVER it stands, as the push reads it: what stands above it is the declaration's, kept
 *  (the formatter prints it back) and never read as the body. Text there the declaration parser did not take — a `;`
 *  after `END_VAR`, a statement — the push writes into the IDE's declaration as sent, so what is said about it is the
 *  build's, and that is not recorded: the LSP says nothing an IDE recording does not back (niche: accepted loss, 0
 *  occurrences in the corpora). Nothing of it is analysed as the body. */
test("text between the last END_VAR and the line is the declaration's, and draws nothing no recording backs", () => {
  const src = "FUNCTION_BLOCK F\nVAR\n\tout : BOOL;\nEND_VAR;\n%LANGUAGE ST\nout := TRUE;\nEND_FUNCTION_BLOCK\n"
  expect(syntaxErrors(src)).toEqual([])
  const body = bodiesOf(src)[0]!
  expect(body.languageLine?.text).toBe("%LANGUAGE ST")
  expect(body.languageLine?.leading).toBe(";")
  expect(bodyStatements(body).statements.map((s) => s.kind)).toEqual(["assign"])

  const statements = bodiesOf(fb("x := a;\nfoo bar baz qux\n%LANGUAGE ST\nout := TRUE;"))[0]!
  expect(statements.languageLine?.leading).toBe("x := a;\nfoo bar baz qux")
  expect(bodyStatements(statements).statements.map((s) => s.kind)).toEqual(["assign"])

  expect(syntaxErrors(fb("// a note\n{attribute 'hide'}\n%LANGUAGE ST\nout := TRUE;"))).toEqual([])
})

/** A %-line above the line is a property line in a declaration, which the push refuses as such
 *  (`StReader.RefusePropertyLinesIn`) — reported as every misplaced one is, not as text the push writes as sent. */
test("a property line above the line is reported as misplaced, as the push refuses it", () => {
  const misplaced = "is no property the push reads here"
  const pou = syntaxErrors(fb("%EXCLUDE_FROM_BUILD\n%LANGUAGE ST\nout := TRUE;"))
  expect(pou.length).toBe(1)
  expect(pou[0]!.startsWith("'%EXCLUDE_FROM_BUILD' " + misplaced)).toBe(true)
  const method = syntaxErrors(`${fb("%LANGUAGE ST\nout := TRUE;")}\nMETHOD M : BOOL\nVAR\nEND_VAR\n%FOLDER sub\n%LANGUAGE ST\nM := TRUE;\nEND_METHOD\n`)
  expect(method.length).toBe(1)
  expect(method[0]!.startsWith("'%FOLDER sub' " + misplaced)).toBe(true)
})

test("the retired comment is no boundary: a body behind it is not graphical", () => {
  for (const marker of ["(* @volt-implementation LD *)", "(* @volt-implementation FBD *)"]) {
    const bodies = bodiesOf(fb(`${marker}\n${NETWORK}`))
    expect(bodies.map(graphicalMarkerLanguage)).toEqual([undefined])
    expect(bodies.some(isPlainStNetworkBody)).toBe(false)
  }
})

/** A line inside a comment is the engineer's prose — a declaration's block comment, one opened after code on its line
 *  (bakon-nano's `:= TRUE;(*NOT (`), a NESTED one — the lexer puts every comment in its own token. */
test("a line inside a comment is no boundary", () => {
  for (const decl of [
    "FUNCTION_BLOCK F\n(* notes:\n%LANGUAGE LD\n*)\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR",
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL; (* old layout:\n%LANGUAGE ST\n*)\n\tout : BOOL;\nEND_VAR",
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;(*NOT (\n%LANGUAGE LD\n*)\n\tout : BOOL;\nEND_VAR",
    "FUNCTION_BLOCK F\n(* outer (* inner *)\n%LANGUAGE LD\n*)\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR",
  ]) {
    const src = `${decl}\n%LANGUAGE ST\nout := a;\nEND_FUNCTION_BLOCK\n`
    expect({ decl, errors: syntaxErrors(src) }).toEqual({ decl, errors: [] })
    const unit = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").units[0]!
    if (unit.kind !== "function_block") throw new Error("not a function block")
    expect({ decl, names: unit.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text))) }).toEqual({ decl, names: ["a", "out"] })
    expect({ decl, languages: bodiesOf(src).map(graphicalMarkerLanguage) }).toEqual({ decl, languages: [undefined] })
  }
})

test("a line inside an ST body's comment switches no reader", () => {
  for (const body of ["out := a; (* was %LANGUAGE LD *)", "out := a;\n// %LANGUAGE FBD", "(*\n%LANGUAGE LD\n*)\nout := a;"]) {
    const src = fb(`%LANGUAGE ST\n${body}`)
    expect({ body, errors: syntaxErrors(src) }).toEqual({ body, errors: [] })
    expect({ body, languages: bodiesOf(src).map(graphicalMarkerLanguage) }).toEqual({ body, languages: [undefined] })
  }
})

/** A `%LANGUAGE` line is never code, so one that states no body is reported by name, saying what it lacks — the push's
 *  refusal of the same line — and the body is read by neither reader. */
test("a line that states no body is reported naming it and what it lacks", () => {
  for (const [line, lacks] of [
    ["%LANGUAGE", "states no language"],
    ["%LANGUAGE LD;", "is no language a body can state"],
    ["%LANGUAGE LD // note", "is no language a body can state"],
    ["%LANGUAGE LD out := a;", "is no language a body can state"],
    ["%LANGUAGE ST UNSUPPORTED", "Volt shows every ST body"],
    ["%LANGUAGE CFC", "'%LANGUAGE CFC UNSUPPORTED'"],
    ["%LANGUAGE cfc", "'%LANGUAGE CFC UNSUPPORTED'"],
    ["%LANGUAGE COBOL", "'COBOL' is no language a body can state"],
    ["%LANGUAGE NONE", "'NONE' is no language a body can state"],
  ] as const) {
    const src = fb(`${line}\n${NETWORK}`)
    const errors = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").errors.map((e) => e.message)
    expect({ line, named: errors.some((m) => m.startsWith(`the body states '${line}': `) && m.includes(lacks)) }).toEqual({ line, named: true })
    expect({ line, reader: bodiesOf(src).map((b) => [b.languageLine?.statement, isStBody(b), isPlainStNetworkBody(b)]) }).toEqual({
      line,
      reader: [[undefined, false, false]],
    })
  }
})

test("a %LANGUAGE word that is no line — after code, in another case of the key, in a comment — is no boundary", () => {
  for (const line of ["x := %LANGUAGE LD;", "%language LD", "(* %LANGUAGE LD *)"]) {
    const src = fb(`${line}\n${NETWORK}`)
    expect({ line, languages: bodiesOf(src).map((b) => b.languageLine) }).toEqual({ line, languages: [undefined] })
    expect({ line, clean: syntaxErrors(src).length === 0 }).toEqual({ line, clean: false })
  }
})

// ── language selection ───────────────────────────────────────────────────────────────────────────

test("a graphical body is graphical by its line alone, even with no network", () => {
  expect(bodiesOf(fb("%LANGUAGE LD")).map(graphicalMarkerLanguage)).toEqual(["LD"])
})

test("a method's and an accessor's stated language select their reader too", () => {
  const src = `FUNCTION_BLOCK F
VAR
\ta : BOOL;
\tout : BOOL;
END_VAR
%LANGUAGE ST

END_FUNCTION_BLOCK

METHOD Ladder
%LANGUAGE LD
${NETWORK}
END_METHOD

PROPERTY Ready : BOOL
GET
%LANGUAGE FBD
${NETWORK}
END_GET
SET
%LANGUAGE ST
out := Ready;
END_SET
END_PROPERTY
`
  expect(syntaxErrors(src)).toEqual([])
  expect(bodiesOf(src).map(graphicalMarkerLanguage)).toEqual([undefined, "LD", "FBD", undefined])
})

test("the stated language wins over what the text looks like: network text under ST is read as ST", () => {
  const src = fb(`%LANGUAGE ST\n${NETWORK}`)
  expect(bodiesOf(src).some(isPlainStNetworkBody)).toBe(false)
  expect(syntaxErrors(src)).toEqual(["Unexpected token '%' found", "';' expected instead of 'NETWORK'", "';' expected instead of 'out'"])
})

// ── hidden bodies ─────────────────────────────────────────────────────────────────────────────────

test("an UNSUPPORTED line states a body read by neither parser, on every language but ST, and its empty body is clean", () => {
  for (const line of [
    "%LANGUAGE CFC UNSUPPORTED",
    "%LANGUAGE SFC UNSUPPORTED",
    "%LANGUAGE IL UNSUPPORTED",
    "%LANGUAGE LD UNSUPPORTED",
    "%LANGUAGE  fbd  unsupported",
    // a language Volt has never seen, under the vendor's own name (D27); no word is reserved
    "%LANGUAGE UML UNSUPPORTED",
    "%LANGUAGE nwl unsupported",
    "%LANGUAGE NONE UNSUPPORTED",
  ]) {
    const src = fb(`${line}\n`)
    expect({ line, errors: syntaxErrors(src) }).toEqual({ line, errors: [] })
    const bodies = bodiesOf(src)
    expect({ line, graphical: bodies.map(graphicalMarkerLanguage), st: bodies.map(isStBody) }).toEqual({
      line,
      graphical: [undefined],
      st: [false],
    })
    expect(bodies[0]!.languageLine?.statement?.kind).toBe("unsupported")
  }
})

test("code, a comment or a pragma under an UNSUPPORTED line is refused naming the line, and read by neither reader", () => {
  for (const line of ["%LANGUAGE CFC UNSUPPORTED", "%LANGUAGE LD UNSUPPORTED"])
    for (const under of ["out := a;", "// a note", "(* a note *)", "{attribute 'x'}", NETWORK]) {
      const src = fb(`${line}\n${under}`)
      const errors = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").errors.map((e) => e.message)
      expect({ line, under, named: errors.some((m) => m.includes(`under '${line}'`)) }).toEqual({ line, under, named: true })
      expect({ line, under, reader: bodiesOf(src).map((b) => [isStBody(b), isPlainStNetworkBody(b)]) }).toEqual({
        line,
        under,
        reader: [[false, false]],
      })
    }
})

/** An identifier spelled `Implementation` — alone on a line, in a wrapped expression — is code the IDE compiles. */
test("an identifier spelled Implementation on a line of its own is code, not a line", () => {
  for (const code of ["out := a OR\n  Implementation;", "out := a\nImplementation OR b;"]) {
    const src = fb(`%LANGUAGE ST\n${code}`)
    expect({ code, line: bodiesOf(src)[0]!.languageLine?.text }).toEqual({ code, line: "%LANGUAGE ST" })
    const lineFindings = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").errors.map((e) => e.message).filter((m) => m.includes("line inside a body"))
    expect({ code, lineFindings }).toEqual({ code, lineFindings: [] })
  }
})

test("a second %LANGUAGE line inside a body is reported where it stands", () => {
  const errors = parseSource(fb("%LANGUAGE ST\nout := a;\n%LANGUAGE LD"), { networkText: true, unicodeIdentifiers: false }, "codesys").errors.map((e) => e.message)
  expect(errors).toContain("a second %LANGUAGE line inside a body: '%LANGUAGE LD'. A body states its language once, on the line that opens it.")
})

test("a member's %FOLDER under its line is taken out with the line, whatever the line states", () => {
  for (const line of ["%LANGUAGE ST", "%LANGUAGE LD", "%LANGUAGE CFC UNSUPPORTED", "%LANGUAGE FBD UNSUPPORTED"]) {
    const code = line === "%LANGUAGE LD" ? NETWORK : line === "%LANGUAGE ST" ? "out := a;" : ""
    const src = `${fb("%LANGUAGE ST\n")}\nMETHOD M\n${line}\n%FOLDER Sub/Deep\n${code}\nEND_METHOD\n`
    expect({ line, errors: syntaxErrors(src) }).toEqual({ line, errors: [] })
    const method = bodiesOf(src)[1]!
    expect({ line, folder: method.languageLine?.folder, folderInBody: method.tokens.some((t) => t.text === "FOLDER") }).toEqual({
      line,
      folder: "Sub/Deep",
      folderInBody: false,
    })
  }
})

test("a line sharing its line with END_VAR is no boundary", () => {
  const src = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR %LANGUAGE LD\n%NETWORK\nEND_FUNCTION_BLOCK\n"
  expect(bodiesOf(src).map((b) => b.languageLine)).toEqual([undefined])
  expect(syntaxErrors(src).length).toBeGreaterThan(0)
})

test("the line is taken out of the body: the code starts under it", () => {
  const body = bodiesOf(fb("%LANGUAGE ST\nout := a;"))[0]!
  expect(body.tokens.map((t) => t.text).join("").trim()).toBe("out := a;")
  expect(body.languageLine?.text).toBe("%LANGUAGE ST")
})

/** The line the format no longer reads is named where a body states none — the push's refusal, "pull again". */
test("the retired IMPLEMENTATION line is the hint of a body with no line", () => {
  const body = bodiesOf(fb("IMPLEMENTATION ST\nout := a;"))[0]!
  expect(body.languageLine).toBeUndefined()
  expect(retiredLine(body.tokens)).toBe("IMPLEMENTATION ST")
  expect(retiredLine(bodiesOf(fb("%LANGUAGE ST\nout := a;"))[0]!.tokens)).toBeUndefined()
})

// ── a member with no body slot (DIALECT C2n): no line, nothing after its declaration ──────────────────

const workspace = (src: string) => parseDocument("file:///w/FB_Base.pou", src, { networkText: true, unicodeIdentifiers: false }, "codesys")
const OWNER = "FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n"

test("a workspace METHOD and accessor with no line and nothing after the declaration have no body slot, and are clean", () => {
  const src =
    OWNER +
    "\nMETHOD ABSTRACT TakePicture : INT\n\n// must be overridden\n\n%FOLDER Commands\n%EXCLUDE_FROM_BUILD\nEND_METHOD\n" +
    "\nPROPERTY PUBLIC ABSTRACT Busy : BOOL\nGET\nVAR\nEND_VAR\nEND_GET\nEND_PROPERTY\n"
  const parsed = workspace(src)
  expect(parsed.errors).toEqual([])
  const [, method, getter] = parsed.units.flatMap(unitBodies)
  expect(method!.noSlot).toEqual({ folder: "Commands", objectProperties: ["%EXCLUDE_FROM_BUILD"] })
  expect(method!.tokens.some((t) => t.text === "%")).toBe(false)
  expect(getter!.noSlot).toEqual({})
  expect([method!.languageLine, getter!.languageLine]).toEqual([undefined, undefined])
})

/** Only where the push can take one (`BodyFormatGuard`): a CODESYS ABSTRACT METHOD, an accessor of a CODESYS ABSTRACT
 *  PROPERTY. A no-line member that is not ABSTRACT, and any on TwinCAT (whose abstract members have a slot), the push
 *  refuses — as a create ("only an abstract method is created without one") and as an update ("the line was lost") — so
 *  it states no language. */
test("a no-line member that is not ABSTRACT, or on TwinCAT, is no member without a slot", () => {
  const concrete = workspace(OWNER + "\nMETHOD Run : INT\nVAR\nEND_VAR\nEND_METHOD\n\nPROPERTY P : INT\nGET\nEND_GET\nEND_PROPERTY\n")
  expect(concrete.units.flatMap(unitBodies).map((b) => b.noSlot)).toEqual([undefined, undefined, undefined])
  const tc = parseDocument(
    "file:///w/FB_Base.pou",
    OWNER + "\nMETHOD ABSTRACT Run : INT\nEND_METHOD\n\nPROPERTY ABSTRACT P : INT\nGET\nEND_GET\nEND_PROPERTY\n",
    { networkText: true, unicodeIdentifiers: false },
    "twincat",
  )
  expect(tc.units.flatMap(unitBodies).map((b) => b.noSlot)).toEqual([undefined, undefined, undefined])
})

test("a workspace member with code and no line, a POU with no line, and the IDE's own text are no member without a slot", () => {
  const coded = workspace(OWNER + "\nMETHOD Run : BOOL\nRun := TRUE;\nEND_METHOD\n").units.flatMap(unitBodies)
  expect(coded[1]!.noSlot).toBeUndefined()
  const pou = workspace("FUNCTION_BLOCK F\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n").units.flatMap(unitBodies)
  expect(pou[0]!.noSlot).toBeUndefined()
  // A fixture or a library body is the IDE's text, which states no line anywhere: an empty method is an empty ST body.
  const ide = parseSource("FUNCTION_BLOCK F\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD M\nEND_METHOD\n", { networkText: true, unicodeIdentifiers: false }, "codesys")
  expect(ide.units.flatMap(unitBodies).map((b) => b.noSlot)).toEqual([undefined, undefined])
})
