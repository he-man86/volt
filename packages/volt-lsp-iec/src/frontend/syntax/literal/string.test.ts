import { test, expect } from "bun:test"
import { decodeStringLiteral } from "./string.js"

test("a hex escape is decoded through CP1252 and stored as UTF-8", () => {
  const len = (text: string): number => decodeStringLiteral(text)!.length
  expect(len("$41")).toBe(1) // ASCII
  expect(len("$83")).toBe(2) // ƒ  U+0192 — defined in CP1252, below U+0800
  expect(len("$80")).toBe(3) // €  U+20AC — the cell that ruled the Latin-1 reading out
  expect(len("$92")).toBe(3) // '  U+2019
  expect(len("$8D")).toBe(2) // UNDEFINED in CP1252, so it stays U+008D
  expect(len("$FF")).toBe(2) // ÿ  U+00FF — CP1252 agrees with Latin-1 here
  expect(len("a$80b")).toBe(5)
  // the € really is the three UTF-8 bytes of U+20AC, not three of anything else
  expect([...decodeStringLiteral("$80")!].map((c) => c.charCodeAt(0))).toEqual([0xe2, 0x82, 0xac])
})
