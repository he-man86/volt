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
  const snap = snapshot({ projects: [proj], status: undefined } as never)
  expect(snap.bound).toBe(false)
  expect(snap.projects.map((p) => p.displayName)).toEqual(["MyMachine"])
})

test("unbound snapshot exposes empty drift arrays the renderer reads unconditionally", () => {
  const snap = snapshot({ projects: [], status: undefined } as never)
  expect(snap.bound).toBe(false)
  if (!snap.bound) {
    expect(snap.incoming).toEqual([])
    expect(snap.outgoing).toEqual([])
  }
})
