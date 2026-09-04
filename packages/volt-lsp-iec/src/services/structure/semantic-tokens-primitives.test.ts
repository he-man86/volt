/**
 * semantic-tokens: elementary type names (P2). `INT`/`BOOL`/… are not in the symbol table, so the classifier
 * fell through to `variable` — mis-coloring a type name as a variable on every file. They should be `type`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import { semanticTokensData, SEMANTIC_TOKEN_TYPES } from "./semantic-tokens.js"

test("an elementary type name colors as `type`, not `variable`", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n\tn : INT;\n\tb : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const doc = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  const data = semanticTokensData(doc, project) as number[]
  const types: string[] = []
  for (let i = 0; i < data.length; i += 5) types.push(SEMANTIC_TOKEN_TYPES[data[i + 3]]!)
  expect(types).toContain("type") // INT / BOOL
})

// ─── network-text keywords ────────────────────────────────────────────────────
// FBD/LD structure words are syntax of the sublanguage but not of ST, so the lexer returns them as plain
// identifiers. Nothing coloured them — not the TextMate grammar either — so `NETWORK 0 LD` and `END_NETWORK`
// rendered exactly like a variable in a real graphical POU.

const GRAPHICAL = `FUNCTION_BLOCK FB
VAR
\ta : BOOL; out : BOOL;
END_VAR

NETWORK 0 LD "A title" DISABLED
  LET g1 := a;
  out := g1 SET;
END_NETWORK

END_FUNCTION_BLOCK
`

/** token text → semantic type, for the tokens named in `of`. */
function typesOf(src: string, of: readonly string[]): Record<string, string> {
  const doc = { uri: "file:///FB.fb", source: src, parseResult: parseSource(src) }
  const project = buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }])
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
  const t = typesOf(GRAPHICAL, ["NETWORK", "END_NETWORK", "LD", "DISABLED", "LET"])
  expect(t).toEqual({
    NETWORK: "keyword",
    END_NETWORK: "keyword",
    LD: "keyword",
    DISABLED: "keyword",
    LET: "keyword",
  })
})

test("semantic tokens: operands inside a network still colour as what they are", () => {
  // The point is to colour the SYNTAX, not to repaint the body — `a`/`out` are still variables and the
  // wire `g1` is one too (it is a declaration the network makes).
  const t = typesOf(GRAPHICAL, ["a", "out", "g1", "SET"])
  expect(t.a).toBe("variable")
  expect(t.out).toBe("variable")
  expect(t.SET).toBe("keyword") // an ST keyword already — unchanged by this
})

test("semantic tokens: a declared name beats the keyword list", () => {
  // Resolution runs first, so a project that really has an FB called `Execute` still colours its calls as
  // that FB. Only an unresolvable structure word falls through to `keyword`.
  const src = `FUNCTION_BLOCK Outer
VAR
\tExecute : Inner;
END_VAR

NETWORK 0 FBD
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
