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

// Minimal WorkspaceView fixtures — only the fields the builders read. `affordance` is what connectionAffordance()
// yields for each (it's carried on the view now; the panel renders it rather than re-deciding).
const offlineView = { workspaceRoot: "/w", connectionLabel: "CODESYS — MyMachine", boundProjectName: "MyMachine", health: { label: "Disconnected", tone: "error", online: false }, vendor: "codesys", paused: null, mode: "offline", affordance: { caption: "not connected", action: "connect" }, incoming: [], outgoing: [], conflicts: [] }
const onlineView = { ...offlineView, health: { label: "Connected", tone: "ok", online: true }, mode: "ready", affordance: { caption: "connected", action: "disconnect" } }

const proj = (over: Record<string, unknown> = {}) => {
  const base = { id: "codesys::MyMachine:", displayName: "MyMachine", vendor: "codesys" as const, dirty: false, status: "healthy" as const, ...over }
  return { ...base, projectName: (base as { projectName?: string }).projectName ?? base.displayName }
}

// The bug this guards: the welcome button is static markdown and can't show WHICH project it binds. This view
// fills that gap — an unbound folder with detected projects renders an INDENTED list: a "Detected project(s)"
// header with each project NESTED (children) as a named, clickable-to-set-up row.
test("unbound + a detected project → indented under a header, a named row that inits ITSELF", () => {
  const [header] = bridgeRoots([], [proj()])
  expect(header?.label).toBe("Detected project")
  const node = header?.children?.[0]
  expect(node?.label).toBe("MyMachine")
  // "click to set up" lives on the row (after the name), not on the header — and the row sets up THIS project
  // directly (volt.initProject with the project as its arg), so no project-picker QuickPick re-asks which one.
  // Vendor-blind: the row names the project only — no "· CODESYS" vendor suffix.
  expect(node?.description).toBe("— click to set up")
  expect(node?.command?.command).toBe("volt.initProject")
  expect(node?.command?.arguments?.[0]).toMatchObject({ displayName: "MyMachine", vendor: "codesys" })
})

test("two detected projects → both nested under the header as a list", () => {
  const [header] = bridgeRoots([], [proj({ displayName: "P13" }), proj({ displayName: "P14" })])
  expect(header?.label).toBe("Detected projects")
  expect(header?.children?.map((c) => c.label)).toEqual(["P13", "P14"])
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
  expect(roots.some((n) => n.command?.command === "volt.refresh")).toBe(false) // no hint when the IDE hasn't changed
})

// An IDE-side edit is detected cheaply and surfaced as a HINT — never an auto-/refs walk (which freezes the IDE).
test("bound + ready + ideChanged → a 'Refresh to check' hint (no auto-walk)", () => {
  const roots = syncRoots([{ ...onlineView, ideChanged: true } as never])
  const hint = roots.find((n) => n.command?.command === "volt.refresh")
  expect(hint).toBeDefined()
  expect(String(hint?.label)).toContain("IDE changed")
})

// Offline, the reconnect surface IS the detected-project list: the matching project is a plain Reconnect
// (volt.connect); a different-named one is a Rebind (the rename path); nothing detected → a hint, no action.
test("bound + offline → the matching detected project is a Reconnect row (volt.connect)", () => {
  const roots = bridgeRoots([offlineView as never], [proj()])
  expect(roots.some((n) => n.command?.command === "volt.connect")).toBe(true)
  expect(roots.some((n) => n.command?.command === "volt.disconnect")).toBe(false) // already disconnected
})

test("bound + offline + a DIFFERENT-named project → a Rebind row (volt.rebindProject with that project)", () => {
  const roots = bridgeRoots([offlineView as never], [proj({ displayName: "MyMachine_v2" })])
  const rebind = roots.find((n) => n.command?.command === "volt.rebindProject")
  expect(rebind?.command?.arguments?.[0]).toMatchObject({ displayName: "MyMachine_v2" })
})

test("bound + offline + nothing detected → an 'open your project' hint, no connect/rebind action", () => {
  const roots = bridgeRoots([offlineView as never], [])
  expect(roots.some((n) => n.command?.command === "volt.connect" || n.command?.command === "volt.rebindProject")).toBe(false)
  expect(roots.some((n) => String(n.label).includes("Open your project"))).toBe(true)
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
