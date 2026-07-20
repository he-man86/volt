import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { reconnectBound } from "./actions.js"
import type { ConnectorView } from "./connector.js"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// Records the last /connect body so a test can assert which project got selected.
let lastConnect: unknown
function mockConnector(view: ConnectorView | undefined): void {
  lastConnect = undefined
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith("/status")) return { ok: view !== undefined, json: async () => view } as Response
    if (u.endsWith("/connect")) {
      lastConnect = JSON.parse(String(init?.body))
      return { ok: true, json: async () => ({ ok: true }) } as Response
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
