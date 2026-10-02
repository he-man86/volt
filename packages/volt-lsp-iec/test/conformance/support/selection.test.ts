import { describe, expect, test } from "bun:test"
import { selectFixtures } from "./selection.js"

const all = ["a", "b", "c", "d"].map((name) => ({ name }))
const quiet = { warn: () => {} }

describe("VOLT_FIXTURES — a partial run of the fixture contract", () => {
  test("unset: the whole suite, in order", () => {
    const s = selectFixtures(all, {}, quiet)
    expect(s.partial).toBe(false)
    expect(s.selected.map((t) => t.name)).toEqual(["a", "b", "c", "d"])
    expect(s.has("d")).toBe(true)
  })

  test("named: exactly those fixtures, in suite order, and the run says it is partial", () => {
    const said: string[] = []
    const s = selectFixtures(all, { VOLT_FIXTURES: " c , a" }, { warn: (m) => said.push(m) })
    expect(s.partial).toBe(true)
    expect(s.selected.map((t) => t.name)).toEqual(["a", "c"])
    expect(s.has("a")).toBe(true)
    expect(s.has("b")).toBe(false)
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/PARTIAL.*2 of 4/)
  })

  test("an unknown name throws, naming it — never a run of 0 fixtures that reads green", () => {
    expect(() => selectFixtures(all, { VOLT_FIXTURES: "a,nope,zip" }, quiet)).toThrow(/nope, zip/)
  })

  test("a value that names nothing throws", () => {
    expect(() => selectFixtures(all, { VOLT_FIXTURES: "" }, quiet)).toThrow(/names no fixture/)
    expect(() => selectFixtures(all, { VOLT_FIXTURES: " , " }, quiet)).toThrow(/names no fixture/)
  })

  test("CI and VOLT_REQUIRE_FULL=1 refuse a partial run", () => {
    expect(() => selectFixtures(all, { VOLT_FIXTURES: "a", CI: "true" }, quiet)).toThrow(/CI/)
    expect(() => selectFixtures(all, { VOLT_FIXTURES: "a", VOLT_REQUIRE_FULL: "1" }, quiet)).toThrow(/VOLT_REQUIRE_FULL/)
    // …and a full run there is fine
    expect(selectFixtures(all, { CI: "true", VOLT_REQUIRE_FULL: "1" }, quiet).partial).toBe(false)
  })
})
