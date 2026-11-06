/**
 * The types of a plain-ST network body's own calls and wires (`network-call.ts`, openspec network-text-st 2.3): each box
 * is a call the LSP knows as it knows LIMIT, and a wire is of its definition's type. Asked through the body's own scope
 * (`symbols` `bodies`), as every check asks.
 */
import { expect, test } from "bun:test"
import { type Expr, parseSource, walkAllExprs } from "../../syntax/index.js"
import { bodies, build } from "../../symbols/index.js"
import { inferExprType, renderType, UNKNOWN } from "../index.js"

const FB = `FUNCTION_BLOCK FB_T
VAR_INPUT
\tIN : BOOL;
END_VAR
VAR_OUTPUT
\tQ : BOOL;
\tET : TIME;
END_VAR
%LANGUAGE ST
Q := IN;
END_FUNCTION_BLOCK
`

/** The type of every value a coil `ASSIGN(<expr>, Q => probe…)` writes in the network body of `code`, by the probe's name. */
function probes(language: "LD" | "ST", code: string): Record<string, string> {
  const src = `${FB}PROGRAM P\nVAR\n\ta, b, c, p1, p2, p3, p4, p5, p6 : BOOL;\n\ti, j, n, q1, q2 : INT;\n\tt1 : FB_T;\n\td1 : TIME;\nEND_VAR\n%LANGUAGE ${language}\n${code}END_PROGRAM\n`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "P.pou", parseResult, source: src }], [], "codesys")
  const out: Record<string, string> = {}
  for (const { scope, statements } of bodies(parseResult.units, project))
    for (const s of statements)
      if (s.kind === "assign" && s.target.kind === "ident_expr" && /^[pqd]\d$/.test(s.target.name)) {
        const value: Expr = s.value
        out[s.target.name] = renderType(inferExprType(value, scope, project))
      }
  return out
}

test("an operator box is the type its operands have under the operator: a comparison BOOL, an extensible ADD its meet", () => {
  expect(probes("LD", "%NETWORK\nASSIGN(GT(i, 3), Q => p1);\nASSIGN(ADD(i, j, n), Q => q1);\nASSIGN(AND(a, NOT(b), XOR(a, c)), Q => p2);\nASSIGN(MOD(i, 2), Q => q2);\n")).toEqual({
    p1: "BOOL", q1: "INT", p2: "BOOL", q2: "INT",
  })
})

test("a box showing EN hands on its ENO, a BOOL; .OUT its value; an FB its first output, or the output it names", () => {
  expect(probes("LD", "%NETWORK\nASSIGN(MOVE(EN := a, i, OUT => n), Q => p1);\nASSIGN(GT(EN := a, i, j, OUT => p3), Q => p2);\nASSIGN(ADD(EN := a, i, j).OUT, Q => q1);\n" +
    "ASSIGN(t1(IN := a), Q => p4);\nASSIGN(t1(IN := a).ET, Q => d1);\nASSIGN(t1(EN := a, IN := b), Q => p5);\nASSIGN(INVERT(i), Q => q2);\n")).toEqual({
    p1: "BOOL", p2: "BOOL", q1: "INT", p4: "BOOL", d1: "TIME", p5: "BOOL", q2: "UINT", // INVERT is NOT: on an INT, its UINT (`uop_not_*`)
  })
})

test("a root box closed by .NAME is that output (network-text-one-to-one F3): a member of the box, typed as one read elsewhere", () => {
  const src = `${FB}PROGRAM P\nVAR\n\ta : BOOL;\n\tt1 : FB_T;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nt1(IN := a).ET;\nEND_PROGRAM\n`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "P.pou", parseResult, source: src }], [], "codesys")
  const found: string[] = []
  for (const { scope, statements } of bodies(parseResult.units, project))
    walkAllExprs(statements, (e: Expr) => {
      if (e.kind === "member" && e.member.name === "ET") found.push(renderType(inferExprType(e, scope, project)))
    })
  expect(found).toEqual(["TIME"])
})

test("a wire is of its definition's type: an expression's, an FB output's, an enabled box's value, an ENO", () => {
  const code =
    "%NETWORK\nVAR w1 : ANY; w2 : ANY; w3 : ANY; w4 : ANY; w5 : ANY; END_VAR\nw1 := ADD(i, j);\nASSIGN(w1, Q => q1, Q => q2);\nw2 := t1(IN := a);\nASSIGN(w2, Q => p1);\nw3 := t1(IN := a).ET;\nASSIGN(w3, Q => d1);\n" +
    "w4 := MOVE(EN := b, i).OUT;\nASSIGN(w4, Q => n);\nw5 := MOVE(EN := b, i, OUT => n);\nASSIGN(w5, Q => p1);\n"
  const parseResult = parseSource(`${FB}PROGRAM P\nVAR\n\ta, b, p1 : BOOL;\n\ti, j, n, q1, q2 : INT;\n\tt1 : FB_T;\n\td1 : TIME;\nEND_VAR\n%LANGUAGE LD\n${code}END_PROGRAM\n`, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "P.pou", parseResult, source: "" }], [], "codesys")
  const types: Record<string, string> = {}
  for (const { scope, statements } of bodies(parseResult.units, project))
    walkAllExprs(statements, (e) => {
      if (e.kind === "ident_expr" && /^w\d$/.test(e.name)) types[e.name] = renderType(inferExprType(e, scope, project))
    })
  expect(types).toEqual({ w1: "INT", w2: "BOOL", w3: "TIME", w4: "INT", w5: "BOOL" })
})

test("outside a network body an enabled box is no call: MOVE(…).ENO in ST has no type", () => {
  expect(probes("ST", "p1 := MOVE(EN := a, i, OUT => n).ENO;\n")).toEqual({ p1: renderType(UNKNOWN) })
})
