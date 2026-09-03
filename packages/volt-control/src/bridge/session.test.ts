import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectorStatus, type ConnectorView } from "./connector.js"
import { closeSession } from "./actions.js"
import {
  declareInterest,
  dropInterest,
  shutdownSession,
  selectPickedProject,
  adoptPickedProject,
  startConnectorFeed,
  onConnectorView,
  __resetSessionForTest,
} from "./session.js"
import type { DetectedProject } from "./connector.js"

const realFetch = globalThis.fetch
// The session client is a module singleton — reset it around every test so state never leaks across tests or files.
beforeEach(__resetSessionForTest)
afterEach(() => {
  __resetSessionForTest()
  globalThis.fetch = realFetch
})

interface Body {
  interests?: { vendor: string; projectName: string }[]
  projectId?: string
}
interface Call {
  url: string
  method: string
  body?: Body
}

/** Install a fetch that records every call and answers per a route table. Returns the recorded calls for assertions. */
function router(route: (c: Call) => { status?: number; ok?: boolean; json?: unknown } | Error): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Body) : undefined
    const c: Call = { url: String(url), method, body }
    calls.push(c)
    const r = route(c)
    if (r instanceof Error) throw r
    const status = r.status ?? (r.ok === false ? 500 : 200)
    return { ok: r.ok ?? status < 400, status, json: async () => r.json } as Response
  }) as typeof fetch
  return calls
}

function boundWorkspace(vendor: string, projectName: string): string {
  const dir = join(tmpdir(), `volt-sess-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, ".git", "volt"), { recursive: true })
  writeFileSync(
    join(dir, ".git", "volt", "config.json"),
    JSON.stringify({ bridge: { vendor }, project: { platform: vendor, projectName } }),
  )
  return dir
}

/** A one-project view; `serving` flips its row between connected and gated. */
const view = (serving: boolean): ConnectorView => ({
  projects: [
    { id: "codesys::MyMachine:", displayName: "MyMachine", vendor: "codesys", dirty: false, status: serving ? "healthy" : "idle", projectName: "MyMachine" },
  ],
})

/** A NEW connector: the session API works and /sync answers a view. */
function newConnector(serving = true): Call[] {
  return router((c) => {
    if (c.method === "POST" && c.url.endsWith("/session")) return { json: { sessionId: "s1", leaseSeconds: 15 } }
    if (c.method === "POST" && c.url.includes("/session/s1/sync")) return { json: view(serving) }
    if (c.method === "DELETE" && c.url.includes("/session/s1")) return { status: 204, json: {} }
    if (c.method === "GET" && c.url.endsWith("/status")) return { json: view(serving) }
    return { status: 404, json: {} }
  })
}

const lastSync = (calls: Call[]): Call | undefined => [...calls].reverse().find((c) => c.url.includes("/sync"))

describe("session client (declarative connection presence)", () => {
  test("first declareInterest opens a session and declares the interest", async () => {
    const calls = newConnector(true)
    const r = await declareInterest(boundWorkspace("codesys", "MyMachine"))

    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/session"))).toBe(true)
    expect(lastSync(calls)?.body).toEqual({ interests: [{ vendor: "codesys", projectName: "MyMachine" }] })
  })

  test("connectorStatus returns the session's synced view — no extra GET /status", async () => {
    const calls = newConnector(true)
    await declareInterest(boundWorkspace("codesys", "MyMachine"))

    const v = await connectorStatus()
    expect(v?.projects[0].displayName).toBe("MyMachine")
    expect(calls.some((c) => c.method === "GET" && c.url.endsWith("/status"))).toBe(false)
  })

  test("declareInterest reports not-serving so manual Reconnect can message the user", async () => {
    newConnector(false) // the project's IDE isn't open → row is idle
    const r = await declareInterest(boundWorkspace("codesys", "MyMachine"))

    expect(r.ok).toBe(false)
    expect(r.message).toContain("isn't connected yet")
  })

  test("declareInterest declares ONCE — one sync, one answer, no retry loop", async () => {
    let syncs = 0
    router((c) => {
      if (c.method === "POST" && c.url.endsWith("/session")) return { json: { sessionId: "s1", leaseSeconds: 15 } }
      if (c.method === "POST" && c.url.includes("/session/s1/sync")) return { json: view(++syncs > 1) }
      return { status: 404, json: {} }
    })

    const r = await declareInterest(boundWorkspace("codesys", "MyMachine"))
    expect(syncs).toBe(1) // it does NOT keep re-syncing until the answer turns favourable
    expect(r.ok).toBe(false) // reports what the connector said; the user can connect again
  })

  test("an unbound folder declares nothing and does not open a session", async () => {
    const calls = router(() => ({ json: {} }))
    const dir = join(tmpdir(), `volt-sess-unbound-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })

    const r = await declareInterest(dir)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0) // never touched the connector
  })

  test("dropInterest removes the interest from the next declared set", async () => {
    const calls = newConnector(true)
    const ws = boundWorkspace("codesys", "MyMachine")
    await declareInterest(ws)
    await dropInterest(ws)

    expect(lastSync(calls)?.body).toEqual({ interests: [] })
  })

  test("two bound workspaces declare two interests in one set", async () => {
    const calls = newConnector(true)
    await declareInterest(boundWorkspace("codesys", "MachineA"))
    await declareInterest(boundWorkspace("twincat", "MachineB"))

    expect(lastSync(calls)?.body?.interests).toEqual([
      { vendor: "codesys", projectName: "MachineA" },
      { vendor: "twincat", projectName: "MachineB" },
    ])
  })

  test("a picked project adopted by its workspace is clearable by leaveWorkspace — not a permanent pin", async () => {
    // init/rebind select a project as a TEMPORARY interest and hand it to the created workspace root, so a later
    // dropInterest declares the smaller set — the connection is owned by the workspace, never pinned forever.
    const calls = newConnector(true)
    const project = { id: "codesys::New:", displayName: "New", vendor: "codesys", dirty: false, projectName: "New", status: "healthy" } as DetectedProject

    await selectPickedProject(project) // init's pre-fetch select
    adoptPickedProject(project, "/ws/new") // handed to the workspace init created
    await dropInterest("/ws/new") // the workspace's later Disconnect

    expect(lastSync(calls)?.body).toEqual({ interests: [] }) // dropped — not pinned
  })

  // ── the connector feed: ONE clock, and it says when the connector stops answering ──

  test("the feed fires only when the view actually changed", async () => {
    let dirty = false
    router((c) => {
      if (c.method === "POST" && c.url.endsWith("/session")) return { json: { sessionId: "s1", leaseSeconds: 15 } }
      if (c.method === "POST" && c.url.includes("/session/s1/sync")) {
        const v = view(true)
        v.projects[0].dirty = dirty
        return { json: v }
      }
      return { status: 404, json: {} }
    })

    let fired = 0
    const sub = onConnectorView.event(() => fired++)
    try {
      await startConnectorFeed()
      expect(fired).toBe(1) // the first view
      await declareInterest(boundWorkspace("codesys", "MyMachine")) // syncs again, same view
      expect(fired).toBe(1) // …so nothing downstream re-renders
      dirty = true
      await declareInterest(boundWorkspace("codesys", "MyMachine"))
      expect(fired).toBe(2) // a real change does
    } finally {
      sub.dispose()
    }
  })

  test("a connector that stops answering publishes NO view — a remembered one is never served", async () => {
    let up = true
    router((c) => {
      if (!up) return new Error("ECONNREFUSED")
      if (c.method === "POST" && c.url.endsWith("/session")) return { json: { sessionId: "s1", leaseSeconds: 15 } }
      if (c.method === "POST" && c.url.includes("/session/s1/sync")) return { json: view(true) }
      return { status: 404, json: {} }
    })

    await startConnectorFeed()
    expect((await connectorStatus())?.projects).toHaveLength(1)

    up = false
    await declareInterest(boundWorkspace("codesys", "MyMachine")) // its sync fails
    expect(await connectorStatus()).toBeUndefined() // reported down, not "still those projects"
  })

  test("shutdownSession drops the view WITHOUT firing — nothing re-renders on the way out", async () => {
    newConnector(true)
    await startConnectorFeed()

    let fired = 0
    const sub = onConnectorView.event(() => fired++)
    try {
      await shutdownSession()
      expect(fired).toBe(0)
    } finally {
      sub.dispose()
    }
  })

  test("connectorStatus GETs until the feed has answered, then never issues its own request", async () => {
    const calls = newConnector(true)

    // No feed has answered yet → the one-shot GET still applies. (Blinding it on "a timer exists" made VS Code's
    // activate paint "Volt Connector not running" in the window before the first tick.)
    await connectorStatus()
    expect(calls.some((c) => c.method === "GET" && c.url.endsWith("/status"))).toBe(true)

    await startConnectorFeed()
    const before = calls.length
    await connectorStatus()
    await connectorStatus()
    expect(calls.length).toBe(before) // reads are free now — they project the feed's view
  })

  test("shutdownSession DELETEs the session", async () => {
    const calls = newConnector(true)
    await declareInterest(boundWorkspace("codesys", "MyMachine"))
    await shutdownSession()

    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/session/s1"))).toBe(true)
  })
})


// ── the bounded quit teardown (`closeSession`) ──

// THE BUG BOTH SHELLS SHIPPED. Quit ran a `leaveWorkspace` per bound root and THEN the shutdown, all raced against
// 1.5s — but each leave awaits `ensureSession` + `syncDeclare`, each bounded at 2s, so against a slow connector the
// sequence could not reach the DELETE inside the bound and the session lingered until its lease expired. The leaves
// were redundant besides: the DELETE drops every interest in one request. So the assertion is about what is SENT —
// a DELETE, and no PUT ahead of it that could crowd it out.
test("quit deletes the session and does not queue interest updates ahead of it", async () => {
  const root = boundWorkspace("codesys", "MyMachine")
  const calls = newConnector()
  await declareInterest(root)
  calls.length = 0

  await closeSession()

  expect(calls.map((c) => c.method)).toEqual(["DELETE"])
  expect(calls[0]!.url).toContain("/session/s1")
})

// The bound is the point: a connector that never answers must not hold the app open. `shutdownSession`'s own fetch
// is capped at 2s — longer than the 1.5s bound — so without the race a hung DELETE outlives the window it was meant
// to fit in. Resolving is the assertion; the lease expiry cleans up the abandoned session.
test("quit gives up on a connector that never answers", async () => {
  const root = boundWorkspace("codesys", "MyMachine")
  newConnector()
  await declareInterest(root)
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch // never settles

  const started = performance.now()
  await closeSession()

  expect(performance.now() - started).toBeLessThan(1_900) // i.e. the 1.5s bound, not the 2s fetch timeout
})

// Nothing was ever declared — no session to delete, so quit must not open one on the way out just to close it.
test("quit with no session open sends nothing", async () => {
  const calls = router(() => ({ json: {} }))

  await closeSession()

  expect(calls).toEqual([])
})
