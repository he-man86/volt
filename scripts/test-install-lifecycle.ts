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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
// The installer's on-disk contract (install dir, the `current` junction, uninstaller, Add/Remove key, reg reader) —
// ONE definition shared with the smoke gate (test-install.ts), so the two can never drift apart again.
import { installDir, currentDir, uninstaller, uninstallKey, reg } from "./install-layout.js"

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
    console.error(`✗ ${label} not found: ${path}\n  build it first: bun scripts/build-installer.ts`)
    process.exit(1)
  }
}

// Captured ONCE, before anything is installed. `hadExtension` is the immutable original baseline — used only to
// restore the machine at the end. `expectExt` is the EXPECTED-present state as it evolves through the run: it
// starts equal to the baseline and every uninstall turns it off, because the gate's own uninstall strips the
// extension and the silent installs that follow never re-add it (see the extension check for why).
const hadExtension = new Map<string, boolean>()
for (const cli of ["code", "windsurf", "cursor"]) {
  if (spawnSync("where", [cli], { encoding: "utf8", shell: true }).status !== 0) continue
  hadExtension.set(
    cli,
    (spawnSync(cli, ["--list-extensions"], { encoding: "utf8", shell: true }).stdout ?? "").toLowerCase().includes("volt-ai.volt-vscode"),
  )
}
const expectExt = new Map(hadExtension)

let failures = 0
const fail = (step: string, msg: string): void => { failures++; console.error(`  ✗ [${step}] ${msg}`) }
const ok = (msg: string): void => console.log(`  ✓ ${msg}`)

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
  // Uninstall runs [UninstallRun] `--uninstall-extension` on every editor, so the extension is now gone — and a
  // following SILENT install won't re-add it. Reflect that so later steps don't expect what can't be there.
  for (const cli of expectExt.keys()) expectExt.set(cli, false)
  // Inno's uninstaller returns before it has finished deleting itself.
  for (let i = 0; i < 30 && existsSync(uninstaller); i++) spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"])
}

const logStore = join(process.env.LOCALAPPDATA!, "Volt", "logs")

/** Newest log matching a prefix, or null. The installer writes install-<ts>.log / uninstall-<date>.log there. */
function newestLog(prefix: string): string | null {
  if (!existsSync(logStore)) return null
  const files = readdirSync(logStore)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".log"))
    .map((f) => join(logStore, f))
  if (files.length === 0) return null
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!
}

/**
 * Assert the LOG, not just the end state. The end state cannot tell "the step ran and was correctly a no-op" from
 * "the step never ran" — those need different fixes and today look identical. Each expected marker must appear in
 * order, and no marker signalling a failed action (WARNING / FAILED / MISSING) may appear. This is what converts
 * the audit from a one-time read into something a removed step fails CI over, instead of a customer discovering it.
 */
function assertLog(step: string, prefix: string, required: string[]): void {
  const file = newestLog(prefix)
  if (file === null) return fail(step, `no ${prefix}*.log written — the installer logged nothing`)
  const text = readFileSync(file, "utf8")
  let from = 0
  for (const marker of required) {
    const at = text.indexOf(marker, from)
    if (at < 0) return fail(step, `log marker missing or out of order: "${marker}" (in ${file})`)
    from = at + marker.length
  }
  const bad = text
    .split("\n")
    .filter((l) => l.includes("volt:") && /\b(WARNING|FAILED|MISSING)\b/.test(l))
  if (bad.length > 0) fail(step, `log records a failed action: ${bad.map((l) => l.split("volt:")[1]!.trim()).join(" | ")}`)
  else ok(`${step}: log clean, ${required.length} markers in order`)
}

/** THE assertion. Every shipped binary + version.txt must agree, or the install is half-applied. */
function assertInstalled(step: string): void {
  // Everything the payload ships now lives under {app}\current (a junction to app-<version>), so the whole
  // install is inspected THROUGH the junction — which is also how PATH and the shortcut
  // reach it. Checking the version directory directly would pass even if `current` were missing or stale, and a
  // broken junction is the one failure that makes an otherwise perfect install unreachable.
  const current = currentDir // the `{app}\current` junction — the shared source of truth (install-layout.ts)
  if (!existsSync(current)) return fail(step, "{app}\current is missing — nothing resolves the install")
  const versions = existsSync(installDir)
    ? readdirSync(installDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("app-")).map((d) => d.name)
    : []
  if (versions.length === 0) fail(step, "no app-<version> directory")
  // Retain at most 2: the active one and (briefly) its predecessor, which the connector prunes at next start.
  if (versions.length > 2) fail(step, `${versions.length} version directories retained: ${versions.join(", ")}`)
  else ok(`${step}: ${versions.length} version dir(s), current → ${versions.join(", ")}`)

  // The oracle is the version DIRECTORY Inno created — `app-<version>` — not a version.txt in the payload (that
  // file is gone; every binary is stamped instead). This is strictly stronger: the directory name is what the
  // installer actually laid down, so a binary whose own stamp disagrees with the directory it sits in did not get
  // replaced. `versions` holds the active one (and briefly a predecessor); check against the one `current` points
  // at, which readdir cannot distinguish, so take the newest by name — matching what the connector prunes to.
  const claimed = versions.sort().at(-1)!.replace(/^app-/, "")

  const exes = [
    join(current, "VoltConnector.exe"),
    join(current, "VoltBridgeTwincat.exe"),
    join(current, "bin", "volt.exe"),
  ]
  const missing = exes.filter((e) => !existsSync(e))
  for (const e of missing) fail(step, `${e.replace(installDir, "")} missing`)

  // Each binary's OWN stamped version must equal the directory's. Checking binaries against EACH OTHER is not
  // enough: an update that replaced none of them would be self-consistent and still stale.
  const present = exes.filter(existsSync)
  const reported = present.map((e) => [e.replace(installDir, ""), fileVersion(e)] as const)
  const stale = reported.filter(([, v]) => v !== claimed)
  if (stale.length > 0)
    fail(step, `component(s) not at ${claimed}: ${stale.map(([n, v]) => `${n}=${v ?? "?"}`).join(", ")}`)
  else ok(`${step}: every binary reports ${claimed}`)

  // The LSP is bun-compiled, so it has no PE FileVersion — its version is baked in via a compile-time define and
  // it can only be asked by running it. Ask: a `(dev)` here means the define silently failed to land (it did once,
  // when cmd.exe stripped the quotes), which no FileVersion check could see.
  const lsp = join(current, "bin", "volt-lsp-iec.exe")
  if (!existsSync(lsp)) fail(step, "bin/volt-lsp-iec.exe missing")
  else {
    const lspv = (spawnSync(lsp, ["--version"], { encoding: "utf8" }).stdout ?? "").trim()
    if (!lspv.includes(claimed)) fail(step, `volt-lsp-iec reports "${lspv}", not ${claimed} (compile-time version define did not land)`)
    else ok(`${step}: volt-lsp-iec reports ${claimed}`)
  }
  if (!existsSync(join(current, "volt-vscode.vsix"))) fail(step, "volt-vscode.vsix missing")

  // The EXTENSION, asked of the editor itself. A silent install only REFRESHES editors that already have it — it
  // never re-adds one, by design (an auto-update must not push into an editor the user removed it from). So the
  // gate checks presence against the EXPECTED state (expectExt), which every uninstall step turns off: once the
  // gate's own uninstall has stripped the extension, the silent installs that follow correctly leave it absent,
  // and asserting it present against the stale ORIGINAL baseline was the gate expecting what /VERYSILENT can't
  // deliver. (Folder listings are not evidence either — they survived both an uninstall and a skipped install.)
  for (const cli of ["code", "windsurf", "cursor"]) {
    if (spawnSync("where", [cli], { encoding: "utf8", shell: true }).status !== 0) continue
    if (expectExt.get(cli) !== true) continue
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
  // The retired opencode config var must be gone — PublishEnv deletes it, so an upgrade from a pre-removal
  // install cannot leave a variable pointing at a directory this install no longer ships.
  if (reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR") !== null) fail(step, "OPENCODE_CONFIG_DIR was not retired")

  // THE invariant the whole versioned layout rests on: nothing recorded OUTSIDE {app} may name a version. If it
  // does, every update has to rewrite HKCU, and between the update and the new connector's first run those
  // values point at a directory the pruner may already have removed — a registry race traded for a file-lock
  // one. This assertion was written once and silently never applied (the edit did not match), so the gate went
  // GREEN on an install that violated it. A gate that certifies a broken invariant is worse than no gate.
  const userPath = reg("HKCU\\Environment", "Path") ?? ""
  // Match THIS install's entries — those under installDir — not any path containing "volt". The broad match also
  // caught a developer's stale `...\Github\volt\dist\volt\connector\bin` from an earlier dev run: a real leftover,
  // but not one THIS installer wrote, so failing the gate on it tests the machine's history, not the install.
  const voltEntries = userPath.split(";").filter((p) => p.toLowerCase().startsWith(installDir.toLowerCase()))
  for (const [name, value] of voltEntries.map((p) => ["Path", p] as const))
    if (/app-\d+\.\d+\.\d+/i.test(value))
      fail(step, `${name} records a VERSIONED path — it must resolve through \current`)

  // Version-free is only half the invariant: a recorded path that does not EXIST is just as broken, and looks
  // identical to the check above. A mangled backslash once shipped `...\Volt\currentin` on PATH — no version, so
  // this gate called the install clean while `volt` resolved to nothing at all. Every recorded path is resolved.
  if (voltEntries.length === 0) fail(step, "no Volt entry on PATH")
  for (const p of voltEntries) if (!existsSync(p)) fail(step, `recorded path does not exist: ${p}`)

  // The install must not only END correct, it must have DONE each step and said so. These are the load-bearing
  // markers: junction activated, env published, connector launched — the three that were silently failing.
  assertLog(step, "install-", [
    "volt: install ",
    "junction active ->",
    "env published ->",
    "started the connector:",
  ])
}

/** After an uninstall NOTHING may remain — a leftover keeps {app} alive and poisons the next install. */
function assertClean(step: string): void {
  // Uninstall finishes ASYNCHRONOUSLY relative to the process we waited on. Inno's uninstaller relaunches itself
  // from %TEMP% and deletes the original unins000.exe early, so waiting for that file to vanish (which is what
  // runUninstall does) can return while usPostUninstall is still unlinking the junction and removing app-* dirs.
  // The uninstall log proved this: it recorded "removed the junction and every version directory" AFTER the gate
  // had already reported `current` as a leftover, and {app} was empty moments later. Poll instead of sampling once
  // — a fixed sleep would be both slower and still a guess. A genuine leftover never disappears, so this cannot
  // mask a real failure; it only stops the gate from reporting a cleanup that had not finished yet.
  const deadline = Date.now() + 15_000
  let left: string[] = []
  while (Date.now() < deadline) {
    if (!existsSync(installDir)) break
    left = readdirSync(installDir)
    if (left.length === 0) break
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"])
  }
  if (existsSync(installDir)) {
    if (left.length > 0) fail(step, `${left.length} leftover entr(ies) in ${installDir}: ${left.slice(0, 8).join(", ")}`)
    else ok(`${step}: install dir empty`)
  } else ok(`${step}: install dir gone`)
  if (reg(uninstallKey) !== null) fail(step, "Add/Remove entry still present")
  if (reg("HKCU\\Environment", "OPENCODE_CONFIG_DIR") !== null) fail(step, "OPENCODE_CONFIG_DIR still present")
  const run = reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Volt")
  if (run !== null) fail(step, "login item still present")

  assertLog(step, "uninstall-", [
    "reverting environment",
    "PATH rewritten without Volt entries",
    "removed the junction and every version directory",
  ])
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

// The gate's uninstall steps run `<editor> --uninstall-extension` against the user's REAL editors (there is no
// sandbox), and it ends on an uninstall — so left alone it strips the Volt extension from every editor that had
// it and never puts it back. Restore the captured baseline: reinstall into exactly the editors that had it before
// the run, from the repo's built vsix (the installed copy is gone after the final uninstall). Leaves the machine
// as the gate found it. Best-effort and never affects pass/fail — this is courtesy, not an assertion.
function restoreExtensionBaseline(): void {
  const vsix = resolve(repo, "dist/volt/volt-vscode.vsix")
  const toRestore = [...hadExtension].filter(([, had]) => had).map(([cli]) => cli)
  if (toRestore.length === 0 || !existsSync(vsix)) return
  console.log(`\n── restoring extension baseline ──`)
  for (const cli of toRestore) {
    if (spawnSync("where", [cli], { encoding: "utf8", shell: true }).status !== 0) continue
    const has = (spawnSync(cli, ["--list-extensions"], { encoding: "utf8", shell: true }).stdout ?? "")
      .toLowerCase()
      .includes("volt-ai.volt-vscode")
    if (has) { console.log(`  ✓ ${cli}: still present`); continue }
    const r = spawnSync(cli, ["--install-extension", vsix, "--force"], { encoding: "utf8", shell: true })
    console.log(r.status === 0 ? `  ✓ ${cli}: restored` : `  ⚠ ${cli}: restore failed (reinstall manually from ${vsix})`)
  }
}

console.log(`• lifecycle: ${setup}${olderSetup ? `\n  upgrading from: ${olderSetup}` : "  (same build reinstalled — pass --older for a true upgrade)"}\n`)
for (const [name, run] of steps) {
  console.log(`── ${name} ──`)
  run()
}

restoreExtensionBaseline()

console.log(
  failures === 0
    ? "\n✓ install lifecycle clean at every step"
    : `\n✗ ${failures} problem(s) across the lifecycle`,
)
process.exit(failures === 0 ? 0 : 1)
