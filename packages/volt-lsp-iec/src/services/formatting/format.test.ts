import { test, expect } from "bun:test"
import { type Document, type ParseResult, parseSource, parseStatements } from "../../syntax/index.js"
import { formatDocument, formatOnType, formatRange } from "../index.js"

/**
 * Normalize a parse result to a span-free / token-free shape, embedding each body's PARSED statement
 * tree so body content is compared too. This is the `parse(format(x)) ≡ parse(x)` (A.3) equivalence.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (obj.kind === "body") {
      return { kind: "body", statements: normalize(parseStatements(obj as never).statements) }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === "span" || k === "tokens") continue
      out[k] = normalize(v)
    }
    return out
  }
  return value
}

function astEqual(a: ParseResult, b: ParseResult): void {
  expect(b.errors).toEqual([]) // the formatted output must re-parse cleanly
  expect(normalize(b.units)).toEqual(normalize(a.units))
}

function roundtrips(src: string): void {
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult: parseSource(src) }
  const formatted = formatDocument(doc)
  astEqual(doc.parseResult, parseSource(formatted))
}

test("roundtrip: an instance's FB_Init arguments survive formatting", () => {
  // `inst : FB(x := 1)` passes FB_Init its arguments (conformance `fb_init_runs_with_declared_arguments`). The parser dropped
  // them and `renderTypeExpr` printed the bare type, so formatting DELETED them from the user's file — unseen by the
  // round-trip gate while the AST held nothing to compare. pro2193 declares 29 files of such instances.
  const src = `PROGRAM P
VAR
	sensor : DigitalSensorFB(invert := TRUE);
	drawer : Lib.DrawerFB(instanceNo := 1, moduleParent := 0);
END_VAR
END_PROGRAM
`
  roundtrips(src)
  expect(formatDocument({ uri: "file:///P.prg", source: src, parseResult: parseSource(src) })).toContain("Lib.DrawerFB(instanceNo := 1, moduleParent := 0)")
})

test("roundtrip: a mixed set/reset chain keeps each link's operator", () => {
  // `print.ts` printed the FIRST operator for every link, believing set/reset ops never chain — so formatting
  // `a S= b R= c` would have written `a S= b S= c` back to the user's file. No test ever formatted a chain.
  roundtrips(`PROGRAM P
VAR
	a : BOOL;
	b : BOOL;
	c : BOOL;
END_VAR
a S= b R= c;
a := b := c;
END_PROGRAM`)
})

test("roundtrip: FB with var sections + assignments + arithmetic", () => {
  roundtrips(`FUNCTION_BLOCK F
VAR
	a : INT := 5;
	b : REAL;
END_VAR
a := a + 1;
b := 2.0 * 3.0;
END_FUNCTION_BLOCK`)
})

test("roundtrip: control flow (IF / CASE / FOR / WHILE / REPEAT)", () => {
  roundtrips(`FUNCTION_BLOCK F
VAR
	i : INT;
	s : INT;
END_VAR
IF s > 0 THEN
	s := 1;
ELSIF s < 0 THEN
	s := 2;
ELSE
	s := 0;
END_IF
CASE s OF
	1: i := 1;
	2..4: i := 2;
ELSE
	i := 0;
END_CASE
FOR i := 0 TO 10 BY 2 DO
	s := s + i;
END_FOR
WHILE i > 0 DO
	i := i - 1;
END_WHILE
REPEAT
	i := i + 1;
UNTIL i > 5
END_REPEAT
END_FUNCTION_BLOCK`)
})

test("roundtrip: FB modifiers, EXTENDS, IMPLEMENTS + a method", () => {
  roundtrips(`FUNCTION_BLOCK PUBLIC FB_X EXTENDS Base IMPLEMENTS IA, IB
VAR
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK
METHOD PUBLIC Step : BOOL
VAR_INPUT
	arg : INT;
END_VAR
Step := TRUE;
END_METHOD`)
})

test("roundtrip: type declarations (struct / enum / alias)", () => {
  roundtrips(`TYPE Pt :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE`)
  roundtrips(`TYPE Color : (Red, Green := 10, Blue) DINT;
END_TYPE`)
  roundtrips(`TYPE MyInt : INT;
END_TYPE`)
})

test("roundtrip: interface + member call", () => {
  roundtrips(`FUNCTION_BLOCK FB_A
VAR
	inst : FB_A;
END_VAR
inst.Step(arg := 1);
END_FUNCTION_BLOCK`)
})

test("format is idempotent (format(format(x)) == format(x))", () => {
  const src = `FUNCTION_BLOCK F
VAR
	a : INT;
END_VAR
a := a + 1;
END_FUNCTION_BLOCK`
  const once = formatDocument({ uri: "u", source: src, parseResult: parseSource(src) })
  const twice = formatDocument({ uri: "u", source: once, parseResult: parseSource(once) })
  expect(twice).toBe(once)
})

test("editorconfig: insertSpaces converts leading tabs to spaces", () => {
  const src = `FUNCTION_BLOCK F
VAR
	a : INT;
END_VAR
END_FUNCTION_BLOCK`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src) }
  const spaced = formatDocument(doc, { insertSpaces: true, tabSize: 4 })
  expect(spaced).toContain("    a : INT;") // 4 spaces, no tab
  expect(spaced).not.toContain("\t")
  // still round-trips (indentation style doesn't change the AST)
  expect(parseSource(spaced).errors).toEqual([])
})

test("range formatting: only units intersecting the range are edited", () => {
  const src = `FUNCTION_BLOCK A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B\nEND_FUNCTION_BLOCK`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src) }
  // range covering only the first unit (lines 0-1)
  const edits = formatRange(doc, { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })
  expect(edits).toHaveLength(1)
  expect(edits[0]?.newText).toContain("FUNCTION_BLOCK A")
})

test("on-type formatting: a newline inside a block indents to its depth", () => {
  const src = `PROGRAM P\nFOR i := 0 TO 10 DO\n\nEND_FOR\nEND_PROGRAM`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src) }
  const edits = formatOnType(doc, { line: 2, character: 0 }, "\n") // the empty line inside FOR
  expect(edits).toHaveLength(1)
  expect(edits[0]?.newText).toBe("\t") // one level deep
  // outside any block → no indent edit
  expect(formatOnType(doc, { line: 0, character: 0 }, "\n")).toEqual([])
})

/**
 * A DECLARATION'S OPERATOR IS PART OF ITS MEANING. `r : REFERENCE TO T REF= x` BINDS the reference to `x`;
 * `r : REFERENCE TO T := x` stores `x` through a reference nothing bound. The printer emitted `:=` for both,
 * because the AST recorded neither — so formatting a real file silently rewrote the engineer's bind.
 *
 * It went unnoticed for as long as the operator was dropped at parse time: with nothing to compare, the corpus
 * round-trip gate (`parse(format(x)) ≡ parse(x)`) saw two identical ASTs. Recording `initOp` on 2026-09-20 made
 * it fail on three real files immediately.
 */
test("formatting keeps a declaration's REF=, which is a bind and not an assignment", () => {
  const src = `PROGRAM P\nVAR\n\tv : UDINT := 7;\n\tr : REFERENCE TO UDINT REF= v;\nEND_VAR\nr := 1;\nEND_PROGRAM\n`
  const out = formatDocument({ uri: "u", source: src, parseResult: parseSource(src) })
  expect(out).toContain("REFERENCE TO UDINT REF= v")
  expect(out).not.toContain("REFERENCE TO UDINT := v")
  // and the ordinary initializer is untouched
  expect(out).toContain("v : UDINT := 7")
  // the round-trip the corpus gate makes over every file
  expect(normalize(parseSource(out).units)).toEqual(normalize(parseSource(src).units))
})
