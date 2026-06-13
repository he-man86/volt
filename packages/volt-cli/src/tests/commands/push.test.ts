import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs"
import { push } from "../../commands/push.js"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"
import { writeMergeFile, deleteMergeFile } from "../../git/plumbing.js"
import { workspacePaths } from "../../config/workspace.js"

describe("push", () => {
  test("push after pull with no edits returns ok with no ops", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.items).toEqual([])
      }
    } finally {
      cleanup()
    }
  })

  test("push with source edit sends pushItem", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      writeFileSync(motorPath, "FUNCTION_BLOCK FB_Motor\nVAR\n\tspeed : INT := 100;\nEND_VAR\n\nspeed := speed + 1;\nEND_FUNCTION_BLOCK\n")

      const beforeCount = bridge.pushCalls.length
      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.items).toContain("FB_Motor")
      }
      expect(bridge.pushCalls.length).toBeGreaterThan(beforeCount)
    } finally {
      cleanup()
    }
  })

  test("push refused when binding mismatches", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      bridge.mutateHealth({ projectName: "DifferentProject" })

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("rejected")
    } finally {
      cleanup()
    }
  })

  test("push refused when merge in progress", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const paths = workspacePaths(workspace)
      writeMergeFile(paths.snapshotPath, "MERGE_HEAD", "abcd1234\n")

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("rejected")
      if (result.kind === "rejected") {
        expect(result.reason).toContain("merge")
      }

      deleteMergeFile(paths.snapshotPath, "MERGE_HEAD")
    } finally {
      cleanup()
    }
  })

  test("push handles moveItem", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      // Move FB_Motor.st to a different folder
      const oldPath = join(workspace, "src", "POUs", "FB_Motor.st")
      const newDir = join(workspace, "src", "Motors")
      mkdirSync(newDir, { recursive: true })
      const newPath = join(newDir, "FB_Motor.st")
      renameSync(oldPath, newPath)

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.items).toContain("FB_Motor")
      }
    } finally {
      cleanup()
    }
  })

  test("push handles create and delete", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      // Create a new POU file
      const newPath = join(workspace, "src", "MyNewPOU.st")
      writeFileSync(newPath, "FUNCTION_BLOCK MyNewPOU\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n")

      const createResult = await push(workspace, bridge, {})
      expect(createResult.kind).toBe("ok")
      if (createResult.kind === "ok") {
        expect(createResult.items).toContain("MyNewPOU")
      }

      // Now delete it
      unlinkSync(newPath)

      const deleteResult = await push(workspace, bridge, {})
      expect(deleteResult.kind).toBe("ok")
      if (deleteResult.kind === "ok") {
        expect(deleteResult.items).toContain("MyNewPOU")
      }
    } finally {
      cleanup()
    }
  })
})

// The push-side of concurrent edits: the engineer changed the IDE after the last
// pull, and the user tries to push a local edit. Push must NOT clobber the IDE.
describe("push — IDE drift since last pull", () => {
  test("push refused when the IDE drifted (changed another item)", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      // Local edit to send...
      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      writeFileSync(motorPath, "FUNCTION_BLOCK FB_Motor\nVAR\n\tspeed : INT := 100;\nEND_VAR\nEND_FUNCTION_BLOCK\n")
      // ...but the IDE moved on (a different item changed) since the last pull.
      bridge.mutate("PLC_PRG", {
        name: "PLC_PRG",
        kind: "program",
        sourceText: "PROGRAM PLC_PRG\nVAR\n\tcycles : INT;\nEND_VAR\ncycles := cycles + 1;\nEND_PROGRAM\n",
      })

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("rejected")
      if (result.kind === "rejected") {
        expect(result.reason).toContain("drift")
      }
    } finally {
      cleanup()
    }
  })

  test("push --force sends the local edit despite IDE drift", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      writeFileSync(motorPath, "FUNCTION_BLOCK FB_Motor\nVAR\n\tspeed : INT := 100;\nEND_VAR\nEND_FUNCTION_BLOCK\n")
      bridge.mutate("PLC_PRG", {
        name: "PLC_PRG",
        kind: "program",
        sourceText: "PROGRAM PLC_PRG\nVAR\n\tcycles : INT;\nEND_VAR\ncycles := cycles + 1;\nEND_PROGRAM\n",
      })

      const result = await push(workspace, bridge, { force: true })
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.items).toContain("FB_Motor")
      }
      // The forced push must NOT have clobbered the IDE's drifted item.
      expect(bridge.items.get("PLC_PRG")?.sourceText).toContain("cycles")
    } finally {
      cleanup()
    }
  })
})
