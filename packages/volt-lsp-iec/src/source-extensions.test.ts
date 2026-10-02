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
    // every DUT, whatever its shape (openspec push-without-header-check 5.P: the four subtype extensions are gone)
    ".dut": "dut",
  })
  // …and a split DUT name is a foreign file, like any extension no kind claims
  for (const e of [".struct", ".enum", ".union", ".alias"]) expect(sourceObjectOf(`file:///w/X${e}`)).toBeUndefined()
  // EXACT, as the crawl (`workspace-refs.ts`) and the CLI's classifier read extensions: `X.DUT` is a foreign file
  // `volt push` refuses, never the `X.dut` the IDE publishes. (This said "case-insensitive, as the crawl reads
  // extensions" — the crawl never did, so an open `X.GVL` was read as a GVL here and ignored there.)
  expect(sourceObjectOf("C:\\w\\X.DUT")).toBeUndefined()
  expect(sourceObjectOf("C:\\w\\X.Gvl")).toBeUndefined()
  // text that is no workspace file — a conformance fixture, the library repo — has no object to read it as
  expect(sourceObjectOf("unit.st")).toBeUndefined()
})
