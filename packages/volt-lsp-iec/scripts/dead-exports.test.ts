/**
 * `dead-exports.ts` (openspec transpile-restructure task 1.0.4; lsp-same-standard task 1.1): a scope keeps only the
 * exports declared under it, less every exported union's members and the transpile barrel's deliberate surface; the
 * `--gate` fails on a NOBODY export the allowlist does not name and on a listed one that is no longer dead.
 */
import { expect, test } from "bun:test"
import { deadExportReport, exportRows, nobodyIn, packageTexts, unionMembers } from "./dead-exports.js"

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
  [
    "src/frontend/syntax/ast/nodes.ts",
    "export interface IfStatement { kind: 'if' }\nexport interface ForStatement { kind: 'for' }\n" +
      "export type Statement = IfStatement | ForStatement | Imported\nexport type Alias = IfStatement\n",
  ],
  ["src/frontend/syntax/ast/other.ts", "export interface Imported { kind: 'x' }\n"],
])

test("the members of every exported union are read from its declaration — exported beside it, union only, keyed by file", () => {
  // `IrEval` is an alias target, not a union member; `Imported` is declared in another file
  expect([...unionMembers(texts)].sort()).toEqual([
    "ForStatement src/frontend/syntax/ast/nodes.ts",
    "IfStatement src/frontend/syntax/ast/nodes.ts",
    "IrConst src/transpile/ir/expr.ts",
    "IrLoad src/transpile/ir/expr.ts",
  ])
})

test("--scope: only its own exports, less the union members, ir's types and the barrel surface", () => {
  expect(nobodyIn(texts, "src/transpile").map((r) => r.name)).toEqual(["unusedIrHelper", "ORPHAN"])
  expect(nobodyIn(texts, "src/analysis").map((r) => r.name)).toEqual(["ELSEWHERE"])
  expect(nobodyIn(texts, "src/frontend").map((r) => r.name)).toEqual(["Statement", "Alias"])
})

test("--gate: a NOBODY export not allowlisted fails by name and file; a listed one no longer dead is stale", () => {
  const report = deadExportReport(texts, ["ORPHAN src/transpile/lower/a.ts", "USED src/transpile/lower/a.ts"])
  expect(report.unexpected).toEqual([
    "unusedIrHelper src/transpile/ir/expr.ts",
    "ELSEWHERE src/analysis/c.ts",
    "Statement src/frontend/syntax/ast/nodes.ts",
    "Alias src/frontend/syntax/ast/nodes.ts",
  ])
  expect(report.stale).toEqual(["USED src/transpile/lower/a.ts"])
})

test("an exclusion is bound to its declaring file: a same-named dead export elsewhere is still reported", () => {
  // The transpile surface is a hand list: its names are excluded only where src/transpile/ declares them, so a dead
  // `IrValue` or `lowerSource` in services/ is reported. (A namesake of a union member or an `ir/` type is never NOBODY
  // — the declaring file mentions the word — so those halves are pinned by the keyed `unionMembers` test above.)
  const texts = new Map<string, string>([
    ["src/transpile/ir/program.ts", "export type IrValue = number\n"],
    ["src/transpile/index.ts", "export type { IrValue } from './ir/program.js'\n"],
    ["src/services/x.ts", "export function IrValue() {}\nexport const lowerSource = 1\n"],
  ])
  expect(deadExportReport(texts, [])).toEqual({ unexpected: ["lowerSource src/services/x.ts"], stale: [] })
  const alone = new Map([["src/services/x.ts", "export function IrValue() {}\nexport const lowerSource = 1\n"]])
  expect(deadExportReport(alone, [])).toEqual({
    unexpected: ["IrValue src/services/x.ts", "lowerSource src/services/x.ts"],
    stale: [],
  })
})

test("the gates' own files, tests included, are not a use: a name they plant cannot keep a real export alive", () => {
  const texts = new Map<string, string>([
    ["src/a.ts", "export const Planted = 1\n"],
    ["scripts/dead-exports.ts", "Planted\n"],
    ["scripts/dead-exports.test.ts", "Planted\n"],
    ["scripts/check-size.ts", "Planted\n"],
    ["scripts/check-size.test.ts", "Planted\n"],
  ])
  expect(exportRows(texts)).toEqual([{ name: "Planted", file: "src/a.ts", src: 0, test: 0, script: 0 }])
})

test("src/ exports nothing nobody reads, but the allowlist (lsp-same-standard 1.1; transpile-restructure 7.10.4)", () => {
  const texts = packageTexts()
  expect(deadExportReport(texts)).toEqual({ unexpected: [], stale: [] })
  expect(nobodyIn(texts, "src/transpile").map((r) => `${r.name} ${r.file}`)).toEqual([])
})
