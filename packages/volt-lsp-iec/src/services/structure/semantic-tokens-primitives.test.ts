/**
 * semantic-tokens: elementary type names (P2). `INT`/`BOOL`/… are not in the symbol table, so the classifier
 * fell through to `variable` — mis-coloring a type name as a variable on every file. They should be `type`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import { semanticTokensData, SEMANTIC_TOKEN_TYPES } from "./semantic-tokens.js"

test("an elementary type name colors as `type`, not `variable`", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n\tn : INT;\n\tb : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const doc = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  const data = semanticTokensData(doc, project) as number[]
  const types: string[] = []
  for (let i = 0; i < data.length; i += 5) types.push(SEMANTIC_TOKEN_TYPES[data[i + 3]]!)
  expect(types).toContain("type") // INT / BOOL
})
