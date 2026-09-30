/**
 * One conversion-name parser (consolidate-lsp-structure A4). There were six, and they disagreed on names spelled with
 * the long type names; CODESYS defines none of those (conformance `cc_conv_spelled_*`).
 */
import { expect, test } from "bun:test"
import { parseConversionName } from "./conversion-name.js"

const parsed = (name: string) => {
  const c = parseConversionName(name)
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
  expect(parseConversionName("ANYNUM_TO_WORD")).toBeUndefined()
  expect(parseConversionName("ANYINT_TO_REAL")).toBeUndefined()
  // the underscored spelling is the real one, and a name that is neither is still refused
  expect(parseConversionName("ANY_TO_DWORD")?.to.name).toBe("DWORD")
  expect(parseConversionName("ANY_NUM_TO_WORD")?.from).toBeUndefined() // names no concrete source
  expect(parseConversionName("TIME_OF_DAY_TO_UDINT")).toBeUndefined() // CODESYS has no such function
  expect(parseConversionName("NOTATYPE_TO_INT")).toBeUndefined()
})
