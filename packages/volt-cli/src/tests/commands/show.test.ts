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
})
