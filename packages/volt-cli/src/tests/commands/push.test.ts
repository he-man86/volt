import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { writeFileSync, readFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs"
import { push } from "../../commands/push.js"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple, withConfig } from "../harness/fixtures.js"
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
        expect(result.items).toContain("FB_Motor.st")
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
        expect(result.items).toContain("FB_Motor.st")
      }
    } finally {
      cleanup()
    }
  })

  // Regression: on Windows the working-copy files often land on disk as CRLF
  // while the snapshot is canonically LF. Read-only files that are byte-identical
  // (modulo line endings) must NOT be flagged as policy refusals.
  test("read-only files with CRLF line endings are not refused", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(withConfig)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      // Rewrite the read-only library/task files with CRLF — same content, LF→CRLF.
      const roPaths = [
        join(workspace, "src", "Device", "Plc Logic", "Application", "Library Manager", "IoStandard.library"),
        join(workspace, "src", "Device", "Plc Logic", "Application", "MainTask.task"),
      ]
      for (const p of roPaths) {
        const lf = readFileSync(p, "utf-8")
        writeFileSync(p, lf.replace(/\n/g, "\r\n"))
      }

      // A genuine edit to a pushable file so push isn't a no-op.
      const pumpPath = join(workspace, "src", "POUs", "FB_Pump.st")
      writeFileSync(pumpPath, "FUNCTION_BLOCK FB_Pump\nVAR\n\tspeed : INT := 50;\nEND_VAR\nEND_FUNCTION_BLOCK\n")

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.items).toContain("FB_Pump.st")
        expect(result.items).not.toContain("IoStandard")
        expect(result.items).not.toContain("MainTask")
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
        expect(createResult.items).toContain("MyNewPOU.st")
      }

      // Now delete it
      unlinkSync(newPath)

      const deleteResult = await push(workspace, bridge, {})
      expect(deleteResult.kind).toBe("ok")
      if (deleteResult.kind === "ok") {
        expect(deleteResult.items).toContain("MyNewPOU.st")
      }
    } finally {
      cleanup()
    }
  })

  // A refused graphical push carries a STRUCTURED VG diagnostic (code + line + the canonical body). The CLI
  // must render it as a readable `name:line [CODE] …` block with the suggested form intact, not an opaque string.
  test("a structured VG diagnostic conflict is formatted with code, line, and the canonical body", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      // a local edit so push isn't a no-op
      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      writeFileSync(motorPath, "FUNCTION_BLOCK FB_Motor\nVAR\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n")

      // the bridge refuses with the structured diagnostic the round-trip gate emits
      bridge.nextPushConflicts = [{
        name: "fbd.fbd",
        reason: "graphical body is not in canonical form — use this exact body:\n\nNETWORK 0 FBD\n  g1 := (i1 AND i2)\nEND_NETWORK",
        code: "VG_NOT_CANONICAL",
        line: 5,
      }]

      const result = await push(workspace, bridge, {})
      expect(result.kind).toBe("rejected")
      if (result.kind === "rejected") {
        expect(result.reason).toContain("fbd.fbd:5 [VG_NOT_CANONICAL]")   // name:line [CODE]
        expect(result.reason).toContain("NETWORK 0 FBD")                  // the canonical body block is preserved (newlines kept)
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
        sourceText: "PROGRAM PLC_PRG\nVAR\n\tcycles : INT;\nEND_VAR\ncycles := cycles + 1;\nEND_PROGRAM\n",
      })

      const result = await push(workspace, bridge, { force: true })
      expect(result.kind).toBe("ok")
      if (result.kind === "ok") {
        expect(result.items).toContain("FB_Motor.st")
      }
      // The forced push must NOT have clobbered the IDE's drifted item.
      expect(bridge.items.get("PLC_PRG.st")?.sourceText).toContain("cycles")
    } finally {
      cleanup()
    }
  })
})
