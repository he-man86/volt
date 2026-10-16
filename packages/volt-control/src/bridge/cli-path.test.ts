import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

// A host's configured CLI path that does not exist is REFUSED by name — never quietly swapped for whatever `volt` is
// on PATH (a packaged desktop missing its own bin\volt.exe would otherwise run another build). Run in a child bun:
// cli-args.test.ts replaces ./cli.js with a mock for the whole test process, so the real module is only reachable
// from a fresh one.
test("setBundledCli refuses a path that does not exist, naming it", () => {
  const missing = join(import.meta.dir, "no-such-dir", "volt.exe")
  const script = `import { setBundledCli } from ${JSON.stringify(join(import.meta.dir, "cli.ts"))}
try { setBundledCli(${JSON.stringify(missing)}); console.log("ACCEPTED") } catch (e) { console.log("REFUSED " + e.message) }`
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" })
  expect(r.stdout).toContain("REFUSED")
  expect(r.stdout).toContain(missing)
})
