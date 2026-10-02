/**
 * semantic-tokens: elementary type names (P2). `INT`/`BOOL`/… are not in the symbol table, so the classifier
 * fell through to `variable` — mis-coloring a type name as a variable on every file. They should be `type`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { semanticTokensData, SEMANTIC_TOKEN_TYPES } from "./semantic-tokens.js"

test("an elementary type name colors as `type`, not `variable`", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n\tn : INT;\n\tb : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true })
  const doc = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
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
  const doc = { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
  const project = build.buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }])
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
  const doc = { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
  const project = build.buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }])
  const data = semanticTokensData(doc as never, project)
  const lines = src.split("\n")
  const wires: string[] = []
  let line = 0
  let ch = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    if (data[i]! > 0) ch = 0
    ch += data[i + 1]!
    if (SEMANTIC_TOKEN_TYPES[data[i + 3]!] === "wire") wires.push(`${line}:${lines[line]!.slice(ch, ch + data[i + 2]!)}`)
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
