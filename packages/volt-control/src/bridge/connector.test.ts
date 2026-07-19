import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boundStatus, connectorStatus, connectProject, detectedProjects, type ConnectorView } from "./connector.js"

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
  status: "Connected",
  bridges: [
    { vendor: "codesys", displayName: "CODESYS", status: "Connected", projectName: "MyMachine", dirty: true, activeOp: null },
    { vendor: "twincat", displayName: "TwinCAT", status: "Unreachable", projectName: null, dirty: false, activeOp: null },
  ],
  projects: [{ id: "codesys:::MyMachine:", displayName: "MyMachine", vendor: "codesys", dirty: true, connected: true }],
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

  test("connectProject POSTs the projectId and reads ok", async () => {
    let body: unknown
    mockFetch((_url, init) => {
      body = JSON.parse(String(init?.body))
      return { ok: true, json: { ok: true } }
    })
    expect(await connectProject("codesys:::MyMachine:")).toBe(true)
    expect(body).toEqual({ projectId: "codesys:::MyMachine:" })
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
        expect(h.health.ideName).toBe("CODESYS")
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
})
