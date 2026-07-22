import { expect, test } from "bun:test"
import { formatProgress } from "./progress.js"

test("count leads, phase is the suffix", () => {
  expect(formatProgress({ done: 3, total: 10, phase: "fetch", phaseIndex: 0, phaseCount: 3 })).toEqual({
    pct: 10,
    message: "3/10 · fetch",
  })
})

test("phase without a count keeps the label", () => {
  expect(formatProgress({ done: 0, phase: "finalize" })).toEqual({ pct: undefined, message: "finalize" })
})

test("count alone when no phase label", () => {
  expect(formatProgress({ done: 5, total: 20 })).toEqual({ pct: 25, message: "5/20" })
})
