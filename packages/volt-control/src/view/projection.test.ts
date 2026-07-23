import { expect, test } from "bun:test"
import { projectWorkspace, onboardingMode } from "./workspace.js"
import { describePull, describePush, describeMerge } from "./outcomes.js"
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
test("projectWorkspace: tags A/M/D, strips src/, and reports the vendor as initialized", () => {
  const status = statusWith({
    incoming: { added: ["New.fb"], modified: ["Edit.fb"], removed: ["Gone.fb"] },
    pathByName: { "New.fb": "src/POUs/New.fb", "Edit.fb": "src/Edit.fb", "Gone.fb": "src/Gone.fb" },
  })
  const v = projectWorkspace({ workspaceRoot: "/ws", status, health: connected, vendor: "codesys" })
  expect(v.initialized).toBe(true)
  expect(v.vendor).toBe("codesys") // 8556 → CODESYS; the UI shows this, not the port
  expect(v.paused).toBeNull()
  expect(v.incoming).toEqual([
    { name: "New.fb", sub: "A", relPath: "POUs/New.fb" },
    { name: "Edit.fb", sub: "M", relPath: "Edit.fb" },
    { name: "Gone.fb", sub: "D", relPath: "Gone.fb" },
  ])
})

test("projectWorkspace: no vendor ⇒ not initialized", () => {
  const v = projectWorkspace({ workspaceRoot: "/ws", status: statusWith(), health: connected })
  expect(v.initialized).toBe(false)
  expect(v.vendor).toBeUndefined()
})

test("projectWorkspace: merging wins over mismatch and hides drift items", () => {
  const status = statusWith({
    merging: { projectVersion: "v", conflicts: [{ path: "A.fb", kind: "text", reason: "both" }] },
    projectMismatch: { configuredAs: { platform: "p", projectName: "A" }, bridgeReports: { platform: "p", projectName: "B" }, diffFields: ["projectName"] },
    incoming: { added: ["X.fb"], removed: [], modified: [] },
  })
  const v = projectWorkspace({ workspaceRoot: "/ws", status, health: connected, vendor: "codesys" })
  expect(v.paused).toBe("merging")
  expect(v.incoming).toEqual([]) // items hidden while paused
})

test("projectWorkspace: a project mismatch alone reports the mismatch reason", () => {
  const status = statusWith({
    projectMismatch: { configuredAs: { platform: "p", projectName: "A" }, bridgeReports: { platform: "p", projectName: "B" }, diffFields: ["projectName"] },
  })
  expect(projectWorkspace({ workspaceRoot: "/ws", status, health: connected, vendor: "codesys" }).paused).toBe("mismatch")
})

// ── syncMode: the state machine both shells render from ──────────────────────
test("projectWorkspace.mode: the offline/ready/merging/mismatch/uninitialized state machine", () => {
  const unreachable: HealthState = { kind: "unreachable", reason: "x" }
  const mk = (over: Partial<StatusJson>, health: HealthState, vendor?: "codesys") =>
    projectWorkspace({ workspaceRoot: "/ws", status: statusWith(over), health, vendor }).mode

  expect(mk({}, connected, "codesys")).toBe("ready") // initialized + online + clean
  expect(mk({}, unreachable, "codesys")).toBe("offline") // initialized but bridge down
  expect(mk({}, { kind: "unknown" }, "codesys")).toBe("offline") // probing counts as not-ready
  expect(mk({}, connected)).toBe("uninitialized") // no vendor ⇒ onboarding
  // merge/mismatch outrank offline — resolvable with the bridge down.
  expect(mk({ merging: { projectVersion: "v", conflicts: [] } }, unreachable, "codesys")).toBe("merging")
  expect(
    mk({ projectMismatch: { configuredAs: { platform: "p", projectName: "A" }, bridgeReports: { platform: "p", projectName: "B" }, diffFields: ["projectName"] } }, unreachable, "codesys"),
  ).toBe("mismatch")
})

// ── onboardingMode: how an UNBOUND folder gets connected ─────────────────────
// The gap this closes: `uninitialized` used to be split by each shell independently, and they diverged — one of
// them couldn't tell "connector down" from "no project open", which need OPPOSITE fixes (start Volt vs open a
// project). One decision, both shells.
test("onboardingMode: connector-down outranks the (necessarily empty) project list", () => {
  expect(onboardingMode(false, 0)).toBe("no-connector")
  expect(onboardingMode(false, 3)).toBe("no-connector") // stale list from before it died — still 'start Volt'
  expect(onboardingMode(true, 0)).toBe("no-project")
  expect(onboardingMode(true, 1)).toBe("choose-project")
})

// ── outcome descriptors ──────────────────────────────────────────────────────
test("describePull: conflict offers Open Conflicts / Finish Merge / Abort; refused offers Force Pull", () => {
  const conflict = describePull({ kind: "conflict", paths: ["A.fb", "B.fb"] })
  expect(conflict.actions.map((a) => a.tag)).toEqual(["open-conflicts", "finish-merge", "abort-merge"])
  expect(conflict.actions.find((a) => a.tag === "abort-merge")?.destructive).toBe(true) // Abort confirms first
  const refused = describePull({ kind: "refused", reason: "dirty tree" })
  expect(refused.tone).toBe("warn")
  expect(refused.actions.map((a) => a.tag)).toEqual(["force-pull"])
  expect(describePull({ kind: "ok", synced: ["A.fb"] }).actions).toEqual([])
})

test("describeMerge: done is a clean toast; unresolved keeps the finish/abort affordances", () => {
  expect(describeMerge({ kind: "done", message: "merge completed — IDE baseline synced" }).actions).toEqual([])
  const unresolved = describeMerge({ kind: "unresolved", message: "2 file(s) with conflict markers" })
  expect(unresolved.tone).toBe("warn")
  expect(unresolved.actions.map((a) => a.tag)).toEqual(["open-conflicts", "finish-merge", "abort-merge"])
  expect(describeMerge({ kind: "error", message: "boom" }).tone).toBe("error")
})

test("describePush: rejected offers Pull First then Force Push (force is destructive)", () => {
  const v = describePush({ kind: "rejected", reason: "the IDE changed since your last sync — run `volt pull` first" })
  expect(v.actions.map((a) => a.tag)).toEqual(["pull-first", "force-push"])
  expect(v.actions.find((a) => a.tag === "force-push")?.destructive).toBe(true)
  expect(describePush({ kind: "error", message: "boom" }).tone).toBe("error")
})

test("describePush: empty push explains WHY — IDE-ahead ⇒ pull first, else in-sync", () => {
  const idea = (added: string[]): StatusJson => ({
    initialized: true, merging: null, incoming: { added, removed: [], modified: [] },
    outgoing: { added: [], removed: [], modified: [] }, pathByName: {}, projectMismatch: null, summary: "",
  })
  // Zero items + the IDE has changes → warn with a Pull First button, not a bare "0".
  const ahead = describePush({ kind: "ok", items: [] }, idea(["A.fb", "B.fb"]))
  expect(ahead.tone).toBe("warn")
  expect(ahead.message).toContain("2 change(s)")
  expect(ahead.actions.map((a) => a.tag)).toEqual(["pull-first"])
  // Zero items + truly in sync → the CLI's message, no action.
  const sync = describePush({ kind: "ok", items: [], message: "nothing to push — the IDE already matches your workspace" }, idea([]))
  expect(sync.tone).toBe("info")
  expect(sync.actions).toEqual([])
  expect(sync.message).toContain("already matches")
})
