/**
 * Workspace symbols — members listed under their owner (openspec lsp-quick-fixes design.md §6 B5, tasks.md 2.4).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { workspaceSymbols } from "./workspace-symbol.js"
import type { Document } from "../shared/index.js"

function setupFiles(files: Record<string, string>) {
  const docs: Document[] = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const project = build.buildSymbolTable(docs.map((d) => ({ uri: d.uri, parseResult: d.parseResult, source: d.source })), [], "codesys")
  return { docs, project }
}
const MEMBERS = `TYPE E_Mode :
(
\tIdle,
\tRun
);
END_TYPE
INTERFACE I_Run
METHOD Go : BOOL
END_METHOD
END_INTERFACE
FUNCTION_BLOCK FB_Run IMPLEMENTS I_Run
VAR
\tlocalVar : INT;
END_VAR
END_FUNCTION_BLOCK
METHOD Go : BOOL
Go := TRUE;
END_METHOD
`

test("B5: workspace symbols list members under their owner — and no local", () => {
  const { project } = setupFiles({ "file:///m.pou": MEMBERS })
  const found = workspaceSymbols(project, "").map((s) => `${s.containerName ?? ""}/${s.name}`)
  expect(found).toEqual(expect.arrayContaining(["FB_Run/Go", "I_Run/Go", "E_Mode/Run", "E_Mode/Idle"]))
  expect(found.some((s) => s.endsWith("/localVar"))).toBe(false)
})
