/**
 * type-as-value (C0230) — a DUT type name used as an assignment value/target.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const tv = (body: string): string[] => {
  const src = `PROGRAM P\nVAR value : INT;\nEND_VAR\n${body}\nEND_PROGRAM\nTYPE MyEnum : (RED, GREEN); END_TYPE`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "type-name-as-value")
    .map((d) => d.message)
}

test("a type name as an assignment value/target is flagged; member access and SIZEOF are not", () => {
  expect(tv(`value := MyEnum;`)).toEqual(["Type name 'MyEnum' not expected in this place"])
  expect(tv(`MyEnum := value;`)).toEqual(["Type name 'MyEnum' not expected in this place"])
  expect(tv(`value := MyEnum.RED;`)).toEqual([]) // member access
  expect(tv(`value := SIZEOF(MyEnum);`)).toEqual([]) // type as a SIZEOF argument
})

// A STRUCT type's name CALLED, and as the base of a member it does not declare, is C0230 too (`dt_struct_type_name_called`,
// `dt_static_base_unknown_member`, CODESYS 2026-10-03). Only those shapes are recorded: an enum's `E.RED` is a member. (Not `S`: S= is a keyword.)
test("a STRUCT type's name called, or reached into for a member it lacks, is a type name not expected here", () => {
  const st = (body: string): string[] => {
    const src = `PROGRAM P\nVAR value : INT;\nEND_VAR\n${body}\nEND_PROGRAM\nTYPE Dut_s :\nSTRUCT\nx : INT;\nEND_STRUCT\nEND_TYPE`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "type-name-as-value")
      .map((d) => d.message)
  }
  expect(st(`Dut_s();`)).toEqual(["Type name 'Dut_s' not expected in this place"])
  expect(st(`value := Dut_s();`)).toEqual(["Type name 'Dut_s' not expected in this place"])
  expect(st(`value := Dut_s.nope;`)).toEqual(["Type name 'Dut_s' not expected in this place"])
  expect(tv(`value := MyEnum();`)).toEqual([]) // an enum type called is unrecorded
})
