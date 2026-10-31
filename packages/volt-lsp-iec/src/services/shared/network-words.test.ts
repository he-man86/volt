/**
 * The network words (`network-words.ts`): what a plain-ST network body holds beyond ST — its `%` lines, the marks before a
 * receiver, `RAIL()` and the network's own boxes, the jump and the return as targets, the network's labels — coloured
 * (semantic tokens and `networkTokens`), offered (completion) and explained (hover), and never in a plain ST body.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { completion, hover } from "../assist/index.js"
import { networkTokens, SEMANTIC_TOKEN_TYPES, semanticTokensData } from "../structure/index.js"
import type { Document } from "./document.js"

const NETWORK = `PROGRAM P
VAR
\ta : BOOL; b : BOOL; c : BOOL; x : BOOL; y : BOOL; n : INT; t1 : TON;
END_VAR
%LANGUAGE LD
%NETWORK "first"
%DISABLED
l:
NOT y := a;
RISING NOT x := b;
t1(RISING IN := a, PT := T#1S, NOT Q => c);
MOVE(NOT EN := c, 1, OUT => n);
x := RAIL();
y := BRANCH(FEED := a, b, c);
y := BRANCH_SHORTCIRCUIT(FEED := a, b, c);
EXECUTE(EN := a, 'n := n + 1;');
x := RISING(a);
%NETWORK
m:
JMP.l := a;
RETURN := RAIL();
`

const PLAIN_ST = `PROGRAM Q
VAR
\ta : BOOL; x : BOOL;
END_VAR
x := NOT a;

END_PROGRAM
`

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///P.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

/** Each token as `"<text>@<line>:<col>" → type`, decoded from the delta stream. */
function colours(src: string): { text: string; line: number; col: number; type: string }[] {
  const { doc, project } = setup(src)
  const data = semanticTokensData(doc, project)
  const lines = src.split("\n")
  const out: { text: string; line: number; col: number; type: string }[] = []
  let line = 0
  let col = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    col = data[i]! > 0 ? data[i + 1]! : col + data[i + 1]!
    out.push({ text: lines[line]!.slice(col, col + data[i + 2]!), line, col, type: SEMANTIC_TOKEN_TYPES[data[i + 3]!]! })
  }
  return out
}

/** The type of the `nth` token spelled `text` on the source line holding `onLine`. */
function typeOf(src: string, onLine: string, text: string, nth = 0): string | undefined {
  const line = src.split("\n").findIndex((l) => l === onLine)
  if (line < 0) throw new Error(`no line ${onLine}`)
  return colours(src).filter((t) => t.line === line && t.text === text)[nth]?.type
}

describe("semantic tokens of a network body", () => {
  test("the %LANGUAGE, %NETWORK and %DISABLED lines are directives", () => {
    for (const [line, word] of [["%LANGUAGE LD", "LANGUAGE"], ['%NETWORK "first"', "NETWORK"], ["%DISABLED", "DISABLED"], ["%NETWORK", "NETWORK"]])
      expect([word, typeOf(NETWORK, line!, word!)]).toEqual([word, "keyword"])
    expect(typeOf(NETWORK, "%DISABLED", "%")).toBe("keyword")
  })

  test("a %UNSUPPORTED line is a directive", () => {
    const src = `PROGRAM P\n%LANGUAGE LD\n%NETWORK "Calc"\n%UNSUPPORTED "a shape" #929f3675\n`
    expect(typeOf(src, '%UNSUPPORTED "a shape" #929f3675', "UNSUPPORTED")).toBe("keyword")
  })

  test("a receiver's marks are keywords, stacked marks each, on a coil, a pin, EN and an output", () => {
    expect(typeOf(NETWORK, "NOT y := a;", "NOT")).toBe("keyword")
    expect(typeOf(NETWORK, "RISING NOT x := b;", "RISING")).toBe("keyword")
    expect(typeOf(NETWORK, "RISING NOT x := b;", "NOT")).toBe("keyword")
    expect(typeOf(NETWORK, "t1(RISING IN := a, PT := T#1S, NOT Q => c);", "RISING")).toBe("keyword")
    expect(typeOf(NETWORK, "t1(RISING IN := a, PT := T#1S, NOT Q => c);", "NOT")).toBe("keyword")
    expect(typeOf(NETWORK, "MOVE(NOT EN := c, 1, OUT => n);", "NOT")).toBe("keyword")
  })

  test("RAIL(), BRANCH, BRANCH_SHORTCIRCUIT, EXECUTE, OPERAND and a value's edge are functions", () => {
    expect(typeOf(NETWORK, "x := RAIL();", "RAIL")).toBe("function")
    expect(typeOf(NETWORK, "y := BRANCH(FEED := a, b, c);", "BRANCH")).toBe("function")
    expect(typeOf(NETWORK, "y := BRANCH_SHORTCIRCUIT(FEED := a, b, c);", "BRANCH_SHORTCIRCUIT")).toBe("function")
    expect(typeOf(NETWORK, "EXECUTE(EN := a, 'n := n + 1;');", "EXECUTE")).toBe("function")
    expect(typeOf(NETWORK, "x := RISING(a);", "RISING")).toBe("function")
    const operand = NETWORK.replace("x := RAIL();", "x := OPERAND('a AND b');")
    expect(typeOf(operand, "x := OPERAND('a AND b');", "OPERAND")).toBe("function")
  })

  test("JMP is a keyword and its label a label; RETURN as a target is a keyword; a network's label is a label", () => {
    expect(typeOf(NETWORK, "JMP.l := a;", "JMP")).toBe("keyword")
    expect(typeOf(NETWORK, "JMP.l := a;", "l")).toBe("label")
    expect(typeOf(NETWORK, "RETURN := RAIL();", "RETURN")).toBe("keyword")
    expect(typeOf(NETWORK, "l:", "l")).toBe("label")
    expect(typeOf(NETWORK, "m:", "m")).toBe("label")
  })

  test("the operands keep their own colour", () => {
    expect(typeOf(NETWORK, "NOT y := a;", "y")).toBe("variable")
    expect(typeOf(NETWORK, "x := RISING(a);", "a")).toBe("variable")
  })

  test("in a plain ST body nothing is a network word: a name RAIL or RISING is the variable it is", () => {
    const src = `PROGRAM Q\nVAR\n\trail : BOOL; rising : BOOL; x : BOOL;\nEND_VAR\nx := NOT rail;\nx := rising;\n\nEND_PROGRAM\n`
    expect(typeOf(src, "x := NOT rail;", "rail")).toBe("variable")
    expect(typeOf(src, "x := rising;", "rising")).toBe("variable")
  })
})

describe("networkTokens — the classification the bundle exports", () => {
  test("returns every classified token as {start, length, kind}, kind a semantic token type", () => {
    const tokens = networkTokens(NETWORK)
    const at = (word: string, from: string) => {
      const start = NETWORK.indexOf(from) + from.indexOf(word)
      return tokens.find((t) => t.start === start)
    }
    expect(at("RAIL", "x := RAIL();")).toEqual({ start: NETWORK.indexOf("x := RAIL();") + 5, length: 4, kind: "function" })
    expect(at("NOT", "NOT y := a;")?.kind).toBe("keyword")
    expect(at("l", "JMP.l := a;")?.kind).toBe("label")
    expect(at("y", "NOT y := a;")?.kind).toBe("variable")
    for (const t of tokens) expect(SEMANTIC_TOKEN_TYPES as readonly string[]).toContain(t.kind)
  })

  test("gives the same classification as the semantic tokens", () => {
    const fromStream = colours(NETWORK).map((c) => c.type)
    expect(networkTokens(NETWORK).map((t): string => t.kind)).toEqual(fromStream)
  })
})

describe("completion of the network words", () => {
  const at = (src: string, marker: string) => {
    const offset = src.indexOf(marker)
    const { doc, project } = setup(src.replace(marker, ""))
    return completion(doc, project, offset).map((i) => i.label)
  }

  test("before a receiver: the mark words", () => {
    const labels = at(NETWORK.replace("NOT y := a;", "NOT y := a;\n|"), "|")
    expect(labels).toEqual(expect.arrayContaining(["NOT", "RISING", "FALLING"]))
    const pin = at(NETWORK.replace("PT := T#1S", "|PT := T#1S"), "|")
    expect(pin).toEqual(expect.arrayContaining(["RISING", "FALLING"]))
  })

  test("after JMP. only the labels of this body", () => {
    expect(at(NETWORK.replace("JMP.l := a;", "JMP.| := a;"), "|").sort()).toEqual(["l", "m"])
  })

  test("where a value or a call can stand: RAIL() and the network's boxes", () => {
    const value = at(NETWORK.replace("x := RAIL();", "x := |"), "|")
    expect(value).toEqual(expect.arrayContaining(["RAIL()", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND"]))
    const statement = at(NETWORK.replace("NOT y := a;", "NOT y := a;\n|"), "|")
    expect(statement).toContain("EXECUTE")
  })

  test("never in a plain ST body", () => {
    const labels = at(PLAIN_ST.replace("x := NOT a;", "x := NOT a;\n|"), "|")
    for (const w of ["RISING", "FALLING", "RAIL()", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND"]) expect(labels).not.toContain(w)
  })
})

describe("hover on the network words: what each runs as, one line", () => {
  const hoverAt = (src: string, from: string, word: string) => {
    const { doc, project } = setup(src)
    const h = hover(doc, project, src.indexOf(from) + from.indexOf(word))
    return (h?.contents as { value: string } | undefined)?.value
  }

  test("RAIL() is the left rail", () => {
    expect(hoverAt(NETWORK, "x := RAIL();", "RAIL")).toBe("the left rail: TRUE")
  })

  test("a mark names its receiver", () => {
    expect(hoverAt(NETWORK, "t1(RISING IN := a", "RISING")).toBe("a rising-edge mark on the IN pin")
    expect(hoverAt(NETWORK, "NOT Q => c", "NOT")).toBe("a negation mark on the output Q")
    expect(hoverAt(NETWORK, "MOVE(NOT EN", "NOT")).toBe("a negation mark on EN")
    expect(hoverAt(NETWORK, "NOT y := a;", "NOT")).toBe("a negation mark on the coil y")
  })

  test("every other network word answers one line", () => {
    for (const [from, word] of [
      ["%DISABLED", "DISABLED"], ['%NETWORK "first"', "NETWORK"], ["y := BRANCH(", "BRANCH"], ["BRANCH_SHORTCIRCUIT(", "BRANCH_SHORTCIRCUIT"],
      ["EXECUTE(EN", "EXECUTE"], ["x := RISING(a)", "RISING"], ["JMP.l", "JMP"], ["JMP.l", "l"], ["RETURN := RAIL", "RETURN"], ["\nl:", "l"],
    ] as const) {
      const text = hoverAt(NETWORK, from, word)
      expect([from, typeof text]).toEqual([from, "string"])
      expect(text!.includes("\n")).toBe(false)
    }
  })

  test("NOT before a value in a plain ST body is not a mark", () => {
    expect(hoverAt(PLAIN_ST, "x := NOT a;", "NOT") ?? "").not.toContain("mark")
  })
})
