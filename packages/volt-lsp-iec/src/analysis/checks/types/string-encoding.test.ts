/**
 * string-not-representable — a STRING literal past Latin-1 under "UTF-8 Encoding for STRING" off (`slit_*`, CODESYS 3.5.21.40).
 */
import { expect, test } from "bun:test"
import { resolveConfig } from "../../index.js"
import { diagnose } from "../../../../test/support/diagnose.js"

const src = (body: string) => `FUNCTION_BLOCK F\nVAR\n\ttxt : STRING;\n\tw : WSTRING;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
const said = (body: string, utf8Encoding: boolean | undefined) =>
  diagnose(src(body), "codesys", resolveConfig({ vendor: "codesys", utf8Encoding }))
    .filter((d) => d.code === "string-not-representable")
    .map((d) => [d.severity, d.message])

test("a STRING literal past Latin-1 warns where the option is off, quoting its first seven characters", () => {
  expect(said("txt := 'a计b';", false)).toEqual([
    ["warning", "The string literal 'a计b...' contains non-representable characters. The project option 'UTF-8 Encoding for STRING' could be used."],
  ])
  expect(said("txt := 'abcdefghijklmnopqrstuvwxyz计';", false)).toEqual([
    ["warning", "The string literal 'abcdefg...' contains non-representable characters. The project option 'UTF-8 Encoding for STRING' could be used."],
  ])
  expect(said("w := 'a😀b';", false).length).toBe(1) // in a WSTRING's context too (`slit_into_wstring`)
})

test("Latin-1 is representable; the option on, or unstated, says nothing; a WSTRING literal is no STRING", () => {
  expect(said("txt := 'größe';", false)).toEqual([])
  expect(said("txt := 'a计b';", true)).toEqual([])
  expect(said("txt := 'a计b';", undefined)).toEqual([])
  expect(said(`w := "a计b";`, false)).toEqual([])
})

test("a STRING literal's message type counts UTF-8 bytes with the option on, characters off or unstated (`slit_into_wstring`)", () => {
  const msg = (utf8Encoding: boolean | undefined) =>
    diagnose(src("w := 'a计b';"), "codesys", resolveConfig({ vendor: "codesys", utf8Encoding }))
      .filter((d) => d.code === "assignment-type-mismatch")
      .map((d) => d.message)
  expect(msg(true)).toEqual(["Cannot convert type 'STRING(INT#5)' to type 'WSTRING'"])
  expect(msg(false)).toEqual(["Cannot convert type 'STRING(INT#3)' to type 'WSTRING'"])
  expect(msg(undefined)).toEqual(["Cannot convert type 'STRING(INT#3)' to type 'WSTRING'"])
})
