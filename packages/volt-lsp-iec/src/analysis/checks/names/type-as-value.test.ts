/**
 * type-as-value (C0230) — a DUT type name used as an assignment value/target.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const tv = (body: string): string[] => {
  const src = `PROGRAM P\nVAR value : INT;\nEND_VAR\n${body}\nEND_PROGRAM\nTYPE MyEnum : (RED, GREEN); END_TYPE`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "type-name-as-value")
      .map((d) => d.message)
  }
  expect(st(`Dut_s();`)).toEqual(["Type name 'Dut_s' not expected in this place"])
  expect(st(`value := Dut_s();`)).toEqual(["Type name 'Dut_s' not expected in this place"])
  expect(st(`value := Dut_s.nope;`)).toEqual(["Type name 'Dut_s' not expected in this place"])
  expect(tv(`value := MyEnum();`)).toEqual([]) // an enum type called is unrecorded
})

// analysis-conformance 3.5 (both vendors, recorded 2026-10-06, `tav_*`): an ALIAS type's name as a value or a target is the
// one message — it has no scope to type it by, and the hole's conversion is not said beside it; a type's name as an
// OPERAND or a CONDITION is the message too (the vendors' further conversions of the type there are a divergence, niche)
test("an ALIAS type's name as a value or a target is that one message", () => {
  const all = (body: string): string[] => {
    const src = `PROGRAM P\nVAR value : INT;\nEND_VAR\n${body}\nEND_PROGRAM\nTYPE T_Al : INT;\nEND_TYPE\nTYPE MyEnum : (RED, GREEN); END_TYPE`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "P.pou", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: "P.pou", parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message)
  }
  expect(all(`value := T_Al;`)).toEqual(["Type name 'T_Al' not expected in this place"])
  expect(all(`T_Al := 3;`)).toEqual(["Type name 'T_Al' not expected in this place"])
  expect(all(`value := T_Al + 1;`)).toContain("Type name 'T_Al' not expected in this place")
  expect(all(`IF MyEnum THEN\n value := 1;\nEND_IF`)).toContain("Type name 'MyEnum' not expected in this place")
})
