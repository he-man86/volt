import { test, expect } from "bun:test"
import { isLibrarySymbol, isLibraryUri } from "./_shared.js"

// The guard identifies referenced-library symbols (skipped by member/section checks — library signatures are
// lossy re: properties). It must match BOTH the raw OS path (corpus/tests) and the file:// URI the live server
// keys symbols by (space → %20) — matching only the raw form silently disabled the skip under the real LSP.
test("isLibrarySymbol matches a raw OS path under Library Manager", () => {
  expect(isLibrarySymbol({ uri: "Device/Plc Logic/Application/Library Manager/Util/X.fb" })).toBe(true)
})

test("isLibrarySymbol matches a file:// URI where the space is percent-encoded", () => {
  expect(isLibrarySymbol({ uri: "file:///C:/proj/src/Application/Library%20Manager/Util/X.fb" })).toBe(true)
})

test("isLibrarySymbol is false for ordinary project source", () => {
  expect(isLibrarySymbol({ uri: "src/Device/Application/01 Main/Main.prg" })).toBe(false)
  expect(isLibrarySymbol({ uri: "file:///C:/proj/src/Main.prg" })).toBe(false)
})

test("isLibraryUri is the shared predicate — same match, raw + %20 forms", () => {
  expect(isLibraryUri("Device/Application/Library Manager/Util/X.fb")).toBe(true)
  expect(isLibraryUri("file:///C:/proj/src/Application/Library%20Manager/Util/X.fb")).toBe(true)
  expect(isLibraryUri("file:///C:/proj/src/Main.prg")).toBe(false)
})
