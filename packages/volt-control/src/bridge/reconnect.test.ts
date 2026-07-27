import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { reconnectBound, enterWorkspace, leaveWorkspace } from "./actions.js"
import { __resetSessionForTest } from "./session.js"
import type { ConnectorView } from "./connector.js"

// The actions layer (enterWorkspace / leaveWorkspace / reconnectBound) now delegates to the session client; the
// full behaviour is covered in session.test.ts. These tests pin the ACTIONS-level wiring: each wrapper declares /
// drops THIS workspace's interest through the session API, and an unbound folder is a clean no-op. The session
// client is a module singleton, so reset it around every test.
const realFetch = globalThis.fetch
beforeEach(__resetSessionForTest)
afterEach(() => {
  __resetSessionForTest()
  globalThis.fetch = realFetch
})

// A new connector (session API present); records the interests declared on the most recent /sync.
let lastInterests: unknown
function mockSessionConnector(serving: boolean): void {
  lastInterests = undefined
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    if (u.endsWith("/session") && method === "POST") return { ok: true, status: 200, json: async () => ({ sessionId: "s1", leaseSeconds: 15 }) } as Response
    if (u.includes("/session/s1/sync")) {
      lastInterests = (JSON.parse(String(init?.body)) as { interests: unknown }).interests
      const projects: ConnectorView["projects"] = serving
        ? [{ id: "codesys::MyMachine:", displayName: "MyMachine", vendor: "codesys", dirty: false, connected: true, status: "healthy", projectName: "MyMachine" }]
        : []
      return { ok: true, status: 200, json: async () => ({ projects }) } as Response
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

describe("enter/leave/reconnect — declare this workspace's interest through the session client", () => {
  test("enterWorkspace declares the bound project (by its binding vendor+projectName)", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockSessionConnector(true)
      const r = await enterWorkspace(dir)
      expect(r.ok).toBe(true)
      expect(lastInterests).toEqual([{ vendor: "codesys", projectName: "MyMachine" }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("reconnectBound re-declares the same interest (the manual Reconnect action)", async () => {
    // The binding's projectName is the identity — for TwinCAT that's the TwinCAT project, not a PLC sub-project.
    const dir = boundWorkspace("twincat", "project13")
    try {
      mockSessionConnector(false)
      await reconnectBound(dir)
      expect(lastInterests).toEqual([{ vendor: "twincat", projectName: "project13" }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("leaveWorkspace drops THIS workspace's interest (declares the smaller set)", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockSessionConnector(true)
      await enterWorkspace(dir)
      const r = await leaveWorkspace(dir)
      expect(r.ok).toBe(true)
      expect(lastInterests).toEqual([]) // interest removed
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("enterWorkspace on an unbound folder declares nothing", async () => {
    const dir = join(tmpdir(), `volt-recon-unbound-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    try {
      mockSessionConnector(true)
      const r = await enterWorkspace(dir)
      expect(r.ok).toBe(false)
      expect(r.message).toContain("isn't a Volt workspace")
      expect(lastInterests).toBeUndefined() // never synced
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("leaveWorkspace on a never-entered folder is a no-op (no bare disconnect of anyone else)", async () => {
    const dir = boundWorkspace("codesys", "MyMachine")
    try {
      mockSessionConnector(true)
      const r = await leaveWorkspace(dir) // never entered → nothing declared to drop
      expect(r.ok).toBe(true)
      expect(lastInterests).toBeUndefined() // no /sync fired for a no-op drop
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
