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
  Uri: { from: (parts: unknown) => parts, file: (p: string) => ({ fsPath: p }) },
}))

const { bridgeRoots, syncRoots } = await import("./panel.js")

// Minimal WorkspaceView fixtures — only the fields the builders read.
const offlineView = { workspaceRoot: "/w", health: { label: "Disconnected", tone: "error", online: false }, vendor: "codesys", paused: null, mode: "offline", incoming: [], outgoing: [], conflicts: [] }
const onlineView = { ...offlineView, health: { label: "Connected", tone: "ok", online: true }, mode: "ready" }

const proj = (over: Record<string, unknown> = {}) => ({
  id: "codesys::MyMachine:",
  displayName: "MyMachine",
  vendor: "codesys" as const,
  dirty: false,
  connected: true,
  ...over,
})

// The bug this guards: the welcome button is static markdown and can't show WHICH project it binds. This view
// fills that gap — an unbound folder with a detected project must render its NAME, clickable to set up. (Row 0 is
// the "click one to set up" header, so the project rows start at 1.)
test("unbound + a detected project → a named, clickable init row", () => {
  const [, node] = bridgeRoots([], [proj()])
  expect(node?.label).toBe("MyMachine")
  expect(node?.description).toBe("CODESYS") // vendorLabel(codesys)
  expect(node?.command?.command).toBe("volt.init")
})

test("ideVersion disambiguates the platform label when a vendor has >1 live instance", () => {
  const [, node] = bridgeRoots([], [proj({ ideVersion: "CODESYS 3.5.19" })])
  expect(node?.description).toBe("CODESYS · CODESYS 3.5.19")
})

test("unbound + nothing detected → says so, and what to do about it", () => {
  const [node] = bridgeRoots([], [])
  expect(node?.label).toBe("No PLC project detected")
})

// "Connector down" and "connector up, no project open" used to render identically — the fix for one is to start
// Volt, for the other to open a project, so they must never look the same.
test("unbound + connector down → names the connector, not the project list", () => {
  const [node] = bridgeRoots([], [], false)
  expect(node?.label).toBe("The Volt Connector isn't running")
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
  expect(roots.some((n) => n.command?.command === "volt.disconnect")).toBe(false) // already disconnected
})

// Disconnect is a REAL disconnect now (the bridge refuses sync until you reconnect), so it earns a button —
// the mirror of Reconnect, on the same row set, instead of hiding in the command palette.
test("bound + online → Bridge view offers Disconnect (volt.disconnect)", () => {
  const roots = bridgeRoots([onlineView as never], [])
  expect(roots.some((n) => n.command?.command === "volt.disconnect")).toBe(true)
  expect(roots.some((n) => n.command?.command === "volt.connect")).toBe(false)
})

// The bug this guards: incoming used to diff VOLTIDE ↔ BRIDGE, but VOLTIDE (refs/remotes/volt/ide) IS the IDE
// remote-tracking branch — after a pull it equals BRIDGE, so the diff showed two identical panes. The left side
// must be the user's local repo (HEAD), giving the "IDE → local repo" diff.
const diffRefs = (dir: "incoming" | "outgoing") => {
  const item = { name: "Foo", sub: "M", relPath: "POUs/Foo.pou" }
  const view = { ...onlineView, [dir]: [item] }
  const roots = syncRoots([view as never])
  const node = roots.find((n) => n.key === `group:${dir}`)?.children?.[0]
  const [left, right] = node!.command!.arguments as { path: string }[]
  return { left: left.path, right: right.path }
}

test("incoming diff = HEAD (repo's last commit) ↔ BRIDGE (live IDE), never the IDE-tracking VOLTIDE ref", () => {
  expect(diffRefs("incoming")).toEqual({ left: "/HEAD/POUs/Foo.pou", right: "/BRIDGE/POUs/Foo.pou" })
})

test("outgoing diff = VOLTIDE (synced baseline) ↔ WORKSPACE (working file)", () => {
  expect(diffRefs("outgoing")).toEqual({ left: "/VOLTIDE/POUs/Foo.pou", right: "/WORKSPACE/POUs/Foo.pou" })
})
