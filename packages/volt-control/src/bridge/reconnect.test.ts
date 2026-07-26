import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { reconnectBound, enterWorkspace, leaveWorkspace } from "./actions.js"
import type { ConnectorView } from "./connector.js"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// Records the last /connect and /disconnect bodies so a test can assert which project got selected/dropped.
let lastConnect: unknown
let lastDisconnect: unknown
function mockConnector(view: ConnectorView | undefined): void {
  lastConnect = undefined
  lastDisconnect = undefined
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith("/status")) return { ok: view !== undefined, json: async () => view } as Response
    if (u.endsWith("/connect")) {
      lastConnect = JSON.parse(String(init?.body))
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }
    if (u.endsWith("/disconnect")) {
      lastDisconnect = JSON.parse(String(init?.body))
      return { ok: true, json: async () => ({ gated: true }) } as Response
    }
    throw new Error(`unexpected ${u}`)
  }) as typeof fetch
}

function boundWorkspace(vendor: string, projectName: string): string {
  const dir = join(tmpdir(), `volt-recon-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, ".git", "volt"), { recursive: true })
  writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor }, project: { platform: vendor, projectName } }))
  return dir
}

const view = (projects: ConnectorView["projects"]): ConnectorView => ({ status: "Connected", bridges: [], projects })
const proj = (vendor: "codesys" | "twincat", displayName: string, projectName?: string): ConnectorView["projects"][number] => ({
  id: `${vendor}:::${displayName}:`,
  displayName,
  vendor,
  dirty: false,
  connected: false,
  projectName: projectName ?? displayName,
})

describe("reconnectBound — re-point the bridge at the ALREADY-bound project", () => {
  test("fires connect for the detected project matching the binding by vendor+name", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockConnector(view([proj("twincat", "Other"), proj("codesys", "MyMachine")]))
      const r = await reconnectBound(dir)
      expect(r.ok).toBe(true)
      expect(lastConnect).toEqual({ projectId: "codesys:::MyMachine:" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("matches a TwinCAT project on the binding name (projectName), not the PLC sub-project displayName", async () => {
    // Binding stores the TwinCAT project 'project13'; the detected project's displayName is the PLC sub 'Untitled1'.
    // With two TwinCAT projects open the sole-project fallback can't save it — the projectName match must work.
    const dir = boundWorkspace("twincat", "project13")
    try {
      mockConnector(view([proj("twincat", "Untitled1", "project13"), proj("twincat", "Untitled1", "project14")]))
      const r = await reconnectBound(dir)
      expect(r.ok).toBe(true)
      expect(lastConnect).toEqual({ projectId: "twincat:::Untitled1:" }) // the project13 one (first match)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("falls back to the sole project of the bound vendor when the name drifted", async () => {
    const dir = boundWorkspace("codesys", "OldName")
    try {
      mockConnector(view([proj("codesys", "RenamedProject")]))
      const r = await reconnectBound(dir)
      expect(r.ok).toBe(true)
      expect(lastConnect).toEqual({ projectId: "codesys:::RenamedProject:" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("no match (bound project not open) → not ok, no connect fired, a message to surface", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockConnector(view([proj("twincat", "SomeTwinCatProject")])) // wrong vendor only
      const r = await reconnectBound(dir)
      expect(r.ok).toBe(false)
      expect(lastConnect).toBeUndefined()
      expect(r.message).toContain("MyMachine")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("unbound folder → not ok, never touches the connector", async () => {
    const dir = join(tmpdir(), `volt-recon-unbound-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      mockConnector(view([]))
      const r = await reconnectBound(dir)
      expect(r.ok).toBe(false)
      expect(r.message).toContain("isn't a Volt workspace")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("enter/leaveWorkspace — the shared connection lifecycle both shells drive", () => {
  test("enterWorkspace connects the bound project (delegates to reconnectBound)", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockConnector(view([proj("codesys", "MyMachine")]))
      const r = await enterWorkspace(dir)
      expect(r.ok).toBe(true)
      expect(lastConnect).toEqual({ projectId: "codesys:::MyMachine:" }) // connected THIS workspace's project
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("leaveWorkspace disconnects THIS workspace's project by its detected id", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockConnector(view([proj("twincat", "Other"), proj("codesys", "MyMachine")]))
      const r = await leaveWorkspace(dir)
      expect(r.ok).toBe(true)
      expect(lastDisconnect).toEqual({ projectId: "codesys:::MyMachine:" }) // named its own project, not a bare disconnect
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("leaveWorkspace on an unbound folder disconnects NOTHING (no bare disconnect of the active connection)", async () => {
    const dir = join(tmpdir(), `volt-leave-unbound-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      mockConnector(view([proj("codesys", "MyMachine")]))
      const r = await leaveWorkspace(dir)
      expect(r.ok).toBe(false)
      expect(lastDisconnect).toBeUndefined() // never POSTed /disconnect
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("leaveWorkspace when the bound project isn't detected disconnects nothing", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockConnector(view([proj("twincat", "SomethingElse")])) // MyMachine not present
      const r = await leaveWorkspace(dir)
      expect(r.ok).toBe(false)
      expect(lastDisconnect).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
