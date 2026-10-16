import { expect, test } from "bun:test"
import { healthDisplay, syncState, type WorkspaceSync } from "./display.js"
import type { HealthState } from "../bridge/health.js"
import type { StatusJson } from "./types.js"

const empty = { added: [], modified: [], removed: [] }
const connected: HealthState = { kind: "connected", health: { projectName: "P" } }
const degraded: HealthState = { kind: "degraded", health: { projectName: "P" } }
const disconnected: HealthState = { kind: "disconnected", health: { projectName: "P" } }
const unreachable: HealthState = { kind: "unreachable", reason: "ECONNREFUSED" }
const probing: HealthState = { kind: "unknown" }

function status(over: Partial<StatusJson> = {}): StatusJson {
  return { initialized: true, merging: null, incoming: empty, outgoing: empty, pathByName: {}, summary: "", ...over }
}
const merging = status({ merging: { projectVersion: "v", conflicts: [] } })
const drift = status({ incoming: { added: ["A.pou"], modified: [], removed: [] }, outgoing: { added: [], modified: ["B.pou"], removed: [] } })
const unwalked = status({ unwalkedFolders: ["Machine"] })
const unreadable = status({ unreadable: [{ name: "Broken", reason: "read failed" }] })

test("nothing bound → none", () => {
  expect(syncState([])).toBe("none")
})

// Every status shape on every health kind: a merge wins over everything; otherwise only the HEALTH decides, and a
// partial view, drift or a degraded channel stays online.
test.each([
  ["connected", connected, "online"],
  ["degraded", degraded, "online"],
  ["disconnected (no project loaded)", disconnected, "offline"],
  ["unreachable", unreachable, "offline"],
  // The bug this guards: a pre-probe workspace read as "in sync/connected" before any probe had answered.
  ["unknown (probing)", probing, "offline"],
] as [string, HealthState, string][])("%s health", (_name, health, expected) => {
  for (const s of [undefined, status(), drift, unwalked, unreadable]) {
    expect(syncState([{ status: s, health }])).toBe(expected as never)
  }
  expect(syncState([{ status: merging, health }])).toBe("merging")
})

test("worst state wins across workspaces: merging > offline > online", () => {
  const on: WorkspaceSync = { status: drift, health: connected }
  const off: WorkspaceSync = { status: status(), health: unreachable }
  const merge: WorkspaceSync = { status: merging, health: connected }
  expect(syncState([on, off])).toBe("offline")
  expect(syncState([off, merge, on])).toBe("merging")
  expect(syncState([on, { status: unwalked, health: degraded }])).toBe("online")
})

// The reduction it replaced ranked "no project" above "degraded" in its doc but let whichever came FIRST win, so a
// degraded workspace listed before a disconnected one read as online. Order must not decide.
test("the order of the workspaces never changes the state", () => {
  const deg: WorkspaceSync = { status: status(), health: degraded }
  for (const health of [disconnected, probing, unreachable]) {
    const down: WorkspaceSync = { status: status(), health }
    expect(syncState([deg, down])).toBe("offline")
    expect(syncState([down, deg])).toBe("offline")
  }
})

test("healthDisplay maps each kind", () => {
  expect(healthDisplay(connected)).toMatchObject({ online: true, tone: "ok" })
  expect(healthDisplay(degraded)).toMatchObject({ online: true, tone: "warn" })
  expect(healthDisplay(unreachable)).toMatchObject({ online: false, tone: "error" })
  expect(healthDisplay(disconnected).online).toBe(false)
})
