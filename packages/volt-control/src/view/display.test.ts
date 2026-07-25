import { expect, test } from "bun:test"
import { aggregate, healthDisplay, type WorkspaceState } from "./display.js"
import type { HealthState } from "../bridge/health.js"
import type { StatusJson } from "./types.js"

const empty = { added: [], modified: [], removed: [] }
const connected: HealthState = { kind: "connected", health: { status: "healthy", connected: true } }
const unreachable: HealthState = { kind: "unreachable", reason: "ECONNREFUSED" }

function status(over: Partial<StatusJson> = {}): StatusJson {
  return {
    initialized: true,
    merging: null,
    incoming: empty,
    outgoing: empty,
    pathByName: {},
    projectMismatch: null,
    summary: "",
    ...over,
  }
}

test("no workspaces → uninitialized", () => {
  expect(aggregate([]).severity).toBe("uninitialized")
})

test("in sync → insync", () => {
  const ws: WorkspaceState = { status: status(), health: connected }
  expect(aggregate([ws]).severity).toBe("insync")
})

test("drift counts both directions", () => {
  const ws: WorkspaceState = {
    status: status({ incoming: { added: ["A"], modified: [], removed: [] }, outgoing: { added: [], modified: ["B", "C"], removed: [] } }),
    health: connected,
  }
  const d = aggregate([ws])
  expect(d.severity).toBe("drift")
  expect(d.incoming).toBe(1)
  expect(d.outgoing).toBe(2)
  expect(d.label).toBe("Volt 2↑ 1↓")
})

test("worst-state-wins: merge beats offline beats drift", () => {
  const merging: WorkspaceState = { status: status({ merging: { projectVersion: "v", conflicts: [] } }), health: unreachable }
  const offline: WorkspaceState = { status: status({ outgoing: { added: ["X"], modified: [], removed: [] } }), health: unreachable }
  expect(aggregate([offline, merging]).severity).toBe("merging") // merge wins over the offline+drift peer
  expect(aggregate([offline]).severity).toBe("offline") // offline wins over drift
  expect(aggregate([offline]).action).toBe("status") // bridge control is the connector's job, not the frontend's
})

test("probing (unknown health) never reads as insync/connected", () => {
  // The bug: aggregate started conn="ok" and ignored `unknown`, so the pre-probe window reported "insync".
  const probing: WorkspaceState = { status: status(), health: { kind: "unknown" } }
  const d = aggregate([probing])
  expect(d.severity).not.toBe("insync")
  expect(d.severity).toBe("offline")
})

test("healthDisplay maps each kind", () => {
  expect(healthDisplay(connected)).toMatchObject({ online: true, tone: "ok" })
  expect(healthDisplay({ kind: "degraded", health: { connected: true } })).toMatchObject({ online: true, tone: "warn" })
  expect(healthDisplay(unreachable)).toMatchObject({ online: false, tone: "error" })
  expect(healthDisplay({ kind: "disconnected", health: { connected: false } }).online).toBe(false)
})
