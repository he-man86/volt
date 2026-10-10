import { describe, expect, test } from "bun:test"
import { BACK, closure, FRONT, frontLines, RUNTIME_IDS, runtimeText, withoutRuntime } from "./index.js"
import { IEC_MAX, IEC_MIN } from "./numeric.js"
import { IEC_PARSE_INT, IEC_PARSE_REAL } from "./parse.js"
import { IEC_STR } from "./string.js"
import { IEC_CIVIL, IEC_LCLOCK, IEC_LDT_TEXT, IEC_LREAL_TEXT, IEC_LTOD_TEXT } from "./text.js"

describe("emit/rust/runtime — the registry", () => {
  test("every helper is whole Rust items ending in a newline, and a fn helper defines the fn its id names", () => {
    for (const id of RUNTIME_IDS) {
      const text = runtimeText(id)
      expect(text.endsWith("\n")).toBe(true)
      if (id.startsWith("iec_")) expect(text).toContain(`fn ${id}`)
    }
    expect(runtimeText("string")).toBe(IEC_STR)
  })

  test("the string family goes in front, everything else after, and the two lists are the whole registry", () => {
    expect(FRONT[0]).toBe("string")
    expect(BACK).toEqual([
      "iec_deref", "iec_r2i64", "iec_r2i32", "iec_fmax", "iec_fmin", "iec_log", "iec_pow", "iec_div",
      "mem", "mem_region", "mem_at", "mem_ld", "mem_ld_bool", "mem_st", "mem_order", "iec_ix",
    ])
    expect(closure(["mem_ld_bool"])).toEqual(["mem_region", "mem_at", "mem_ld", "mem_ld_bool"])
    expect([...FRONT, ...BACK]).toEqual([...RUNTIME_IDS])
  })

  test("a helper brings what it calls, in registry order, each once — and nothing it does not call", () => {
    expect(closure(["iec_ldt_text"])).toEqual(["iec_civil", "iec_lclock", "iec_ldt_text"])
    expect(closure(["iec_ltod_text", "iec_ldt_text", "iec_ltod_text"])).toEqual(["iec_civil", "iec_lclock", "iec_ldt_text", "iec_ltod_text"])
    expect(runtimeText("iec_ldt_text", "iec_ltod_text")).toBe(IEC_CIVIL + IEC_LCLOCK + IEC_LDT_TEXT + IEC_LTOD_TEXT)
    expect(closure(["iec_lreal_text"])).toEqual(["iec_lreal_text"])
    expect(closure(["string"])).toEqual(["string"])
    expect(runtimeText()).toBe("")
  })

  test("every helper a text calls is among its deps (a fn named in a helper's body is in its closure)", () => {
    for (const id of RUNTIME_IDS) {
      const body = runtimeText(id)
      for (const other of RUNTIME_IDS.filter((o) => o !== id && o.startsWith("iec_")))
        if (new RegExp(`\\b${other}\\(`).test(body.replace(new RegExp(`fn ${id}\\b`), ""))) expect(closure([id])).toContain(other)
      // a Mem method another one calls (`self.at(…)`) is its own entry, `mem_<method>`
      if (id.startsWith("mem_")) for (const call of body.matchAll(/self\.(\w+)(?:::<[^>]*>)?\(/g)) expect(closure([id]) as string[]).toContain(`mem_${call[1]}`)
    }
  })

  test("the front runtime a code starts with is measured off the code, in any subset the module prints", () => {
    const body = "pub struct P {\n    pub s: IecString<5>,\n}\n"
    const front = IEC_STR + IEC_MAX + IEC_MIN + IEC_LREAL_TEXT + IEC_PARSE_REAL + IEC_PARSE_INT
    expect(frontLines(front + body)).toBe(front.split("\n").length - 1)
    expect(frontLines(IEC_STR + IEC_PARSE_INT + body)).toBe((IEC_STR + IEC_PARSE_INT).split("\n").length - 1)
    expect(frontLines(body)).toBe(0)
    // what `size` counts: the code without every registry text it holds, wherever it is printed
    expect(withoutRuntime(IEC_STR + body + "\n" + runtimeText("iec_div"))).toBe(body + "\n")
  })
})
