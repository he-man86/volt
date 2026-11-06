/**
 * The network words (`network-words.ts`): what a plain-ST network body holds beyond ST — its `%` lines, `ASSIGN` and its
 * outputs, the marks `INVERT`, `RISING`, `FALLING`, `RAIL()` and the network's own boxes, the jump and the return as
 * targets, the network's labels — coloured (semantic tokens and `networkTokens`), offered (completion) and explained
 * (hover), never resolved as symbols, and never in a plain ST body.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { completion, hover } from "../assist/index.js"
import { definition, documentHighlights } from "../navigation/index.js"
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
ASSIGN(a, Q_INVERTED => y);
ASSIGN(INVERT(b), Q_SET => x, Q_RESET => y);
t1(IN := RISING(a), PT := T#1S);
MOVE(EN := INVERT(c), 1, OUT => n);
ASSIGN(RAIL(), Q => x);
ASSIGN(BRANCH(FEED := a, b, c), Q => y);
ASSIGN(BRANCH_SHORTCIRCUIT(FEED := a, b, c), Q => y);
EXECUTE(EN := a, 'n := n + 1;');
ASSIGN(FALLING(a), Q => x);
%NETWORK
m:
ASSIGN(a, Q => JMP.l);
ASSIGN(RAIL(), Q => RETURN);
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

  test("ASSIGN and the marks are functions, ASSIGN's outputs keywords: on a coil, a pin and EN", () => {
    expect(typeOf(NETWORK, "ASSIGN(INVERT(b), Q_SET => x, Q_RESET => y);", "ASSIGN")).toBe("function")
    expect(typeOf(NETWORK, "ASSIGN(INVERT(b), Q_SET => x, Q_RESET => y);", "INVERT")).toBe("function")
    expect(typeOf(NETWORK, "ASSIGN(INVERT(b), Q_SET => x, Q_RESET => y);", "Q_SET")).toBe("keyword")
    expect(typeOf(NETWORK, "ASSIGN(INVERT(b), Q_SET => x, Q_RESET => y);", "Q_RESET")).toBe("keyword")
    expect(typeOf(NETWORK, "ASSIGN(a, Q_INVERTED => y);", "Q_INVERTED")).toBe("keyword")
    expect(typeOf(NETWORK, "t1(IN := RISING(a), PT := T#1S);", "RISING")).toBe("function")
    expect(typeOf(NETWORK, "MOVE(EN := INVERT(c), 1, OUT => n);", "INVERT")).toBe("function")
  })

  test("RAIL(), BRANCH, BRANCH_SHORTCIRCUIT, EXECUTE, OPERAND and a value's edge are functions", () => {
    expect(typeOf(NETWORK, "ASSIGN(RAIL(), Q => x);", "RAIL")).toBe("function")
    expect(typeOf(NETWORK, "ASSIGN(BRANCH(FEED := a, b, c), Q => y);", "BRANCH")).toBe("function")
    expect(typeOf(NETWORK, "ASSIGN(BRANCH_SHORTCIRCUIT(FEED := a, b, c), Q => y);", "BRANCH_SHORTCIRCUIT")).toBe("function")
    expect(typeOf(NETWORK, "EXECUTE(EN := a, 'n := n + 1;');", "EXECUTE")).toBe("function")
    expect(typeOf(NETWORK, "ASSIGN(FALLING(a), Q => x);", "FALLING")).toBe("function")
    const operand = NETWORK.replace("ASSIGN(RAIL(), Q => x);", "ASSIGN(OPERAND('a AND b'), Q => x);")
    expect(typeOf(operand, "ASSIGN(OPERAND('a AND b'), Q => x);", "OPERAND")).toBe("function")
  })

  test("JMP is a keyword and its label a label; RETURN as a target is a keyword; a network's label is a label", () => {
    expect(typeOf(NETWORK, "ASSIGN(a, Q => JMP.l);", "JMP")).toBe("keyword")
    expect(typeOf(NETWORK, "ASSIGN(a, Q => JMP.l);", "l")).toBe("label")
    expect(typeOf(NETWORK, "ASSIGN(RAIL(), Q => RETURN);", "RETURN")).toBe("keyword")
    expect(typeOf(NETWORK, "l:", "l")).toBe("label")
    expect(typeOf(NETWORK, "m:", "m")).toBe("label")
  })

  test("the operands keep their own colour", () => {
    expect(typeOf(NETWORK, "ASSIGN(a, Q_INVERTED => y);", "y")).toBe("variable")
    expect(typeOf(NETWORK, "ASSIGN(FALLING(a), Q => x);", "a")).toBe("variable")
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
    expect(at("RAIL", "ASSIGN(RAIL(), Q => x);")).toEqual({ start: NETWORK.indexOf("ASSIGN(RAIL(), Q => x);") + 7, length: 4, kind: "function" })
    expect(at("INVERT", "ASSIGN(INVERT(b), Q_SET => x, Q_RESET => y);")?.kind).toBe("function")
    expect(at("l", "ASSIGN(a, Q => JMP.l);")?.kind).toBe("label")
    expect(at("y", "ASSIGN(a, Q_INVERTED => y);")?.kind).toBe("variable")
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

  test("where a value stands — a statement's start, a call's argument, a pin's value — ASSIGN, the marks, RAIL() and the boxes", () => {
    const statement = at(NETWORK.replace("ASSIGN(a, Q_INVERTED => y);", "ASSIGN(a, Q_INVERTED => y);\n|"), "|")
    expect(statement).toEqual(expect.arrayContaining(["ASSIGN", "INVERT", "RISING", "FALLING", "RAIL()", "BRANCH", "EXECUTE", "OPERAND"]))
    const pin = at(NETWORK.replace("PT := T#1S", "PT := |T#1S"), "|")
    expect(pin).toEqual(expect.arrayContaining(["INVERT", "RISING", "FALLING"]))
    const value = at(NETWORK.replace("ASSIGN(RAIL(), Q => x);", "ASSIGN(|"), "|")
    expect(value).toEqual(expect.arrayContaining(["RAIL()", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND", "INVERT"]))
  })

  test("in an ASSIGN's arguments past its value: its outputs", () => {
    expect(at(NETWORK.replace("ASSIGN(a, Q_INVERTED => y);", "ASSIGN(a, |Q_INVERTED => y);"), "|")).toEqual(expect.arrayContaining(["Q", "Q_SET", "Q_RESET", "Q_INVERTED"]))
  })

  test("after JMP. only the labels of this body", () => {
    expect(at(NETWORK.replace("ASSIGN(a, Q => JMP.l);", "ASSIGN(a, Q => JMP.|);"), "|").sort()).toEqual(["l", "m"])
  })

  test("never in a plain ST body", () => {
    const labels = at(PLAIN_ST.replace("x := NOT a;", "x := NOT a;\n|"), "|")
    for (const w of ["ASSIGN", "INVERT", "RISING", "FALLING", "RAIL()", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND"]) expect(labels).not.toContain(w)
  })
})

describe("hover on the network words: what each runs as, one line", () => {
  const hoverAt = (src: string, from: string, word: string) => {
    const { doc, project } = setup(src)
    const h = hover(doc, project, src.indexOf(from) + from.indexOf(word))
    return (h?.contents as { value: string } | undefined)?.value
  }

  test("RAIL() is the left rail", () => {
    expect(hoverAt(NETWORK, "ASSIGN(RAIL(), Q => x);", "RAIL")).toBe("the left rail: TRUE")
  })

  test("a mark and an ASSIGN's output say what they run as", () => {
    expect(hoverAt(NETWORK, "ASSIGN(INVERT(b)", "INVERT")).toBe("a negation of its value: NOT of it (bitwise on an integer)")
    expect(hoverAt(NETWORK, "Q_SET => x", "Q_SET")).toBe("a set coil: the target is set TRUE while the value is TRUE")
    expect(hoverAt(NETWORK, "Q_INVERTED => y", "Q_INVERTED")).toBe("a negated coil: the target receives NOT the value")
  })

  test("every other network word answers one line", () => {
    for (const [from, word] of [
      ["%DISABLED", "DISABLED"], ['%NETWORK "first"', "NETWORK"], ["ASSIGN(BRANCH(", "BRANCH"], ["BRANCH_SHORTCIRCUIT(", "BRANCH_SHORTCIRCUIT"],
      ["EXECUTE(EN", "EXECUTE"], ["ASSIGN(FALLING(a)", "FALLING"], ["IN := RISING(a)", "RISING"], ["ASSIGN(a, Q_INVERTED", "ASSIGN"],
      ["JMP.l", "JMP"], ["JMP.l", "l"], ["Q => RETURN", "RETURN"], ["\nl:", "l"],
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

const ITEMS = `PROGRAM P
VAR
\ta : BOOL; b : BOOL; c : BOOL; x : BOOL; y : BOOL; t1 : TON;
END_VAR
%LANGUAGE LD
%NETWORK
l:
ASSIGN(c, Q_INVERTED => JMP.l);
ASSIGN(COMMENT(a, 'why'), Q => y);
ASSIGN(c, Q_INVERTED => COMMENT(x, 'why'));
t1(IN := COMMENT(b, 'in'), PT := T#1S, Q => COMMENT(y, 'out'));
`

const offsetOf = (src: string, from: string, word: string) => src.indexOf(from) + from.indexOf(word)

const hoverAt = (src: string, from: string, word: string) => {
  const { doc, project } = setup(src)
  return (hover(doc, project, offsetOf(src, from, word))?.contents as { value: string } | undefined)?.value
}

test("COMMENT is a function, the operand it wraps the operand", () => {
  const kind = (from: string, word: string) => networkTokens(ITEMS).find((t) => t.start === offsetOf(ITEMS, from, word))?.kind
  expect(kind("ASSIGN(COMMENT(a, 'why'), Q => y);", "COMMENT")).toBe("function")
  expect(kind("ASSIGN(COMMENT(a, 'why'), Q => y);", "a")).toBe("variable")
  expect(kind("ASSIGN(c, Q_INVERTED => JMP.l);", "Q_INVERTED")).toBe("keyword")
})

test("hover says what COMMENT is", () => {
  expect(hoverAt(ITEMS, "ASSIGN(COMMENT(a, 'why'), Q => y);", "COMMENT")).toBe("an operand comment: the operand it wraps, the comment the engineer typed beside it")
})

test("COMMENT is offered where an operand stands: a value, a statement's start, an output's target, a pin", () => {
  const at = (src: string, marker: string) => {
    const offset = src.indexOf(marker)
    const { doc, project } = setup(src.replace(marker, ""))
    return completion(doc, project, offset).map((i) => i.label)
  }
  expect(at(ITEMS.replace("ASSIGN(COMMENT(a, 'why'), Q => y);", "ASSIGN(|"), "|")).toEqual(expect.arrayContaining(["COMMENT", "RISING", "FALLING"]))
  expect(at(ITEMS.replace("ASSIGN(c, Q_INVERTED => JMP.l);", "ASSIGN(c, Q_INVERTED => JMP.l);\n|"), "|")).toEqual(expect.arrayContaining(["COMMENT", "RAIL()", "BRANCH"]))
  expect(at(ITEMS.replace("Q => COMMENT(y, 'out')", "Q => |"), "|")).toContain("COMMENT")
  expect(at(ITEMS.replace("IN := COMMENT(b, 'in')", "IN := |"), "|")).toEqual(expect.arrayContaining(["COMMENT", "INVERT", "RISING"]))
})

test("the operand a comment wraps navigates as the operand: its definition, its every occurrence", () => {
  const { doc, project } = setup(ITEMS)
  const def = definition(doc, project, offsetOf(ITEMS, "ASSIGN(COMMENT(a, 'why')", "a,"))
  expect(def?.range.start.line).toBe(2)
  const highlights = documentHighlights(doc, project, offsetOf(ITEMS, "COMMENT(x, 'why')", "x,")) ?? []
  expect(highlights.map((r) => ITEMS.split("\n")[r.start.line]!.slice(r.start.character, r.end.character))).toEqual(["x", "x"])
})

test("INVERT, RISING, FALLING and ASSIGN are no symbols: navigation finds nothing, and nothing is undefined", () => {
  const { doc, project } = setup(NETWORK)
  for (const [from, word] of [["ASSIGN(INVERT(b)", "ASSIGN"], ["ASSIGN(INVERT(b)", "INVERT"], ["IN := RISING(a)", "RISING"], ["Q_SET => x", "Q_SET"]] as const)
    expect([word, definition(doc, project, offsetOf(NETWORK, from, word))]).toEqual([word, undefined])
})
