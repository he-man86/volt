#!/usr/bin/env bun
/**
 * Install → verify → uninstall → verify-clean smoke test for the Volt installer. Silent-installs
 * dist/release/Volt-win-Setup.exe (or a path arg), asserts the install laid down its CONTRACT (env + payload under
 * the `current` junction + shortcut + login item + Add/Remove entry + tray process, and the CLIs actually RUN),
 * then silent-uninstalls and asserts every one is GONE. Exits non-zero on any failure or leftover — so a dirty
 * uninstall blocks a release (release.yml runs this between build and publish).
 *
 * The install layout is NOT hardcoded here — it comes from ./install-layout.ts, the ONE source of truth both this
 * smoke gate and the deeper test-install-lifecycle.ts share, so the two can't drift (which is exactly what let this
 * gate rot against the old flat layout until the first stable cut ran it). What this gate adds over the lifecycle
 * one is BEHAVIOUR: it runs the installed CLIs (`--version`) rather than only checking files exist.
 *
 * Windows only; per-user install, reads HKCU. Best on a throwaway machine / CI runner — it really does install
 * and uninstall Volt. A /VERYSILENT install skips the opencode-winget step (Check: NotSilent in the .iss) but
 * NOT the extension sideload — that one is gated by WantExt, which on a silent run refreshes editors that already
 * have the extension. So a silent install DOES touch your editors, and this asserts it leaves them sane: an
 * installer change once uninstalled the extension from every editor and skipped the reinstall (the uninstall step
 * flipped the very predicate the install step was gated on), and nothing here noticed.
 *
 *   bun run test:install [path\to\Volt-win-Setup.exe]
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { installDir, currentDir, uninstaller, uninstallKey, runKey, appId, reg, pathHasEntry } from "./install-layout.js"

const EXE = ".exe" // Windows-only gate

if (process.platform !== "win32") {
  console.error("test:install is Windows-only (the installer + HKCU checks are Windows).")
  process.exit(1)
}

const repo = resolve(import.meta.dirname, "..")
const setup = resolve(process.argv[2] ?? resolve(repo, "dist/release/Volt-win-Setup.exe"))
if (!existsSync(setup)) {
  console.error(`✗ installer not found: ${setup}\n  build it first: bun volt-scripts/build-installer.ts`)
  process.exit(1)
}

// The payload resolves through the `current` junction (see install-layout.ts). Only Inno's own unins000.exe sits
// flat at {app}. The Start Menu shortcut is the one artefact this gate checks that the lifecycle gate does not.
const connector = join(currentDir, "VoltConnector" + EXE)
const binDir = join(currentDir, "bin")
const configDir = join(currentDir, "opencode-config")
const vsix = join(currentDir, "volt-vscode.vsix")
const shortcut = join(process.env.APPDATA!, "Microsoft", "Windows", "Start Menu", "Programs", "Volt.lnk")

// Does this binary actually RUN (exit 0)? A behavioural check — proves the installed exe resolves + executes, which
// existsSync alone never does (a truncated/rolled-back copy exists but can't run).
const runsOk = (exe: string, args: string[]): boolean => {
  try { return spawnSync(exe, args, { encoding: "utf8", timeout: 20_000 }).status === 0 } catch { return false }
}
const procRunning = (name: string): boolean =>
  (spawnSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { encoding: "utf8" }).stdout ?? "").toLowerCase().includes(name.toLowerCase())
const waitFor = async (pred: () => boolean, seconds: number): Promise<boolean> => {
  for (let i = 0; i < seconds && !pred(); i++) await Bun.sleep(1000)
  return pred()
}
// Two paths naming the same location (case-insensitive, separator/format-normalised).
const samePath = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

let failures = 0
// soft = best-effort feature (per the connector's own "best-effort" comments): report but don't gate the release.
// The load-bearing install checks + ALL cleanup checks stay hard — cleanliness is the guarantee.
const check = (label: string, ok: boolean, soft = false): void => {
  console.log(`  ${ok ? "✓" : soft ? "⚠" : "✗"} ${label}${!ok && soft ? "  (best-effort — not gated)" : ""}`)
  if (!ok && !soft) failures++
}

if (existsSync(installDir)) console.warn("⚠ Volt already installed — results reflect an upgrade-over-install, not a clean one.")

// Any Volt process running out of the install dir holds it locked, and Inno's Restart Manager can't close a tray
// app (or an Electron window) under /VERYSILENT — Setup aborts with exit 5 before any check runs. The real
// auto-update path never hits this: the connector Environment.Exit(0)s itself right after launching Setup
// (Updater.cs). Match that here. No-op on CI, where nothing is running; this is what lets the gate run on a dev
// box too. ALL THREE matter: Volt.exe (the Electron GUI) locks {app}\current\desktop, and omitting it left the gate
// failing on exactly the machine most likely to run it. VoltBridgeTwincat.exe is the pipe worker the connector spawns.
for (const name of ["Volt.exe", "VoltConnector.exe", "VoltBridgeTwincat.exe"]) {
  if (procRunning(name)) {
    console.log(`• stopping ${name} (it holds the install dir locked)`)
    spawnSync("taskkill", ["/F", "/IM", name], { stdio: "ignore" })
  }
}

// Which editors had the Volt extension BEFORE the install. A silent run refreshes exactly those (WantExt), so
// this is the baseline the post-install assertion compares against — captured here, before anything is touched.
const hadExt = new Map<string, boolean>()
for (const cli of ["code", "windsurf", "cursor"]) {
  if (spawnSync("where", [cli], { encoding: "utf8", shell: true }).status !== 0) continue
  hadExt.set(
    cli,
    spawnSync(cli, ["--list-extensions"], { encoding: "utf8", shell: true }).stdout?.toLowerCase().includes("volt-ai.volt-vscode") === true,
  )
}

// ── install ───────────────────────────────────────────────────────────────────
console.log(`• installing ${setup} (/VERYSILENT)`)
const inst = spawnSync(setup, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { stdio: "inherit" })
// A ROLLBACK is the failure mode that actually shipped: a file held open by a running editor made Inno abort and
// revert, silently, leaving a half-old install. Inno still exits 0 in some abort paths, so the exit code alone is
// not proof — the checks below are. Kept as an explicit note so nobody "simplifies" them away.
if (inst.status !== 0) {
  // 5 = Setup aborted during install; on a dev box that's almost always a Volt process it couldn't close.
  const hint = inst.status === 5 ? " — a Volt process is holding the install dir (close Volt and retry)" : ""
  console.error(`✗ installer exited ${inst.status}${hint}`)
  process.exit(1)
}

// The installer publishes OPENCODE_CONFIG_DIR as part of the install — wait for it to appear, then verify.
console.log("• waiting for the installer to publish its environment…")
await waitFor(() => reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR") != null, 45)

console.log("• verifying install:")
// The junction MUST resolve — a missing `current` makes an otherwise-perfect versioned payload unreachable, which
// is the one failure that looks fine on disk (the app-<ver> dir is there) yet makes nothing work.
check("{app}\\current junction resolves", existsSync(currentDir))
// The env var opencode resolves through must point THROUGH `current` at a REAL config (its opencode.json — the file
// that actually makes opencode PLC-aware), and NOT at a versioned path (which would break on the next update).
const cfg = reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR")
check("OPENCODE_CONFIG_DIR → current\\opencode-config", cfg != null && samePath(cfg, configDir))
check("opencode-config is real (opencode.json present)", existsSync(join(configDir, "opencode.json")))
check("PATH has current\\bin", pathHasEntry(binDir))
// Behaviour, not just presence: the installed CLIs must actually RUN (a rolled-back install leaves a file that can't).
check("volt CLI runs from the installed bin", runsOk(join(binDir, "volt" + EXE), ["--version"]))
check("volt-lsp-iec CLI runs from the installed bin", runsOk(join(binDir, "volt-lsp-iec" + EXE), ["--version"]))
check("VoltConnector.exe present", existsSync(connector))
// The .vsix must ship, or the sideload tasks are no-ops on a real install.
check("volt-vscode.vsix present", existsSync(vsix))

// And every editor that HAD the extension must still report one afterwards. This is the assertion that was
// missing when the installer started uninstalling the extension and skipping the reinstall: the folders were
// still on disk (so a directory listing looked fine) while `--list-extensions` reported nothing at all.
const EXT_ID = "volt-ai.volt-vscode"
const editorReports = (cli: string): boolean =>
  spawnSync(cli, ["--list-extensions"], { encoding: "utf8", shell: true }).stdout?.toLowerCase().includes(EXT_ID) === true
const editorsOnPath = ["code", "windsurf", "cursor"].filter(
  (cli) => spawnSync("where", [cli], { encoding: "utf8", shell: true }).status === 0,
)
for (const cli of editorsOnPath) {
  // Only editors that had it before are refreshed on a silent run — an editor that never had it staying without
  // it is correct, not a failure. `hadExt` is captured before the install (see above).
  if (hadExt.get(cli) === true) check(`${cli} still reports the Volt extension`, editorReports(cli))
}
// Both best-effort per the connector's code, and both behave differently in a headless session (COM shortcut,
// per-user Run key) — report but don't gate. Their CLEANUP checks below stay hard, so a leftover still fails.
check("Start Menu shortcut", existsSync(shortcut), true)
check("login item (Run\\VoltConnector)", reg(runKey, "VoltConnector") != null, true)
check("Add/Remove entry", appId != null && reg(uninstallKey) != null)
check("tray process running", await waitFor(() => procRunning("VoltConnector.exe"), 10))

// ── uninstall ──────────────────────────────────────────────────────────────────
console.log("• uninstalling (/VERYSILENT)")
if (!existsSync(uninstaller)) {
  console.error(`✗ uninstaller not found: ${uninstaller}`)
  process.exit(1)
}
// Inno's uninstaller copies itself to %TEMP% and returns immediately, so poll for the whole {app} dir to vanish.
spawnSync(uninstaller, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { stdio: "inherit" })

console.log("• verifying cleanup:")
check("install dir removed", await waitFor(() => !existsSync(installDir), 60))
// The env revert is ASYNC: the uninstaller returns immediately and reverts env in its FINAL phase (usPostUninstall),
// AFTER the files go — so the file-removal above does NOT imply the env is reverted yet. Wait for it, symmetric with
// the install-side wait for the env to appear. A never-reverted var still fails (the wait just exhausts) — this
// tolerates the uninstall's timing without masking a real leftover.
check("OPENCODE_CONFIG_DIR reverted", await waitFor(() => reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR") == null, 15))
check("PATH bin removed", await waitFor(() => !pathHasEntry(binDir), 15))
check("Start Menu shortcut removed", !existsSync(shortcut))
check("login item removed", reg(runKey, "VoltConnector") == null)
check("Add/Remove entry removed", reg(uninstallKey) == null)
check("tray process stopped", await waitFor(() => !procRunning("VoltConnector.exe"), 10))

console.log(failures === 0 ? "\n✓ install / uninstall clean" : `\n✗ ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
