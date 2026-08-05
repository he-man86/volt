import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readRecent, setRecentFile, writeRecent } from "./recent.js"

// This is what replaced opencode's route as the desktop's "which project" signal, so the two ways it can go wrong
// both strand the user on the create-a-new-workspace surface with their real workspace out of reach.
test("a recorded workspace round-trips, and a vanished or corrupt one reads as unbound", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-recent-"))
  try {
    const store = join(dir, "last-workspace.json")
    setRecentFile(store)

    expect(readRecent()).toBeUndefined() // first run — no store yet

    writeRecent(dir)
    expect(readRecent()).toBe(dir)

    writeRecent(join(dir, "moved-away")) // recorded, then deleted/unplugged
    expect(readRecent()).toBeUndefined()

    writeFileSync(store, "{ not json")
    expect(readRecent()).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
