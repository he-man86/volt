import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureRepo } from "../git/plumbing.js"

describe("ensureRepo", () => {
  test("creates a git repo at a standalone root, idempotently", () => {
    const dir = mkdtempSync(join(tmpdir(), "volt-ensure-"))
    try {
      expect(ensureRepo(dir)).toBe(true) // created
      expect(existsSync(join(dir, ".git"))).toBe(true)
      expect(ensureRepo(dir)).toBe(false) // already a repo → no-op
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("skips when the dir is already inside a git work tree (no nested repo)", () => {
    const outer = mkdtempSync(join(tmpdir(), "volt-outer-"))
    try {
      expect(ensureRepo(outer)).toBe(true) // outer becomes a repo
      const inner = join(outer, "sub")
      mkdirSync(inner)
      expect(ensureRepo(inner)).toBe(false) // inner is inside outer's worktree → skip
      expect(existsSync(join(inner, ".git"))).toBe(false)
    } finally {
      rmSync(outer, { recursive: true, force: true })
    }
  })
})
