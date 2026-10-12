import { expect, test } from "bun:test"
import { join } from "node:path"
import { resolveVoltCli } from "./cli-path.js"

// The installer (installer/Volt.iss) lays the CLI down at the FIXED {localappdata}\Programs\Volt\bin\volt.exe — no
// `current` junction any more (openspec installer-rebuild). Resolving the old path returned undefined on every new
// install, and the extension fell back to `volt` on PATH: `spawn volt ENOENT` in an editor started before the install.
const exe = process.platform === "win32" ? "volt.exe" : "volt"
const local = join("C:", "Users", "me", "AppData", "Local")

test("resolves the installed CLI at Programs/Volt/bin", () => {
  const installed = join(local, "Programs", "Volt", "bin", exe)
  expect(resolveVoltCli({ LOCALAPPDATA: local }, (p) => p === installed)).toBe(installed)
})

test("does not name the deleted current/bin layout", () => {
  const old = join(local, "Programs", "Volt", "current", "bin", exe)
  expect(resolveVoltCli({ LOCALAPPDATA: local }, (p) => p === old)).toBeUndefined()
})

test("no install → undefined (the caller falls back to PATH)", () => {
  expect(resolveVoltCli({ LOCALAPPDATA: local }, () => false)).toBeUndefined()
  expect(resolveVoltCli({}, () => true)).toBeUndefined()
})
