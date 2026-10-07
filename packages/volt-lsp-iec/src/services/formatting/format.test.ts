import { test, expect } from "bun:test"
import { type ParseResult, parseDocument, parseSource, sourceStatements } from "../../frontend/syntax/index.js"
import { formatDocument, formatOnType, formatRange } from "../index.js"
import type { Document } from "../shared/index.js"

/**
 * Normalize a parse result to a span-free / token-free shape, embedding each body's PARSED statement
 * tree so body content is compared too. This is the `parse(format(x)) ≡ parse(x)` (A.3) equivalence.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (obj.kind === "body") {
      // The body's `IMPLEMENTATION` line and a member's `%FOLDER` under it are compared too: they are out of the body's
      // tokens, so a gate that looked at the statements alone passed a printer that deleted both from every file. So is
      // what stands between the declaration and the line (`leading`), which is out of the tokens for the same reason — its
      // line endings are layout, which the printer writes as `\n`.
      const line = (obj as { implementation?: { statement: unknown; folder?: string; leading?: string } }).implementation
      return {
        kind: "body",
        implementation: line === undefined ? undefined : { statement: line.statement, folder: line.folder, leading: line.leading?.replace(/\r\n/g, "\n") },
        statements: normalize(sourceStatements(obj as never).statements), // as written: every conditional branch
      }
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
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
  const formatted = formatDocument(doc)
  astEqual(doc.parseResult, parseSource(formatted, { networkText: true }))
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
  expect(formatDocument({ uri: "file:///P.pou", source: src, parseResult: parseSource(src, { networkText: true }) })).toContain("Lib.DrawerFB(instanceNo := 1, moduleParent := 0)")
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
	sx : INT;
END_VAR
IF sx > 0 THEN
	sx := 1;
ELSIF sx < 0 THEN
	sx := 2;
ELSE
	sx := 0;
END_IF
CASE sx OF
	1: i := 1;
	2..4: i := 2;
ELSE
	i := 0;
END_CASE
FOR i := 0 TO 10 BY 2 DO
	sx := sx + i;
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
  const once = formatDocument({ uri: "u", source: src, parseResult: parseSource(src, { networkText: true }) })
  const twice = formatDocument({ uri: "u", source: once, parseResult: parseSource(once, { networkText: true }) })
  expect(twice).toBe(once)
})

test("editorconfig: insertSpaces converts leading tabs to spaces", () => {
  const src = `FUNCTION_BLOCK F
VAR
	a : INT;
END_VAR
END_FUNCTION_BLOCK`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src, { networkText: true }) }
  const spaced = formatDocument(doc, { insertSpaces: true, tabSize: 4 })
  expect(spaced).toContain("    a : INT;") // 4 spaces, no tab
  expect(spaced).not.toContain("\t")
  // still round-trips (indentation style doesn't change the AST)
  expect(parseSource(spaced, { networkText: true }).errors).toEqual([])
})

test("range formatting: only units intersecting the range are edited", () => {
  const src = `FUNCTION_BLOCK A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B\nEND_FUNCTION_BLOCK`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src, { networkText: true }) }
  // range covering only the first unit (lines 0-1)
  const edits = formatRange(doc, { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })
  expect(edits).toHaveLength(1)
  expect(edits[0]?.newText).toContain("FUNCTION_BLOCK A")
})

test("on-type formatting: a newline inside a block indents to its depth", () => {
  const src = `PROGRAM P\nFOR i := 0 TO 10 DO\n\nEND_FOR\nEND_PROGRAM`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src, { networkText: true }) }
  const edits = formatOnType(doc, { line: 2, character: 0 }, "\n") // the empty line inside FOR
  expect(edits).toHaveLength(1)
  expect(edits[0]?.newText).toBe("\t") // one level deep
  // outside any block → no indent edit
  expect(formatOnType(doc, { line: 0, character: 0 }, "\n")).toEqual([])
})

test("on-type formatting: a block in a conditional branch the LSP cannot decide indents to its depth too", () => {
  const src = `PROGRAM P\n{IF defined (IsSimulationMode)}\nFOR i := 0 TO 10 DO\n\nEND_FOR\n{END_IF}\nEND_PROGRAM`
  const doc: Document = { uri: "u", source: src, parseResult: parseSource(src, { networkText: true }) }
  expect(formatOnType(doc, { line: 3, character: 0 }, "\n").map((e) => e.newText)).toEqual(["\t"])
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
  const out = formatDocument({ uri: "u", source: src, parseResult: parseSource(src, { networkText: true }) })
  expect(out).toContain("REFERENCE TO UDINT REF= v")
  expect(out).not.toContain("REFERENCE TO UDINT := v")
  // and the ordinary initializer is untouched
  expect(out).toContain("v : UDINT := 7")
  // the round-trip the corpus gate makes over every file
  expect(normalize(parseSource(out, { networkText: true }).units)).toEqual(normalize(parseSource(src, { networkText: true }).units))
})

/**
 * THE `IMPLEMENTATION` LINE AND A MEMBER'S `%FOLDER` SURVIVE FORMATTING. Both stand OUTSIDE a body's tokens (the line
 * is no code in any language, and the folder is metadata under it), so a printer that rebuilt a body from its tokens
 * alone deleted them: an LD body lost the line that states its language and read as ST, every rung a parse error, and
 * a member lost its folder, which the next push then took for "no folder" and moved the member to the POU's root.
 */
test("formatting keeps every body's IMPLEMENTATION line, and a member's %FOLDER under it", () => {
  const cases: Record<string, { src: string; kept: string[] }> = {
    "an ST function block": {
      src: "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := x + 1;\nEND_FUNCTION_BLOCK\n",
      kept: ["END_VAR\nIMPLEMENTATION ST\nx := x + 1;\n"],
    },
    "a ladder": {
      src: "FUNCTION_BLOCK G\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\nIMPLEMENTATION LD\nNETWORK\n  out := a;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n",
      kept: ["END_VAR\nIMPLEMENTATION LD\nNETWORK\n  out := a;\nEND_NETWORK\n"],
    },
    "a method in a folder": {
      src: "METHOD M : INT\nIMPLEMENTATION ST\n%FOLDER Sub/Deep\nM := 1;\nEND_METHOD\n",
      kept: ["IMPLEMENTATION ST\n%FOLDER Sub/Deep\nM := 1;\n"],
    },
    "an action in a folder": {
      src: "ACTION A\nIMPLEMENTATION ST\n%FOLDER Sub\nx := 1;\nEND_ACTION\n",
      kept: ["ACTION A\nIMPLEMENTATION ST\n%FOLDER Sub\nx := 1;\n"],
    },
    "a hidden member in a folder": {
      src: "METHOD Chart\nIMPLEMENTATION CFC UNSUPPORTED\n%FOLDER Sub\nEND_METHOD\n",
      kept: ["METHOD Chart\nIMPLEMENTATION CFC UNSUPPORTED\n%FOLDER Sub\nEND_METHOD"],
    },
    "a property's accessors": {
      src: "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nSET\nIMPLEMENTATION FBD UNSUPPORTED\nEND_SET\nEND_PROPERTY\n",
      kept: ["IMPLEMENTATION ST\nP := 1;\nEND_GET","IMPLEMENTATION FBD UNSUPPORTED\nEND_SET"],
    },
  }
  for (const [name, { src, kept }] of Object.entries(cases)) {
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
    const out = formatDocument(doc)
    for (const k of kept) expect({ name, out, kept: out.includes(k) }).toEqual({ name, out, kept: true })
    astEqual(doc.parseResult, parseSource(out, { networkText: true }))
    // Range formatting prints the same units.
    const ranged = formatRange(doc, { start: { line: 0, character: 0 }, end: { line: src.split("\n").length - 1, character: 0 } })
    for (const k of kept)
      expect({ name, kept: ranged.some((e) => e.newText.includes(k)) }).toEqual({ name, kept: true })
  }
})

/**
 * A PROPERTY'S AND AN INTERFACE MEMBER'S `%FOLDER` SURVIVE FORMATTING, AND SO DO AN INTERFACE MEMBER'S MODIFIERS. A
 * property and an interface member have no body to stand a folder under, so the push reads their folder as the LAST
 * line of their declaration (`StReader.PeelFolderClosing`) — which the parser skipped and the printer then could not
 * print. The next push read "no folder" and moved the member to the POU's root. `PUBLIC` on an interface member was
 * eaten the same way. pro2193's `IIMM_Default_XYControl.itf` has exactly this shape.
 */
test("formatting keeps a property's and an interface member's %FOLDER, and an interface member's modifiers", () => {
  const cases: Record<string, { src: string; kept: string[]; gone: string[] }> = {
    "a property in a folder": {
      src:
        "FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n\n" +
        "PROPERTY P : INT\n%FOLDER sub/dir\nGET\nIMPLEMENTATION ST\nP := x;\nEND_GET\nEND_PROPERTY\n",
      kept: ["PROPERTY P : INT\n%FOLDER sub/dir\nGET\nIMPLEMENTATION ST\nP := x;\nEND_GET\nEND_PROPERTY"],
      // An accessor with no VAR section gained a blank line under its keyword — which the push keeps as the
      // accessor's (a leading newline is the engineer's blank line, `StWriter.AssembleAccessor`).
      gone: ["GET\n\n"],
    },
    "an interface's members in folders": {
      src:
        "INTERFACE I\n\nMETHOD PUBLIC M : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n%FOLDER Commands\nEND_METHOD\n\n" +
        "PROPERTY PUBLIC Q : INT\n%FOLDER Props\nGET\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n",
      kept: ["METHOD PUBLIC M : BOOL\n", "END_VAR\n%FOLDER Commands\n\tEND_METHOD", "PROPERTY PUBLIC Q : INT\n%FOLDER Props\n"],
      gone: [],
    },
  }
  for (const [name, { src, kept, gone }] of Object.entries(cases)) {
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
    expect({ name, errors: doc.parseResult.errors }).toEqual({ name, errors: [] })
    const out = formatDocument(doc)
    for (const k of kept) expect({ name, out, kept: out.includes(k) }).toEqual({ name, out, kept: true })
    for (const g of gone) expect({ name, out, gone: !out.includes(g) }).toEqual({ name, out, gone: true })
    astEqual(doc.parseResult, parseSource(out, { networkText: true }))
  }
})

/**
 * A CRLF FILE GAINS NO BLANK LINE UNDER ITS `IMPLEMENTATION` LINE. The line's own newline token opens the body's tokens,
 * and a verbatim body stripped only a leading `\n` — so a `\r\n` stayed, under the `\n` the head already printed: a blank
 * line the push writes into the IDE body (a leading newline is the engineer's), and a file of mixed line endings.
 */
test("formatting a CRLF file adds no blank line under the IMPLEMENTATION line or a member's %FOLDER", () => {
  const cases = {
    "a ladder": "FUNCTION_BLOCK F\r\nVAR\r\n\tx : BOOL;\r\nEND_VAR\r\nIMPLEMENTATION LD\r\nNETWORK\r\n  x := TRUE;\r\nEND_NETWORK\r\nEND_FUNCTION_BLOCK\r\n",
    "a ladder method in a folder": "METHOD M\r\nIMPLEMENTATION LD\r\n%FOLDER a\r\nNETWORK\r\n  M := TRUE;\r\nEND_NETWORK\r\nEND_METHOD\r\n",
    "a commented ST body": "FUNCTION_BLOCK F\r\nVAR\r\n\tx : INT;\r\nEND_VAR\r\nIMPLEMENTATION ST\r\n// c\r\nx := 1;\r\nEND_FUNCTION_BLOCK\r\n",
  }
  for (const [name, src] of Object.entries(cases)) {
    const out = formatDocument({ uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) })
    expect({ name, out, blankLine: /(IMPLEMENTATION [A-Z]+|%FOLDER a)\r?\n\r?\n/.test(out), cr: out.includes("\r") }).toEqual({
      name,
      out,
      blankLine: false,
      cr: false,
    })
  }
})

/**
 * WHAT STANDS BETWEEN A DECLARATION AND ITS `IMPLEMENTATION` LINE SURVIVES FORMATTING. It is declaration text on the
 * push side — a `{warning}` or `{attribute}` pragma means something there — and it is neither code nor the line, so
 * the body splitter set it aside and nothing printed it back.
 */
test("formatting keeps a comment or pragma between the declaration and the IMPLEMENTATION line", () => {
  for (const between of ["{warning 'keep'}", "// keep me", "(* keep me *)"]) {
    const src = `FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\n${between}\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n`
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
    const out = formatDocument(doc)
    expect({ between, out, kept: out.includes(`END_VAR\n${between}\nIMPLEMENTATION ST\n`) }).toEqual({ between, out, kept: true })
    astEqual(doc.parseResult, parseSource(out, { networkText: true }))
  }
})

test("formatting keeps a declaration the parser refused, on either vendor (`__VECTOR` on TwinCAT, a keyword type)", () => {
  // A refused declaration leaves no node, so a unit reprinted from its AST DELETED the user's line: `v : __VECTOR[4] OF
  // REAL;` on TwinCAT (task 2.1.4 refuses the word there, `lex_vector_twincat`) and `v : final;` on either. A unit the
  // parse refused anything inside is kept as written — the rule an unparseable body already follows.
  const cases: [string, "codesys" | "twincat"][] = [
    ["\tv : __VECTOR[4] OF REAL;", "twincat"],
    ["\tv : final;", "codesys"],
  ]
  for (const [decl, dialect] of cases) {
    const src = `FUNCTION_BLOCK FB\nVAR\n${decl}\n\tn : INT;\nEND_VAR\nn := 1;\nEND_FUNCTION_BLOCK\n`
    const doc: Document = { uri: "file:///x/FB.pou", source: src, parseResult: parseDocument("file:///x/FB.pou", src, { networkText: true }, dialect) }
    expect(doc.parseResult.errors.length).toBeGreaterThan(0)
    expect({ dialect, whole: formatDocument(doc) }).toEqual({ dialect, whole: src })
    const range = { start: { line: 0, character: 0 }, end: { line: 7, character: 0 } }
    expect({ dialect, edits: formatRange(doc, range) }).toEqual({ dialect, edits: [] })
  }
})

test("formatting keeps a `__VECTOR` as a vector, with its size or without", () => {
  for (const decl of ["v : __VECTOR[4] OF REAL;", "v : __VECTOR[] OF REAL;"]) {
    const src = `FUNCTION_BLOCK FB\nVAR\n\t${decl}\nEND_VAR\nEND_FUNCTION_BLOCK\n`
    const out = formatDocument({ uri: "file:///x/FB.pou", source: src, parseResult: parseDocument("file:///x/FB.pou", src, { networkText: true }, "codesys") })
    expect(out).toContain(decl)
  }
})

// `decl_bracket_init_no_assign_fb` (both vendors 2026-10-01): a `[…]` list straight after an FB array's type, with no
// `:=`, passes each element's `(…)` to its FB_Init. `:= [(…), (…)]` is a structured initialization of the inputs — another
// declaration to the vendor — so the formatter writes the form back as it was, operator-less.
test("formatting keeps an FB array's bracket list without `:=`", () => {
  const src = "PROGRAM P\nVAR\n\tfbs : ARRAY[0..1] OF FB_X [(x := 1), (x := 2)];\n\tn : INT;\nEND_VAR\nn := 1;\nEND_PROGRAM\n"
  const doc: Document = { uri: "file:///x/P.pou", source: src, parseResult: parseDocument("file:///x/P.pou", src, { networkText: true }) }
  expect(doc.parseResult.errors).toEqual([])
  const out = formatDocument(doc)
  expect(out).not.toContain(":= [")
  expect(out).toContain("fbs : ARRAY[0..1] OF FB_X [")
  expect(parseSource(out, { networkText: true }).units[0]).toMatchObject({ varSections: [{ decls: [{ initOp: "FB_Init" }, {}] }] })
})

// conformance 2.4 (`fixtures/grammar/units.ts`): the printer wrote a header from flags in a fixed order and dropped what
// a check refuses — so formatting reordered `FINAL PUBLIC`-style modifiers, moved a STRUCT's EXTENDS to where both vendors
// refuse it, and deleted a FUNCTION's IMPLEMENTS, a PROGRAM's return type, an FB's second base, a TYPE's initializer and
// an interface accessor's VAR sections.
test("roundtrip: every header clause as written — modifier order, a refused clause, a qualified base", () => {
  roundtrips(`FUNCTION_BLOCK INTERNAL FINAL FB_X EXTENDS Standard.TON, Other IMPLEMENTS __SYSTEM.IQueryInterface
VAR
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK
METHOD PROTECTED FINAL ABSTRACT Step : BOOL
Step := TRUE;
END_METHOD`)
  roundtrips(`FUNCTION F EXTENDS B IMPLEMENTS I : INT
VAR_INPUT
	x : INT;
END_VAR
F := x;
END_FUNCTION`)
  roundtrips(`PROGRAM P : BOOL
VAR
	n : INT;
END_VAR
n := 1;
END_PROGRAM`)
  // analysis-conformance 3.4 (`hdr_fb_return_type`, C0182 on both vendors): the parser reads an FB's return type since,
  // so the header is reprinted from the AST rather than kept as a refused unit — the printer must write it back.
  roundtrips(`FUNCTION_BLOCK FB_X : INT EXTENDS Base
VAR
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK`)
})

test("roundtrip: a TYPE's EXTENDS stays on the TYPE line, and its initializer stays", () => {
  const src = `TYPE S EXTENDS Base :
STRUCT
	x : INT;
END_STRUCT
END_TYPE`
  roundtrips(src)
  const doc: Document = { uri: "file:///S.dut", source: src, parseResult: parseSource(src, { networkText: true }) }
  expect(formatDocument(doc)).toContain("TYPE S EXTENDS Base :\nSTRUCT\n")
  roundtrips(`TYPE A EXTENDS S : INT := 5;
END_TYPE`)
  roundtrips(`TYPE E : (Red, Green) DINT := Green;
END_TYPE`)
})

test("roundtrip: an interface's IMPLEMENTS and its accessors' VAR sections", () => {
  roundtrips(`INTERFACE I2 IMPLEMENTS I1
PROPERTY Level : INT
GET
VAR
	scratch : INT;
END_VAR
END_GET
SET
END_PROPERTY
END_INTERFACE`)
})

test("roundtrip: an FB header the vendor refuses keeps every modifier as written", () => {
  // `unit_fb_final_public_order`: no message on either vendor, so the unit is reprinted — and must not lose `PUBLIC`
  roundtrips(`FUNCTION_BLOCK FINAL PUBLIC FB_X
VAR
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK`)
})

test("roundtrip: a NAMESPACE with no END_NAMESPACE is printed without one", () => {
  // `unit_namespace_opening_only`: the keyword line alone is a text the push hands the IDE (which declares nothing and
  // says nothing). The printer closed it with an END_NAMESPACE nobody wrote — a line the push then refuses.
  const src = `NAMESPACE NS
FUNCTION_BLOCK F
VAR
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK`
  roundtrips(src)
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
  expect(formatDocument(doc)).not.toContain("END_NAMESPACE")
})
