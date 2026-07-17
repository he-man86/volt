#!/usr/bin/env bun
/**
 * Install → verify → uninstall → verify-clean smoke test for the Volt installer. Silent-installs
 * dist/release/Volt-win-Setup.exe (or a path arg), asserts the install laid down its files + env + shortcut +
 * login item + Add/Remove entry + tray process, then silent-uninstalls and asserts every one is GONE. Exits
 * non-zero on any failure or leftover — so a dirty uninstall blocks a release (release.yml runs this between
 * build and publish).
 *
 * Windows only; per-user install, reads HKCU. Best on a throwaway machine / CI runner — it really does install
 * and uninstall Volt. A /VERYSILENT install skips the opencode-winget + VS-Code-extension steps (Check:
 * NotSilent in the .iss), so this exercises Volt's OWN install/uninstall, not the third-party installs.
 *
 *   bun run test:install [path\to\Volt-win-Setup.exe]
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve, join } from "node:path"

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

// Everything the install touches — mirror installer/Volt.iss, VoltEnv.cs, LoginItem.cs.
const installDir = join(process.env.LOCALAPPDATA!, "Programs", "Volt")
const connector = join(installDir, "VoltConnector.exe")
const uninstaller = join(installDir, "unins000.exe")
const binDir = join(installDir, "bin")
const configDir = join(installDir, "volt-config")
const vsix = join(installDir, "volt-vscode.vsix")
const shortcut = join(process.env.APPDATA!, "Microsoft", "Windows", "Start Menu", "Programs", "Volt.lnk")
const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
// Inno's per-user uninstall subkey is {AppId}_is1 — read AppId from the .iss so this can't drift.
const appId = readFileSync(resolve(repo, "installer/Volt.iss"), "utf8").match(/AppId=\{\{([0-9A-Fa-f-]+)\}/)?.[1]
const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${appId}}_is1`

const regGet = (key: string, value?: string): string | null => {
  const r = spawnSync("reg", ["query", key, ...(value ? ["/v", value] : [])], { encoding: "utf8" })
  return r.status === 0 ? r.stdout : null
}
const envHas = (value: string, needle: string): boolean => {
  const out = regGet("HKCU\\Environment", value)
  return out != null && out.toLowerCase().includes(needle.toLowerCase())
}
const procRunning = (name: string): boolean => {
  const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { encoding: "utf8" })
  return (r.stdout ?? "").toLowerCase().includes(name.toLowerCase())
}
const waitFor = async (pred: () => boolean, seconds: number): Promise<boolean> => {
  for (let i = 0; i < seconds && !pred(); i++) await Bun.sleep(1000)
  return pred()
}

let failures = 0
// soft = best-effort feature (per the connector's own "best-effort" comments): report but don't gate the release.
// The load-bearing install checks + ALL cleanup checks stay hard — cleanliness is the guarantee.
const check = (label: string, ok: boolean, soft = false): void => {
  console.log(`  ${ok ? "✓" : soft ? "⚠" : "✗"} ${label}${!ok && soft ? "  (best-effort — not gated)" : ""}`)
  if (!ok && !soft) failures++
}

if (existsSync(connector)) console.warn("⚠ Volt already installed — results reflect an upgrade-over-install, not a clean one.")

// A running tray connector holds the install dir locked, and Inno's Restart Manager can't close a tray app under
// /VERYSILENT — Setup aborts with exit 5 before any check runs. The real auto-update path never hits this: the
// connector Environment.Exit(0)s itself right after launching Setup (Updater.cs). Match that here. No-op on CI,
// where nothing is running; this is what lets the gate also run on a dev box.
for (const name of ["VoltConnector.exe", "Volt.Bridge.Beckhoff.exe"]) {
  if (procRunning(name)) {
    console.log(`• stopping ${name} (it holds the install dir locked)`)
    spawnSync("taskkill", ["/F", "/IM", name], { stdio: "ignore" })
  }
}

// ── install ───────────────────────────────────────────────────────────────────
console.log(`• installing ${setup} (/VERYSILENT)`)
const inst = spawnSync(setup, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { stdio: "inherit" })
if (inst.status !== 0) {
  // 5 = Setup aborted during install; on a dev box that's almost always a Volt process it couldn't close.
  const hint = inst.status === 5 ? " — a Volt process is holding the install dir (close Volt and retry)" : ""
  console.error(`✗ installer exited ${inst.status}${hint}`)
  process.exit(1)
}

// The connector self-configures env on startup (installer launches it nowait) — wait for it to take effect.
console.log("• waiting for the connector to self-configure…")
await waitFor(() => envHas("OPENCODE_CONFIG_DIR", "Volt"), 45)

console.log("• verifying install:")
check("install dir + VoltConnector.exe", existsSync(connector))
check("OPENCODE_CONFIG_DIR → volt-config", envHas("OPENCODE_CONFIG_DIR", configDir))
check("PATH contains \\bin", envHas("Path", binDir))
// The extension tasks themselves are skipped under /VERYSILENT (Check: NotSilent), so all we can assert here is
// that the .vsix they sideload actually shipped — without it those tasks are no-ops on a real install.
check("volt-vscode.vsix present", existsSync(vsix))
// Both best-effort per the connector's code, and both behave differently in a headless session (COM shortcut,
// per-user Run key) — report but don't gate. Their CLEANUP checks below stay hard, so a leftover still fails.
check("Start Menu shortcut", existsSync(shortcut), true)
check("login item (Run\\VoltConnector)", regGet(runKey, "VoltConnector") != null, true)
check("Add/Remove entry", appId != null && regGet(uninstallKey) != null)
check("tray process running", await waitFor(() => procRunning("VoltConnector.exe"), 10))

// ── uninstall ──────────────────────────────────────────────────────────────────
console.log("• uninstalling (/VERYSILENT)")
if (!existsSync(uninstaller)) {
  console.error(`✗ uninstaller not found: ${uninstaller}`)
  process.exit(1)
}
// Inno's uninstaller copies itself to %TEMP% and returns immediately, so poll for the dir to vanish.
spawnSync(uninstaller, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { stdio: "inherit" })
const gone = await waitFor(() => !existsSync(connector), 60)

console.log("• verifying cleanup:")
check("install dir removed", gone)
check("OPENCODE_CONFIG_DIR reverted", regGet("HKCU\\Environment", "OPENCODE_CONFIG_DIR") == null)
check("PATH \\bin removed", !envHas("Path", binDir))
check("Start Menu shortcut removed", !existsSync(shortcut))
check("login item removed", regGet(runKey, "VoltConnector") == null)
check("Add/Remove entry removed", regGet(uninstallKey) == null)
check("tray process stopped", await waitFor(() => !procRunning("VoltConnector.exe"), 10))

console.log(failures === 0 ? "\n✓ install / uninstall clean" : `\n✗ ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
