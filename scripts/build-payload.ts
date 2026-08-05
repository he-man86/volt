#!/usr/bin/env bun
/**
 * Volt release builder — compiles every shippable binary into dist/volt/ so the installer just bundles one
 * folder. The volt-desktop shell + the Inno Setup installer are built separately
 * (scripts/build-installer.ts → installer/Volt.iss), which bundles this folder.
 *
 *   bun scripts/build-payload.ts           # LSP + vsix + the C# toolchain (needs dotnet)
 *   bun scripts/build-payload.ts --no-cli  # skip the C# toolchain (non-Windows / no .NET SDK) — LSP only
 *
 * Output:
 *   dist/volt/bin/           volt[.exe] (the PLC CLI) + volt-lsp-iec[.exe] (the Structured Text LSP) + runtime
 *   dist/volt/connector/     VoltConnector.exe + the pipe workers + the CODESYS in-proc DLL (needs dotnet)
 *   dist/volt/docs/, volt-vscode.vsix
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const out = resolve(repo, "dist/volt")
const bin = resolve(out, "bin")
const ext = process.platform === "win32" ? ".exe" : ""
const skipCli = process.argv.includes("--no-cli")

function run(cmd: string, args: string[], cwd = repo): boolean {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
  return r.status === 0
}

function compile(entry: string, name: string): void {
  // Bake VOLT_VERSION into the binary — the JS parallel to build-cli.ps1 stamping FileVersion into the .NET exes.
  // A bun-compiled exe has no PE FileVersion to read, so this define is how the LSP knows its own version without a
  // version.txt beside it (which is gone — it reported what the install MEANT to be and could drift from the
  // binary). Unstamped local builds get "(dev)". Keep the constant name in sync with bin.ts.
  //
  // SINGLE quotes, deliberately. `run` uses shell:true on Windows, so the compile goes through cmd.exe, which
  // STRIPS double quotes from an arg — `__VOLT_VERSION__="1.2.3"` reached bun as an unquoted, invalid define and
  // silently fell back to "(dev)" (caught only because the build asserts the stamp). Single quotes pass through
  // cmd.exe untouched and are a valid JS string literal for esbuild's define. Verified through a shell:true spawn.
  const version = process.env.VOLT_VERSION ?? "(dev)"
  if (!run("bun", ["build", "--compile", `--define`, `__VOLT_VERSION__='${version}'`, "--outfile", resolve(bin, name + ext), entry])) {
    console.error(`✗ failed to compile ${name}`)
    process.exit(1)
  }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(bin, { recursive: true })

// The `volt` PLC CLI is the .NET binary (packages/volt-cli), built by build-cli.ps1 below alongside the pipe
// workers + connector — one dotnet toolchain, one transport (named pipes). build-cli.ps1 needs the .NET SDK +
// Windows, so on a box without it (or with --no-cli) there is no `volt` binary — the self-check below reflects
// that.
console.log("• volt-lsp-iec")
compile("packages/volt-lsp-iec/src/bin.ts", "volt-lsp-iec")

// VERIFY the stamp landed. The version is baked via a compile-time --define, which failed SILENTLY once (cmd.exe
// stripped the quotes) and fell back to "(dev)" — a shipped binary that could not report its own version, exactly
// the drift version.txt was removed to prevent. So when VOLT_VERSION is set, prove the compiled exe reports it.
if (process.env.VOLT_VERSION) {
  const out2 = spawnSync(resolve(bin, "volt-lsp-iec" + ext), ["--version"], { encoding: "utf8" }).stdout ?? ""
  if (!out2.includes(process.env.VOLT_VERSION)) {
    console.error(`✗ volt-lsp-iec did not bake in VOLT_VERSION (${process.env.VOLT_VERSION}); reported: ${out2.trim() || "nothing"}`)
    process.exit(1)
  }
  console.log(`  ✓ volt-lsp-iec stamped ${process.env.VOLT_VERSION}`)
}

// SMOKE the compiled server end-to-end — it's not enough that it prints --version. Spawn it exactly as the desktop
// does (collectDiagnostics) against a known-bad fixture and require it to ANSWER workspace/diagnostic. The
// installer/lifecycle gates only ran --version, so a launchable-but-wedged server — or a bun --compile asset
// regression — would ship green while the desktop just times out. This is the gate that catches that.
{
  const { collectDiagnostics, setLspServer } = await import("../packages/volt-control/src/index.js")
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  setLspServer(resolve(bin, "volt-lsp-iec" + ext))
  const fx = mkdtempSync(join(tmpdir(), "volt-lsp-smoke-"))
  // `i := b` assigns a BOOL to an INT — a type error the eager crawl must find without opening the file.
  writeFileSync(join(fx, "F.fb"), "FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK")
  try {
    const r = await collectDiagnostics(fx, "codesys", { timeoutMs: 30_000 })
    if (r.errors < 1) {
      console.error(`✗ volt-lsp-iec compiled but served NO diagnostics for a known-bad file — got ${JSON.stringify(r)}`)
      process.exit(1)
    }
    console.log(`  ✓ volt-lsp-iec serves diagnostics (${r.errors} error(s) on the smoke fixture)`)
  } catch (e) {
    console.error(`✗ volt-lsp-iec failed to serve diagnostics: ${(e as Error).message}`)
    process.exit(1)
  } finally {
    rmSync(fx, { recursive: true, force: true })
  }
}

// Ship the language-reference corpus beside the binaries. `bun --compile` only embeds imported JS, not this
// fs-read docs tree, so `volt init`'s installCorpus reads it from `resources/volt/docs` (init.ts resolves
// `dirname(process.execPath)/../docs` when the package layout isn't present). Without this, `volt init` warns
// "Source corpus not found at B:\~BUN\docs\codesys-reference" and skips the ST language-reference skill.
cpSync(resolve(repo, "packages/volt-lsp-iec/docs"), resolve(out, "docs"), { recursive: true })
console.log("  ✓ docs corpus → dist/volt/docs")

// Build the VS Code extension (.vsix) so the installer can sideload it into VS Code / Windsurf / Cursor.
console.log("• volt-vscode extension (.vsix)")
const vsixDir = resolve(repo, "packages/volt-vscode")
if (run("bun", ["run", "package"], vsixDir)) {
  // vsce names the package from the version `bun run package` passes it — the git-derived one from version.ts,
  // NOT volt-vscode's stored package.json version (which stays at the base 0.0.1 locally, since `package` passes
  // --no-update-package-json). Ask the same script for the same answer. Do NOT glob+sort: this dir is never
  // cleaned (old .vsix files accumulate, gitignored) and a sort is LEXICAL — at 0.10.0, "volt-vscode-0.10.0.vsix"
  // sorts BEFORE "volt-vscode-0.2.0.vsix", which would silently ship a stale extension.
  const vsixVersion = spawnSync("bun", [resolve(repo, "scripts/version.ts"), "--vsix"], { cwd: repo, encoding: "utf8", shell: process.platform === "win32" }).stdout?.trim()
  const vsix = `volt-vscode-${vsixVersion}.vsix`
  if (existsSync(resolve(vsixDir, vsix))) {
    cpSync(resolve(vsixDir, vsix), resolve(out, "volt-vscode.vsix"))
    console.log(`  ✓ extension → dist/volt/volt-vscode.vsix (${vsix})`)
  } else {
    console.warn(`  ⚠ ${vsix} not found after package`)
  }
} else {
  console.warn("  ⚠ extension package failed — installer ships without the bundled extension")
}

// NOTE: no agent-config layer ships here. Volt used to bundle an `opencode-config/` directory and publish it via
// OPENCODE_CONFIG_DIR — one product's config format, installed into that product's environment. That coupling is
// gone. Every host now registers Volt through its own native mechanism (the `volt-vscode` extension for the VS
// Code family, a plugin for Claude Code), and the installer's whole contribution is putting `bin` on PATH.

if (!skipCli) {
  console.log("• volt CLI + pipe workers + connector (C#)")
  // build-cli.ps1 runs the Volt.Cli tests, publishes volt.exe + the two pipe IDE hosts, and assembles the
  // connector bundle (VoltConnector.exe + workers) into packages/volt-cli/dist. Best-effort: a machine without
  // the .NET SDK ships the LSP only (pass --no-cli to silence). volt.exe lives in the connector-style Cli
  // bundle, so it's copied into bin/ here.
  const built =
    process.platform === "win32" &&
    run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "packages/volt-cli/scripts/build-cli.ps1"])
  const cliDist = resolve(repo, "packages/volt-cli/dist")
  const priorConnector = resolve(cliDist, "Connector")
  const priorCli = resolve(cliDist, "Cli")
  if (built || existsSync(resolve(priorConnector, "VoltConnector.exe"))) {
    if (!built)
      console.warn("⚠ CLI/connector build skipped/failed — reused the prior bundle (channel-neutral; CI rebuilds fresh)")
    cpSync(priorConnector, resolve(out, "connector"), { recursive: true })
    // The self-contained volt.exe bundle → dist/volt/bin so the installer's PATH resolves `volt`.
    cpSync(priorCli, bin, { recursive: true })
    console.log("  ✓ volt.exe → dist/volt/bin, connector → dist/volt/connector")
  } else {
    console.warn("⚠ CLI/connector build skipped or failed (dotnet missing? non-Windows?) — LSP only")
  }
}

// Self-check: the shipped binaries are the non-negotiable release artifacts. `volt` needs the .NET build (skipped
// on non-Windows / --no-cli); the LSP always ships.
const required = skipCli ? ["volt-lsp-iec"] : ["volt", "volt-lsp-iec"]
for (const name of required) {
  if (!existsSync(resolve(bin, name + ext))) {
    console.error(`✗ missing expected artifact: ${name}${ext}`)
    process.exit(1)
  }
}

console.log(`\n✓ release binaries in ${out}`)
