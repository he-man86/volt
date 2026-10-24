import { expect, test } from "bun:test"
import { buildDiagnosticWhere, describeBuildDiagnostic } from "./build.js"
import type { BuildDiagnostic } from "../bridge/actions.js"

const d = (over: Partial<BuildDiagnostic>): BuildDiagnostic => ({ severity: "error", message: "Unexpected statement", ...over })

// wire-final-shape 3.6b: `line` is a line of the item's file, so the position is `name:line`; the member a diagnostic is
// inside follows it — exactly as `volt build` prints it.
test("a diagnostic inside a member prints the position, then the member", () => {
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", member: "Execute", line: 51 }))).toBe("FB_Motor.pou:51 (Execute) ")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", member: "Execute", line: 51, column: 3 }))).toBe(
    "FB_Motor.pou:51:3 (Execute) ",
  )
})

test("a member with no line (every CODESYS diagnostic) still names the member", () => {
  expect(buildDiagnosticWhere(d({ name: "FB_DcnMeth.pou", member: "MExecute" }))).toBe("FB_DcnMeth.pou (MExecute) ")
})

test("a diagnostic on the item itself prints name:line[:column]", () => {
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", line: 12, column: 4 }))).toBe("FB_Motor.pou:12:4 ")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", line: 12 }))).toBe("FB_Motor.pou:12 ")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou" }))).toBe("FB_Motor.pou ")
})

// The CLI's rule: the position rides on the NAME. A column never appears without a line.
test("no name → no position at all; a column never appears without a line", () => {
  expect(buildDiagnosticWhere(d({ line: 12, column: 4 }))).toBe("")
  expect(buildDiagnosticWhere(d({ name: "FB_Motor.pou", column: 4 }))).toBe("FB_Motor.pou ")
})

test("the one-line description carries position, vendor code and message", () => {
  expect(
    describeBuildDiagnostic(d({ name: "FB_Motor.pou", member: "Execute", line: 51, code: "C0578" })),
  ).toBe("FB_Motor.pou:51 (Execute) C0578: Unexpected statement")
  expect(describeBuildDiagnostic(d({}))).toBe("Unexpected statement")
})
