/**
 * The writable-source extensions (`source-extensions.ts`, the literal set the wiring check reads) against the objects
 * the syntax layer reads them as (`sourceObjectOf`) — held to each other here, since the syntax layer may not import
 * this one (openspec frontend-conformance 1.5).
 */
import { expect, test } from "bun:test"
import { SOURCE_EXTENSIONS } from "./source-extensions.js"
import { sourceObjectOf } from "./frontend/syntax/index.js"

test("every writable-source extension names its object; nothing else does", () => {
  expect(Object.fromEntries(SOURCE_EXTENSIONS.map((e) => [e, sourceObjectOf(`file:///w/X${e}`)]))).toEqual({
    ".fb": "pou",
    ".prg": "pou",
    ".fun": "pou",
    ".itf": "interface",
    ".gvl": "gvl",
    ".struct": "dut",
    ".enum": "dut",
    ".union": "dut",
    ".alias": "dut",
  })
  // EXACT, as the crawl (`workspace-refs.ts`) and the CLI's classifier read extensions: `X.STRUCT` is a foreign file
  // `volt push` refuses, never the `X.struct` the IDE publishes. (This said "case-insensitive, as the crawl reads
  // extensions" — the crawl never did, so an open `X.GVL` was read as a GVL here and ignored there.)
  expect(sourceObjectOf("C:\\w\\X.STRUCT")).toBeUndefined()
  expect(sourceObjectOf("C:\\w\\X.Gvl")).toBeUndefined()
  // text that is no workspace file — a conformance fixture, the library repo — has no object to read it as
  expect(sourceObjectOf("unit.st")).toBeUndefined()
})
