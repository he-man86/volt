import { expect, test } from "bun:test"
import { buildDiagnosticWhere, describeBuildDiagnostic } from "./build.js"
import type { BuildDiagnostic } from "../bridge/actions.js"

const d = (over: Partial<BuildDiagnostic>): BuildDiagnostic => ({ severity: "error", message: "Unexpected statement", ...over })

// openspec codesys-diagnostic-child-names 5.4. On TwinCAT a diagnostic inside a method counts its line inside the
// METHOD (DIALECT D36), so `FB_Motor.pou:6` sends the engineer to the wrong line of the right file. The member is the
// frame of the line and is printed with it — exactly as `volt build` prints it.
test("a diagnostic inside a member prints the member between the name and the line", () => {
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", member: "Execute", line: 6 }))).toBe("FB_Motor.pou(Execute):6 ")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", member: "Execute", line: 6, column: 3 }))).toBe(
    "FB_Motor.pou(Execute):6:3 ",
  )
})

test("a member with no line (every CODESYS diagnostic) still names the member", () => {
  expect(buildDiagnosticWhere(d({ name: "FB_DcnMeth.pou", member: "MExecute", line: 0 }))).toBe("FB_DcnMeth.pou(MExecute) ")
})

test("a diagnostic on the item itself prints name:line[:column], as before", () => {
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", line: 12, column: 4 }))).toBe("FB_Motor.pou:12:4 ")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", line: 12 }))).toBe("FB_Motor.pou:12 ")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou" }))).toBe("FB_Motor.pou ")
})

// The CLI's rule: the position rides on the NAME. A project-level message can carry a line with no item (TwinCAT);
// printed alone it read `:12 message`. A column never appears without a line.
test("no name → no position at all; a column never appears without a line", () => {
  expect(buildDiagnosticWhere(d({ line: 12, column: 4 }))).toBe("")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", column: 4 }))).toBe("FB_Motor.pou ")
})

test("the one-line description carries position, vendor code and message", () => {
  expect(
    describeBuildDiagnostic(d({ name: "FB_Motor.pou", member: "Execute", line: 6, code: "C0578" })),
  ).toBe("FB_Motor.pou(Execute):6 C0578: Unexpected statement")
  expect(describeBuildDiagnostic(d({}))).toBe("Unexpected statement")
})
