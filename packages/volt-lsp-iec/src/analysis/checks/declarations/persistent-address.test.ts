/**
 * persistent-address — C0215: a direct-address (`AT %…`) binding in a PERSISTENT var list. A persistent var
 * without an address, and an AT-mapped var in a non-persistent section, both stay silent.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.gvl", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "persistent-direct-address")
    .map((d) => d.message)
}

test("C0215: an AT address in a PERSISTENT list is flagged", () => {
  expect(msgs(`VAR_GLOBAL PERSISTENT RETAIN\n  directAddressVar AT %QB7 : BYTE;\nEND_VAR`)).toEqual([
    "Direct address declaration is not possible in persistent list",
  ])
})

test("C0215: a persistent var without an address, or an AT var in a non-persistent list, is not flagged", () => {
  expect(msgs(`VAR_GLOBAL PERSISTENT\n  x : INT;\nEND_VAR`)).toEqual([])
  expect(msgs(`VAR_GLOBAL\n  mapped AT %QB7 : BYTE;\nEND_VAR`)).toEqual([])
})
