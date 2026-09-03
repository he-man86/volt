import { expect, test } from "bun:test"
import { startupWorkspace, workspaceArg } from "./startup.js"

// `--workspace <dir>` and `--workspace=<dir>` — both, because the CLI accepts both and `volt open` is what
// produces this argv. Accepting only one would work until someone typed the other.
test("both --workspace spellings are read", () => {
  expect(workspaceArg(["volt.exe", "--workspace", "C:/ws"])).toBe("C:/ws")
  expect(workspaceArg(["volt.exe", "--workspace=C:/ws"])).toBe("C:/ws")
})

// Electron injects flags of its own, and argv[0]/argv[1] are the exe and (in dev) the app path.
test("unrelated argv is ignored", () => {
  expect(workspaceArg(["Volt.exe", ".", "--inspect", "--no-sandbox"])).toBeUndefined()
  expect(workspaceArg([])).toBeUndefined()
})

// A trailing `--workspace` with nothing after it must not resolve to a garbage path.
test("a --workspace with no value yields nothing", () => {
  expect(workspaceArg(["Volt.exe", "--workspace"])).toBeUndefined()
  expect(workspaceArg(["Volt.exe", "--workspace="])).toBeUndefined()
})

// The precedence is the whole point: argv is the only channel that reaches an app that is ALREADY running, so it
// has to win over an environment that was read at start.
test("argv beats the environment, which beats the remembered workspace", () => {
  const recent = () => "C:/remembered"
  expect(startupWorkspace(["--workspace", "C:/argv"], "C:/env", recent)).toBe("C:/argv")
  expect(startupWorkspace([], "C:/env", recent)).toBe("C:/env")
  expect(startupWorkspace([], undefined, recent)).toBe("C:/remembered")
})

// Nothing named anywhere → unbound, and the app shows the picker. No fourth guess.
test("with nothing named, the app opens unbound", () => {
  expect(startupWorkspace([], undefined, () => undefined)).toBeUndefined()
})

// `recent` is a thunk so the store is not read when argv or env already decided — reading it LOGS when the
// remembered workspace has gone missing, and that line would be about a path nobody asked for.
test("the remembered workspace is not even read when something else decided", () => {
  let reads = 0
  const recent = () => {
    reads++
    return "C:/remembered"
  }

  startupWorkspace(["--workspace", "C:/argv"], undefined, recent)
  expect(reads).toBe(0)

  startupWorkspace([], "C:/env", recent)
  expect(reads).toBe(0)

  startupWorkspace([], undefined, recent)
  expect(reads).toBe(1)
})
