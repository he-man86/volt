/**
 * intrinsic-operands: C0131 (ADR of a literal) + C0242 (__DELETE of a non-pointer). Docs wording; provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const run =
  (code: string) =>
  (body: string): string[] => {
    const src = `FUNCTION_BLOCK F\nVAR\n i:INT; pt:POINTER TO INT; b:BIT; s:STRING; r:REAL;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === code)
      .map((d) => d.message)
  }
const adr = run("invalid-adr-operand")
const del = run("delete-non-pointer")
const adrBit = run("adr-on-bit")

test("C0131: ADR of a literal is flagged; ADR of a variable is not", () => {
  expect(adr(`pt := ADR(1);`)).toEqual(["'1' is not allowed as operand for ADR"])
  expect(adr(`pt := ADR(i);`)).toEqual([])
})

test("C0242: __DELETE of a non-pointer is flagged; of a pointer is not", () => {
  expect(del(`__DELETE(i);`)).toEqual(["Operand of __DELETE must be pointer"])
  expect(del(`__DELETE(pt);`)).toEqual([])
})

test("C0355: ADR of a BIT variable is flagged (warning); ADR of a non-BIT is not", () => {
  expect(adrBit(`pt := ADR(b);`)).toEqual(["A single bit cannot be referenced. A reference to the complete byte will be stored."])
  expect(adrBit(`pt := ADR(i);`)).toEqual([])
})

test("C0070: INI of a non-instance is flagged; INI of an FB instance is not", () => {
  const ini = run("ini-needs-instance")
  expect(ini(`i := INI(i, TRUE);`)).toEqual(["INI operator needs function block instance or data unit type instance"])
})

test("C0072: a math operator on a non-numeric type is flagged; on a numeric type is not", () => {
  const op = run("operator-not-possible")
  expect(op(`r := ABS(s);`)).toEqual(["Operation 'Abs' is not possible on type 'STRING'"])
  expect(op(`r := SQRT(s);`)).toEqual(["Operation 'Sqrt' is not possible on type 'STRING'"])
  expect(op(`r := ABS(i);`)).toEqual([])
})

test("C0240/C0241: __QueryPointer operands of the wrong kind are flagged; valid ones are not", () => {
  const qp = (body: string) => {
    const src = `FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\nINTERFACE ITF\nEND_INTERFACE\nPROGRAM P\nVAR\n a:INT; b:INT; itf:ITF; pt:POINTER TO FB; inst:FB;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "query-pointer-operand")
      .map((d) => d.message)
  }
  expect(qp(`__QueryPointer(a, pt);`)).toEqual(["First operand of __QueryPointer must be an interface reference or the instance of a function block"])
  expect(qp(`__QueryPointer(itf, b);`)).toEqual(["Second operand of __QueryInterface must be a pointer"])
  expect(qp(`__QueryPointer(itf, pt);`)).toEqual([]) // valid
  expect(qp(`__QueryPointer(inst, pt);`)).toEqual([]) // valid FB instance
})

test("C0234/C0235: __QueryInterface operands of the wrong kind are flagged; valid ones are not", () => {
  const qi = (body: string) => {
    const src = `FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\nINTERFACE ITF\nEND_INTERFACE\nPROGRAM P\nVAR\n a:INT; b:INT; itf:ITF; itf2:ITF; inst:FB;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "query-interface-operand")
      .map((d) => d.message)
  }
  expect(qi(`__QueryInterface(a, itf);`)).toEqual(["First Operand of __QueryInterface must be an interface reference or the instance of a function block"])
  expect(qi(`__QueryInterface(itf, b);`)).toEqual(["Second Operand of __QueryInterface must be an interface reference"])
  expect(qi(`__QueryInterface(itf, itf2);`)).toEqual([]) // valid
  expect(qi(`__QueryInterface(inst, itf);`)).toEqual([]) // valid FB instance
})

test("C0022/C0023: wrong intrinsic-operator operand count is flagged; correct arity is not", () => {
  const arity = run("operator-operand-count")
  expect(arity(`pt := ADR(i, 1);`)).toEqual(["'ADR' needs exactly '1' operands"]) // C0022 exact
  expect(arity(`i := MUX(30, 40);`)).toEqual(["'MUX' needs at least '3' operands"]) // C0023 at-least
  expect(arity(`pt := ADR(i);`)).toEqual([]) // correct
  expect(arity(`i := SEL(i > 0, i, i);`)).toEqual([]) // SEL exactly 3
  expect(arity(`i := MUX(i, i, i);`)).toEqual([]) // MUX >= 3
})
