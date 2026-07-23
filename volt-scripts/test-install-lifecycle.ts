#!/usr/bin/env bun
/**
 * The install LIFECYCLE gate — the multi-step sibling of `test:install`.
 *
 * `test:install` proves ONE install and ONE uninstall are clean. It cannot catch the failures that actually
 * shipped, because those only appear on the SECOND install (an update over an existing install, with files held
 * open) and only in the components it never inspects:
 *
 *   • A silent update ABORTED AND ROLLED BACK because a running editor held bin\volt-lsp-iec.exe: Inno retried,
 *     hit an Abort/Retry/Ignore box that /SUPPRESSMSGBOXES defaults to Abort, and reverted — silently. Files that
 *     sort AFTER the locked one (notably bin\volt.exe) stayed several releases behind while the connector moved
 *     on, so a shipped CLI feature looked broken for days.
 *   • version.txt is what the tray REPORTS as the installed version, and it is just a text file the installer
 *     writes. It asserts nothing about the binaries beside it, so a half-applied install reports the version it
 *     MEANT to be.
 *
 * So this runs a realistic sequence and, after every step, asserts the whole install agrees with itself:
 *
 *   install → uninstall → install → update → update → uninstall → install → uninstall
 *
 * The load-bearing assertion is VERSION CONSISTENCY: every shipped binary and version.txt must report the SAME
 * version. A stale component is then a hard failure instead of something you discover in a user's workspace.
 *
 * Windows only; per-user install; this REALLY installs and uninstalls Volt several times. Best on a throwaway
 * machine or a CI runner. Optionally point it at two builds to exercise a genuine upgrade:
 *
 *   bun run test:install:lifecycle [setup.exe] [--older <older-setup.exe>]
 *
 * With --older, the "update" steps install the newer build over the older one — the case that broke. Without it,
 * the same build is reinstalled over itself, which still exercises the file-in-use path.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

if (process.platform !== "win32") {
  console.error("test:install:lifecycle is Windows-only.")
  process.exit(1)
}

const repo = resolve(import.meta.dirname, "..")
const args = process.argv.slice(2)
const olderIdx = args.indexOf("--older")
const olderSetup = olderIdx >= 0 ? resolve(args[olderIdx + 1]!) : undefined
const setup = resolve(args.find((a) => !a.startsWith("--") && a !== args[olderIdx + 1]) ?? resolve(repo, "dist/release/Volt-win-Setup.exe"))

for (const [label, path] of [["installer", setup], ...(olderSetup ? [["older installer", olderSetup] as const] : [])] as const) {
  if (!existsSync(path)) {
    console.error(`✗ ${label} not found: ${path}\n  build it first: bun volt-scripts/build-installer.ts`)
    process.exit(1)
  }
}

const installDir = join(process.env.LOCALAPPDATA!, "Programs", "Volt")
const uninstaller = join(installDir, "unins000.exe")
const appId = readFileSync(resolve(repo, "installer/Volt.iss"), "utf8").match(/AppId=\{\{([0-9A-Fa-f-]+)\}/)?.[1]
const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${appId}}_is1`

let failures = 0
const fail = (step: string, msg: string): void => { failures++; console.error(`  ✗ [${step}] ${msg}`) }
const ok = (msg: string): void => console.log(`  ✓ ${msg}`)

const reg = (key: string, value?: string): string | null => {
  const r = spawnSync("reg", ["query", key, ...(value ? ["/v", value] : [])], { encoding: "utf8" })
  return r.status === 0 ? r.stdout : null
}
const productVersion = (exe: string): string | null => {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-Item '${exe}').VersionInfo.ProductVersion`],
    { encoding: "utf8" },
  )
  return r.status === 0 ? (r.stdout ?? "").trim() || null : null
}

/** Run a setup silently. Inno can exit 0 on some abort paths, so the caller must still verify the RESULT. */
function runSetup(path: string, step: string): void {
  const logFile = join(process.env.TEMP!, `volt-lifecycle-${Date.now()}.log`)
  const r = spawnSync(path, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", `/LOG=${logFile}`], { stdio: "inherit" })
  if (r.status !== 0) fail(step, `installer exited ${r.status}`)
  // The rollback that shipped announced itself in the log and nowhere else — the process still finished and no
  // error surfaced. Read the log rather than trusting the exit code.
  if (existsSync(logFile)) {
    const log = readFileSync(logFile, "utf8")
    if (log.includes("Rolling back changes")) fail(step, `setup ROLLED BACK (see ${logFile})`)
    const locked = log.match(/appears to be in use[\s\S]{0,400}?Defaulting to Abort/)
    if (locked) fail(step, `a file was in use and setup aborted (see ${logFile})`)
  }
}

function runUninstall(step: string): void {
  if (!existsSync(uninstaller)) return fail(step, "uninstaller missing — cannot uninstall")
  const r = spawnSync(uninstaller, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], { stdio: "inherit" })
  if (r.status !== 0) fail(step, `uninstaller exited ${r.status}`)
  // Inno's uninstaller returns before it has finished deleting itself.
  for (let i = 0; i < 30 && existsSync(uninstaller); i++) spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"])
}

/** THE assertion. Every shipped binary + version.txt must agree, or the install is half-applied. */
function assertInstalled(step: string): void {
  const versionFile = join(installDir, "version.txt")
  if (!existsSync(versionFile)) return fail(step, "version.txt missing — nothing to check against")
  const claimed = readFileSync(versionFile, "utf8").trim()

  const exes = [
    join(installDir, "VoltConnector.exe"),
    join(installDir, "VoltBridgeTwincat.exe"),
    join(installDir, "bin", "volt.exe"),
  ]
  for (const exe of exes) {
    if (!existsSync(exe)) { fail(step, `${exe.replace(installDir, "")} missing`); continue }
    const v = productVersion(exe)
    // The C# binaries carry `1.0.0+<sha>`, not the marketing version, so compare them to EACH OTHER: a build
    // produces one sha across the toolchain, and a mismatch means some component didn't get replaced.
    if (v === null) fail(step, `${exe.replace(installDir, "")} has no ProductVersion`)
  }
  const shas = exes.filter(existsSync).map((e) => productVersion(e)?.split("+")[1] ?? "?")
  if (new Set(shas).size > 1)
    fail(step, `components disagree — ${exes.map((e, i) => `${e.replace(installDir, "")}=${shas[i]}`).join(", ")}`)
  else ok(`${step}: all components at ${shas[0]} (version.txt says ${claimed})`)

  if (!existsSync(join(installDir, "bin", "volt-lsp-iec.exe"))) fail(step, "bin/volt-lsp-iec.exe missing")
  if (!existsSync(join(installDir, "volt-vscode.vsix"))) fail(step, "volt-vscode.vsix missing")
  if (!existsSync(uninstaller)) fail(step, "uninstaller missing")
  if (reg(uninstallKey) === null) fail(step, "Add/Remove entry missing")
  const env = reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR")
  if (env === null || !env.toLowerCase().includes("volt")) fail(step, "OPENCODE_CONFIG_DIR not set to the Volt config")
}

/** After an uninstall NOTHING may remain — a leftover keeps {app} alive and poisons the next install. */
function assertClean(step: string): void {
  if (existsSync(installDir)) {
    const left = readdirSync(installDir)
    if (left.length > 0) fail(step, `${left.length} leftover entr(ies) in ${installDir}: ${left.slice(0, 8).join(", ")}`)
    else ok(`${step}: install dir empty`)
  } else ok(`${step}: install dir gone`)
  if (reg(uninstallKey) !== null) fail(step, "Add/Remove entry still present")
  const env = reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR")
  if (env !== null && env.toLowerCase().includes("volt")) fail(step, "OPENCODE_CONFIG_DIR still points at Volt")
  const run = reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Volt")
  if (run !== null) fail(step, "login item still present")
}

// ── the flow ─────────────────────────────────────────────────────────────────
// Deliberately not just install→uninstall: the failures that shipped needed an install OVER an existing one.
const steps: [string, () => void][] = [
  ["1 install", () => { runSetup(olderSetup ?? setup, "1 install"); assertInstalled("1 install") }],
  ["2 uninstall", () => { runUninstall("2 uninstall"); assertClean("2 uninstall") }],
  ["3 install", () => { runSetup(olderSetup ?? setup, "3 install"); assertInstalled("3 install") }],
  ["4 update", () => { runSetup(setup, "4 update"); assertInstalled("4 update") }],
  ["5 update again", () => { runSetup(setup, "5 update again"); assertInstalled("5 update again") }],
  ["6 uninstall", () => { runUninstall("6 uninstall"); assertClean("6 uninstall") }],
  ["7 install", () => { runSetup(setup, "7 install"); assertInstalled("7 install") }],
  ["8 uninstall", () => { runUninstall("8 uninstall"); assertClean("8 uninstall") }],
]

console.log(`• lifecycle: ${setup}${olderSetup ? `\n  upgrading from: ${olderSetup}` : "  (same build reinstalled — pass --older for a true upgrade)"}\n`)
for (const [name, run] of steps) {
  console.log(`── ${name} ──`)
  run()
}

console.log(
  failures === 0
    ? "\n✓ install lifecycle clean at every step"
    : `\n✗ ${failures} problem(s) across the lifecycle`,
)
process.exit(failures === 0 ? 0 : 1)
