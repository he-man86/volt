import { expect, test } from "bun:test"
import { snapshot } from "./panel.js"

// panel.ts is electron-free (the renderer draws the pixels); snapshot() is the pure shell → shared view-model
// projection. Smoke it so the desktop package enters the CI gate and the init surface keeps naming projects.
const proj = {
  id: "codesys::MyMachine:",
  displayName: "MyMachine",
  vendor: "codesys" as const,
  dirty: false,
  connected: true,
}

// The parity point behind the vscode fix: the desktop init surface shows the detected project NAME. That works
// because the unbound snapshot carries `projects` through to the renderer — assert it doesn't get dropped.
test("unbound snapshot carries the detected projects (so the init surface can name them)", () => {
  const snap = snapshot({ projects: [proj], status: undefined, connectorUp: true } as never)
  expect(snap.bound).toBe(false)
  expect(snap.projects.map((p) => p.displayName)).toEqual(["MyMachine"])
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
