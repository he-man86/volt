import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { status } from "../../commands/status.js"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"

describe("status", () => {
  test("status after init before pull does not throw", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await status(workspace, bridge, {})
    } finally {
      cleanup()
    }
  })

  test("status after pull does not throw", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      await status(workspace, bridge, {})
    } finally {
      cleanup()
    }
  })

  test("status after workspace edit does not throw", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      const motorPath = join(workspace, "src", "POUs", "FB_Motor.st")
      writeFileSync(motorPath, "// dirty change")

      await status(workspace, bridge, {})
    } finally {
      cleanup()
    }
  })

  test("status with --json flag does not throw", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      await status(workspace, bridge, { json: true })
    } finally {
      cleanup()
    }
  })

  test("status with --porcelain flag does not throw", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})
      await status(workspace, bridge, { porcelain: true })
    } finally {
      cleanup()
    }
  })
})
