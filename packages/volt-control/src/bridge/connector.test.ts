import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boundStatus, connectOptions, connectSurface, connectorStatus, detectedProjects, type ConnectorView } from "./connector.js"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; json: unknown } | Error): void {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const r = handler(String(url), init)
    if (r instanceof Error) throw r
    return { ok: r.ok, json: async () => r.json } as Response
  }) as typeof fetch
}

const VIEW: ConnectorView = {
  projects: [{ id: "codesys:::MyMachine:", displayName: "MyMachine", vendor: "codesys", dirty: true, connected: true, status: "healthy", projectName: "MyMachine" }],
}

function tempWorkspace(vendor?: string): string {
  const dir = join(tmpdir(), `volt-conn-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  if (vendor) {
    mkdirSync(join(dir, ".git", "volt"), { recursive: true })
    writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor } }))
  }
  return dir
}

/** A workspace with a FULL binding (vendor + project name) — what per-workspace boundStatus resolves against. */
function boundWorkspace(vendor: string, projectName: string): string {
  const dir = join(tmpdir(), `volt-conn-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, ".git", "volt"), { recursive: true })
  writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor }, project: { platform: vendor, projectName } }))
  return dir
}
// `connected` is only the tray highlight; the row's `status` decides connection state (default "healthy"/serving —
// these fixtures describe live projects unless a test is specifically about a bridge that isn't serving, i.e. "idle").
const proj = (vendor: string, name: string, connected: boolean, projectName?: string, status: "idle" | "healthy" | "degraded" = "healthy") => ({ id: `${vendor}::${name}:`, displayName: name, vendor, dirty: false, connected, status, projectName: projectName ?? name })
const projView = (projects: unknown[]): ConnectorView => ({ projects: projects as ConnectorView["projects"] })

// The connection picker's per-project action — replaces the old accept-rename flow: a renamed project is just a
// `rebind` row. Unbound ⇒ every row is a first-time `init`; matched ⇒ `connect`; anything else ⇒ `rebind`.
test("connectOptions tags each detected project: init (unbound) / connect (match) / rebind (else)", () => {
  const mine = proj("codesys", "MyMachine", true)
  const renamed = proj("codesys", "MyMachine_v2", true)
  const other = proj("codesys", "OtherRig", false)
  expect(connectOptions([mine, renamed, other] as never, undefined).map((o) => o.action)).toEqual(["init", "init", "init"])
  const bound = { vendor: "codesys" as const, projectName: "MyMachine" }
  expect(connectOptions([mine, renamed, other] as never, bound).map((o) => o.action)).toEqual(["connect", "rebind", "rebind"])
})

// The surface partition both shells frame from: create (unbound) vs reconnect (bound), matching project primary.
test("connectSurface splits create vs reconnect and puts the matching project first", () => {
  const mine = proj("codesys", "MyMachine", true)
  const renamed = proj("codesys", "MyMachine_v2", true)
  const other = proj("codesys", "OtherRig", false)

  // Unbound → a create surface: every option is a first-time init, no reconnect groups.
  const create = connectSurface(connectOptions([mine, other] as never, undefined))
  expect(create.kind).toBe("create")
  expect(create.create.map((o) => o.project.displayName)).toEqual(["MyMachine", "OtherRig"])
  expect(create.primary.length + create.alternates.length).toBe(0)

  // Bound → a reconnect surface: the matching project is primary even when detected AFTER a rebind alternate.
  const reconnect = connectSurface(connectOptions([renamed, mine, other] as never, { vendor: "codesys", projectName: "MyMachine" }))
  expect(reconnect.kind).toBe("reconnect")
  expect(reconnect.primary.map((o) => o.project.displayName)).toEqual(["MyMachine"])
  expect(reconnect.alternates.map((o) => o.project.displayName)).toEqual(["MyMachine_v2", "OtherRig"])
  expect(reconnect.create.length).toBe(0)
})

describe("connector client (the UI's single source of connection status)", () => {
  test("connectorStatus parses the aggregated view", async () => {
    mockFetch(() => ({ ok: true, json: VIEW }))
    expect(await connectorStatus()).toEqual(VIEW)
  })

  test("detectedProjects returns the unified project list (use case B)", async () => {
    mockFetch(() => ({ ok: true, json: VIEW }))
    const ps = await detectedProjects()
    expect(ps.map((p) => `${p.vendor}:${p.displayName}`)).toEqual(["codesys:MyMachine"])
  })

  test("connector down → empty / undefined, never throws", async () => {
    mockFetch(() => new Error("ECONNREFUSED"))
    expect(await connectorStatus()).toBeUndefined()
    expect(await detectedProjects()).toEqual([])
  })


  test("boundStatus maps the bound vendor's connector health to HealthState (use case A)", async () => {
    const dir = tempWorkspace("codesys")
    try {
      mockFetch(() => ({ ok: true, json: VIEW }))
      const h = await boundStatus(dir)
      expect(h.kind).toBe("connected")
      if (h.kind === "connected") {
        expect(h.health.projectName).toBe("MyMachine")
        expect(h.health.projectDirty).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("boundStatus is unknown when the workspace is unbound", async () => {
    const dir = tempWorkspace()
    try {
      mockFetch(() => ({ ok: true, json: VIEW }))
      expect((await boundStatus(dir)).kind).toBe("unknown")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("boundStatus is unreachable when the connector is down", async () => {
    const dir = tempWorkspace("twincat")
    try {
      mockFetch(() => new Error("down"))
      expect((await boundStatus(dir)).kind).toBe("unreachable")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("boundStatus is PER-WORKSPACE: a live bound project shows connected even when another is the active one", async () => {
    const dir = boundWorkspace("codesys", "MachineB")
    try {
      // MachineA is the global active connection; MachineB is also live (its own pipe) but not highlighted.
      mockFetch(() => ({ ok: true, json: projView([proj("codesys", "MachineA", true), proj("codesys", "MachineB", false)]) }))
      const h = await boundStatus(dir)
      expect(h.kind).toBe("connected")
      if (h.kind === "connected") expect(h.health.projectName).toBe("MachineB")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("boundStatus is disconnected when the bound project's IDE isn't serving it", async () => {
    const dir = boundWorkspace("codesys", "Ghost")
    try {
      mockFetch(() => ({ ok: true, json: projView([proj("codesys", "MachineA", true)]) }))
      const h = await boundStatus(dir)
      expect(h.kind).toBe("disconnected")
      if (h.kind === "disconnected") expect(h.health.projectName).toBe("Ghost")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // THE bug this refactor exists for. A gated bridge (the tray's Disconnect) stays LISTED — that list is how you
  // reconnect — so "detected" never meant "connected". boundStatus used to reason "detected → its host is live →
  // this workspace is connected" and reported healthy while every sync op was being refused with
  // PLC_DISCONNECTED. Connection state now comes from the row's `status` (serving = non-idle) and nothing else.
  test("boundStatus is disconnected when the project is detected but its bridge is idle (not serving it)", async () => {
    const dir = boundWorkspace("codesys", "MachineB")
    try {
      mockFetch(() => ({ ok: true, json: projView([proj("codesys", "MachineB", false, undefined, "idle")]) }))
      const h = await boundStatus(dir)
      expect(h.kind).toBe("disconnected")
      if (h.kind === "disconnected") expect(h.health.connected).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // A row with no `status` at all (or "idle") must read as NOT serving: guessing "connected" is exactly the failure
  // this field ends — a detected-but-not-served project is a gated bridge.
  test("boundStatus treats a missing/idle `status` as not connected, never as connected", async () => {
    const dir = boundWorkspace("codesys", "MachineB")
    try {
      const legacy = { id: "codesys::MachineB:", displayName: "MachineB", vendor: "codesys", dirty: false, connected: true, projectName: "MachineB" }
      mockFetch(() => ({ ok: true, json: projView([legacy]) }))
      expect((await boundStatus(dir)).kind).toBe("disconnected")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("boundStatus matches TwinCAT on the binding name (health projectName), NOT the PLC sub-project displayName", async () => {
    // The binding stores the TwinCAT project name; the detected project's displayName is the PLC sub-project.
    const dir = boundWorkspace("twincat", "project13")
    try {
      mockFetch(() => ({ ok: true, json: projView([proj("twincat", "Untitled1", false, "project13")]) }))
      const h = await boundStatus(dir)
      expect(h.kind).toBe("connected") // would be "disconnected" if we matched displayName === projectName
      if (h.kind === "connected") expect(h.health.projectName).toBe("project13")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
