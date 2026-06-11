import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"
import { workspacePaths } from "../../config/workspace.js"

describe("init", () => {
  test("init creates .volt/config.json with project binding", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      const result = await init(workspace, bridge, {})
      expect(result.kind).toBe("ok")

      const paths = workspacePaths(workspace)
      expect(existsSync(paths.configPath)).toBe(true)
    } finally {
      cleanup()
    }
  })

  test("init creates snapshot repo", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      const result = await init(workspace, bridge, {})
      expect(result.kind).toBe("ok")

      const paths = workspacePaths(workspace)
      expect(existsSync(paths.snapshotPath)).toBe(true)
    } finally {
      cleanup()
    }
  })

  test("init --no-scaffold skips scaffold files", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      const result = await init(workspace, bridge, { noScaffold: true })
      expect(result.kind).toBe("ok")
    } finally {
      cleanup()
    }
  })

  test("init --force overwrites existing config", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      const first = await init(workspace, bridge, {})
      expect(first.kind).toBe("ok")

      // Re-init with force — should succeed even though config already exists
      const second = await init(workspace, bridge, { force: true })
      expect(second.kind).toBe("ok")
    } finally {
      cleanup()
    }
  })

  test("init refuses when bridge has no project loaded", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      bridge.mutateHealth({ connected: false, projectName: "", plcProjectName: "" })

      const result = await init(workspace, bridge, {})
      expect(result.kind).toBe("error")
    } finally {
      cleanup()
    }
  })
})
