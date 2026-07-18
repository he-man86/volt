import { expect, test } from "bun:test"
import { projectWorkspace } from "./workspace.js"
import { describePull, describePush } from "./outcomes.js"
import type { StatusJson } from "./types.js"
import type { HealthState } from "../bridge/health.js"

const connected: HealthState = {
  kind: "connected",
  health: { status: "healthy", connected: true, projectName: "Proj" },
}

function statusWith(over: Partial<StatusJson> = {}): StatusJson {
  return {
    initialized: true,
    merging: null,
    incoming: { added: [], removed: [], modified: [] },
    outgoing: { added: [], removed: [], modified: [] },
    pathByName: {},
    projectMismatch: null,
    summary: "",
    ...over,
  }
}

// ── projectWorkspace ─────────────────────────────────────────────────────────
test("projectWorkspace: tags A/M/D, strips src/, and reports the port as initialized", () => {
  const status = statusWith({
    incoming: { added: ["New.fb"], modified: ["Edit.fb"], removed: ["Gone.fb"] },
    pathByName: { "New.fb": "src/POUs/New.fb", "Edit.fb": "src/Edit.fb", "Gone.fb": "src/Gone.fb" },
  })
  const v = projectWorkspace({ workspaceRoot: "/ws", status, health: connected, port: 8556 })
  expect(v.initialized).toBe(true)
  expect(v.port).toBe(8556)
  expect(v.vendor).toBe("codesys") // 8556 → CODESYS; the UI shows this, not the port
  expect(v.paused).toBeNull()
  expect(v.incoming).toEqual([
    { name: "New.fb", sub: "A", relPath: "POUs/New.fb" },
    { name: "Edit.fb", sub: "M", relPath: "Edit.fb" },
    { name: "Gone.fb", sub: "D", relPath: "Gone.fb" },
  ])
})

test("projectWorkspace: no port ⇒ not initialized", () => {
  const v = projectWorkspace({ workspaceRoot: "/ws", status: statusWith(), health: connected })
  expect(v.initialized).toBe(false)
  expect(v.port).toBeUndefined()
})

test("projectWorkspace: merging wins over mismatch and hides drift items", () => {
  const status = statusWith({
    merging: { projectVersion: "v", conflicts: [{ path: "A.fb", kind: "text", reason: "both" }] },
    projectMismatch: { configuredAs: { platform: "p", projectName: "A" }, bridgeReports: { platform: "p", projectName: "B" }, diffFields: ["projectName"] },
    incoming: { added: ["X.fb"], removed: [], modified: [] },
  })
  const v = projectWorkspace({ workspaceRoot: "/ws", status, health: connected, port: 8556 })
  expect(v.paused).toBe("merging")
  expect(v.incoming).toEqual([]) // items hidden while paused
})

test("projectWorkspace: a project mismatch alone reports the mismatch reason", () => {
  const status = statusWith({
    projectMismatch: { configuredAs: { platform: "p", projectName: "A" }, bridgeReports: { platform: "p", projectName: "B" }, diffFields: ["projectName"] },
  })
  expect(projectWorkspace({ workspaceRoot: "/ws", status, health: connected, port: 8556 }).paused).toBe("mismatch")
})

// ── outcome descriptors ──────────────────────────────────────────────────────
test("describePull: conflict offers Open Conflicts; refused offers Force Pull", () => {
  expect(describePull({ kind: "conflict", paths: ["A.fb", "B.fb"] }).actions.map((a) => a.tag)).toEqual(["open-conflicts"])
  const refused = describePull({ kind: "refused", reason: "dirty tree" })
  expect(refused.tone).toBe("warn")
  expect(refused.actions.map((a) => a.tag)).toEqual(["force-pull"])
  expect(describePull({ kind: "ok", synced: ["A.fb"] }).actions).toEqual([])
})

test("describePush: rejected offers Pull First then Force Push (force is destructive)", () => {
  const v = describePush({ kind: "rejected", reason: "the IDE changed since your last sync — run `volt pull` first" })
  expect(v.actions.map((a) => a.tag)).toEqual(["pull-first", "force-push"])
  expect(v.actions.find((a) => a.tag === "force-push")?.destructive).toBe(true)
  expect(describePush({ kind: "error", message: "boom" }).tone).toBe("error")
})
