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
 *   dist/volt/bin/volt-lsp-iec[.exe]  the Structured Text LSP (no node needed)
 *   dist/volt/bridge/                     the C# IDE connectors (best-effort; needs dotnet)
 */
import { Glob } from "bun"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
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

console.log("• volt-lsp-iec")
compile("packages/volt-lsp-iec/src/bin.ts", "volt-lsp-iec")

// Ship the language-reference corpus beside the binaries. `bun --compile` only embeds imported JS, not this
// fs-read docs tree, so `volt init`'s installCorpus reads it from `resources/volt/docs` (init.ts resolves
// `dirname(process.execPath)/../docs` when the package layout isn't present). Without this, `volt init` warns
// "Source corpus not found at B:\~BUN\docs\codesys-reference" and skips the ST language-reference skill.
cpSync(resolve(repo, "packages/volt-lsp-iec/docs"), resolve(out, "docs"), { recursive: true })
console.log("  ✓ docs corpus → dist/volt/docs")

// PATH helper bundled with the binaries — the installer's NSIS (connector.nsh) uses it to add/remove `volt`
// on PATH, so the install also gives you the terminal CLI + makes the VS Code extension work.
cpSync(resolve(import.meta.dirname, "volt-path.ps1"), resolve(bin, "volt-path.ps1"))

// Extension-install helper — the installer's NSIS uses it to sideload the .vsix into the user's editors.
cpSync(resolve(import.meta.dirname, "volt-extension.ps1"), resolve(bin, "volt-extension.ps1"))

// Build the VS Code extension (.vsix) so the installer can sideload it into VS Code / Windsurf / Cursor.
console.log("• volt-vscode extension (.vsix)")
const vsixDir = resolve(repo, "packages/volt-vscode")
if (run("bun", ["run", "package"], vsixDir)) {
  const vsix = [...new Glob("volt-vscode-*.vsix").scanSync({ cwd: vsixDir })].sort().at(-1)
  if (vsix) {
    cpSync(resolve(vsixDir, vsix), resolve(out, "volt-vscode.vsix"))
    console.log(`  ✓ extension → dist/volt/volt-vscode.vsix (${vsix})`)
  } else {
    console.warn("  ⚠ .vsix not found after package")
  }
} else {
  console.warn("  ⚠ extension package failed — installer ships without the bundled extension")
}

// Volt config dir — the whole agent-facing layer (LSP, `volt` tool, agent, theme, permissions) shipped ONCE
// and handed to opencode via OPENCODE_CONFIG_DIR (set on the desktop sidecar + the CLI launcher). Static —
// the LSP/tool resolve off PATH (bare names), so nothing machine-specific is baked. The only thing vendored
// is @opencode-ai/plugin (the tool's import), so the tool loads with no npm/registry at runtime.
console.log("• volt-config (agent toolchain via OPENCODE_CONFIG_DIR)")
const cfgOut = resolve(out, "volt-config")
cpSync(resolve(repo, "packages/volt-git/volt-config"), cfgOut, { recursive: true })
// Bundle the `volt` tool to a self-contained .js (its @opencode-ai/plugin import + zod inlined — the rest of
// the plugin is type-only) and drop the .ts source. The shipped dir then needs NO node_modules: opencode
// scans {tool,tools}/*.{js,ts} and loads the bundle directly. (electron-builder's extraResources copy strips
// a node_modules subtree, so vendoring into one is moot — bundling sidesteps it entirely.)
const toolTs = resolve(cfgOut, "tool/volt.ts")
if (!run("bun", ["build", "--target=node", "--outfile", resolve(cfgOut, "tool/volt.js"), toolTs])) {
  console.error("✗ failed to bundle the volt tool into volt-config")
  process.exit(1)
}
rmSync(toolTs, { force: true })
console.log("  ✓ volt-config → dist/volt/volt-config (volt tool bundled self-contained)")

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
for (const name of ["volt", "volt-lsp-iec"]) {
  if (!existsSync(resolve(bin, name + ext))) {
    console.error(`✗ missing expected artifact: ${name}${ext}`)
    process.exit(1)
  }
}

// Guard: the compiled `volt` must still register the TUI <spinner>. build.ts's minify+splitting can tree-shake
// the bare side-effect import (opentui-spinner) → chat crashes with "[Reconciler] Unknown component type:
// spinner". volt.ts value-references registerSpinner() to keep it; verify it survived the bundle.
if (!readFileSync(resolve(bin, "volt" + ext), "latin1").includes("registerSpinner")) {
  console.error("✗ TUI spinner registration tree-shaken out of the volt binary — chat would crash.")
  console.error("  Fix: packages/volt-git/src/volt.ts must value-reference registerSpinner().")
  process.exit(1)
}

console.log(`\n✓ release binaries in ${out}`)
