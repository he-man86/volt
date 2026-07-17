#!/usr/bin/env bun
/**
 * Volt one-installer builder (Windows). Produces a single Inno Setup wizard for ALL Volt apps — desktop GUI +
 * `volt` CLI + LSP + tray connector + config, plus opt-in opencode CLI + the VS Code extension — whose
 * always-running C# connector drives auto-update (Updater.cs re-runs a newer Setup.exe). See installer/Volt.iss.
 *
 *   bun volt-scripts/build-app.ts                 # full build → dist/release/Volt-win-Setup.exe
 *   bun volt-scripts/build-app.ts --skip-dist     # reuse the current dist/volt payload (dev iteration)
 *   bun volt-scripts/build-app.ts --upload        # also publish the GitHub release (the update feed) via gh
 *
 * Pipeline: dist.ts (CLI+LSP+connector+config+.vsix) → electron-builder --dir (the branded Electron app) →
 * assemble the payload (connector at root; bin/ volt-config/ docs/ desktop/ + version.txt + .vsix as siblings)
 * → ISCC compiles installer/Volt.iss over it → Volt-win-Setup.exe.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const version = (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version
const payload = resolve(repo, "dist/volt")
const stage = resolve(repo, "dist/stage")
const release = resolve(repo, "dist/release")
const desktopDir = resolve(repo, "packages/volt-desktop")
const icon = resolve(desktopDir, "assets/volt-icon.ico")
const skipDist = process.argv.includes("--skip-dist")
const upload = process.argv.includes("--upload")
// --upload-only: skip the whole build, just publish the already-built dist/release installer. Lets CI run the
// install/uninstall smoke test (bun run test:install) BETWEEN build and publish, gating the release on it.
const uploadOnly = process.argv.includes("--upload-only")

function run(cmd: string, args: string[], cwd = repo, shell = true): void {
  if (spawnSync(cmd, args, { cwd, stdio: "inherit", shell: shell && process.platform === "win32" }).status !== 0) {
    // Redact secret values (e.g. a `--token <PAT>`) so a failure never echoes them into CI logs.
    const safe = args.map((a, i) => (args[i - 1] === "--token" ? "***" : a))
    console.error(`✗ failed: ${cmd} ${safe.join(" ")}`)
    process.exit(1)
  }
}

// Create the release for this version (bare tag X.Y.Z) with the installer attached; if it already exists (re-cut
// tag / re-run), fall back to uploading + clobbering the asset. gh reads GH_TOKEN/GITHUB_TOKEN from env.
function publish(setupExe: string): void {
  // The tag MUST already exist on the REMOTE, else `gh release create` would mint it at HEAD (finding #7). Check
  // the remote, not the local ref — actions/checkout on a tag push doesn't populate refs/tags/<v> locally, which
  // is why `gh release create --verify-tag` failed in CI even though the tag was pushed.
  const onRemote = spawnSync("git", ["ls-remote", "--tags", "origin", version], { cwd: repo, encoding: "utf8" })
  if (!(onRemote.stdout ?? "").trim()) {
    console.error(`✗ tag ${version} is not on the remote — push it first (bun run release)`)
    process.exit(1)
  }
  console.log("• gh release → he-man86/volt")
  // No --title (its space would need quoting under shell:true; gh defaults the title to the tag).
  const created = spawnSync(
    "gh",
    ["release", "create", version, setupExe, "--repo", "he-man86/volt", "--generate-notes"],
    { cwd: repo, stdio: "inherit", shell: true },
  )
  if (created.status !== 0) run("gh", ["release", "upload", version, setupExe, "--repo", "he-man86/volt", "--clobber"])
}

if (uploadOnly) {
  const setupExe = resolve(release, "Volt-win-Setup.exe")
  if (!existsSync(setupExe)) {
    console.error(`✗ ${setupExe} not found — run the build (bun volt-scripts/build-app.ts) first`)
    process.exit(1)
  }
  publish(setupExe)
  console.log(`\n✓ uploaded ${setupExe}`)
  process.exit(0)
}

// ISCC (the Inno Setup 6 compiler) — machine-wide dirs, then the per-user winget location, else assume PATH.
const iscc = [
  `${process.env["ProgramFiles(x86)"]}\\Inno Setup 6\\ISCC.exe`,
  `${process.env.ProgramFiles}\\Inno Setup 6\\ISCC.exe`,
  `${process.env.LOCALAPPDATA}\\Programs\\Inno Setup 6\\ISCC.exe`,
  "ISCC",
].find((p) => existsSync(p) || p === "ISCC")!

// 1. The Volt payload (CLI + LSP + connector + config + docs).
if (!skipDist) run("bun", ["volt-scripts/dist.ts"])
for (const dir of ["bin", "connector", "volt-config", "docs"]) {
  if (!existsSync(resolve(payload, dir))) {
    console.error(`✗ dist/volt/${dir} missing — run without --skip-dist (the connector needs dotnet)`)
    process.exit(1)
  }
}

// 2. The branded Electron app (win-unpacked/) — --dir only, no installer.
console.log("• electron app (--dir)")
run("bun", ["run", "build"], desktopDir) // src/main.ts → main.mjs (fast)
const unpacked = resolve(desktopDir, "dist/win-unpacked")
const voltExe = resolve(unpacked, "Volt.exe")
// Rebuild the Electron app only when the shell actually changed — compare the freshly-built main.mjs to the
// copy already packed into win-unpacked (asar:false → resources/app/main.mjs). Reuse otherwise, since
// electron-builder's winCodeSign extraction is flaky without Windows Developer Mode ("Cannot create symbolic
// link"). --rebuild-app forces it.
const packedMain = resolve(unpacked, "resources", "app", "main.mjs")
const shellChanged =
  !existsSync(packedMain) || !readFileSync(packedMain).equals(readFileSync(resolve(desktopDir, "main.mjs")))
if (process.argv.includes("--rebuild-app") || !existsSync(voltExe) || shellChanged) {
  run("bunx", ["electron-builder", "--dir"], desktopDir) // auto-finds electron-builder.yml
} else {
  console.log("  ✓ reusing win-unpacked (shell unchanged)")
}
if (!existsSync(voltExe)) {
  console.error("✗ no Volt.exe in dist/win-unpacked (electron-builder failed — see the winCodeSign note above)")
  process.exit(1)
}

// 3. Assemble the installer payload (Inno's StageDir): connector at root; bin/ volt-config/ docs/ desktop/ as siblings.
console.log("• assembling the installer payload")
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(resolve(payload, "connector"), stage, { recursive: true }) // → root (VoltConnector.exe + files)
cpSync(resolve(payload, "bin"), resolve(stage, "bin"), { recursive: true })
cpSync(resolve(payload, "volt-config"), resolve(stage, "volt-config"), { recursive: true })
cpSync(resolve(payload, "docs"), resolve(stage, "docs"), { recursive: true })
cpSync(unpacked, resolve(stage, "desktop"), { recursive: true })
// The connector reads version.txt (auto-update: current version) beside itself; the .vsix is what the per-editor
// extension wizard tasks sideload via `<editor> --install-extension`. Hard-fail on a missing .vsix: the tasks
// would silently install nothing, and nothing downstream catches it — test:install runs /VERYSILENT, which skips
// those tasks entirely (Check: NotSilent in the .iss).
writeFileSync(resolve(stage, "version.txt"), version)
const vsix = resolve(payload, "volt-vscode.vsix")
if (!existsSync(vsix)) {
  console.error("✗ volt-vscode.vsix missing from dist/volt — the installer's extension tasks would install nothing")
  process.exit(1)
}
cpSync(vsix, resolve(stage, "volt-vscode.vsix"))
if (!existsSync(resolve(stage, "VoltConnector.exe"))) {
  console.error("✗ VoltConnector.exe not at payload root — the connector bundle is missing it")
  process.exit(1)
}

// 4. Compile the one installer (Inno Setup). The connector self-configures env + hosts auto-update at runtime,
// so the .iss just lays down the payload + optional-component tasks (opencode / VS Code extension).
console.log(`• ISCC → Volt ${version}`)
rmSync(release, { recursive: true, force: true })
mkdirSync(release, { recursive: true })
// shell:false — the ISCC path contains spaces ("Inno Setup 6"); a shell would split it on the space.
run(iscc, [
  `/DAppVersion=${version}`,
  `/DStageDir=${stage}`,
  `/DOutputDir=${release}`,
  `/DSetupIcon=${icon}`,
  resolve(repo, "installer/Volt.iss"),
], repo, false)

const setup = resolve(release, "Volt-win-Setup.exe")
if (upload) publish(setup)

console.log(`\n✓ ${setup}`)
