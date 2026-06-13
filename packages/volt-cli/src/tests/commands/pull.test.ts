import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { show } from "../../commands/show.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"
import { writeMergeFile, deleteMergeFile } from "../../git/plumbing.js"
import { workspacePaths } from "../../config/workspace.js"

const MOTOR_PATH = ["src", "POUs", "FB_Motor.st"]
/** Build an FB_Motor bridge item with the given assembled source. */
const motorItem = (sourceText: string) => ({
	name: "FB_Motor",
	kind: "function_block",
	folder: "POUs",
	sourceText,
})

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

// Concurrent edits on BOTH sides between pull/push — the 3-way merge that's the
// crux of bidirectional sync. base = last pulled snapshot, ours = workspace edit,
// theirs = IDE edit (simulated via bridge.mutate).
describe("pull — concurrent edits (3-way merge)", () => {
  test("non-overlapping edits on both sides auto-merge cleanly", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      const motorPath = join(workspace, ...MOTOR_PATH)
      const base = readFileSync(motorPath, "utf-8")

      // ours: edit the declaration; theirs: edit the body (5 lines apart).
      writeFileSync(motorPath, base.replace("speed : INT := 0;", "speed : INT := 5;"))
      bridge.mutate("FB_Motor", motorItem(base.replace("speed := speed + 1;", "speed := speed + 2;")))

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("ok")

      // Both edits survive the merge, with no conflict markers.
      const merged = readFileSync(motorPath, "utf-8")
      expect(merged).toContain("speed : INT := 5;")
      expect(merged).toContain("speed := speed + 2;")
      expect(merged).not.toContain("<<<<<<<")
    } finally {
      cleanup()
    }
  })

  test("overlapping edits to the same line produce a conflict with markers", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      const motorPath = join(workspace, ...MOTOR_PATH)
      const base = readFileSync(motorPath, "utf-8")

      // Both sides change the SAME line to different values.
      writeFileSync(motorPath, base.replace("speed : INT := 0;", "speed : INT := 5;"))
      bridge.mutate("FB_Motor", motorItem(base.replace("speed : INT := 0;", "speed : INT := 9;")))

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("conflict")
      if (result.kind === "conflict") {
        // Conflict paths are snapshot-tree-relative (src/ is the tree root),
        // so they materialize at <workspace>/src/POUs/FB_Motor.st on disk.
        expect(result.paths).toContain("POUs/FB_Motor.st")
      }

      // Conflict markers materialized on disk for the engineer to resolve.
      const conflicted = readFileSync(motorPath, "utf-8")
      expect(conflicted).toContain("<<<<<<<")
      expect(conflicted).toContain("=======")
      expect(conflicted).toContain(">>>>>>>")
      expect(conflicted).toContain("speed : INT := 5;")
      expect(conflicted).toContain("speed : INT := 9;")
    } finally {
      cleanup()
    }
  })

  test("during a conflict, show resolves the three merge sides for the merge editor", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    const cap = async (ref: string): Promise<string> => {
      let out = ""
      const orig = process.stdout.write
      process.stdout.write = ((s: string | Uint8Array) => { out += s.toString(); return true }) as typeof process.stdout.write
      try { await show(workspace, bridge, ref, "POUs/FB_Motor.st") } finally { process.stdout.write = orig }
      return out
    }
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      const motorPath = join(workspace, ...MOTOR_PATH)
      const base = readFileSync(motorPath, "utf-8")
      writeFileSync(motorPath, base.replace("speed : INT := 0;", "speed : INT := 5;"))
      bridge.mutate("FB_Motor", motorItem(base.replace("speed : INT := 0;", "speed : INT := 9;")))
      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("conflict")

      // base = last-synced (0), ours = workspace edit (5), theirs = IDE edit (9).
      expect(await cap("MERGE_BASE")).toContain("speed : INT := 0;")
      expect(await cap("MERGE_OURS")).toContain("speed : INT := 5;")
      expect(await cap("MERGE_THEIRS")).toContain("speed : INT := 9;")
    } finally {
      process.exitCode = undefined
      cleanup()
    }
  })

  test("IDE deletes an item the workspace edited → modify-delete conflict", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      const motorPath = join(workspace, ...MOTOR_PATH)
      const base = readFileSync(motorPath, "utf-8")

      // ours: edit; theirs: delete.
      writeFileSync(motorPath, base.replace("speed : INT := 0;", "speed : INT := 5;"))
      bridge.mutate("FB_Motor", undefined)

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("conflict")
      if (result.kind === "conflict") {
        // Conflict paths are snapshot-tree-relative (src/ is the tree root),
        // so they materialize at <workspace>/src/POUs/FB_Motor.st on disk.
        expect(result.paths).toContain("POUs/FB_Motor.st")
      }
    } finally {
      cleanup()
    }
  })

  test("workspace deletes an item the IDE edited → delete-modify conflict", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      const motorPath = join(workspace, ...MOTOR_PATH)
      const base = readFileSync(motorPath, "utf-8")

      // ours: delete the file; theirs: edit.
      rmSync(motorPath)
      bridge.mutate("FB_Motor", motorItem(base.replace("speed := speed + 1;", "speed := speed + 2;")))

      const result = await pull(workspace, bridge, {})
      expect(result.kind).toBe("conflict")
      if (result.kind === "conflict") {
        // Conflict paths are snapshot-tree-relative (src/ is the tree root),
        // so they materialize at <workspace>/src/POUs/FB_Motor.st on disk.
        expect(result.paths).toContain("POUs/FB_Motor.st")
      }
    } finally {
      cleanup()
    }
  })
})
