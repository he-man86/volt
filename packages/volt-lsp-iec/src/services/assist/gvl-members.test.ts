/**
 * GVL-qualified member completion (P1). `GvlName.field` — a GVL block has no child scope; its vars live flat
 * on the project scope tagged by the block uri, so completion has to collect by uri, not `findChildScope`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import { completion } from "./completion.js"

test("completion after `GVL.` offers the GVL's globals (incl. qualified_only)", () => {
  const gvl = `{attribute 'qualified_only'}\nVAR_GLOBAL\n speed : INT;\n mode : BOOL;\nEND_VAR`
  const prg = `PROGRAM PLC_PRG\nVAR\n x : INT;\nEND_VAR\nx := GVL.speed;\nEND_PROGRAM`
  const inputs = [
    { uri: "file:///GVL.gvl", source: gvl, parseResult: parseSource(gvl) },
    { uri: "file:///P.prg", source: prg, parseResult: parseSource(prg) },
  ]
  const project = buildSymbolTable(inputs)
  const labels = (completion(inputs[1], project, prg.indexOf("GVL.") + 4) ?? []).map((c) => c.label)
  expect(labels.sort()).toEqual(["mode", "speed"])
})
