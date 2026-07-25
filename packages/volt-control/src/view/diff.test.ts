import { expect, test } from "bun:test"
import { lineDiff } from "./diff.js"

test("identical text → all context, no +/-", () => {
	const d = lineDiff("a\nb\nc\n", "a\nb\nc\n")
	expect(d.every((l) => l.tag === " ")).toBe(true)
	expect(d.map((l) => l.text)).toEqual(["a", "b", "c"])
})

test("a changed middle line is one del + one add, context preserved", () => {
	const d = lineDiff("a\nb\nc\n", "a\nB\nc\n")
	expect(d).toEqual([
		{ tag: " ", text: "a" },
		{ tag: "-", text: "b" },
		{ tag: "+", text: "B" },
		{ tag: " ", text: "c" },
	])
})

test("pure add (empty left) → all additions; pure delete (empty right) → all removals", () => {
	expect(lineDiff("", "x\ny").every((l) => l.tag === "+")).toBe(true)
	expect(lineDiff("x\ny", "").every((l) => l.tag === "-")).toBe(true)
	expect(lineDiff("", "")).toEqual([])
})

test("trailing newline is not a spurious change", () => {
	expect(lineDiff("a\nb", "a\nb\n").every((l) => l.tag === " ")).toBe(true)
})
