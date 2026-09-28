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
