import { describe, test, expect, beforeEach } from "bun:test"
import { show } from "../../commands/show.js"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"

describe("show", () => {
  test("show HEAD with valid path does not throw", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      await show(workspace, bridge, "HEAD", "POUs/FB_Motor.st")
    } finally {
      cleanup()
    }
  })

  test("show with missing ref sets exitCode", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      await show(workspace, bridge, "refs/heads/nonexistent", "POUs/FB_Motor.st")
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = undefined
      cleanup()
    }
  })

  test("show with missing path sets exitCode", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      await show(workspace, bridge, "HEAD", "nonexistent/path.st")
      expect(process.exitCode).toBe(2)
    } finally {
      process.exitCode = undefined
      cleanup()
    }
  })

  test("show BRIDGE writes the LIVE IDE content (for diffing without a pull)", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      // IDE moves on; BRIDGE must reflect that, not the snapshot.
      bridge.mutate("FB_Motor", {
        name: "FB_Motor", folder: "POUs",
        sourceText: "FUNCTION_BLOCK FB_Motor\nVAR\n\tlive : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n",
      })

      let out = ""
      const orig = process.stdout.write
      process.stdout.write = ((s: string | Uint8Array) => { out += s.toString(); return true }) as typeof process.stdout.write
      try {
        await show(workspace, bridge, "BRIDGE", "POUs/FB_Motor.st")
      } finally {
        process.stdout.write = orig
      }
      expect(out).toContain("live : INT := 7")
    } finally {
      cleanup()
    }
  })

  test("show BRIDGE for an unknown item sets exitCode 2", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      await show(workspace, bridge, "BRIDGE", "POUs/DoesNotExist.st")
      expect(process.exitCode).toBe(2)
    } finally {
      process.exitCode = undefined
      cleanup()
    }
  })

  test("show HEAD tolerates the src/-prefixed workspace path (diff left side)", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      let out = ""
      const orig = process.stdout.write
      process.stdout.write = ((s: string | Uint8Array) => { out += s.toString(); return true }) as typeof process.stdout.write
      try {
        // The SCM view may pass either form — both must resolve.
        await show(workspace, bridge, "HEAD", "src/POUs/FB_Motor.st")
      } finally {
        process.stdout.write = orig
      }
      expect(out).toContain("FUNCTION_BLOCK FB_Motor")
    } finally {
      cleanup()
    }
  })
})
