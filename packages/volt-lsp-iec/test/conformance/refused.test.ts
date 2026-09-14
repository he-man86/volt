/**
 * Every source the execution oracle recorded CODESYS REFUSING to compile (a `refused` case) must be an LSP error too.
 *
 * The class fix for the LSP gaps the transpiler work keeps exposing (tasks.md "Found along the way"): the conformance
 * replay fails only on a false POSITIVE, so a construct the compiler rejects and the LSP silently accepts could stay
 * unnoticed forever. Here it is a failing row. The wording must match too — the fragment is CODESYS's own text.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../src/syntax/index.js"
import { buildSymbolTable } from "../../src/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../src/analysis/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"

const libraries = STANDARD_LIBRARY.map((l) => ({ ...l, parseResult: parseSource(l.source) }))

describe("every source CODESYS refuses is an LSP error (codesys)", () => {
  for (const c of ALL_TESTS.filter((x) => x.refused !== undefined)) {
    test(c.name, () => {
      const source = plcPrgSource(c)
      const parseResult = parseSource(source)
      const project = buildSymbolTable([{ uri: "PLC_PRG.prg", parseResult, source }, ...libraries])
      const errors = computeSemanticDiagnostics({ parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) })
        .filter((d) => d.severity === "error")
        .map((d) => d.message)
      expect(errors).toContainEqual(expect.stringContaining(c.refused!))
    })
  }
})
