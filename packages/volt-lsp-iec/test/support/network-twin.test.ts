/**
 * THE EXEC TWIN'S MEASURED RULES, one small network each (openspec network-text-st 2.4; `network-twin.ts`). The corpus
 * gate (`test/corpus/corpus-twins.test.ts`) builds the twins; these pin WHAT a twin runs where 1.3 / 1.4 measured it.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../src/frontend/syntax/index.js"
import { build } from "../../src/frontend/symbols/index.js"
import { twinFile } from "./network-twin.js"

function twin(decls: string, body: string): { source: string; refused: string[] } {
  const source = `PROGRAM P\nVAR\n${decls}\nEND_VAR\n%LANGUAGE FBD\n${body}END_PROGRAM\n`
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "file:///P.pou", parseResult, source }], [], "codesys")
  return twinFile(source, parseResult, project)
}

/** The ST lines of the twin's body, without its VAR block. */
const code = (source: string) => source.slice(source.indexOf("%LANGUAGE ST\n") + "%LANGUAGE ST\n".length, source.indexOf("END_PROGRAM")).trim()

test("an enabled box read by its value under a coil holds the coil when disabled (1.4: IF en THEN x := <box>; END_IF)", () => {
  const t = twin("\ty : INT := 5;\n\tk : INT := 7;\n\tc : BOOL;", "%NETWORK\n%WIRES w1\nMOVE_EN(EN := c, k, OUT => w1);\ny := w1;\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\ty := k;\nEND_IF;")
})

test("an enabled comparison read by its value is FALSE when disabled (1.3)", () => {
  const t = twin("\tx : BOOL;\n\ti : INT;\n\tc : BOOL;", "%NETWORK\n%WIRES w1\nGT_EN(EN := c, i, 3, OUT => w1);\nx := w1;\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\tvtw1_w1 := (i > 3);\nELSE\n\tvtw1_w1 := FALSE;\nEND_IF;\nx := vtw1_w1;")
})
