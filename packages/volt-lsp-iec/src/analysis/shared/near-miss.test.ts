import { expect, test } from "bun:test"
import { changeToFixes, nearMisses } from "./near-miss.js"

test("near-miss: within two edits, case-insensitive, nearest first, then in candidate order", () => {
  expect(nearMisses("countr", ["counter", "count", "x", "COUNTER"])).toEqual(["counter", "count"])
  expect(nearMisses("vlaue", ["value", "valve", "values"])).toEqual(["value", "valve", "values"]) // a swap is one edit; the two at two edits in the order given
  expect(nearMisses("DIMT", ["TIME", "DINT", "WORD"])).toEqual(["DINT", "TIME"])
  expect(nearMisses("countr", ["countx", "counter"])).toEqual(["countx", "counter"]) // a nearer scope first
})

test("near-miss: never the written name itself, never more than three, never farther than two edits", () => {
  expect(nearMisses("Counter", ["counter"])).toEqual([])
  expect(nearMisses("ab", ["a", "b", "abc", "abd", "xb"])).toHaveLength(3)
  expect(nearMisses("level", ["lever_x", "leve1xx"])).toEqual([])
})

test("near-miss: 'Change to' replaces exactly the written name, plus what a rename adds", () => {
  const src = "x := countr;"
  const [fix] = changeToFixes(src, 5, 11, ["counter"])
  expect(fix!.title).toBe("Change to 'counter'")
  expect(fix!.edits.map((e) => [e.span.start, e.span.end, e.replaces, e.newText])).toEqual([[5, 11, "countr", "counter"]])
  expect(fix!.preferred).toBeUndefined()
})
