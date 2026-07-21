import { expect, mock, test } from "bun:test"

// The panel's view-model builders are pure; only the widget layer needs the extension host. Stub the tiny
// `vscode` surface they touch so the smoke runs in the plain bun gate (no @vscode/test-electron download).
mock.module("vscode", () => ({
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class {
    event = (): void => {}
  },
}))

const { bridgeRoots, syncRoots } = await import("./panel.js")

// Minimal WorkspaceView fixtures — only the fields the builders read.
const offlineView = { workspaceRoot: "/w", health: { label: "Disconnected", tone: "error", online: false }, vendor: "codesys", paused: null, incoming: [], outgoing: [], conflicts: [] }
const onlineView = { ...offlineView, health: { label: "Connected", tone: "ok", online: true } }

const proj = (over: Record<string, unknown> = {}) => ({
  id: "codesys::MyMachine:",
  displayName: "MyMachine",
  vendor: "codesys" as const,
  dirty: false,
  connected: true,
  ...over,
})

// The bug this guards: the welcome button is static markdown and can't show WHICH project it binds. The Bridge
// view fills that gap — an unbound folder with a detected project must render its NAME, clickable to initialize.
test("unbound + a detected project → a named, clickable init row", () => {
  const [node] = bridgeRoots([], [proj()])
  expect(node?.label).toBe("MyMachine")
  expect(node?.description).toBe("CODESYS") // vendorLabel(codesys)
  expect(node?.command?.command).toBe("volt.init")
})

test("ideVersion disambiguates the platform label when a vendor has >1 live instance", () => {
  const [node] = bridgeRoots([], [proj({ ideVersion: "CODESYS 3.5.19" })])
  expect(node?.description).toBe("CODESYS · CODESYS 3.5.19")
})

test("unbound + nothing detected → the plain empty state", () => {
  const [node] = bridgeRoots([], [])
  expect(node?.label).toBe("No workspace bound")
})

// The gap this guards: an offline bound workspace used to falsely read "In sync" AND only pointed at the tray.
test("bound + offline → syncRoots yields nothing (so the 'Connect' welcome renders, not a false 'In sync')", () => {
  expect(syncRoots([offlineView as never])).toEqual([])
})

test("bound + online + no drift → 'In sync' (unchanged)", () => {
  const roots = syncRoots([onlineView as never])
  expect(roots.some((n) => n.label.includes("In sync"))).toBe(true)
})

test("bound + offline → Bridge view offers a one-click Reconnect (volt.connect), not a tray pointer", () => {
  const roots = bridgeRoots([offlineView as never], [])
  expect(roots.some((n) => n.command?.command === "volt.connect")).toBe(true)
})
