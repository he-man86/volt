/**
 * THE COMPILER'S OWN STRUCTS — `VERSION` (rule TY15) and the `__SYSTEM.AnyType` an ANY / ANY_* input is (rule TY14), which
 * no library declares (frontend-conformance 4.1.3; both vendors recorded 2026-10-03).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { build } from "../symbols/index.js"
import { inferExprType } from "./infer/expr.js"
import { renderType } from "./render.js"
import { resolveNamedType } from "./resolve.js"
import { bodies } from "../symbols/index.js"
import type { Expr } from "../syntax/index.js"

const project = () => build.buildSymbolTable([], [], "codesys")

test("VERSION is a STRUCT of four UINT components (`ty_version_type`, `ty_version_component_type`)", () => {
  const t = resolveNamedType("VERSION", project())
  expect(t.kind).toBe("struct")
  expect(renderType(t)).toBe("VERSION")
})

test("an ANY / ANY_* input is the compiler's AnyType: diSize a DINT, pValue a POINTER TO BYTE (`type_any_*`, `tr_17_*`)", () => {
  const src = `FUNCTION F : DINT\nVAR_INPUT\n\tx : ANY_INT;\n\ty : ANY;\nEND_VAR\nF := x.diSize;\nF := y.DISIZE;\nF := x.pValue^;\nEND_FUNCTION`
  const parseResult = parseSource(src, { networkText: true })
  const p = build.buildSymbolTable([{ uri: "F.pou", source: src, parseResult }], [], "codesys")
  const [body] = [...bodies(parseResult.units, p)]
  const rhs = body!.statements.map((s) => (s as { value: Expr }).value)
  expect(rhs.map((e) => renderType(inferExprType(e, body!.scope, p)))).toEqual(["DINT", "DINT", "BYTE"])
})

test("a project's own VERSION type wins over the compiler's", () => {
  const src = `TYPE VERSION :\nSTRUCT\n\tmine : BOOL;\nEND_STRUCT\nEND_TYPE`
  const p = build.buildSymbolTable([{ uri: "VERSION.dut", source: src, parseResult: parseSource(src, { networkText: true }) }], [], "codesys")
  const t = resolveNamedType("VERSION", p)
  expect(t.kind === "struct" && t.scope?.symbols.has("mine")).toBe(true)
})
