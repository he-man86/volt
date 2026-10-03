/**
 * One conversion-name parser (consolidate-lsp-structure A4). There were six, and they disagreed on names spelled with
 * the long type names; CODESYS defines none of those (conformance `cc_conv_spelled_*`).
 */
import { expect, test } from "bun:test"
import { isConversionName, parseConversionName } from "./conversion-name.js"

const X64 = { pointerBits: 64 } as const
const X32 = { pointerBits: 32 } as const

const parsed = (name: string) => {
  const c = parseConversionName(name, X64)
  return c === undefined ? undefined : [c.from?.name, c.to.name]
}

test("a conversion name is two elementary types as the table spells them, or TO_ and one", () => {
  expect(parsed("INT_TO_REAL")).toEqual(["INT", "REAL"])
  expect(parsed("tod_to_udint")).toEqual(["TOD", "UDINT"])
  expect(parsed("TO_STRING")).toEqual([undefined, "STRING"])
  // not defined in CODESYS, and not a conversion: the spelled-out names, and a project name of that shape
  expect([parsed("TIME_OF_DAY_TO_UDINT"), parsed("UDINT_TO_TIME_OF_DAY"), parsed("GO_TO_START"), parsed("INT_TO_")]).toEqual([
    undefined, undefined, undefined, undefined,
  ])
})

test("an ANY family spelled WITHOUT its underscore is NOT a conversion", () => {
  // Measured on SP21 (`cs_anynum_to_conversions`): "Identifier 'ANYNUM_TO_WORD' not defined". It was accepted here
  // on the strength of 80 corpus uses — every one of them inside a materialized `Library Manager/` file, so none of
  // them was ever evidence about a POU. A count is not a measurement.
  expect(parseConversionName("ANYNUM_TO_WORD", X64)).toBeUndefined()
  expect(parseConversionName("ANYINT_TO_REAL", X64)).toBeUndefined()
  // the underscored spelling is the real one, and a name that is neither is still refused
  expect(parseConversionName("ANY_TO_DWORD", X64)?.to.name).toBe("DWORD")
  expect(parseConversionName("ANY_NUM_TO_WORD", X64)?.from).toBeUndefined() // names no concrete source
  expect(parseConversionName("TIME_OF_DAY_TO_UDINT", X64)).toBeUndefined() // CODESYS has no such function
  expect(parseConversionName("NOTATYPE_TO_INT", X64)).toBeUndefined()
})

test("the platform-alias conversion names are conversions on every target, typed by the target (TY11)", () => {
  // recorded 2026-10-03 (`ty_xint_to_dint`, `ty_dint_to_uxint`, `ty_xint_to_dint_result_type`): all eight build and run on
  // CODESYS Control Win V3 x64 and TwinCAT RT (x64), and `DINT_TO___XINT(d)` into a STRING is "Cannot convert type 'LINT'"
  const both = (name: string, target: typeof X64 | typeof X32 | undefined) => {
    const c = parseConversionName(name, target)
    return c === undefined ? undefined : [c.from?.name, c.to.name]
  }
  expect(both("__XINT_TO_DINT", X64)).toEqual(["LINT", "DINT"])
  expect(both("__uxint_to_udint", X64)).toEqual(["ULINT", "UDINT"])
  expect(both("__XWORD_TO_DWORD", X64)).toEqual(["LWORD", "DWORD"])
  expect(both("DINT_TO___UXINT", X64)).toEqual(["DINT", "ULINT"])
  expect(both("DWORD_TO___XWORD", X64)).toEqual(["DWORD", "LWORD"])
  expect(both("INT_TO___XINT", X32)).toEqual(["INT", "DINT"]) // the 32-bit half of the table (TwinCAT CE7)
  // on an unknown target the name is still a conversion, with no facts for its platform side
  expect(both("DINT_TO___XINT", undefined)).toBeUndefined()
  expect(["__XINT_TO_DINT", "DINT_TO___UXINT", "dword_to___xword"].map(isConversionName)).toEqual([true, true, true])
  // `__UXWORD` is no type (`ct_pointer_width_types`), so no conversion either
  expect([isConversionName("__UXWORD_TO_DINT"), isConversionName("DINT_TO___UXWORD")]).toEqual([false, false])
  expect([isConversionName("INT_TO_REAL"), isConversionName("GO_TO_START"), isConversionName("ANYNUM_TO_WORD")]).toEqual([true, false, false])
})
