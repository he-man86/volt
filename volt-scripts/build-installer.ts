#!/usr/bin/env bun
/**
 * Build the PROD Volt installer — one all-inclusive desktop NSIS: the GUI app + the `volt` CLI (on PATH) +
 * the bridge/connector + the LSP. There is no separate CLI installer: the install is a superset, so terminal
 * users just use `volt` and the VS Code extension off the same install (no GUI-less variant, no collisions).
 *
 * Forces OPENCODE_CHANNEL=prod so the bundled binary, the app, and the update feed are all the prod channel.
 *
 *   bun volt-scripts/build-installer.ts  ->  packages/desktop/dist/Volt-Setup-<ver>-x64.exe
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const env = { ...process.env, OPENCODE_CHANNEL: "prod" }

function step(name: string, cmd: string, args: string[], cwd = repo): void {
  console.log(`\n• ${name}`)
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env })
  if (r.status !== 0) {
    console.error(`✗ ${name} failed`)
    process.exit(1)
  }
}

step("bundle — prod volt binary + LSP + connector", "bun", ["volt-scripts/dist.ts"])
step("installer (electron-builder NSIS)", "bun", ["run", "package:win"], resolve(repo, "packages/desktop"))

console.log("\n✓ prod installer: packages/desktop/dist/Volt-Setup-<ver>-x64.exe")
