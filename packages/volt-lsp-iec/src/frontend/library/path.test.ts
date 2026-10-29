/**
 * THE LIBRARY PATH RULE — `isLibraryUri` (a referenced library's signature, not project source) and `libraryOf` (which
 * library). It lived in the old `symbols/library-symbol` and `symbols/symbols` tests while the rule was the binder's.
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

// openspec lsp-field-false-positives 8 (class 1): a client percent-encodes every character past ASCII, not only the
// space. A library folder named `Bibliothek_Ä` (or `运动控制`) is that name — in a workspace symbol's container and in
// the namespace binding that matches it against its manifest's folder — never `Bibliothek_%C3%84`.
test("libraryOf and isLibraryUri read the DECODED path — a library folder past ASCII is its own name", () => {
  expect(libraryOf({ uri: "file:///c%3A/proj/Library%20Manager/Bibliothek_%C3%84/X.pou" })).toBe("Bibliothek_Ä")
  expect(libraryOf({ uri: "file:///c%3A/proj/Library%20Manager/%E8%BF%90%E5%8A%A8%E6%8E%A7%E5%88%B6/X.pou" })).toBe("运动控制")
  expect(libraryOf({ uri: "C:\\proj\\Library Manager\\运动控制\\X.pou" })).toBe("运动控制")
  // a raw path holding a `%` is no URI: it is read as the path it is, never decoded
  expect(libraryOf({ uri: "C:\\proj\\Library Manager\\A%20B\\X.pou" })).toBe("A%20B")
  expect(isLibraryUri("file:///c%3A/p/Library%20Manager/%C3%84/X.pou")).toBe(true)
})
