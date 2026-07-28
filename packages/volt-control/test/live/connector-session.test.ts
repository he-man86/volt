import { test, expect, afterAll } from "bun:test"

/**
 * The connector session model, against a LIVE connector — the contract every frontend depends on and no unit test
 * can prove: declaring an interest makes a bridge serve, dropping it gates the bridge, and a client that dies
 * without closing is cleaned up by its lease.
 *
 * This is the layer that produced today's two "it connects when it shouldn't / never disconnects" reports, and
 * every one of those was invisible to the mocked-fetch unit tests in src/bridge/session.test.ts — those pin what we
 * SEND; these pin what the connector DOES.
 *
 * Unattended by design: it opens its own sessions, cleans them up, and asserts through GET /status. It never
 * touches the user's binding, workspace, or IDE state — the worst it does is briefly serve a project that is
 * already detected (which is exactly what opening the app would do).
 *
 * SKIPS (never fails) with no connector or no detected project, so it is safe in CI and on a bare dev box:
 *     bun test test/live                       # against the ambient connector (:8550)
 *     VOLT_CONTROL_BASE=http://127.0.0.1:8551 bun test test/live   # against an isolated one
 */

const BASE = process.env.VOLT_CONTROL_BASE ?? "http://127.0.0.1:8550"
const LEASE_GRACE_MS = Number(process.env.VOLT_E2E_LEASE_MS ?? 45_000)

interface Row { id: string; displayName: string; projectName: string; vendor: string; status?: string }
interface View { projects: Row[] }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function status(): Promise<View | undefined> {
  try {
    const r = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(5000) })
    return r.ok ? ((await r.json()) as View) : undefined
  } catch {
    return undefined
  }
}

async function openSession(): Promise<string | undefined> {
  try {
    const r = await fetch(`${BASE}/session`, { method: "POST", signal: AbortSignal.timeout(5000) })
    return r.ok ? ((await r.json()) as { sessionId?: string }).sessionId : undefined
  } catch {
    return undefined
  }
}

/** Declare a session's FULL interest set and return the view the connector answers with. */
async function sync(id: string, interests: { vendor: string; projectName: string }[]): Promise<View | undefined> {
  try {
    const r = await fetch(`${BASE}/session/${id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interests }),
      signal: AbortSignal.timeout(10_000),
    })
    return r.ok ? ((await r.json()) as View) : undefined
  } catch {
    return undefined
  }
}

const close = (id: string): Promise<unknown> => fetch(`${BASE}/session/${id}`, { method: "DELETE" }).catch(() => undefined)

const serving = (v: View | undefined, name: string): boolean =>
  (v?.projects ?? []).some((p) => p.projectName === name && (p.status === "healthy" || p.status === "degraded"))

/** Poll GET /status until `ok`, or give up — reconcile is a cycle, not an instant. */
async function until(ok: (v: View | undefined) => boolean, ms: number): Promise<View | undefined> {
  const deadline = Date.now() + ms
  let v = await status()
  while (!ok(v) && Date.now() < deadline) {
    await sleep(1000)
    v = await status()
  }
  return v
}

/** The PID of the connector running OUR built exe — never the engineer's installed one, which runs the same
 *  executable name from a different directory.
 *
 *  Not by port: the control plane is an `HttpListener`, i.e. http.sys, so `netstat` attributes the LISTENING
 *  socket to PID 4 (System) and there is no user-mode process to find that way. Ask the process list instead. */
async function connectorPid(exe: string): Promise<number | undefined> {
  const { spawnSync } = await import("node:child_process")
  const ps = `Get-Process VoltConnector -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe.replace(/\//g, "\\")}' } | Select-Object -First 1 -ExpandProperty Id`
  const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).stdout?.trim() ?? ""
  return /^\d+$/.test(out) ? Number(out) : undefined
}

const opened: string[] = []
afterAll(async () => {
  for (const id of opened) await close(id) // never leave an interest behind — it would keep a bridge serving
  // …and if a bridge is STILL serving with nothing wanting it (the restart test reproduces exactly that), force
  // the wanted→unwanted edge that gates it. Otherwise a test run would leave the engineer's IDE attached to a
  // connector nobody is talking to — the very state this suite exists to catch.
  const v = await status()
  const stray = v?.projects.find((p) => p.status === "healthy" || p.status === "degraded")
  if (stray === undefined) return
  const id = await openSession()
  if (id === undefined) return
  await sync(id, [{ vendor: stray.vendor, projectName: stray.projectName }])
  await sync(id, [])
  await close(id)
})

async function target(): Promise<Row | undefined> {
  const v = await status()
  return v?.projects.find((p) => p.vendor === "codesys" || p.vendor === "twincat")
}

test("declaring an interest makes the connector serve that project; dropping it gates the bridge", async () => {
  const project = await target()
  if (project === undefined) return console.log("SKIP: no connector or no detected PLC project")

  const id = await openSession()
  expect(id, "connector accepted no session").toBeDefined()
  opened.push(id!)

  const declared = await sync(id!, [{ vendor: project.vendor, projectName: project.projectName }])
  expect(serving(declared, project.projectName), "a declared project must serve").toBe(true)

  const dropped = await sync(id!, [])
  expect(serving(dropped, project.projectName), "dropping the last interest must gate the bridge").toBe(false)
}, 60_000)

test("a client that dies without closing is cleaned up by its lease, not left holding the bridge", async () => {
  const project = await target()
  if (project === undefined) return console.log("SKIP: no connector or no detected PLC project")

  const id = await openSession()
  if (id === undefined) return console.log("SKIP: connector accepted no session")
  opened.push(id)

  expect(serving(await sync(id, [{ vendor: project.vendor, projectName: project.projectName }]), project.projectName)).toBe(true)

  // Now go silent — no close, no renew. This is a crashed/killed client, and the ONLY thing that can release the
  // bridge is the lease sweep. (A frontend that quits cleanly DELETEs its session; that path is the test above.)
  const after = await until((v) => !serving(v, project.projectName), LEASE_GRACE_MS)
  expect(
    serving(after, project.projectName),
    `still serving ${LEASE_GRACE_MS / 1000}s after the client went silent — a lapsed lease must release the bridge`,
  ).toBe(false)
}, LEASE_GRACE_MS + 30_000)

// Needs a connector WE own (it gets restarted):
//   VOLT_CONTROL_PORT=8551 VoltConnector.exe --silent
//   VOLT_CONTROL_BASE=http://127.0.0.1:8551 VOLT_E2E_CONNECTOR_EXE=<path> bun test test/live
//
// …and it must be the ONLY connector running. A second connector is isolated in its control PORT but not in what
// it reconciles: both scan the same bridges, so the installed one gates whatever the test one binds (nothing in
// ITS sessions wants it) and the two thrash. Measured: with both up, every test here fails; with one, they pass.
// So the live tier stops the installed connector for the duration — port isolation is not fleet isolation.
const OWN_EXE = process.env.VOLT_E2E_CONNECTOR_EXE
// KNOWN BUG — this test currently FAILS, on purpose, and reproduces a field incident (2026-07-28): after the
// 14:25 auto-update the connector came back with no memory of what it had bound, so `Pro2193` sat `healthy` with
// every Volt app closed. Gating is edge-triggered ("was wanted, now isn't") and a restart forgets the edge; the
// same hole swallows a gate call that fails, since the edge is gone by the next cycle. Fix options are a durable
// `wanted` set (survives the restart) or gating on shutdown; both are pending a decision, and this test is the
// oracle for whichever lands. It SKIPS unless a connector we own is provided, so CI stays green.
test("a connector restart does not strand a bridge serving with nobody wanting it", async () => {
  if (OWN_EXE === undefined) return console.log("SKIP: set VOLT_E2E_CONNECTOR_EXE (needs a connector we may restart)")
  const project = await target()
  if (project === undefined) return console.log("SKIP: no detected PLC project")

  const id = await openSession()
  if (id === undefined) return console.log("SKIP: connector accepted no session")
  opened.push(id)
  expect(serving(await sync(id, [{ vendor: project.vendor, projectName: project.projectName }]), project.projectName)).toBe(true)

  // Restart the connector WHILE it is serving on our behalf, then never re-declare — exactly what an auto-update
  // does to a running app. Gating is edge-triggered on "was wanted, now isn't"; a fresh connector remembers no
  // previous want, so there is no edge and the bridge can serve forever with no client. Seen in the field
  // 2026-07-28 after the 14:25 update: a project sat `healthy` with every Volt app closed.
  //
  // Kill by PID, never by image name: `taskkill /im VoltConnector.exe` would take the ENGINEER'S installed
  // connector down with it. (First cut did exactly that — and still passed, because after the kill `status()`
  // answers undefined and "no connector" read as "not serving". Hence the up-check below before asserting.)
  const { spawnSync, spawn } = await import("node:child_process")
  const pid = await connectorPid(OWN_EXE)
  expect(pid, `no connector process found listening on ${BASE}`).toBeDefined()
  spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
  const down = await until((v) => v === undefined, 20_000)
  expect(down, "the connector did not actually go down — the restart never happened").toBeUndefined()

  spawn(OWN_EXE, ["--silent"], { env: { ...process.env }, detached: true, stdio: "ignore" }).unref()
  const up = await until((v) => v !== undefined, 40_000)
  expect(up, "the connector never came back up — cannot judge the strand").toBeDefined()

  const after = await until((v) => !serving(v, project.projectName), 30_000)
  expect(after, "connector went away mid-assertion").toBeDefined() // "not serving" must mean gated, not absent
  expect(
    serving(after, project.projectName),
    "a restarted connector left the bridge serving with no live session wanting it — gating must not depend on an edge it forgot",
  ).toBe(false)
}, 120_000)

test("two sessions wanting the same project: one leaving does not disconnect the other", async () => {
  const project = await target()
  if (project === undefined) return console.log("SKIP: no connector or no detected PLC project")

  const a = await openSession()
  const b = await openSession()
  if (a === undefined || b === undefined) return console.log("SKIP: connector accepted no session")
  opened.push(a, b)

  const want = [{ vendor: project.vendor, projectName: project.projectName }]
  await sync(a, want)
  await sync(b, want)
  // POLL, don't trust one response: a reconcile is a cycle, and a bridge gated moments earlier (by the test before
  // this one) needs a scan to come back before it can be re-bound. Asserting the sync response directly made this
  // fail 20ms in, looking like a product bug when it was the harness being impatient.
  expect(serving(await until((v) => serving(v, project.projectName), 20_000), project.projectName)).toBe(true)

  // A closes. B still wants it — the union, not a refcount, is what decides. This is the "two windows on one
  // project" case that used to disconnect whichever app you closed first.
  await close(a)
  await sync(b, want)
  await sleep(2000) // give a WRONG implementation time to gate it
  expect(serving(await status(), project.projectName), "B still wants it — closing A must not gate the bridge").toBe(true)
}, 60_000)
