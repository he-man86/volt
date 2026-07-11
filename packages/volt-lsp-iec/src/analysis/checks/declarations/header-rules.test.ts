/**
 * header-rules — C0096 (multiple EXTENDS bases on an FB), C0182 (return type on a PROGRAM), C0421 (an
 * INTERFACE using IMPLEMENTS), C0149 (a VAR section inside an INTERFACE). Each fires only in the illegal
 * case; the legal forms stay silent.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string, code: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === code)
    .map((d) => d.message)
}

test("C0096: an FB with more than one EXTENDS base is flagged; a single base is fine", () => {
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS FB2, FB3\nEND_FUNCTION_BLOCK`, "multiple-inheritance")).toEqual([
    "Only one base function block may be defined in EXTENDS list",
  ])
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS FB2\nEND_FUNCTION_BLOCK`, "multiple-inheritance")).toEqual([])
})

test("C0182: a return type on a PROGRAM is flagged; a bare PROGRAM is fine", () => {
  expect(msgs(`PROGRAM P : BOOL\nEND_PROGRAM`, "return-type-not-allowed")).toEqual([
    "Return type is only possible for POUs of type FUNCTION and METHOD",
  ])
  expect(msgs(`PROGRAM P\nEND_PROGRAM`, "return-type-not-allowed")).toEqual([])
})

test("C0421: an INTERFACE using IMPLEMENTS is flagged; EXTENDS is fine", () => {
  expect(msgs(`INTERFACE ITF_1 IMPLEMENTS ITF\nEND_INTERFACE`, "interface-implements")).toEqual([
    "Use keyword EXTENDS for inheritance of interfaces instead of IMPLEMENTS",
  ])
  expect(msgs(`INTERFACE ITF_1 EXTENDS ITF\nEND_INTERFACE`, "interface-implements")).toEqual([])
})

test("C0149: a VAR section inside an INTERFACE is flagged; a method-only interface is fine", () => {
  expect(msgs(`INTERFACE ITF\nVAR_INPUT\n  i : INT;\nEND_VAR\nEND_INTERFACE`, "var-in-interface")).toEqual([
    "Variable declarations are not allowed in interfaces",
  ])
  expect(msgs(`INTERFACE ITF\nMETHOD M : BOOL\nEND_METHOD\nEND_INTERFACE`, "var-in-interface")).toEqual([])
})

test("C0144: EXTENDS on an enum/alias DUT is flagged; a struct EXTENDS is fine", () => {
  expect(msgs(`TYPE E EXTENDS Base :\n(\n  A, B\n); END_TYPE`, "inheritance-not-allowed")).toEqual([
    "Inheritance only allowed in function blocks, Interfaces and Structures",
  ])
  expect(msgs(`TYPE A EXTENDS Base : INT; END_TYPE`, "inheritance-not-allowed")).toEqual([
    "Inheritance only allowed in function blocks, Interfaces and Structures",
  ])
  // A struct legitimately EXTENDS another struct — never flagged.
  expect(msgs(`TYPE S EXTENDS Base :\nSTRUCT\n  x : INT;\nEND_STRUCT\nEND_TYPE`, "inheritance-not-allowed")).toEqual([])
})

test("C0542: EXTENDS on a UNION is flagged with its type name", () => {
  expect(msgs(`TYPE U EXTENDS Base :\nUNION\n  a : INT;\nEND_UNION\nEND_TYPE`, "union-inheritance")).toEqual([
    `Inheritance is not intended for data type "UNION": Base`,
  ])
  expect(msgs(`TYPE U :\nUNION\n  a : INT;\nEND_UNION\nEND_TYPE`, "union-inheritance")).toEqual([])
})

test("C0145: IMPLEMENTS on a FUNCTION is flagged; a bare FUNCTION is fine", () => {
  expect(msgs(`FUNCTION F IMPLEMENTS ITF\nVAR\nEND_VAR\nEND_FUNCTION`, "function-implements")).toEqual([
    "Interfaces can only be implemented by function blocks",
  ])
  expect(msgs(`FUNCTION F : INT\nVAR\nEND_VAR\nEND_FUNCTION`, "function-implements")).toEqual([])
})
