/**
 * `dead-exports.ts --scope` (openspec transpile-restructure task 1.0.4): the scope keeps only the exports declared under
 * it, and `src/transpile` leaves out the IR union members and the barrel's deliberate surface.
 */
import { expect, test } from "bun:test"
import { irUnionMembers, nobodyIn, packageTexts } from "./dead-exports.js"

const texts = new Map<string, string>([
  [
    "src/transpile/ir/expr.ts",
    "export interface IrLoad { kind: 1 }\nexport interface IrConst { kind: 2 }\n" +
      "export type IrExpr =\n  | IrLoad\n  | IrConst\n\nexport const unusedIrHelper = 1\n",
  ],
  ["src/transpile/ir/stmt.ts", "export interface IrEval { kind: 3 }\nexport type IrStmt = IrEval\n"],
  ["src/transpile/lower/a.ts", "export function lowerSource() {}\nexport const ORPHAN = 1\nexport const USED = 2\n"],
  ["src/transpile/lower/b.ts", "import { USED } from './a.js'\n"],
  ["src/analysis/c.ts", "export const ELSEWHERE = 1\n"],
])

test("the IR union members are read from their declarations", () => {
  expect([...irUnionMembers(texts)].sort()).toEqual(["IrConst", "IrEval", "IrLoad"])
})

test("--scope src/transpile: only its own exports, less the union members, ir's types and the barrel surface", () => {
  expect(nobodyIn(texts, "src/transpile").map((r) => r.name)).toEqual(["unusedIrHelper", "ORPHAN"])
  expect(nobodyIn(texts, "src/analysis").map((r) => r.name)).toEqual(["ELSEWHERE"])
})

test("src/transpile exports nothing nobody reads (transpile-restructure 7.10.4)", () => {
  expect(nobodyIn(packageTexts(), "src/transpile").map((r) => `${r.name} ${r.file}`)).toEqual([])
})
