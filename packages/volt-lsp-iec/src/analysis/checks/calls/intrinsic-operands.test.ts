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
