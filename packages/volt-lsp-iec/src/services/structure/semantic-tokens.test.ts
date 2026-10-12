/**
 * Semantic tokens (`semantic-tokens.ts`): 5-int tuples with valid type indices; an elementary type name colours as
 * `type`, not `variable` (P2), only in a dialect that has it; network-text structure words, operands and wires; a
 * declared name over the keyword list; comments line by line; and the implementation keyword line.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { semanticTokensData, SEMANTIC_TOKEN_TYPES } from "./semantic-tokens.js"
import { semanticTokens } from "./index.js"
import type { Document } from "../shared/index.js"

test("an elementary type name colors as `type`, not `variable`", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n\tn : INT;\n\tb : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true }, "codesys")
  const doc = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  const data = semanticTokensData(doc, project) as number[]
  const types: string[] = []
  for (let i = 0; i < data.length; i += 5) types.push(SEMANTIC_TOKEN_TYPES[data[i + 3]]!)
  expect(types).toContain("type") // INT / BOOL
})

// ─── network-text keywords ────────────────────────────────────────────────────
// FBD/LD structure words are syntax of the sublanguage but not of ST, so the lexer returns them as plain
// identifiers. Nothing coloured them — not the TextMate grammar either — so `NETWORK` and `END_NETWORK`
// rendered exactly like a variable in a real graphical POU.

const GRAPHICAL = `FUNCTION_BLOCK FB
VAR
\ta : BOOL; out : BOOL; g2 : BOOL; st : INT;
END_VAR
IMPLEMENTATION LD
NETWORK TITLE: "A title" DISABLED
  VAR_TEMP g1 : BOOL; END_VAR
  g1 := R_EDGE(a);
  out S= PARALLEL(IN := g1, g2, a);
  out := MOVE(EN := g1, 0, => st).ENO;
END_NETWORK

END_FUNCTION_BLOCK
`

/** token text → semantic type, for the tokens named in `of`. */
function typesOf(src: string, of: readonly string[]): Record<string, string> {
  const doc = { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }, "codesys") }
  const project = build.buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }], [], "codesys")
  const data = semanticTokensData(doc as never, project)
  const lines = src.split("\n")
  const out: Record<string, string> = {}
  let line = 0
  let ch = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    if (data[i]! > 0) ch = 0
    ch += data[i + 1]!
    const text = lines[line]!.slice(ch, ch + data[i + 2]!)
    if (of.includes(text)) out[text] = SEMANTIC_TOKEN_TYPES[data[i + 3]!]!
  }
  return out
}

test("semantic tokens: network structure words colour as keywords, not variables", () => {
  const t = typesOf(GRAPHICAL, ["NETWORK", "END_NETWORK", "TITLE", "DISABLED", "R_EDGE", "PARALLEL", "ENO"])
  expect(t).toEqual({
    NETWORK: "keyword",
    END_NETWORK: "keyword",
    TITLE: "keyword",
    DISABLED: "keyword",
    R_EDGE: "keyword",
    PARALLEL: "keyword",
    ENO: "keyword",
  })
})

test("semantic tokens: operands inside a network still colour as what they are", () => {
  // The point is to colour the SYNTAX, not to repaint the body — `a`/`out` are still variables, and `g2`, a
  // variable the POU declares that merely LOOKS like a wire, is one too.
  const t = typesOf(GRAPHICAL, ["a", "out", "g2", "VAR_TEMP"])
  expect(t.a).toBe("variable")
  expect(t.out).toBe("variable")
  expect(t.g2).toBe("variable")
  expect(t.VAR_TEMP).toBe("keyword") // an ST keyword already — unchanged by this
})

test("semantic tokens: a wire has its own class, resolved through its network's scope", () => {
  // openspec network-text-literal-nwl 5.3. A wire is a vendor Demux — a fan-out point on the drawing — declared in the
  // network's own VAR_TEMP block, so it resolves only there: the POU scope has no `g1`, and without the network scope
  // the classifier painted it a plain variable of nothing. Every occurrence gets the class: the declaration, the
  // definition and each reference.
  const src = GRAPHICAL
  const doc = { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }, "codesys") }
  const project = build.buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }], [], "codesys")
  const data = semanticTokensData(doc as never, project)
  const lines = src.split("\n")
  const wires: string[] = []
  let line = 0
  let ch = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    if (data[i]! > 0) ch = 0
    ch += data[i + 1]!
    if (SEMANTIC_TOKEN_TYPES[data[i + 3]!] === "wire")
      wires.push(`${line}:${lines[line]!.slice(ch, ch + data[i + 2]!)}`)
  }
  expect(wires).toEqual(["6:g1", "7:g1", "8:g1", "9:g1"])
})

test("semantic tokens: a declared name beats the keyword list", () => {
  // Resolution runs first, so a project that really has an FB called `Execute` still colours its calls as
  // that FB. Only an unresolvable structure word falls through to `keyword`.
  const src = `FUNCTION_BLOCK Outer
VAR
\tExecute : Inner;
END_VAR

IMPLEMENTATION FBD
NETWORK
  Execute(x := TRUE);
END_NETWORK

END_FUNCTION_BLOCK
FUNCTION_BLOCK Inner
VAR_INPUT x : BOOL; END_VAR
END_FUNCTION_BLOCK
`
  expect(typesOf(src, ["Execute"]).Execute).toBe("variable")
})

test("semantic tokens: a network word outside a graphical body is NOT a keyword", () => {
  // `NETWORK` is only syntax inside FBD/LD. In ordinary ST it is an ordinary name, and colouring it as
  // syntax there would be a lie about the language.
  const src = `PROGRAM P
VAR
\tNETWORK : INT;
END_VAR
NETWORK := 1;
END_PROGRAM
`
  expect(typesOf(src, ["NETWORK"]).NETWORK).toBe("variable")
})

// ─── one fact per dialect (lsp-same-standard 3.1, finding R4) ─────────────────
// The type colouring asked a dialect-blind predicate, so on TwinCAT `LDATE` — no TwinCAT type, "not defined" there —
// painted as a type name. What a name is comes from the project's dialect, the one fact every service reads.

/** The semantic-token type each occurrence of `word` gets, in `dialect`. */
function colourOf(src: string, word: string, dialect: "codesys" | "twincat"): string[] {
  const parseResult = parseSource(src, { networkText: true }, dialect)
  const doc = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], dialect)
  const data = semanticTokensData(doc, project)
  const out: string[] = []
  let line = 0
  let char = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    char = data[i] === 0 ? char + data[i + 1]! : data[i + 1]!
    const text = src.split("\n")[line]!.slice(char, char + data[i + 2]!)
    if (text === word) out.push(SEMANTIC_TOKEN_TYPES[data[i + 3]!]!)
  }
  return out
}

test("a type name the dialect lacks is not painted as a type", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n\td : LDATE;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(colourOf(src, "LDATE", "twincat")).toEqual(["variable"])
  expect(colourOf(src, "LDATE", "codesys")).not.toContain("variable")
})

// ─── a token never spans lines (lsp-same-standard 3.1, finding R12) ─────────────
// LSP allows a multi-line token only to a client stating `multilineTokenSupport`; VS Code states none. A block comment
// went out as ONE token of its whole length on its first line, so only that line was coloured as a comment.
test("a multi-line block comment is one comment token per line, each its own line's length", () => {
  const src = `PROGRAM P\n(* one\n   two *)\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true }, "codesys")
  const doc = { uri: "file:///P.pou", source: src, parseResult }
  const data = semanticTokensData(
    doc,
    build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys"),
  )
  const comments: number[][] = []
  let line = 0
  let char = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    char = data[i] === 0 ? char + data[i + 1]! : data[i + 1]!
    if (SEMANTIC_TOKEN_TYPES[data[i + 3]!] === "comment") comments.push([line, char, data[i + 2]!])
  }
  expect(comments).toEqual([
    [1, 0, "(* one".length],
    [2, 0, "   two *)".length],
  ])
})

describe("the whole-document pass", () => {
  function setup(src: string) {
    const parseResult = parseSource(src, { networkText: true }, "codesys")
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
    const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
    return { doc, project }
  }

  const SRC = `FUNCTION_BLOCK F
VAR
	i : INT;
	total : INT;
END_VAR
FOR i := 0 TO 10 DO
	total := total + i;
END_FOR
END_FUNCTION_BLOCK`

  test("semantic tokens: color network-text operand text (whole-doc pass covers graphical bodies)", () => {
    // A network text (LD) body's operands are ordinary lexer tokens, so the whole-document semantic pass colors them —
    // no network text-specific pass needed. Guards that graphical bodies produce valid tokens over their operand region.
    const src = `FUNCTION_BLOCK F
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
    const { doc, project } = setup(src)
    const { data } = semanticTokens(doc, project)
    expect(data.length % 5).toBe(0)
    // a token lands on the `out` operand line inside the network (line index 6, 0-based)
    let line = 0
    const lines: number[] = []
    for (let i = 0; i < data.length; i += 5) {
      line += data[i]! // deltaLine is cumulative in the LSP encoding
      lines.push(line)
    }
    expect(lines).toContain(6) // the `out := (a AND b);` operand line is tokenized
  })

  test("semantic tokens: emits 5-int tuples with valid type indices", () => {
    const { doc, project } = setup(SRC)
    const { data } = semanticTokens(doc, project)
    expect(data.length % 5).toBe(0)
    expect(data.length).toBeGreaterThan(0)
    // every emitted type index is within the legend
    for (let i = 3; i < data.length; i += 5) expect(data[i]).toBeLessThan(SEMANTIC_TOKEN_TYPES.length)
    // an identifier bound to a variable colors as "variable"; a keyword as "keyword"
    expect(SEMANTIC_TOKEN_TYPES).toContain("variable")
    expect(SEMANTIC_TOKEN_TYPES).toContain("keyword")
  })
})

describe("the implementation keyword", () => {
  /**
   * The implementation keyword in the structure services (openspec `implementation-keyword`): `IMPLEMENTATION` and the
   * language it states colour as keywords, and a body stated `LD`/`FBD` folds per NETWORK like any graphical body.
   */
  /** `line:text → semantic type` for every token on `lines`. */
  function typesOn(src: string, lines: readonly number[]): Record<string, string> {
    const doc = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }, "codesys") }
    const project = build.buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }], [], "codesys")
    const data = semanticTokensData(doc as never, project)
    const text = src.split("\n")
    const out: Record<string, string> = {}
    let line = 0
    let ch = 0
    for (let i = 0; i < data.length; i += 5) {
      line += data[i]!
      if (data[i]! > 0) ch = 0
      ch += data[i + 1]!
      if (lines.includes(line))
        out[`${line}:${text[line]!.slice(ch, ch + data[i + 2]!)}`] = SEMANTIC_TOKEN_TYPES[data[i + 3]!]!
    }
    return out
  }

  const ST_FB = `FUNCTION_BLOCK F
VAR
\tx : INT;
END_VAR
IMPLEMENTATION ST
x := 1;
END_FUNCTION_BLOCK
`

  const LD_FB = `FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
NETWORK
out := (a OR b);
END_NETWORK
END_FUNCTION_BLOCK`

  test("semantic tokens: IMPLEMENTATION and its stated language colour as keywords", () => {
    expect(typesOn(ST_FB, [4])).toEqual({ "4:IMPLEMENTATION": "keyword", "4:ST": "keyword" })
    expect(typesOn(LD_FB, [4])).toEqual({ "4:IMPLEMENTATION": "keyword", "4:LD": "keyword" })
    expect(typesOn(LD_FB.replace("IMPLEMENTATION LD", "IMPLEMENTATION FBD"), [4])).toEqual({
      "4:IMPLEMENTATION": "keyword",
      "4:FBD": "keyword",
    })
  })

  test("semantic tokens: the body after IMPLEMENTATION ST still colours as ST", () => {
    expect(typesOn(ST_FB, [5])["5:x"]).toBe("variable")
  })

  test("semantic tokens: an UNSUPPORTED line colours every word it states, and a look-alike in a comment none", () => {
    const ro = ST_FB.replace("IMPLEMENTATION ST\nx := 1;", "IMPLEMENTATION LD UNSUPPORTED\n")
    expect(typesOn(ro, [4])).toEqual({ "4:IMPLEMENTATION": "keyword", "4:LD": "keyword", "4:UNSUPPORTED": "keyword" })
    const commented = ST_FB.replace("END_VAR\n", "END_VAR\n// IMPLEMENTATION LD\n")
    expect(typesOn(commented, [4])).toEqual({ "4:// IMPLEMENTATION LD": "comment" })
  })
})
