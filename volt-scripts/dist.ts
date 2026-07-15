#!/usr/bin/env bun
/**
 * Volt release builder — compiles every shippable binary + the volt-config layer into dist/volt/ so the
 * installer just bundles one folder. The volt-desktop shell + NSIS installer are built separately
 * (packages/volt-desktop), which bundles this folder.
 *
 *   bun volt-scripts/dist.ts            # binaries + bridges
 *   bun volt-scripts/dist.ts --no-bridge  # binaries only (skip dotnet)
 *
 * Output:
 *   dist/volt/bin/volt[.exe]              the PLC CLI (`volt <verb>` syncs; the agent is stock opencode)
 *   dist/volt/bin/volt-lsp-iec[.exe]  the Structured Text LSP (no node needed)
 *   dist/volt/bridge/                     the C# IDE connectors (best-effort; needs dotnet)
 */
import { Glob } from "bun"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve, sep } from "node:path"

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

console.log("• volt binary (PLC CLI — no opencode; the agent is stock opencode)")
compile("packages/volt-git/src/bin.ts", "volt")

console.log("• volt-lsp-iec")
compile("packages/volt-lsp-iec/src/bin.ts", "volt-lsp-iec")

// Ship the language-reference corpus beside the binaries. `bun --compile` only embeds imported JS, not this
// fs-read docs tree, so `volt init`'s installCorpus reads it from `resources/volt/docs` (init.ts resolves
// `dirname(process.execPath)/../docs` when the package layout isn't present). Without this, `volt init` warns
// "Source corpus not found at B:\~BUN\docs\codesys-reference" and skips the ST language-reference skill.
cpSync(resolve(repo, "packages/volt-lsp-iec/docs"), resolve(out, "docs"), { recursive: true })
console.log("  ✓ docs corpus → dist/volt/docs")

// The .vsix build + the volt-config tool bundle below use `bun build --target=node`, which resolves workspace
// packages via the "default" export condition → dist/ (not the "bun" → src condition that --compile above uses).
// So @volt/lsp-iec must have its dist built or those bundles can't resolve it. Build it here — this runs AFTER a
// full `bun install`, so there's no prepare-during-install race (which is why the prepare scripts were removed).
console.log("• build @volt/lsp-iec dist (for --target=node resolution)")
if (!run("bun", ["run", "--filter=@volt/lsp-iec", "build"])) {
  console.error("✗ failed to build @volt/lsp-iec dist")
  process.exit(1)
}

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
const cfgSrc = resolve(repo, "volt-config")
// The `volt` tool imports @opencode-ai/plugin. volt-config is NOT a workspace member, so root `bun install` never
// installs its deps — ensure they're present (idempotent) before bundling, or a clean CI runner can't resolve it.
if (!existsSync(resolve(cfgSrc, "node_modules/@opencode-ai/plugin"))) {
  console.log("  installing volt-config deps (@opencode-ai/plugin)…")
  if (!run("bun", ["install"], cfgSrc)) {
    console.error("✗ failed to install volt-config deps")
    process.exit(1)
  }
}
const cfgOut = resolve(out, "volt-config")
// Copy everything EXCEPT node_modules — the tool is bundled self-contained below, so the shipped dir needs none.
cpSync(cfgSrc, cfgOut, { recursive: true, filter: (src) => !src.includes(`${sep}node_modules`) })
// Bundle the `volt` tool to a self-contained .js (its @opencode-ai/plugin import + zod inlined — the rest of the
// plugin is type-only) and drop the .ts source. Bundle from the SOURCE tool/volt.ts so the import resolves via
// volt-config/node_modules. The shipped dir then needs NO node_modules: opencode scans {tool,tools}/*.{js,ts}
// and loads the bundle directly.
if (!run("bun", ["build", "--target=node", "--outfile", resolve(cfgOut, "tool/volt.js"), resolve(cfgSrc, "tool/volt.ts")])) {
  console.error("✗ failed to bundle the volt tool into volt-config")
  process.exit(1)
}
rmSync(resolve(cfgOut, "tool/volt.ts"), { force: true })
console.log("  ✓ volt-config → dist/volt/volt-config (volt tool bundled self-contained)")

if (!skipBridge) {
  console.log("• bridges + connector (C#)")
  // build-bridges.ps1 runs the Core tests, publishes the bridges, and assembles the connector bundle
  // (VoltConnector.exe + workers) into packages/volt-bridge/dist/Connector. Best-effort: a machine without
  // the .NET SDK still ships the TS binaries (the bridge is the IDE side; pass --no-bridge to silence).
  const built =
    process.platform === "win32" &&
    run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "packages/volt-bridge/scripts/build-bridges.ps1"])
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

console.log(`\n✓ release binaries in ${out}`)
