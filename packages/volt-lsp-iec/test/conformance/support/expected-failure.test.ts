import { describe, expect, test } from "bun:test"
import { expectStillDiverges, markRef } from "./expected-failure.js"

const mismatch = () => {
  throw new Error("expected 11, received 10\nmore detail")
}
const match = () => {}

describe("a known divergence runs as an expected failure", () => {
  test("a fake fixture that still fails passes, and says why", () => {
    expect(expectStillDiverges("fake_fixture", "task 16: measured", [match, mismatch])).toEqual({
      verdict: "still-diverges",
      why: "expected 11, received 10",
    })
  })

  test("a fake fixture that starts passing fails the suite, naming the mark to remove", () => {
    expect(() => expectStillDiverges("fake_fixture", "transpile-review-2026-09-29 task 16: measured", [match, match])).toThrow(
      "fixture fake_fixture now matches CODESYS — remove its divergence mark (task 16)",
    )
  })

  test("every half has to match — one oracle agreeing is not the fixture matching", () => {
    expect(expectStillDiverges("fake_fixture", "task 29", [mismatch, match]).verdict).toBe("still-diverges")
  })

  test("a half this run could not measure makes a passing check inconclusive, never a verdict", () => {
    expect(expectStillDiverges("fake_fixture", "task 29", [match, undefined])).toEqual({ verdict: "inconclusive" })
    expect(expectStillDiverges("fake_fixture", "task 29", [undefined, mismatch]).verdict).toBe("still-diverges")
  })

  test("the oracle is named in the message", () => {
    expect(() => expectStillDiverges("fake_fixture", "known", [match], "twincat's build")).toThrow("now matches twincat's build")
  })

  test("a mark names its task, or its own opening words when it has none", () => {
    expect(markRef("transpile-review-2026-09-29 task 2.3: a constant")).toBe("task 2.3")
    expect(markRef("COS near π/2 differs")).toBe('"COS near π/2 differs"')
  })
})
