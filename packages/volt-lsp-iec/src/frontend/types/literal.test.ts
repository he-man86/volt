/**
 * How CODESYS types an untyped integer literal for checking (gap 13). Every expectation is a recorded answer
 * (conformance `overflow_*`, `cc_literal_*`, `cc_fp_literal_*`).
 */
import { expect, test } from "bun:test"
import { parseSource, type Expr, type FunctionBlock, type Literal } from "../syntax/index.js"
import { elementaryType } from "./elementary.js"
import { elementaryTypeRef } from "./type.js"
import { integerLiteralType, literalCapacityType, literalCheckType, REAL_MAX_MAGNITUDE } from "./literal.js"

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
  const unit = parseSource(`FUNCTION_BLOCK F\nVAR\n x : INT := ${literal};\nEND_VAR\nEND_FUNCTION_BLOCK`, { networkText: true, unicodeIdentifiers: false }, "codesys").units[0] as FunctionBlock
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

// transpile-restructure 6.A.21 (Appendix A): a TYPED REAL literal fits up to f32's largest, 3.4028234663852886E38, exactly —
// REAL#3.4028234E38 builds (it holds 3.40282347E+38), REAL#3.4028235E38 and its negation are "too large", as is
// REAL#3.4028236E38 (`tr_a21_typed_real_*`, CODESYS record:exec 2026-10-10). The bound was 3.402823E38, so the first was
// called too large; and it was one of two constants, the untyped literal's check holding the other.
test("a typed REAL literal is too large only past f32's largest — the one REAL bound, typed and untyped alike", () => {
  expect(REAL_MAX_MAGNITUDE.get("REAL")).toBe(Math.fround(3.4028234663852886e38))
  const capacity = (text: string) => literalCapacityType(literalInit(text) as Literal)
  expect(capacity("REAL#3.4028234E38")).toBeUndefined()
  expect(["REAL#3.4028235E38", "REAL#3.4028236E38"].map(capacity)).toEqual(["REAL", "REAL"])
  // the untyped literal's warning (`cc_real_init_max`: 3.4028235E38 warns LREAL -> REAL) reads the same bound
  expect(checkedAs("3.4028234E38", "REAL")).toBeUndefined()
  expect(checkedAs("3.4028235E38", "REAL")).toBe("LREAL")
})

// …and a TYPED REAL literal too large for REAL is that error alone — no LREAL → REAL warning beside it: the "beyond REAL's
// largest is an LREAL" rule is the UNTYPED literal's (`tr_a21_typed_real_rounds_to_max`: CODESYS and TwinCAT record only
// "Constant 'REAL#3.4028235E38' too large for type 'REAL'"; the LSP warned LREAL → REAL beside it).
test("a typed REAL literal is checked as its own type, never as an LREAL", () => {
  expect(checkedAs("REAL#3.4028235E38", "REAL")).toBeUndefined()
  expect(checkedAs("REAL#-3.4028235E38", "REAL")).toBeUndefined()
})
