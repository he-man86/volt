/**
 * THE PUBLISHED BUILD COMPILES — `tsc -p tsconfig.build.json`, the `build` script, the one CI's `integration` and
 * `control-e2e` jobs run before anything else.
 *
 * `bun test` never runs it, so it went red for days with every suite green: the build's program reached test-runner
 * helpers (`test/conformance/support/`, `test/frontend/`) that use Bun-only APIs (`Bun.spawnSync`, `import.meta.dir`,
 * `bun:test`) and cannot type under the build's `types: ["node"]` — rightly, since `dist/` is what a runtime that is
 * NOT Bun loads. The fix is the import graph (the build compiles `src/` and what the `./conformance` export reaches,
 * and that reaches no runner helper), and this is what keeps it fixed.
 */
import { expect, test } from "bun:test"
import { join } from "node:path"

test("tsc -p tsconfig.build.json compiles with no error — the build reaches no Bun-only test helper", () => {
  const out = Bun.spawnSync([process.execPath, "x", "tsc", "-p", "tsconfig.build.json", "--noEmit"], {
    cwd: join(import.meta.dir, ".."),
  })
  expect(out.stdout.toString() + out.stderr.toString()).toBe("")
  expect(out.exitCode).toBe(0)
})
