import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { snapshot } from "./panel.js"

// shell.html is the renderer — a static file loaded at runtime, so nothing type-checks or bundles it, and a
// syntax error in its <script> silently kills EVERY handler: the rail still draws (static HTML) but clicking a
// tab does nothing, so the whole IDE panel becomes unopenable. That shipped — a confirm() message written across
// two source lines put a raw newline INSIDE a string literal (must be \n), which is a SyntaxError that took down
// tab()/setOpen() and everything else. Parse the script the way the browser would; `new Function` throws on
// exactly that class without running any of it.
test("shell.html's script parses (a syntax error there makes the whole IDE panel unopenable)", () => {
  const html = readFileSync(join(import.meta.dir, "..", "shell.html"), "utf8")
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
  expect(script, "shell.html has no <script> block").toBeTruthy()
  expect(() => new Function(script!)).not.toThrow()
})

// panel.ts is electron-free (the renderer draws the pixels); snapshot() is the pure shell → shared view-model
// projection. Smoke it so the desktop package enters the CI gate and the init surface keeps naming projects.
const proj = {
  id: "codesys::MyMachine:",
  displayName: "MyMachine",
  vendor: "codesys" as const,
  dirty: false,
  connected: true,
}

// The parity point behind the vscode fix: the desktop init surface shows the detected project NAME. The unbound
// snapshot carries the picker as `surface` (partitioned by @volt/control) — an unbound folder is a `create` surface.
test("unbound snapshot carries the detected projects as a create surface (so the init surface can name them)", () => {
  const snap = snapshot({ projects: [proj], status: undefined, connectorUp: true } as never)
  expect(snap.bound).toBe(false)
  expect(snap.surface.kind).toBe("create")
  expect(snap.surface.create.map((p) => p.displayName)).toEqual(["MyMachine"])
})

// The onboarding gap: connector-down vs no-project must be distinguishable — snapshot carries connectorUp so the
// renderer can say "Connector isn't running" instead of the misleading "no project detected".
test("snapshot carries connectorUp so onboarding can tell 'connector down' from 'no project'", () => {
  expect(snapshot({ projects: [], status: undefined, connectorUp: false } as never).connectorUp).toBe(false)
  expect(snapshot({ projects: [], status: undefined, connectorUp: true } as never).connectorUp).toBe(true)
})

test("unbound snapshot exposes empty drift arrays the renderer reads unconditionally", () => {
  const snap = snapshot({ projects: [], status: undefined } as never)
  expect(snap.bound).toBe(false)
  if (!snap.bound) {
    expect(snap.incoming).toEqual([])
    expect(snap.outgoing).toEqual([])
  }
})
