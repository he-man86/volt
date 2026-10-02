/**
 * THE LIBRARY PATH RULE — `isLibraryUri` (a referenced library's signature, not project source) and `libraryOf` (which
 * library). It lived in `symbols/library-symbol.test.ts` and `symbols/symbols.test.ts` while the rule was the binder's.
 */
import { expect, test } from "bun:test"
import { isLibraryUri, libraryOf } from "./index.js"

// The guard identifies referenced-library symbols (skipped by member/section checks — library signatures are
// lossy re: properties). It must match BOTH the raw OS path (corpus/tests) and the file:// URI the live server
// keys symbols by (space → %20) — matching only the raw form silently disabled the skip under the real LSP.
test("isLibraryUri matches a raw OS path under Library Manager", () => {
  expect(isLibraryUri("Device/Plc Logic/Application/Library Manager/Util/X.pou" )).toBe(true)
})

test("isLibraryUri matches a file:// URI where the space is percent-encoded", () => {
  expect(isLibraryUri("file:///C:/proj/src/Application/Library%20Manager/Util/X.pou" )).toBe(true)
})

test("isLibraryUri is false for ordinary project source", () => {
  expect(isLibraryUri("src/Device/Application/01 Main/Main.pou" )).toBe(false)
  expect(isLibraryUri("file:///C:/proj/src/Main.pou" )).toBe(false)
})

test("libraryOf names the referenced library a file comes from — raw path, `file://` URI, or none", () => {
  expect(libraryOf({ uri: "C:\\proj\\Application\\Library Manager\\Standard\\LEN.pou" })).toBe("Standard")
  expect(libraryOf({ uri: "file:///c%3A/proj/Application/Library%20Manager/Util/BLINK.pou" })).toBe("Util")
  expect(libraryOf({ uri: "C:/proj/Application/POUs/PLC_PRG.pou" })).toBeUndefined()
})
