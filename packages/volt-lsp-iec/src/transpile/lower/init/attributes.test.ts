/**
 * Lowering tests of `attributes.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

// {attribute 'instance-path'} (user decision 2026-09-15): the path from the project tree — the device folder, the application
// folder, then the instance hierarchy — set once at start. Without a project tree there is nothing to take it from.
test("an instance-path STRING holds Device.Application and the instance's path; refused outside a project tree", () => {
  const source =
    "PROGRAM PLC_PRG\nVAR outer : FB_Outer; direct : FB_Path; END_VAR\nouter();\nEND_PROGRAM\nFUNCTION_BLOCK FB_Outer\nVAR inner : FB_Path; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Path\nVAR\n\t{attribute 'instance-path'}\n\t{attribute 'noinit'}\n\tsPath : STRING(255);\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  const { pou, diagnostics } = lowerSource(source, "PLC_PRG", [], "C:/work/Line1/Device/Plc Logic/Application/PLC_PRG.pou")
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  expect([runner.get("direct.sPath"), runner.get("outer.inner.sPath")]).toEqual(["Device.Application.PLC_PRG.direct", "Device.Application.PLC_PRG.outer.inner"])
  expect(lowerSource(source, "PLC_PRG").diagnostics.map((d) => d.code)).toEqual(["attr-instance-path"])
  // openspec lsp-field-false-positives 8 (class 1): a client's uri percent-encodes the tree — `Plc%20Logic` is the node
  // `Plc Logic`, a device and an application past ASCII are their own names
  const uri = "file:///c%3A/work/Line1/Ger%C3%A4t/Plc%20Logic/Anwendung_%C3%9C/PLC_PRG.pou"
  const fromUri = lowerSource(source, "PLC_PRG", [], uri)
  expect(fromUri.diagnostics).toEqual([])
  expect(run(fromUri.pou!).get("direct.sPath")).toBe("Gerät.Anwendung_Ü.PLC_PRG.direct")
})
