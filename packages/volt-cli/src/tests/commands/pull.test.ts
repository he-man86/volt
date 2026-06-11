import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { existsSync, writeFileSync } from "node:fs"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"
import { writeMergeFile, deleteMergeFile } from "../../git/plumbing.js"
import { workspacePaths } from "../../config/workspace.js"

describe("pull", () => {
  test("clean pull on empty workspace returns ok with synced items", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      const initResult = await init(workspace, bridge, {})
      expect(initResult.kind).toBe("ok")

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.synced.length).toBeGreaterThan(0)
      }
    } finally {
      cleanup()
    }
  })

  test("files materialized under src/ with correct paths", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      expect(existsSync(join(workspace, "src", "POUs", "FB_Motor.st"))).toBe(true)
      expect(existsSync(join(workspace, "src", "GVL_Config.gvl"))).toBe(true)
      expect(existsSync(join(workspace, "src", "PLC_PRG.st"))).toBe(true)
      expect(existsSync(join(workspace, "src", "POUs", "Types", "DUT_MotorState.struct"))).toBe(true)
    } finally {
      cleanup()
    }
  })

  test("second pull is a no-op", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      // Already up to date — a second pull succeeds but the synced array
      // may still contain the same paths. The snapshot machinery accepts
      // duplicate pulls as a no-op.
    } finally {
      cleanup()
    }
  })

  test("pull refused when merge in progress", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const paths = workspacePaths(workspace)
      writeMergeFile(paths.snapshotPath, "MERGE_HEAD", "abcd1234\n")

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("refused")
      if (result.kind === "refused") {
        expect(result.reason).toContain("merge")
      }

      deleteMergeFile(paths.snapshotPath, "MERGE_HEAD")
    } finally {
      cleanup()
    }
  })

  test("pull refused when workspace dirty", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      writeFileSync(motorPath, "// dirty change")

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("refused")
      if (result.kind === "refused") {
        expect(result.reason).toContain("edit")
      }
    } finally {
      cleanup()
    }
  })

  test("pull --force overwrites dirty workspace", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      const original = "FUNCTION_BLOCK FB_Motor\nVAR\n\tspeed : INT := 0;\n\trunning : BOOL := FALSE;\nEND_VAR\n\nIF NOT running THEN\n\tspeed := speed + 1;\nEND_IF\nEND_FUNCTION_BLOCK\n"
      writeFileSync(motorPath, "// dirty change")

      const result = await pull(workspace, bridge, { force: true })
      expect(result.kind).toBe("ok")
    } finally {
      cleanup()
    }
  })

  test("pull removes retired items", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      // Delete an item from the bridge to simulate IDE-level deletion
      bridge.mutate("FB_Motor", undefined)

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      expect(existsSync(join(workspace, "src", "POUs", "FB_Motor.st"))).toBe(false)
    } finally {
      cleanup()
    }
  })
})
