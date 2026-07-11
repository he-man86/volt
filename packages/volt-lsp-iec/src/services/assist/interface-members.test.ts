/**
 * Interface-typed member access (P1). `drv : IDrive; drv.Spin(…)` must complete/hover/sig-help through the
 * interface's members. Before the `interface` Type kind, `resolveTypeExpr(IDrive)` yielded UNKNOWN → completion
 * fell back to scope symbols and hover on the member wrongly matched a builtin operator.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import type { Document } from "../shared/index.js"
import { hover } from "./hover.js"
import { completion } from "./completion.js"
import { signatureHelp } from "./signature-help.js"

const SRC = `INTERFACE IDrive
METHOD Spin : BOOL
VAR_INPUT
    dist : INT;
END_VAR
END_METHOD
PROPERTY Pos : INT
END_INTERFACE
PROGRAM PLC_PRG
VAR
    drv : IDrive;
    r : BOOL;
    n : INT;
END_VAR
r := drv.Spin(10);
n := drv.Pos;
END_PROGRAM`

const setup = () => {
  const parseResult = parseSource(SRC)
  const doc: Document = { uri: "file:///F.fb", source: SRC, parseResult }
  return { doc, project: buildSymbolTable([{ uri: doc.uri, parseResult, source: SRC }]) }
}

test("completion after an interface instance's `.` offers its members", () => {
  const { doc, project } = setup()
  const labels = (completion(doc, project, SRC.indexOf("drv.") + 4) ?? []).map((c) => c.label)
  expect(labels).toContain("Spin")
  expect(labels).toContain("Pos")
})

test("hover on an interface method shows the method, not a builtin operator", () => {
  const { doc, project } = setup()
  const value = (hover(doc, project, SRC.indexOf("drv.Spin") + 4) as { contents?: { value?: string } })?.contents?.value ?? ""
  expect(value).toContain("Spin")
  expect(value).not.toContain("MOVE")
})

test("signature help resolves the interface method's parameters", () => {
  const { doc, project } = setup()
  const sig = signatureHelp(doc, project, SRC.indexOf("Spin(10") + 5) as { signatures?: { label: string }[] }
  expect(sig?.signatures?.[0]?.label).toBe("Spin(dist : INT)")
})
