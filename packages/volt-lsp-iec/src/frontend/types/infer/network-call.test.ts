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

/** The type of every expression `x := <expr>;` assigns to `probe…` in the network body of `code`, by the probe's name. */
function probes(language: "LD" | "ST", code: string): Record<string, string> {
  const src = `${FB}PROGRAM P\nVAR\n\ta, b, c, p1, p2, p3, p4, p5, p6 : BOOL;\n\ti, j, n, q1, q2 : INT;\n\tt1 : FB_T;\n\td1 : TIME;\nEND_VAR\n%LANGUAGE ${language}\n${code}END_PROGRAM\n`
  const parseResult = parseSource(src, { networkText: true }, "codesys")
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
  expect(probes("LD", "%NETWORK\np1 := GT(i, 3);\nq1 := ADD(i, j, n);\np2 := AND(a, NOT(b), XOR(a, c));\nq2 := MOD(i, 2);\n")).toEqual({
    p1: "BOOL", q1: "INT", p2: "BOOL", q2: "INT",
  })
})

test("an enabled box and the Execute box return their ENO, a BOOL", () => {
  expect(probes("LD", "%NETWORK\np1 := MOVE_EN(EN := a, i, OUT => n);\np2 := GT_EN(EN := a, i, j, OUT => p3);\n")).toEqual({ p1: "BOOL", p2: "BOOL" })
})

test("a wire is of its definition's type: an expression's, an FB output's, an enabled box's value, an ENO", () => {
  const code =
    "%NETWORK\n%WIRES w1, w2, w3, w4\nw1 := ADD(i, j);\nq1 := w1;\nq2 := w1;\nt1(IN := a, Q => w2, ET => w3);\np1 := w2;\nd1 := w3;\n" +
    "MOVE_EN(EN := b, i, OUT => w4);\nn := w4;\n"
  const parseResult = parseSource(`${FB}PROGRAM P\nVAR\n\ta, b, p1 : BOOL;\n\ti, j, n, q1, q2 : INT;\n\tt1 : FB_T;\n\td1 : TIME;\nEND_VAR\n%LANGUAGE LD\n${code}END_PROGRAM\n`, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "P.pou", parseResult, source: "" }], [], "codesys")
  const types: Record<string, string> = {}
  for (const { scope, statements } of bodies(parseResult.units, project))
    walkAllExprs(statements, (e) => {
      if (e.kind === "ident_expr" && /^w\d$/.test(e.name)) types[e.name] = renderType(inferExprType(e, scope, project))
    })
  expect(types).toEqual({ w1: "INT", w2: "BOOL", w3: "TIME", w4: "INT" })
})

test("outside a network body an enabled box is no call: MOVE_EN(…) in ST has no type", () => {
  expect(probes("ST", "p1 := MOVE_EN(EN := a, i, OUT => n);\n")).toEqual({ p1: renderType(UNKNOWN) })
})
