/**
 * A REFERENCED LIBRARY'S MANIFEST — what `parseLibraryManifest` reads from `<folder>.library`. Here: where the manifest
 * sits (`dir`, as written — the library repo names the bodies it adds beside the declarations by it) against the folder
 * the declarations are recognised by (`folder`, lower case).
 */
import { expect, test } from "bun:test"
import { parseLibraryManifest } from "./index.js"

const SOURCE = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.18.0 (System)\n"

test("dir is the manifest's directory exactly as its uri writes it — case, separators and %20 kept", () => {
  const raw = parseLibraryManifest("C:\\Proj\\Library Manager\\Standard\\Standard.library", SOURCE)!
  expect(raw.dir).toBe("C:\\Proj\\Library Manager\\Standard\\")
  expect(raw.folder).toBe("standard")
  const uri = parseLibraryManifest("file:///c:/Proj/Library%20Manager/Standard/Standard.library", SOURCE)!
  expect(uri.dir).toBe("file:///c:/Proj/Library%20Manager/Standard/")
})

test("a manifest uri with no directory is not read as a manifest (it has no folder, so no dir)", () => {
  expect(parseLibraryManifest("Standard.library", SOURCE)?.dir).toBeUndefined()
})
