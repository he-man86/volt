/**
 * detectVendor — vendor auto-detection from workspace signals (used by `volt init` + the VS Code
 * extension). Untested before; pins the strong file signals, content signals, and the empty/undecided
 * fallback on hermetic temp workspaces.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectVendor } from "./detect-vendor.js"

let base: string
const dir = (name: string, files: Record<string, string>): string => {
  const d = join(base, name)
  mkdirSync(d, { recursive: true })
  for (const [f, content] of Object.entries(files)) writeFileSync(join(d, f), content)
  return d
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "volt-vendor-"))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

test("a TwinCAT file signal (.tcpou) wins → twincat", async () => {
  expect(await detectVendor(dir("tc-file", { "Fb.TcPOU": "<TcPlcObject></TcPlcObject>" }))).toBe("twincat")
})

test("a CODESYS `.project` (with the CodeSysProject marker) → codesys", async () => {
  expect(await detectVendor(dir("cs-file", { "App.project": "<?xml version='1.0'?><CodeSysProject></CodeSysProject>" }))).toBe(
    "codesys",
  )
})

test("a TwinCAT content signal (`{attribute 'Tc…'}`) in kind-named source → twincat", async () => {
  expect(await detectVendor(dir("tc-content", { "Fb.fb": "{attribute 'TcLinkTo'}\nFUNCTION_BLOCK Fb\nEND_FUNCTION_BLOCK" }))).toBe(
    "twincat",
  )
})

test("a CODESYS content signal (`__POOL`) in kind-named source → codesys", async () => {
  expect(await detectVendor(dir("cs-content", { "Fb.fb": "FUNCTION_BLOCK Fb\nx := __POOL;\nEND_FUNCTION_BLOCK" }))).toBe(
    "codesys",
  )
})

test("no signals → undefined (caller picks its own default)", async () => {
  expect(await detectVendor(dir("empty", { "readme.txt": "nothing plc here" }))).toBeUndefined()
})

test("a nonexistent workspace → undefined, never throws", async () => {
  expect(await detectVendor(join(base, "does-not-exist"))).toBeUndefined()
})
