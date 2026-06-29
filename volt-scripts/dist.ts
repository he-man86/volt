#!/usr/bin/env bun
/**
 * Volt release builder — compiles every shippable binary into dist/volt/ so the installer just bundles
 * one folder. The desktop app + NSIS installer are built separately (packages/desktop: `package:win`),
 * which bundles this folder via extraResources.
 *
 *   bun volt-scripts/dist.ts            # binaries + bridges
 *   bun volt-scripts/dist.ts --no-bridge  # binaries only (skip dotnet)
 *
 * Output:
 *   dist/volt/bin/volt[.exe]              the CLI: bare `volt` opens the agent, `volt <verb>` syncs
 *   dist/volt/bin/volt-lsp-codesys[.exe]  the Structured Text LSP (no node needed)
 *   dist/volt/bridge/                     the C# IDE connectors (best-effort; needs dotnet)
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const out = resolve(repo, "dist/volt")
const bin = resolve(out, "bin")
const ext = process.platform === "win32" ? ".exe" : ""
const skipBridge = process.argv.includes("--no-bridge")

function run(cmd: string, args: string[], cwd = repo): boolean {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
  return r.status === 0
}

function compile(entry: string, name: string): void {
  if (!run("bun", ["build", "--compile", "--outfile", resolve(bin, name + ext), entry])) {
    console.error(`✗ failed to compile ${name}`)
    process.exit(1)
  }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(bin, { recursive: true })

console.log("• volt binary (opencode + PLC — mirrors opencode's build, TUI included)")
if (!run("bun", ["volt-scripts/build.ts"])) {
  console.error("✗ volt build failed")
  process.exit(1)
}

console.log("• volt-lsp-codesys")
compile("packages/volt-lsp-codesys/src/bin.ts", "volt-lsp-codesys")

if (!skipBridge) {
  console.log("• bridges (C#)")
  // Best-effort: a machine without the .NET SDK can still ship the TS binaries (the bridge is the IDE side).
  if (!run("bun", ["run", "build:all"], resolve(repo, "packages/volt-bridge"))) {
    console.warn("⚠ bridge build failed (dotnet missing?) — binaries are still in dist/volt/bin; pass --no-bridge to silence")
  }
}

// Self-check: the two binaries are the non-negotiable release artifacts.
for (const name of ["volt", "volt-lsp-codesys"]) {
  if (!existsSync(resolve(bin, name + ext))) {
    console.error(`✗ missing expected artifact: ${name}${ext}`)
    process.exit(1)
  }
}

console.log(`\n✓ release binaries in ${out}`)
