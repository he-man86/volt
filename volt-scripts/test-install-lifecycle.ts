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
 * The load-bearing assertion measures the BINARIES, not the paperwork: build-cli.ps1 stamps VOLT_VERSION into
 * every exe's FileVersion, so each one is asked what it actually is and compared against the version the install
 * claims. A stale component is a hard failure instead of something you discover in a user's workspace. The
 * extension is checked the same way — `--list-extensions --show-versions` is the editor's own answer, not a
 * folder listing (the folders survived an uninstall that deregistered it, which is what made that bug invisible).
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

// Captured ONCE, before anything is installed: a silent run refreshes only editors that already had the
// extension, so this is the baseline every later step is judged against.
const hadExtension = new Map<string, boolean>()
for (const cli of ["code", "windsurf", "cursor"]) {
  if (spawnSync("where", [cli], { encoding: "utf8", shell: true }).status !== 0) continue
  hadExtension.set(
    cli,
    (spawnSync(cli, ["--list-extensions"], { encoding: "utf8", shell: true }).stdout ?? "").toLowerCase().includes("volt-ai.volt-vscode"),
  )
}

let failures = 0
const fail = (step: string, msg: string): void => { failures++; console.error(`  ✗ [${step}] ${msg}`) }
const ok = (msg: string): void => console.log(`  ✓ ${msg}`)

const reg = (key: string, value?: string): string | null => {
  const r = spawnSync("reg", ["query", key, ...(value ? ["/v", value] : [])], { encoding: "utf8" })
  return r.status === 0 ? r.stdout : null
}
/** The binary's OWN stamped version — the fact, as opposed to version.txt's claim. build-cli.ps1 stamps
 *  FileVersion from VOLT_VERSION, so this is directly comparable to the release number. */
const fileVersion = (exe: string): string | null => {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-Item '${exe}').VersionInfo.FileVersion`],
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
  // Everything the payload ships now lives under {app}\current (a junction to app-<version>), so the whole
  // install is inspected THROUGH the junction — which is also how PATH, OPENCODE_CONFIG_DIR and the shortcut
  // reach it. Checking the version directory directly would pass even if `current` were missing or stale, and a
  // broken junction is the one failure that makes an otherwise perfect install unreachable.
  const current = join(installDir, "current")
  if (!existsSync(current)) return fail(step, "{app}\current is missing — nothing resolves the install")
  const versions = existsSync(installDir)
    ? readdirSync(installDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("app-")).map((d) => d.name)
    : []
  if (versions.length === 0) fail(step, "no app-<version> directory")
  // Retain at most 2: the active one and (briefly) its predecessor, which the connector prunes at next start.
  if (versions.length > 2) fail(step, `${versions.length} version directories retained: ${versions.join(", ")}`)
  else ok(`${step}: ${versions.length} version dir(s), current → ${versions.join(", ")}`)

  const versionFile = join(current, "version.txt")
  if (!existsSync(versionFile)) return fail(step, "version.txt missing — nothing to check against")
  const claimed = readFileSync(versionFile, "utf8").trim()

  const exes = [
    join(current, "VoltConnector.exe"),
    join(current, "VoltBridgeTwincat.exe"),
    join(current, "bin", "volt.exe"),
  ]
  const missing = exes.filter((e) => !existsSync(e))
  for (const e of missing) fail(step, `${e.replace(installDir, "")} missing`)

  // Compare each binary's OWN stamped version against version.txt. Checking the binaries against EACH OTHER is
  // not enough: an update that replaced none of them would be self-consistent and still stale. version.txt is
  // the version the installer intended, so any binary that disagrees with it did not get replaced.
  const present = exes.filter(existsSync)
  const reported = present.map((e) => [e.replace(installDir, ""), fileVersion(e)] as const)
  const stale = reported.filter(([, v]) => v !== claimed)
  if (stale.length > 0)
    fail(step, `component(s) not at ${claimed}: ${stale.map(([n, v]) => `${n}=${v ?? "?"}`).join(", ")}`)
  else ok(`${step}: every binary reports ${claimed}`)

  if (!existsSync(join(current, "bin", "volt-lsp-iec.exe"))) fail(step, "bin/volt-lsp-iec.exe missing")
  if (!existsSync(join(current, "volt-vscode.vsix"))) fail(step, "volt-vscode.vsix missing")

  // The EXTENSION, asked of the editor itself. A silent install only refreshes editors that already have it, so
  // an editor that never had it staying without it is correct — but one that HAD it must still report one, and at
  // a version the editor acknowledges. Folder listings are not evidence: they survived both an uninstall that
  // deregistered the extension and an install that skipped it.
  for (const cli of ["code", "windsurf", "cursor"]) {
    if (spawnSync("where", [cli], { encoding: "utf8", shell: true }).status !== 0) continue
    if (hadExtension.get(cli) !== true) continue
    const listed = (spawnSync(cli, ["--list-extensions", "--show-versions"], { encoding: "utf8", shell: true }).stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.toLowerCase().startsWith("volt-ai.volt-vscode"))
    if (listed.length === 0) fail(step, `${cli} no longer reports the Volt extension`)
    else if (listed.length > 1) fail(step, `${cli} reports ${listed.length} copies: ${listed.join(", ")}`)
    else ok(`${step}: ${cli} reports ${listed[0]!.trim()}`)
  }
  if (!existsSync(uninstaller)) fail(step, "uninstaller missing")
  if (reg(uninstallKey) === null) fail(step, "Add/Remove entry missing")
  const env = reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR")
  if (env === null || !env.toLowerCase().includes("volt")) fail(step, "OPENCODE_CONFIG_DIR not set to the Volt config")

  // THE invariant the whole versioned layout rests on: nothing recorded OUTSIDE {app} may name a version. If it
  // does, every update has to rewrite HKCU, and between the update and the new connector's first run those
  // values point at a directory the pruner may already have removed — a registry race traded for a file-lock
  // one. This assertion was written once and silently never applied (the edit did not match), so the gate went
  // GREEN on an install that violated it. A gate that certifies a broken invariant is worse than no gate.
  const userPath = reg("HKCU\Environment", "Path") ?? ""
  for (const [name, value] of [["OPENCODE_CONFIG_DIR", env ?? ""], ["Path", userPath]] as const)
    if (/app-\d+\.\d+\.\d+/i.test(value))
      fail(step, `${name} records a VERSIONED path — it must resolve through \current`)
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
