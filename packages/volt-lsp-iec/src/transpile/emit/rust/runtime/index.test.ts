import { describe, expect, test } from "bun:test"
import { INLINE, runtimeText, usedIn } from "./index.js"
import { IEC_MAX_MIN } from "./numeric.js"
import { PARSE } from "./parse.js"
import { IEC_STR } from "./string.js"
import { TEXT } from "./text.js"

describe("emit/rust/runtime — the registry", () => {
  test("the string blob is the string type, MAX/MIN over a string, the formatters, then the parsers", () => {
    expect(runtimeText("string")).toBe(IEC_STR + IEC_MAX_MIN + TEXT + PARSE)
    for (const part of [IEC_STR, IEC_MAX_MIN, TEXT, PARSE]) expect(part.endsWith("}\n")).toBe(true)
  })

  test("the string blob is asked for by the string types' names", () => {
    expect(usedIn("string", "let s: IecString<80> = IecStr::lit(b\"a\");")).toBe(true)
    expect(usedIn("string", "let w: IecWString<4>;")).toBe(true)
    expect(usedIn("string", "let x: i32 = 1;")).toBe(false)
  })

  test("each helper appended after the code defines the fn its call names, and nothing else asks for it", () => {
    for (const id of INLINE) {
      const text = runtimeText(id)
      expect(text.startsWith(`fn ${id}`)).toBe(true)
      expect(text.endsWith("\n")).toBe(true)
      expect(usedIn(id, `${id}(1)`)).toBe(true)
      expect(usedIn(id, id)).toBe(false)
    }
    expect(INLINE).toEqual(["iec_deref", "iec_r2i64", "iec_r2i32", "iec_fmax", "iec_fmin", "iec_log", "iec_pow", "iec_div"])
  })
})
