import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initBareRepo, writeBlob, buildTree, createDeterministicCommit, updateRef } from "../../git/plumbing.js"
import { loadState, saveState, type RepoState } from "../../snapshot/repo.js"
import { hasChanges, computeIncoming, type ChangeSet } from "../../snapshot/state.js"

describe("state", () => {
  test("RepoState load/save round-trips", () => {
    const root = mkdtempSync(join(tmpdir(), "volt-state-test-"))
    try {
      mkdirSync(root, { recursive: true })
      initBareRepo(root)

      const state: RepoState = {
        projectVersion: "abc123",
        commitSha: "def456",
        items: { FB_Motor: "v1", GVL_Config: "v2" },
        folders: { FB_Motor: "POUs", GVL_Config: "" },
      }

      saveState(root, state)
      const loaded = loadState(root)

      expect(loaded).not.toBeNull()
      expect(loaded!.projectVersion).toBe("abc123")
      expect(loaded!.commitSha).toBe("def456")
      expect(loaded!.items).toEqual({ FB_Motor: "v1", GVL_Config: "v2" })
      expect(loaded!.folders).toEqual({ FB_Motor: "POUs", GVL_Config: "" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("hasChanges detects modified items", () => {
    const empty: ChangeSet = { added: [], removed: [], modified: [], moved: [] }
    expect(hasChanges(empty)).toBe(false)

    expect(hasChanges({ ...empty, added: ["Foo"] })).toBe(true)
    expect(hasChanges({ ...empty, removed: ["Foo"] })).toBe(true)
    expect(hasChanges({ ...empty, modified: ["Foo"] })).toBe(true)
    expect(hasChanges({ ...empty, moved: [{ name: "Foo", from: "a", to: "b" }] })).toBe(true)
  })

  test("computeIncoming detects added/removed/modified", () => {
    const bridgeItems = { FB_Motor: "v2", GVL_Config: "v1", NewPOU: "v1" }
    const snapshotItems = { FB_Motor: "v1", GVL_Config: "v1", OldPOU: "v1" }

    const result = computeIncoming(bridgeItems, snapshotItems)
    expect(result.added).toEqual(["NewPOU"])
    expect(result.removed).toEqual(["OldPOU"])
    expect(result.modified).toEqual(["FB_Motor"])
    expect(result.moved).toEqual([])
  })

  test("computeIncoming handles empty snapshot", () => {
    const bridgeItems = { A: "v1", B: "v2" }
    const result = computeIncoming(bridgeItems, {})
    expect(result.added).toEqual(["A", "B"])
    expect(result.removed).toEqual([])
    expect(result.modified).toEqual([])
  })
})
