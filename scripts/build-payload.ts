#!/usr/bin/env bun
/**
 * Volt release builder — compiles every shippable binary into dist/volt/, laid out EXACTLY as the install tree
 * ({app}, openspec installer-rebuild design 2), so the installer copies it 1:1. The volt-desktop shell + the Inno
 * Setup installer are built separately (scripts/build-installer.ts → installer/Volt.iss), which bundles this folder.
 *
 *   bun scripts/build-payload.ts           # LSP + the C# toolchain (needs dotnet, Windows)
 *   bun scripts/build-payload.ts --no-cli  # skip the C# toolchain (non-Windows / no .NET SDK) — LSP only
 *
 * Output:
 *   dist/volt/bin/        volt.exe (the PLC CLI, single-file) + volt-lsp-iec.exe — exactly these two files, the PATH dir —
 *                         + git/, the CLI's own MinGit (a folder: not on PATH; the full CLI only, never a bridge bundle)
 *   dist/volt/connector/  VoltConnector.exe + the x64 VoltBridgeTwincat.exe on one runtime, and x86/VoltBridgeTwincat.exe
 *                         (the x86 worker, single-file) — the worker of each XAE bitness
 *   dist/volt/codesys/    Volt.Ide.Codesys.dll + start/stop_volt_codesys.py
 *
 * No .vsix: the extension ships from the Marketplace (openspec vscode-extension-marketplace), not the installer.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { check as checkTargets } from "./binary-targets.js"

const repo = resolve(import.meta.dirname, "..")
const out = resolve(repo, "dist/volt")
const bin = resolve(out, "bin")
const ext = process.platform === "win32" ? ".exe" : ""
const skipCli = process.argv.includes("--no-cli")

function run(cmd: string, args: string[], cwd = repo): boolean {
  // `env` is passed EXPLICITLY. Bun snapshots process.env for child spawns, so a mutation made after startup
  // (VOLT_VERSION, set below) never reached build-cli.ps1 and every .NET binary shipped stamped 1.0.0.0 while
  // the installer around it said 0.1.x. Handing the current env in is what makes the mutation take.
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: process.env })
  return r.status === 0
}

// The build version, resolved ONCE and self-sufficiently.
//
// This read `process.env.VOLT_VERSION ?? "(dev)"` and trusted its caller to have set it. CI does; a local
// `bun run build:installer` did not, so the installer was stamped 0.1.x while every binary inside it reported
// "(dev)"/1.0.0.0 — and `bun run test:install` then failed ten checks that had nothing to do with the change
// under test. Relying on an inherited env var also failed when the parent set it on `process.env`, because that
// mutation does not reliably reach a GRANDCHILD (build-cli.ps1, two spawns down).
//
// So resolve it here from the same single source every other script uses (version.ts), and WRITE IT BACK to the
// environment for the children. Whoever runs this script, local or CI, gets the same answer.
const VOLT_VERSION =
  process.env.VOLT_VERSION ||
  (spawnSync("bun", [resolve(repo, "scripts/version.ts")], { cwd: repo, encoding: "utf8", shell: process.platform === "win32" }).stdout ?? "")
    .split("\n")
    .find((l) => l.startsWith("version="))
    ?.slice("version=".length)
    .trim() ||
  "(dev)"
process.env.VOLT_VERSION = VOLT_VERSION
console.log(`• version ${VOLT_VERSION}`)

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
  //
  // BASELINE on Windows: bun's default x64 target needs AVX2, so the LSP crashed at start on the Atom/Celeron CPUs of
  // industrial panel PCs — a PLC engineer's machine more often than a developer's. The baseline build runs on any x64.
  const version = VOLT_VERSION
  const target = process.platform === "win32" ? ["--target=bun-windows-x64-baseline"] : []
  if (!run("bun", ["build", "--compile", ...target, `--define`, `__VOLT_VERSION__='${version}'`, "--outfile", resolve(bin, name + ext), entry])) {
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
compile("packages/volt-lsp-iec/src/server/bin.ts", "volt-lsp-iec")

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
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  setLspServer(resolve(bin, "volt-lsp-iec" + ext))
  const fx = mkdtempSync(join(tmpdir(), "volt-lsp-smoke-"))
  // A BOUND workspace, as `volt init --vendor codesys` leaves it: the server takes its vendor from the binding and
  // refuses an unbound folder (volt-lsp-iec `server/vendor.ts`, lsp-same-standard) — the desktop only ever opens bound ones.
  mkdirSync(join(fx, ".git", "volt"), { recursive: true })
  writeFileSync(join(fx, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor: "codesys" } }))
  // `i := b` assigns a BOOL to an INT — a type error the eager crawl must find without opening the file.
  writeFileSync(join(fx, "F.pou"), "FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK")
  try {
    const r = await collectDiagnostics(fx, { timeoutMs: 30_000 })
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

// No docs corpus and no agent config ship in the payload: the reference reaches an agent through the LSP on PATH,
// and hosts register Volt themselves (CLAUDE.md, "Agent hosts").

if (!skipCli) {
  console.log("• volt CLI + pipe workers + connector (C#)")
  // build-cli.ps1 runs the Volt.Cli tests and publishes the three installed folders into packages/volt-cli/dist
  // (Cli/volt.exe, Connector/, Codesys/). A failed build FAILS this one: there used to be a branch that "reused the
  // prior bundle" when the build failed — so a red C# build shipped whatever an earlier one left behind, stamped
  // with an older version, and nothing downstream said so. A machine without the .NET SDK passes --no-cli.
  if (process.platform !== "win32") {
    console.error("✗ the C# toolchain builds on Windows only — pass --no-cli for an LSP-only payload")
    process.exit(1)
  }
  // Windows PowerShell 5.1 started from PowerShell 7 (the release workflow's shell) inherits 7's PSModulePath and then
  // cannot load its own Microsoft.PowerShell.Utility — `Get-FileHash` "not recognized" (release run 38580981280).
  // Without the variable, 5.1 computes its own default.
  delete process.env.PSModulePath
  if (!run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "packages/volt-cli/scripts/build-cli.ps1"])) {
    console.error("✗ build-cli.ps1 failed — no payload is assembled from an earlier build's leftovers")
    process.exit(1)
  }
  const cliDist = resolve(repo, "packages/volt-cli/dist")
  cpSync(resolve(cliDist, "Cli", "volt.exe"), resolve(bin, "volt.exe"))
  // The CLI's own git (MinGit, packages/volt-cli/src/Volt.Cli/MinGit.targets): volt.exe runs bin/git/cmd/git.exe by path.
  cpSync(resolve(cliDist, "Cli", "git"), resolve(bin, "git"), { recursive: true })
  cpSync(resolve(cliDist, "Connector"), resolve(out, "connector"), { recursive: true })
  cpSync(resolve(cliDist, "Codesys"), resolve(out, "codesys"), { recursive: true })
  console.log("  ✓ volt.exe + git/ → dist/volt/bin, connector → dist/volt/connector, codesys → dist/volt/codesys")
}

// Self-check: the payload is the install tree, so it is checked as one — by name, every required file. bin\ is
// the PATH dir and holds exactly the CLI and the LSP (the gate asserts the same of {app}\bin).
const required = skipCli
  ? ["bin/volt-lsp-iec" + ext]
  : [
      "bin/volt.exe",
      "bin/volt-lsp-iec.exe",
      "bin/git/cmd/git.exe",
      "bin/git/LICENSE.txt",
      "bin/git/VOLT-SOURCE.txt",
      "connector/VoltConnector.exe",
      "connector/VoltBridgeTwincat.exe",
      "connector/x86/VoltBridgeTwincat.exe",
      "connector/Volt.Engine.Host.dll",
      "codesys/Volt.Ide.Codesys.dll",
      "codesys/start_volt_codesys.py",
      "codesys/stop_volt_codesys.py",
    ]
const absent = required.filter((f) => !existsSync(resolve(out, f)))
if (absent.length > 0) {
  console.error(`✗ missing expected artifact(s) in dist/volt: ${absent.join(", ")}`)
  process.exit(1)
}
const binFiles = readdirSync(bin).sort()
const binWanted = (skipCli ? ["volt-lsp-iec" + ext] : ["git", "volt-lsp-iec.exe", "volt.exe"]).sort()
if (binFiles.join("|") !== binWanted.join("|")) {
  console.error(`✗ dist/volt/bin holds [${binFiles.join(", ")}], not exactly [${binWanted.join(", ")}] — it is the PATH dir`)
  process.exit(1)
}
// git ships with the full CLI ONLY: connector/ and codesys/ are also the bridge bundles PLCAssist distributes, and a
// bridge never runs git (owner, openspec environment-dependency-audit 2.1). build-cli.ps1 refuses the same.
const bridgeGit = ["connector", "codesys"].flatMap((d) =>
  existsSync(resolve(out, d))
    ? readdirSync(resolve(out, d), { recursive: true, encoding: "utf8" })
        .filter((f) => /(^|[\\/])git(\.exe)?$/i.test(f))
        .map((f) => `${d}/${f}`)
    : [],
)
if (bridgeGit.length > 0) {
  console.error(`✗ a bridge bundle carries git: ${bridgeGit.join(", ")} — git ships with the full CLI only (bin/git)`)
  process.exit(1)
}

// …and every binary in it is built for the CPU its place allows (binary-targets.ts: the in-proc CODESYS DLL AnyCPU, the
// TwinCAT workers x86 and x64, everything else x64/AnyCPU). The PE header is what Windows loads by, so it is read, not the csproj.
const targets = checkTargets(out)
if (targets.wrong.length > 0) {
  console.error(`✗ ${targets.wrong.length} binaries in dist/volt are built for a CPU their place does not allow:\n  ${targets.wrong.join("\n  ")}`)
  process.exit(1)
}
console.log(`  ✓ ${targets.read} binaries, each built for the CPU its place allows`)

console.log(`\n✓ release binaries in ${out}`)
