import { describe, test, expect } from "bun:test"
import { build } from "../../commands/build.js"
import { pull } from "../../commands/pull.js"
import { init } from "../../commands/init.js"
import { makeTestEnv } from "../harness/test-env.js"
import { simple } from "../harness/fixtures.js"
import { TestBridge } from "../../bridge/test-bridge.js"

describe("build", () => {
  test("build returns success with zero diagnostics on clean project", async () => {
    const { workspace, bridge, cleanup } = makeTestEnv(simple)
    try {
      await init(workspace, bridge, {})
      await pull(workspace, bridge, {})

      await build(workspace, bridge, {})
    } finally {
      cleanup()
    }
  })

  test("build sets exitCode on failure with diagnostics", async () => {
    const failBridge = new TestBridge({
      initialItems: simple,
      build: async () => ({
        success: false,
        duration: 12,
        diagnostics: [{ severity: "error", message: "syntax error", line: 1, object: "PLC_PRG", section: "impl" }],
      }),
    })

    const env = makeTestEnv(simple)
    try {
      await init(env.workspace, failBridge, {})
      await pull(env.workspace, failBridge, {})

      await build(env.workspace, failBridge, {})
      expect(process.exitCode).toBe(2)
    } finally {
      process.exitCode = 0   // reset: `= undefined` does NOT clear it in bun → the runner would exit 2
      env.cleanup()
    }
  })
})
