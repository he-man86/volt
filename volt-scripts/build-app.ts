#!/usr/bin/env bun
/**
 * Volt one-installer builder (Windows). Produces a single Velopack installer for ALL Volt apps — desktop GUI +
 * `volt` CLI + LSP + tray connector + config — whose always-running C# connector drives auto-update. The VS
 * Code extension is NOT included (Marketplace). See openspec/changes/distribution/design.md.
 *
 *   bun volt-scripts/build-app.ts                 # full build → dist/release/Volt-win-Setup.exe
 *   bun volt-scripts/build-app.ts --skip-dist     # reuse the current dist/volt payload (dev iteration)
 *   bun volt-scripts/build-app.ts --upload        # also `vpk upload github` → he-man86/volt (the update feed)
 *
 * Pipeline: dist.ts (CLI+LSP+connector+config) → electron-builder --dir (the branded Electron app) → assemble
 * the Velopack packDir (connector at root = mainExe; bin/ volt-config/ docs/ desktop/ as siblings) → vpk pack.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
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

function run(cmd: string, args: string[], cwd = repo, shell = true): void {
  if (spawnSync(cmd, args, { cwd, stdio: "inherit", shell: shell && process.platform === "win32" }).status !== 0) {
    // Redact secret values (e.g. the vpk `--token <PAT>`) so a failure never echoes them into CI logs.
    const safe = args.map((a, i) => (args[i - 1] === "--token" ? "***" : a))
    console.error(`✗ failed: ${cmd} ${safe.join(" ")}`)
    process.exit(1)
  }
}

// vpk (Velopack CLI, a global dotnet tool) — the default tools dir wins, else assume it's on PATH.
const vpk = [`${process.env.USERPROFILE}\\.dotnet\\tools\\vpk.exe`, "vpk"].find((p) => existsSync(p) || p === "vpk")!

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

// 3. Assemble the Velopack packDir: connector (mainExe) at root; bin/ volt-config/ docs/ desktop/ as siblings.
console.log("• assembling the Velopack packDir")
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(resolve(payload, "connector"), stage, { recursive: true }) // → root (VoltConnector.exe + files)
cpSync(resolve(payload, "bin"), resolve(stage, "bin"), { recursive: true })
cpSync(resolve(payload, "volt-config"), resolve(stage, "volt-config"), { recursive: true })
cpSync(resolve(payload, "docs"), resolve(stage, "docs"), { recursive: true })
cpSync(unpacked, resolve(stage, "desktop"), { recursive: true })
if (!existsSync(resolve(stage, "VoltConnector.exe"))) {
  console.error("✗ VoltConnector.exe not at packDir root — the connector bundle is missing it")
  process.exit(1)
}

// 4. Pack the one installer. mainExe = the connector (its VelopackApp hooks own env + the update loop).
// --shortcuts None: the connector auto-starts via its login item; its install hook makes the GUI shortcut.
console.log(`• vpk pack → Volt ${version}`)
// Clear release so only THIS version's assets remain — else vpk computes deltas from (and an --upload pushes)
// stale prior-version nupkgs left in the dir. ponytail: full-only updates; cross-version deltas would need a
// maintained base-nupkg dir — add that if update bandwidth matters.
rmSync(release, { recursive: true, force: true })
mkdirSync(release, { recursive: true })
run(vpk, ["pack",
  "--packId", "Volt", "--packVersion", version, "--packTitle", "Volt",
  "--packDir", stage, "--mainExe", "VoltConnector.exe",
  "--icon", icon, "--shortcuts", "None", "--outputDir", release,
], repo, false)

if (upload) {
  console.log("• vpk upload github → he-man86/volt")
  // Pass the token explicitly when present (CI: GH_TOKEN/GITHUB_TOKEN) so the upload doesn't depend on an ambient
  // `gh` login. Local runs without the env var fall back to vpk's own credential resolution (unchanged).
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  run(vpk, ["upload", "github", "--repoUrl", "https://github.com/he-man86/volt", "--publish", "true",
    "--outputDir", release, ...(ghToken ? ["--token", ghToken] : [])], repo, false)
}

console.log(`\n✓ ${resolve(release, "Volt-win-Setup.exe")}`)
