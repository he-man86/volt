/** The IDE path grammar (transpile-restructure 1.2.5): one reader for `Runner.get` and `rustAccess`. */
import { expect, test } from "bun:test"
import { namesVariable, parsePath } from "./path.js"

test("names and indices, one index segment per dimension", () => {
  expect(parsePath("count")).toEqual([{ kind: "name", name: "count" }])
  expect(parsePath("inst.q")).toEqual([
    { kind: "name", name: "inst" },
    { kind: "name", name: "q" },
  ])
  expect(parsePath("arr[2].x")).toEqual([
    { kind: "name", name: "arr" },
    { kind: "index", index: 2n },
    { kind: "name", name: "x" },
  ])
  expect(parsePath("a[1, -2]")).toEqual([
    { kind: "name", name: "a" },
    { kind: "index", index: 1n },
    { kind: "index", index: -2n },
  ])
})

test("a backtick-quoted name comes back unquoted, and names its quoted declaration either way", () => {
  expect(parsePath("fb.`TYPE`")).toEqual([
    { kind: "name", name: "fb" },
    { kind: "name", name: "TYPE" },
  ])
  expect(namesVariable("`TYPE`", "type")).toBe(true)
  expect(namesVariable("Count", "COUNT")).toBe(true)
  expect(namesVariable("count", "counter")).toBe(false)
})

test("an index that is no integer is refused by the parse", () => {
  expect(() => parsePath("a[i]")).toThrow()
})
