#!/usr/bin/env bun
/**
 * Recreate the PROD distributable installers — both the desktop NSIS and the CLI NSIS — in one go.
 *
 * Installers are prod-only: the dev/beta channels are for `dev.ts` (run from source) and CI beta releases,
 * not local installer builds. This forces OPENCODE_CHANNEL=prod so the bundled `volt` binary, the desktop
 * app, and the update feeds are all the prod channel (otherwise the binary embeds whatever channel the last
 * `dist.ts` used — e.g. a dev binary inside a prod installer).
 *
 *   bun volt-scripts/build-installers.ts
 *      ->  dist/Volt-CLI-Setup-<ver>-x64.exe            (CLI installer)
 *      ->  packages/desktop/dist/Volt-Setup-<ver>-x64.exe  (desktop installer)
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
step("CLI installer (NSIS)", "bun", ["volt-scripts/build-cli-installer.ts"])
step("desktop installer (electron-builder NSIS)", "bun", ["run", "package:win"], resolve(repo, "packages/desktop"))

console.log("\n✓ prod installers built:")
console.log("    dist/Volt-CLI-Setup-<ver>-x64.exe               (CLI)")
console.log("    packages/desktop/dist/Volt-Setup-<ver>-x64.exe  (desktop)")
