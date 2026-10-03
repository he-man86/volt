import { describe, expect, test } from "bun:test"
import { ALL_TESTS } from "../fixtures/index.js"
import type { LanguageTest } from "../types.js"
import { assembleFixture } from "./fixture-units.js"

const st: LanguageTest = {
  name: "sfc_contract_st",
  pouName: "FB_LANG_sfc_contract_st",
  kind: "function_block",
  feature: "an ST function block",
  fromDoc: "lsp-sfc-step-names 1 (review)",
  source: "FUNCTION_BLOCK FB_LANG_sfc_contract_st\nVAR\n\tk : INT;\nEND_VAR\nk := 1;\nEND_FUNCTION_BLOCK\n",
}
const sfc: LanguageTest = {
  ...st,
  name: "sfc_contract_sfc",
  pouName: "PRG_LANG_sfc_contract_sfc",
  kind: "program",
  source: "PROGRAM PRG_LANG_sfc_contract_sfc\nVAR\n\tk : INT;\nEND_VAR\nIMPLEMENTATION SFC UNSUPPORTED\nEND_PROGRAM\n",
  sfcStep: "S_Boot",
}

/**
 * `sfcStep` is required of a fixture holding an SFC POU and refused on any other (`types.ts`) — on every path that
 * assembles a fixture, not only at record time: the check lived in `fixtureUnits` alone, so a stray or a lost `sfcStep`
 * passed the contract suite until the next `record:exec` (lsp-sfc-step-names 1, review).
 */
describe("sfcStep: exactly the fixtures holding an SFC POU", () => {
  test("a stray sfcStep on an ST fixture is refused by name where the suite assembles it", () => {
    expect(() => assembleFixture({ ...st, sfcStep: "X" }, [])).toThrow(/sfc_contract_st: names an sfcStep and holds no SFC POU/)
  })

  test("an SFC fixture that lost its sfcStep is refused by name where the suite assembles it", () => {
    const { sfcStep: _lost, ...lost } = sfc
    expect(() => assembleFixture(lost, [])).toThrow(/sfc_contract_sfc: .*SFC POU and the fixture names no sfcStep/)
  })

  test("both shapes assemble", () => {
    expect(() => assembleFixture(st, [])).not.toThrow()
    expect(() => assembleFixture(sfc, [])).not.toThrow()
  })

  test("every committed fixture keeps the contract", () => {
    for (const t of ALL_TESTS) expect(() => assembleFixture(t, ALL_TESTS), t.name).not.toThrow()
  })
})
