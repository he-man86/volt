/** Rendering a Type and a TypeExpr (from `types.test.ts`, transpile-restructure 1.1.11). */
import { expect, test } from "bun:test"
import { type FunctionBlock, parseSource, renderTypeExpr, type TypeExpr } from "../syntax/index.js"
import { build, type Scope } from "../symbols/index.js"
import { renderType, resolveNamedType, resolveTypeExpr } from "./index.js"

function proj(src: string): Scope {
  return build.buildSymbolTable([{ uri: "F.pou", parseResult: parseSource(src, { networkText: true }), source: src }])
}

function declType(src: string): TypeExpr {
  const fb = parseSource(`FUNCTION_BLOCK F\nVAR\n ${src}\nEND_VAR\nEND_FUNCTION_BLOCK`, { networkText: true }).units[0] as FunctionBlock
  return fb.varSections[0].decls[0].type
}

test("renderType / renderTypeExpr", () => {
  const p = proj("")
  expect(renderType(resolveNamedType("INT", p, undefined))).toBe("INT")
  expect(renderType(resolveTypeExpr(declType("a : ARRAY[0..9] OF INT;"), p))).toBe("ARRAY [0..9] OF INT") // the IDE's spelling (conformance `cc6_function_input_array_default`)
  expect(renderType(resolveTypeExpr(declType("q : POINTER TO REAL;"), p))).toBe("POINTER TO REAL")
  expect(renderTypeExpr(declType("sx : STRING(80);"))).toBe("STRING(80)")
  expect(renderTypeExpr(declType("x : INT(0..100);"))).toBe("INT(0..100)")
  expect(renderTypeExpr(declType("p : POINTER TO INT;"))).toBe("POINTER TO INT")
})
