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
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
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

// PATH helper bundled with the binaries — the installer's NSIS (connector.nsh) uses it to add/remove `volt`
// on PATH, so the install also gives you the terminal CLI + makes the VS Code extension work.
cpSync(resolve(import.meta.dirname, "volt-path.ps1"), resolve(bin, "volt-path.ps1"))

if (!skipBridge) {
  console.log("• bridges + connector (C#)")
  // build-bridges.ps1 runs the Core tests, publishes the bridges, and assembles the connector bundle
  // (VoltConnector.exe + workers) into packages/volt-bridge/dist/Connector. Best-effort: a machine without
  // the .NET SDK still ships the TS binaries (the bridge is the IDE side; pass --no-bridge to silence).
  const built =
    process.platform === "win32" &&
    run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "packages/volt-bridge/build-bridges.ps1"])
  const priorConnector = resolve(repo, "packages/volt-bridge/dist/Connector")
  if (built) {
    cpSync(priorConnector, resolve(out, "connector"), { recursive: true })
    console.log("  ✓ connector bundled → dist/volt/connector")
  } else if (existsSync(resolve(priorConnector, "VoltConnector.exe"))) {
    // The connector is channel-neutral (C# bridge — no version/channel embedded), so a prior bundle is safe to
    // reuse when the build is skipped/fails (e.g. dotnet not resolvable). Beats a missing-connector installer.
    cpSync(priorConnector, resolve(out, "connector"), { recursive: true })
    console.warn("⚠ connector build skipped/failed — reused the prior bundle (channel-neutral; CI rebuilds fresh)")
  } else {
    console.warn("⚠ bridge/connector build skipped or failed (dotnet missing? non-Windows?) — TS binaries only")
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
