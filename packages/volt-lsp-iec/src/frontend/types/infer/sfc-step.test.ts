/**
 * SFC steps (`sfc-step.ts`, openspec lsp-sfc-step-names 2.1, DIALECT D40): which member access is bet a step of an SFC
 * chart, and what a step's members are typed — conformance `fixtures/names/sfc-steps.ts` holds CODESYS's answers.
 */
import { expect, test } from "bun:test"
import { bodyStatements, parseSource, type Expr, type Program } from "../../syntax/index.js"
import { build, findChildScope, type Scope } from "../../symbols/index.js"
import { inferExprType, isSfcStepBase, renderType, UNKNOWN } from "../index.js"

const SFC = (vars: string, body = "IMPLEMENTATION SFC UNSUPPORTED") => `PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

/** Each of `reads` assigned in an ST program Q beside the program `sfc`: its type, and whether its base is bet a step. */
function ask(sfc: string, reads: string[]): { type: string; step: boolean }[] {
  const q = `PROGRAM Q\nVAR\n\tv : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n${reads.map((r) => `v := ${r};`).join("\n")}\nEND_PROGRAM\n`
  const files = [
    { uri: "P.pou", source: sfc },
    { uri: "Q.pou", source: q },
  ].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: false }) }))
  const project = build.buildSymbolTable(files, [], "codesys")
  const unit = files[1]!.parseResult.units[0] as Program
  const scope = findChildScope(project, "Q") as Scope
  const parsed = bodyStatements(unit.body)
  if (!parsed.ok) throw new Error("Q did not parse")
  return parsed.statements.map((s) => {
    const value = (s as { value: Expr }).value
    return { type: renderType(inferExprType(value, scope, project), { form: "compiler" }), step: value.kind === "member" && isSfcStepBase(value, scope, project) }
  })
}

test("a step read through its SFC program is an SFCStepType: x and _x BOOL, t and _t TIME, an unknown member untyped", () => {
  expect(ask(SFC("\tn : INT;"), ["P.S_Boot.x", "P.S_Boot._x", "P.S_Boot.t", "P.S_Boot._t", "P.S_Boot.y"])).toEqual([
    { type: "BOOL", step: true },
    { type: "BOOL", step: true },
    { type: "TIME", step: true },
    { type: "TIME", step: true },
    { type: renderType(UNKNOWN, { form: "compiler" }), step: true },
  ])
})

test("a member the program declares is its own, and an ST program has no steps", () => {
  expect(ask(SFC("\tn : INT;"), ["P.n"])).toEqual([{ type: "INT", step: false }])
  expect(ask(SFC("\tn : INT;", "IMPLEMENTATION ST"), ["P.S_Boot.x"]).map((x) => x.step)).toEqual([false])
})
