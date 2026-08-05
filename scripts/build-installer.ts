#!/usr/bin/env bun
/**
 * Volt one-installer builder (Windows). Produces a single Inno Setup wizard for ALL Volt apps — desktop GUI +
 * `volt` CLI + LSP + tray connector, plus the opt-in VS Code-family extension — whose always-running C#
 * connector drives auto-update (Updater.cs re-runs a newer Setup.exe). See installer/Volt.iss.
 *
 *   bun scripts/build-installer.ts                 # full build → dist/release/Volt-win-Setup.exe
 *   bun scripts/build-installer.ts --skip-dist     # reuse the current dist/volt payload (dev iteration)
 *   bun scripts/build-installer.ts --upload        # also publish the GitHub release (the update feed) via gh
 *
 * Pipeline: build-payload.ts (CLI+LSP+connector+.vsix) → electron-builder --dir (the branded Electron app) →
 * assemble the payload (connector at root; bin/ docs/ desktop/ + .vsix as siblings)
 * → ISCC compiles installer/Volt.iss over it → Volt-win-Setup.exe.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
// The release version. CI passes it in VOLT_VERSION (computed once by version.ts). For a LOCAL build we compute the
// SAME way — run version.ts and take its `version=` line — so a local install is the git-derived 3-part
// <maj>.<min>.<count> (e.g. 0.1.15940), NOT a bare 0.1.0. That matters: the connector's updater compares with
// System.Version, and a low bare base reads as OLDER than the dev channel's <maj>.<min>.<count>, so a fresh local
// install would falsely show "update available" on the dev channel. Never recompute here — version.ts is the source.
const version =
  process.env.VOLT_VERSION ||
  (spawnSync("bun", [resolve(repo, "scripts/version.ts")], { cwd: repo, encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .find((l) => l.startsWith("version="))
    ?.slice("version=".length)
    .trim() ||
  (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version
const payload = resolve(repo, "dist/volt")
const stage = resolve(repo, "dist/stage")
const release = resolve(repo, "dist/release")
const desktopDir = resolve(repo, "packages/volt-desktop")
const icon = resolve(desktopDir, "assets/volt-icon.ico")
const skipDist = process.argv.includes("--skip-dist")
const upload = process.argv.includes("--upload")
// --upload-only: skip the whole build, just publish the already-built dist/release installer.
const uploadOnly = process.argv.includes("--upload-only")
// This publish is ALWAYS a PRERELEASE (the dev channel) — the connector's stable updater ignores prereleases, only
// `VOLT_UPDATE_CHANNEL=dev` picks them up. There is no path to publish stable here: a RELEASE promotes an existing
// dev build via promote.yml (which gates it, then flips prerelease -> latest), so stable is ALWAYS a gated flip,
// never a fresh direct publish. (release.yml still passes `--prerelease`; it's now a documented no-op.)

function run(cmd: string, args: string[], cwd = repo, shell = true): void {
  if (spawnSync(cmd, args, { cwd, stdio: "inherit", shell: shell && process.platform === "win32" }).status !== 0) {
    // Redact secret values (e.g. a `--token <PAT>`) so a failure never echoes them into CI logs.
    const safe = args.map((a, i) => (args[i - 1] === "--token" ? "***" : a))
    console.error(`✗ failed: ${cmd} ${safe.join(" ")}`)
    process.exit(1)
  }
}

// Publish the build `version` (the 3-part build number) as a PRERELEASE, installer attached, creating the tag at the
// checked-out commit (--target). Always a prerelease — a release later PROMOTES this exact build (promote.yml flips
// it to --latest); this never publishes stable. On a re-run the tag/release already exists → fall back to clobbering
// the asset. gh reads GH_TOKEN/GITHUB_TOKEN from env.
function publish(setupExe: string): void {
  const sha = process.env.GITHUB_SHA || spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout?.trim() || ""
  const kind = "--prerelease"
  console.log(`• gh release (prerelease) → he-man86/volt ${version}`)
  // No --title (its space would need quoting under shell:true; gh defaults the title to the tag).
  const created = spawnSync(
    "gh",
    ["release", "create", version, setupExe, "--repo", "he-man86/volt", "--generate-notes", kind, ...(sha ? ["--target", sha] : [])],
    { cwd: repo, stdio: "inherit", shell: true },
  )
  if (created.status !== 0) {
    run("gh", ["release", "upload", version, setupExe, "--repo", "he-man86/volt", "--clobber"])
    run("gh", ["release", "edit", version, "--repo", "he-man86/volt", kind])
  }
}

if (uploadOnly) {
  const setupExe = resolve(release, "Volt-win-Setup.exe")
  if (!existsSync(setupExe)) {
    console.error(`✗ ${setupExe} not found — run the build (bun scripts/build-installer.ts) first`)
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

// 0. The .iss must not contain control characters. Editing it programmatically has silently injected BEL/BS/VT
// four times (a Python "\bin" becoming a backspace turned {app}\current\bin into "currentin", which shipped a
// PATH entry pointing nowhere). Inno compiles such a file happily — the corruption only shows up as a path that
// silently does not exist, which is the hardest kind of bug to trace back here.
{
  const iss = readFileSync(resolve(repo, "installer/Volt.iss"), "utf8")
  const bad = [...iss].filter((c) => c.charCodeAt(0) < 32 && c.charCodeAt(0) !== 10 && c.charCodeAt(0) !== 13 && c.charCodeAt(0) !== 9)
  if (bad.length > 0) {
    const codes = [...new Set(bad.map((c) => "0x" + c.charCodeAt(0).toString(16)))].join(", ")
    console.error(`✗ installer/Volt.iss contains ${bad.length} control character(s) (${codes}) — almost certainly a mangled backslash escape from a scripted edit. Fix before building.`)
    process.exit(1)
  }
  // The load-bearing log markers are a CONTRACT: the lifecycle gate asserts them and installer/README.md documents
  // them for support. If someone removes a Log() line while refactoring, the gate would fail on a machine — catch
  // it here at build time instead. This list must match assertLog()'s in test-install.ts.
  const requiredMarkers = [
    "volt: install ",
    "junction active ->",
    "env published ->",
    "started the connector:",
    "reverting environment",
    "removed the junction and every version directory",
  ]
  const absent = requiredMarkers.filter((m) => !iss.includes(m))
  if (absent.length > 0) {
    console.error(`✗ installer/Volt.iss is missing required log marker(s): ${absent.map((m) => `"${m}"`).join(", ")} — these are the support/gate contract. Restore them before building.`)
    process.exit(1)
  }
}

// 1. The Volt payload (CLI + LSP + connector + docs).
if (!skipDist) run("bun", ["scripts/build-payload.ts"])
for (const dir of ["bin", "connector", "docs"]) {
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
// Rebuild the Electron app only when an input actually changed — reuse otherwise, since electron-builder's
// winCodeSign extraction is flaky without Windows Developer Mode ("Cannot create symbolic link").
// --rebuild-app forces it.
//
// The cache key must cover EVERY input electron-builder packs (electron-builder.yml `files:`), not just
// main.mjs: package.json carries the version AND productName (which sets Electron's userData path), so keying
// on main.mjs alone silently shipped a stale package.json — a 0.1.0 app inside a 0.2.0 installer. If you add a
// file to electron-builder.yml `files:`, add it here. assets/ is excluded: icons only, and a stale icon is
// cosmetic — use --rebuild-app after changing one.
const packedApp = resolve(unpacked, "resources", "app")
const BYTE_INPUTS = ["main.mjs", "preload.cjs", "shell.html"]
// package.json needs a PROJECTION, not a byte compare: electron-builder rewrites it when packing, stripping
// `scripts` and `devDependencies`. Byte-comparing source vs packed can therefore never match, which would make
// this whole reuse branch unreachable — every build re-running the flaky winCodeSign step the branch exists to
// avoid. Sorted keys so a reordering by either side doesn't force a rebuild.
const BUILDER_STRIPS = ["scripts", "devDependencies"]
const pkgProjection = (file: string): string => {
  const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  for (const k of BUILDER_STRIPS) delete j[k]
  return JSON.stringify(Object.keys(j).sort().map((k) => [k, j[k]]))
}
const differs = (f: string): boolean => {
  const packed = resolve(packedApp, f)
  if (!existsSync(packed)) return true
  const src = resolve(desktopDir, f)
  return f === "package.json"
    ? pkgProjection(packed) !== pkgProjection(src)
    : !readFileSync(packed).equals(readFileSync(src))
}
const inputsChanged = [...BYTE_INPUTS, "package.json"].some(differs)
if (process.argv.includes("--rebuild-app") || !existsSync(voltExe) || inputsChanged) {
  run("bunx", ["electron-builder", "--dir"], desktopDir) // auto-finds electron-builder.yml
} else {
  console.log("  ✓ reusing win-unpacked (packed inputs unchanged)")
}
if (!existsSync(voltExe)) {
  console.error("✗ no Volt.exe in dist/win-unpacked (electron-builder failed — see the winCodeSign note above)")
  process.exit(1)
}

// 3. Assemble the installer payload (Inno's StageDir): connector at root; bin/ docs/ desktop/ as siblings.
console.log("• assembling the installer payload")
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(resolve(payload, "connector"), stage, { recursive: true }) // → root (VoltConnector.exe + files)
cpSync(resolve(payload, "bin"), resolve(stage, "bin"), { recursive: true })
cpSync(resolve(payload, "docs"), resolve(stage, "docs"), { recursive: true })
cpSync(unpacked, resolve(stage, "desktop"), { recursive: true })
// No version.txt is shipped: every binary carries its version stamped in (FileVersion for the .NET exes, a
// compile-time define for the bun-built LSP), so a sidecar file could only drift from the binary — which is the
// bug it caused. The .vsix is what the per-editor extension wizard tasks sideload via `<editor>
// --install-extension`. Hard-fail on a missing .vsix: the tasks would silently install nothing, and nothing
// downstream catches it — test:install runs /VERYSILENT, which skips those tasks entirely (Check: NotSilent).
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

// 4. Compile the one installer (Inno Setup). The connector self-configures its login item + shortcut and hosts
// auto-update at runtime, so the .iss just lays down the payload + the VS Code-family extension tasks.
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
