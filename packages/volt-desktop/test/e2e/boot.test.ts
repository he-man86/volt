import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
// electron's default export IS the path to its executable when imported from node/bun (not inside electron).
import electronPath from "electron"

const root = join(import.meta.dir, "..", "..") // desktop package root — where main.mjs + shell.html live

// The real electron smoke: launch the built app in VOLT_SMOKE mode. main.ts creates the frameless window, loads
// shell.html, then (in smoke mode) asserts the shell URL and exits 0 — so a clean exit means the electron entry,
// the window, and the Volt shell all rendered. Headless on CI via xvfb (the `desktop-e2e` job wraps this).
// Needs `bun run build` first (electron loads main.mjs) — the `test:e2e` script does that.
test("electron app boots a window and renders the Volt shell", () => {
  // --no-sandbox: CI runners have no correctly-configured SUID sandbox (and run as root), so electron aborts
  // without it. Harmless locally; standard for headless electron in CI.
  const r = spawnSync(electronPath as unknown as string, ["--no-sandbox", "."], {
    cwd: root,
    env: { ...process.env, VOLT_SMOKE: "1" },
    timeout: 60_000,
    stdio: "inherit",
  })
  expect(r.error).toBeUndefined()
  expect(r.status).toBe(0)
}, 70_000)
