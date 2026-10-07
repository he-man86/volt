/**
 * The size ratchet (openspec transpile-restructure task 1.0.2): green on the real tree with its ceilings; on a scratch
 * tree a new 401-line file fails, a 601-line test fails, a file over its ceiling fails, a stale ceiling fails, and a
 * function over 80 lines is listed — by its name and first line.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { codeOnly, lineCount, longFunctions, sizeReport } from "./check-size.js"

function inScratch<T>(files: Record<string, string>, run: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "volt-size-"))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const lines = (n: number): string => Array.from({ length: n }, (_, k) => `export const v${k} = ${k}\n`).join("")

test("the real tree is within its limits or its ceilings", () => {
  expect(sizeReport().errors).toEqual([])
})

test("a new 401-line file fails; 400 lines passes", () => {
  const report = inScratch(
    { "src/transpile/lower/big.ts": lines(401), "src/transpile/lower/ok.ts": lines(400) },
    (root) => sizeReport(root, {}),
  )
  expect(report.errors).toEqual(["src/transpile/lower/big.ts: 401 lines is over the 400-line limit (a new oversize file)"])
})

test("a test file may hold 600 lines, not 601", () => {
  const report = inScratch(
    { "src/transpile/lower/a.test.ts": lines(601), "src/transpile/lower/b.test.ts": lines(600) },
    (root) => sizeReport(root, {}),
  )
  expect(report.errors).toEqual(["src/transpile/lower/a.test.ts: 601 lines is over the 600-line limit (a new oversize file)"])
})

test("a ceiling may not rise, a stale one fails, a shrunk file is told its new ceiling", () => {
  const report = inScratch(
    {
      "src/transpile/lower/grew.ts": lines(451),
      "src/transpile/lower/shrank.ts": lines(420),
      "src/transpile/lower/fits.ts": lines(390),
    },
    (root) =>
      sizeReport(root, {
        "lower/grew.ts": 450,
        "lower/shrank.ts": 430,
        "lower/fits.ts": 500,
        "lower/gone.ts": 500,
      }),
  )
  expect(report.errors).toEqual([
    "src/transpile/lower/fits.ts: 390 lines is within the 400-line limit — remove its ceiling",
    "src/transpile/lower/grew.ts: 451 lines is over its ceiling of 450 (the ceilings only fall)",
    "src/transpile/lower/gone.ts: listed with a ceiling but does not exist — remove its ceiling",
  ])
  expect(report.lower).toEqual(["src/transpile/lower/shrank.ts: 420 lines — lower its ceiling from 430 to 420"])
})

const body = (n: number): string => Array.from({ length: n }, (_, k) => `  x += ${k}\n`).join("")

test("functions over 80 lines are listed by name and first line: declarations, methods, arrows", () => {
  const text =
    `export function short(): number {\n${body(10)}  return x\n}\n` + // lines 1-13
    `export function long(a: { b: number }): { c: string } {\n${body(80)}  return x\n}\n` + // 14-96
    `class K {\n  private method(x: number): void {\n${body(79)}  }\n}\n` + // 97-179
    `const arrow = (a: number) => {\n${body(85)}}\n` // 180-266
  const found = longFunctions("f.ts", text)
  expect(found.map((f) => [f.name, f.line, f.lines])).toEqual([
    ["long", 14, 83],
    ["method", 98, 81],
    ["arrow", 180, 87],
  ])
})

test("braces in strings, templates, comments and regexes are not code", () => {
  const code = codeOnly('const a = "{" + `x${"}"}y{` // {\nconst r = /[{}]/g /* } */\nconst d = 4 / 2 / 1\n')
  expect(code.replace(/[^{}\n/]/g, "")).toEqual("{}\n//\n//\n")
  expect(lineCount("a\nb\n")).toBe(2)
  expect(lineCount("a\nb")).toBe(2)
})
