/**
 * How CODESYS types an untyped integer literal for checking (gap 13). Every expectation is a recorded answer
 * (conformance `overflow_*`, `cc_literal_*`, `cc_fp_literal_*`).
 */
import { expect, test } from "bun:test"
import { parseSource, type Expr, type FunctionBlock } from "../syntax/index.js"
import { elementaryType, integerLiteralType } from "./elementary.js"
import { literalCheckType } from "./infer.js"
import { elementaryTypeRef } from "./type.js"

test("the narrowest of SINT, USINT, INT, UINT, DINT, UDINT, LINT, ULINT that holds the value", () => {
  const named = (v: bigint) => integerLiteralType(v)?.name
  expect([127n, 128n, 300n, 40000n, 70000n, -5n, -129n, 3_000_000_000n].map(named)).toEqual([
    "SINT", "USINT", "INT", "UINT", "DINT", "SINT", "INT", "UDINT",
  ])
  expect(named(18446744073709551615n)).toBe("ULINT")
  expect(named(18446744073709551616n)).toBeUndefined()
})

/** The literal (or negated literal) initializer of `x : <type> := <literal>`. */
const literalInit = (literal: string): Expr => {
  const unit = parseSource(`FUNCTION_BLOCK F\nVAR\n x : INT := ${literal};\nEND_VAR\nEND_FUNCTION_BLOCK`).units[0] as FunctionBlock
  return unit.varSections[0]!.decls[0]!.init as Expr
}
const checkedAs = (literal: string, target: string) => {
  const t = literalCheckType(literalInit(literal), elementaryTypeRef(elementaryType(target)!))
  return t?.kind === "elementary" ? t.name : undefined
}

test("a value the target cannot hold is checked as its literal type", () => {
  expect(checkedAs("300", "BYTE")).toBe("INT")
  expect(checkedAs("128", "SINT")).toBe("USINT")
  expect(checkedAs("40000", "INT")).toBe("UINT")
  expect(checkedAs("-1", "USINT")).toBe("SINT")
  expect(checkedAs("3000000000", "DINT")).toBe("UDINT")
})

test("a value the target holds is not checked at all — `us := 5`, `b := 255`, `i := 200` are silent", () => {
  expect([checkedAs("5", "USINT"), checkedAs("5", "WORD"), checkedAs("255", "BYTE"), checkedAs("200", "INT")]).toEqual([
    undefined, undefined, undefined, undefined,
  ])
})

test("only an integer or bit-string target: REAL, TIME and BOOL are not measured", () => {
  expect([checkedAs("300", "REAL"), checkedAs("300", "TIME"), checkedAs("300", "BOOL")]).toEqual([undefined, undefined, undefined])
})
