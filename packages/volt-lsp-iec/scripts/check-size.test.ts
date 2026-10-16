/**
 * The size gate (openspec transpile-restructure task 1.0.2; the whole package since lsp-same-standard task 1.1): green
 * on the real tree; on a scratch tree a 401-line file fails anywhere under `src/` or `test/`, a 601-line test fails,
 * `map.generated.ts` is exempt by name, a function over 80 lines fails — each named by its file (and function).
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
const fn = (name: string, n: number): string =>
  `export function ${name}(): number {\n  let x = 0\n${Array.from({ length: n - 4 }, () => "  x += 1\n").join("")}  return x\n}\n`

test("the real tree is within its limits", () => {
  expect(sizeReport().errors).toEqual([])
})

test("a new 401-line file fails anywhere under src/ or test/; 400 lines passes; scripts/ is not scanned", () => {
  const report = inScratch(
    {
      "src/analysis/big.ts": lines(401),
      "src/transpile/lower/ok.ts": lines(400),
      "test/conformance/support/big.ts": lines(401),
      "scripts/big.ts": lines(900),
    },
    (root) => sizeReport(root),
  )
  expect(report.errors).toEqual([
    "src/analysis/big.ts: 401 lines is over the 400-line limit — split it",
    "test/conformance/support/big.ts: 401 lines is over the 400-line limit — split it",
  ])
})

test("a test file may hold 600 lines, not 601; map.generated.ts is exempt by name, and only it", () => {
  const report = inScratch(
    {
      "src/server/a.test.ts": lines(601),
      "test/corpus/b.test.ts": lines(600),
      "test/conformance/fixtures/map.generated.ts": lines(5000),
      "test/conformance/fixtures/other.generated.ts": lines(401),
    },
    (root) => sizeReport(root),
  )
  expect(report.errors).toEqual([
    "src/server/a.test.ts: 601 lines is over the 600-line limit — split it",
    "test/conformance/fixtures/other.generated.ts: 401 lines is over the 400-line limit — split it",
  ])
})

test("a function over 80 lines fails, in src/ and in test/ support; 80 lines passes; a *.test.ts is not scanned", () => {
  const report = inScratch(
    {
      "src/analysis/a.ts": fn("fresh", 81) + fn("fits", 80),
      "test/frontend/support.ts": fn("helper", 82),
      "src/analysis/a.test.ts": fn("inTest", 200),
    },
    (root) => sizeReport(root),
  )
  expect(report.errors).toEqual([
    "function src/analysis/a.ts#fresh (line 1): 81 lines is over the 80-line limit — split it",
    "function test/frontend/support.ts#helper (line 1): 82 lines is over the 80-line limit — split it",
  ])
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

test("an interface's method signatures are no functions, though a function's body follows the interface", () => {
  // the signature's return type ends where the interface closes — the `{` of the function after it is no body of it
  const members = Array.from({ length: 90 }, (_, k) => `  m${k}(a: string): string\n`).join("")
  const text = `export interface I {\n${members}}\n\nexport function f(): I {\n${body(5)}  return x\n}\n`
  expect(longFunctions("f.ts", text)).toEqual([])
})

test("braces in strings, templates, comments and regexes are not code", () => {
  const code = codeOnly('const a = "{" + `x${"}"}y{` // {\nconst r = /[{}]/g /* } */\nconst d = 4 / 2 / 1\n')
  expect(code.replace(/[^{}\n/]/g, "")).toEqual("{}\n//\n//\n")
  expect(lineCount("a\nb\n")).toBe(2)
  expect(lineCount("a\nb")).toBe(2)
})
