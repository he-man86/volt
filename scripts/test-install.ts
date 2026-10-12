#!/usr/bin/env bun
/**
 * THE install gate. Really installs, updates and uninstalls Volt on this machine and asserts after every step.
 * Every check is HARD — there is no "warn": a best-effort check is how a shortcut that was never created passed
 * both halves of the old gate for months. Written against openspec installer-rebuild's design (section 1).
 *
 *   bun run test:install [setup.exe] --older <older-setup.exe | stable>
 *
 * `--older` is REQUIRED: the failures that shipped needed an install OVER an existing one, and the one-release
 * migration from the `app-<v>` + `current` layout can only be proven by upgrading from it. `stable` downloads the
 * latest non-prerelease's Volt-win-Setup.exe with `gh`. A run without an upgrade is refused by name.
 *
 * The flow (design 1):
 *    1  install --older                     (today's layout — only its version is asserted)
 *    2  update to the new build             (+ the migration: no app-*, no current, old PATH entry / env / Run gone)
 *    3  update again, same build            (files in use: the connector it launched holds its own exe)
 *    4  update with `volt.exe` alive, /VOLTWAIT=15  → setup exits non-zero, the CLI is NOT killed, NOTHING
 *                                             stopped (the TwinCAT worker is the other end of the CLI's pipe), no
 *                                             binary replaced, the tray untouched
 *    5  the same, the CLI stopped 5 s into the wait → setup completes
 *    6  uninstall with `volt.exe` alive, /VOLTWAIT=15 → aborted, nothing removed, the CLI alive
 *    7  uninstall → clean                    8  fresh install            9  uninstall → clean
 *   10  the updater refuses a tampered / digest-less download (Volt.Connector.Tests, UpdaterVerificationTests)
 *
 * What "installed" means, measured (assertInstalled): Add/Remove `DisplayVersion` (Inno writes it) equals the
 * setup's own ProductVersion, and every stamped binary's FileVersion equals that — the binaries, not paperwork; a
 * half-applied update is self-consistent and still stale. Plus the published surface, each one exact: the Start
 * Menu shortcut's TARGET, the Run value's DATA, the PATH entry (once, nothing else under {app}), the
 * WM_SETTINGCHANGE("Environment") broadcast observed by a running window, the Documents\Volt scripts, the bridge
 * DLL resolved the way the shipped script resolves it with no VOLT_BRIDGE_DLL.
 *
 * Windows only; per-user; really installs several times — a throwaway machine or a CI runner. It refuses to start
 * on a machine where Volt is already installed (it could not tell its own leftovers from yours).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

if (process.platform !== "win32") {
  console.error("test:install is Windows-only (the installer + HKCU checks are Windows).")
  process.exit(1)
}

const repo = resolve(import.meta.dirname, "..")

// ── the installer's on-disk contract (design: target layout) ─────────────────
// {app} — Inno's DefaultDirName (a per-user install) — flat: no `app-<version>`, no `current` junction.
const installDir = join(process.env.LOCALAPPDATA!, "Programs", "Volt")
const uninstaller = join(installDir, "unins000.exe")
const binDir = join(installDir, "bin")
const cliExe = join(binDir, "volt.exe")
const lspExe = join(binDir, "volt-lsp-iec.exe")
const desktopExe = join(installDir, "desktop", "VoltDesktop.exe")
const connectorExe = join(installDir, "connector", "VoltConnector.exe")
/** Everything `build-cli.ps1` / electron-builder stamps with the release version. The two DLLs are what the
 *  bridges read `health.bridgeVersion` from (BridgeRelease off the file the host was loaded from), so an unstamped
 *  one reports `(dev)` on a release install even when every exe passes. */
const stamped = [
  connectorExe,
  join(installDir, "connector", "VoltBridgeTwincat.exe"),
  join(installDir, "connector", "Volt.Engine.Host.dll"),
  cliExe,
  desktopExe,
  join(installDir, "codesys", "Volt.Ide.Codesys.dll"),
]
/** PATH carries exactly this directory and it holds exactly these — nothing else lands on an agent's PATH. */
const binExpected = ["volt-lsp-iec.exe", "volt.exe"]

const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
const runValueName = "VoltConnector"
const runValueData = `"${connectorExe}" --silent`
const shortcut = join(process.env.APPDATA!, "Microsoft", "Windows", "Start Menu", "Programs", "Volt.lnk")
/** The env vars only the old layout wrote. Volt publishes PATH and nothing else. */
const retiredEnv = ["VOLT_BRIDGE_DLL", "OPENCODE_CONFIG_DIR"]
const codesysScripts = ["start_volt_codesys.py", "stop_volt_codesys.py"]
const bridgeDll = "Volt.Ide.Codesys.dll"
/** Volt's own processes, by their own (now unique) image names — never `volt.exe`, the CLI. */
const voltProcesses = ["VoltConnector.exe", "VoltBridgeTwincat.exe", "VoltDesktop.exe"]

// Inno's per-user uninstall subkey is {AppId}_is1 — read AppId from the .iss so this can't drift from the installer.
const appId = readFileSync(resolve(repo, "installer/Volt.iss"), "utf8").match(/AppId=\{\{([0-9A-Fa-f-]+)\}/)?.[1]
if (!appId) throw new Error("installer/Volt.iss has no AppId={{GUID} — cannot locate the Add/Remove entry")
const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${appId}}_is1`

const logStore = join(process.env.LOCALAPPDATA!, "Volt", "logs")
const work = mkdtempSync(join(tmpdir(), "volt-test-install-"))

// ── small, exact readers ─────────────────────────────────────────────────────

/** `reg query`. With a value NAME, returns that value's DATA (which may contain spaces); without, the raw stdout
 *  (non-null iff the key exists). Null when absent. */
function reg(key: string, value?: string): string | null {
  const r = spawnSync("reg", ["query", key, ...(value ? ["/v", value] : [])], { encoding: "utf8" })
  if (r.status !== 0) return null
  if (!value) return r.stdout
  const line = (r.stdout ?? "").split("\n").find((l) => new RegExp(`^\\s+${value}\\s+REG_`, "i").test(l))
  return line ? line.replace(new RegExp(`^\\s+${value}\\s+REG_\\w+\\s+`, "i"), "").trim() : null
}

const ps = (command: string): string => {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`powershell failed (${r.status}): ${command}\n${r.stderr}`)
  return (r.stdout ?? "").trim()
}
const q = (s: string): string => `'${s.replaceAll("'", "''")}'`

const userPathEntries = (): string[] => (reg("HKCU\\Environment", "Path") ?? "").split(";").filter((e) => e.trim() !== "")
/** The user PATH value itself — whether it exists, its registry type and its exact string, unexpanded. `reg query`
 *  trims and `userPathEntries` drops empty parts, so neither sees a lost trailing ';', an emptied-not-deleted value
 *  or a REG_EXPAND_SZ turned REG_SZ; "byte-identical after uninstall" is measured on this. */
const userPathValue = (): string =>
  ps(
    `$k = Get-Item -LiteralPath 'HKCU:\\Environment'; if ($k.GetValueNames() -contains 'Path') { $k.GetValueKind('Path').ToString() + ' ' + (ConvertTo-Json -Compress $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')) } else { 'absent' }`,
  )
const underApp = (p: string): boolean => p.trim().toLowerCase().startsWith(installDir.toLowerCase())
/** A FileVersion, or null when the file has none. */
const fileVersion = (file: string): string | null => ps(`(Get-Item -LiteralPath ${q(file)}).VersionInfo.FileVersion`) || null
const productVersion = (file: string): string | null => ps(`(Get-Item -LiteralPath ${q(file)}).VersionInfo.ProductVersion`) || null
/** NTFS file id: a REPLACED file has a new one even when Inno restores its timestamp (and tunnelling restores its
 *  creation time), so this is what "no binary was replaced" is measured by. */
const fileId = (file: string): string | null => {
  const r = spawnSync("fsutil", ["file", "queryfileid", file], { encoding: "utf8" })
  return r.status === 0 ? (r.stdout ?? "").trim() : null
}
const documentsVolt = join(ps("[Environment]::GetFolderPath('MyDocuments')"), "Volt")

const imageRunning = (name: string): boolean =>
  (spawnSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { encoding: "utf8" }).stdout ?? "").toLowerCase().includes(name.toLowerCase())
/** A process running FROM this exact file — an image name alone also matches a dev tray or any other copy, which
 *  would pass "the installed connector is running" on a process the installer never started. */
const runningFrom = (exe: string): boolean => pidsFrom(exe).length > 0
/** Every process of image `name` as `pid path` (path "?" when Windows will not say), via Win32_Process. */
const processesNamed = (name: string): { pid: number; path: string }[] =>
  ps(`@(Get-CimInstance Win32_Process -Filter ${q(`Name='${name}'`)} | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }) -join "\`n"`)
    .split(/\r?\n/)
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [pid, path] = l.split("|")
      return { pid: Number(pid), path: path || "?" }
    })
/** The pids running FROM this exact file. */
const pidsFrom = (exe: string): number[] =>
  processesNamed(exe.split(/[\\/]/).pop()!).filter((p) => p.path.toLowerCase() === exe.toLowerCase()).map((p) => p.pid)
const describe = (ps_: { pid: number; path: string }[]): string => ps_.map((p) => `pid ${p.pid} ${p.path}`).join(", ")
/** Any process whose image name starts with `prefix` (tasklist's filter takes a trailing `*`). */
const prefixRunning = (prefix: string): boolean =>
  (spawnSync("tasklist", ["/FI", `IMAGENAME eq ${prefix}*`, "/NH", "/FO", "CSV"], { encoding: "utf8" }).stdout ?? "")
    .toLowerCase()
    .includes(`"${prefix.toLowerCase()}`)
const pidAlive = (pid: number): boolean =>
  (spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" }).stdout ?? "").includes(String(pid))

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred: () => boolean, seconds: number): Promise<boolean> {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    if (pred()) return true
    await sleep(500)
  }
  return pred()
}

let failures = 0
const fail = (step: string, msg: string): void => {
  failures++
  console.error(`  ✗ [${step}] ${msg}`)
}
const ok = (msg: string): void => console.log(`  ✓ ${msg}`)
/** A precondition the run cannot continue without — refused by name, nothing installed yet. */
const refuse = (msg: string): never => {
  console.error(`✗ refused: ${msg}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

// ── arguments ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const olderIdx = args.indexOf("--older")
const olderArg = olderIdx >= 0 ? args[olderIdx + 1] : undefined
if (olderArg === undefined || olderArg.startsWith("--"))
  refuse("no upgrade source — pass --older <setup.exe> or --older stable (a run without an upgrade proves nothing about the migration)")
const unknown = args.filter((a, i) => a.startsWith("--") && a !== "--older" && i !== olderIdx + 1)
if (unknown.length > 0) refuse(`unknown option(s): ${unknown.join(" ")}`)
const positional = args.filter((a, i) => !a.startsWith("--") && i !== olderIdx + 1)
if (positional.length > 1) refuse(`more than one setup given: ${positional.join(" ")}`)
const setup = resolve(positional[0] ?? join(repo, "dist", "release", "Volt-win-Setup.exe"))
if (!existsSync(setup)) refuse(`installer not found: ${setup} — build it first: bun run build:installer`)

/** `stable` = the latest non-prerelease's own Volt-win-Setup.exe, downloaded with gh. */
function resolveOlder(arg: string): string {
  if (arg !== "stable") {
    const p = resolve(arg)
    if (!existsSync(p)) refuse(`older installer not found: ${p}`)
    return p
  }
  const list = spawnSync("gh", ["release", "list", "--exclude-pre-releases", "--exclude-drafts", "--limit", "1", "--json", "tagName", "--jq", ".[0].tagName"], { encoding: "utf8", cwd: repo })
  const tag = (list.stdout ?? "").trim()
  if (list.status !== 0 || tag === "") refuse(`could not resolve the latest stable release with gh: ${list.stderr ?? ""}`)
  const dir = join(work, "older")
  const dl = spawnSync("gh", ["release", "download", tag, "--pattern", "Volt-win-Setup.exe", "--dir", dir, "--clobber"], { encoding: "utf8", cwd: repo })
  const p = join(dir, "Volt-win-Setup.exe")
  if (dl.status !== 0 || !existsSync(p)) refuse(`could not download Volt-win-Setup.exe of stable ${tag}: ${dl.stderr ?? ""}`)
  console.log(`• older = stable ${tag}`)
  return p
}
const olderSetup = resolveOlder(olderArg!)

const versionOf = (exe: string): string => {
  const v = productVersion(exe)?.trim()
  if (!v || !/^\d+(\.\d+){1,3}$/.test(v)) refuse(`${exe} carries no ProductVersion — cannot tell which version it installs`)
  return v!
}
const newVersion = versionOf(setup)
const olderVersion = versionOf(olderSetup)
const cmpVersion = (a: string, b: string): number => {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
if (cmpVersion(olderVersion, newVersion) >= 0)
  refuse(`--older is ${olderVersion}, not older than ${newVersion} — that is not an upgrade`)

// ── machine preconditions + the baseline the uninstall is measured against ───

const already = reg(uninstallKey, "DisplayVersion")
if (already !== null) refuse(`Volt ${already} is already installed — the gate starts from a clean machine; uninstall it first`)
if (existsSync(installDir) && readdirSync(installDir).length > 0) refuse(`${installDir} is not empty — remove the leftover first`)
/** The user PATH WITHOUT Volt: uninstall must give back exactly this — "no other PATH entry is touched". */
const pathBaseline = userPathEntries()
/** The same as the value itself (existence / type / exact string): what the uninstall must give back. */
const pathValueBaseline = userPathValue()
if (pathBaseline.some(underApp)) refuse(`the user PATH already names ${installDir} — the machine is not clean`)
// Every other published fact must be ABSENT at the start too, or a leftover would pass an assertion the installer
// never earned. A running Volt process (a dev tray publishes its own Documents scripts) would do the same.
const runningAtStart = voltProcesses.filter(imageRunning)
if (runningAtStart.length > 0) refuse(`Volt process(es) already running: ${runningAtStart.join(", ")} — stop them (a dev tray included) first`)
// A `volt.exe` from ANY path (another agent's CLI, a dev build's `volt console`, an editor's call) makes every setup
// wait on it — up to the default /VOLTWAIT of an hour — so steps 2/3/8 would die at the setup timeout as "hung" and
// step 5 would wait on a CLI the gate cannot stop. Steps 4–6 start their own; none may be running before.
const cliAtStart = processesNamed("volt.exe")
if (cliAtStart.length > 0) refuse(`volt.exe already running (${describe(cliAtStart)}) — every setup would wait on it; stop it first`)
if (existsSync(shortcut)) refuse(`${shortcut} already exists — the machine is not clean`)
if (reg(runKey, runValueName) !== null) refuse(`Run\\${runValueName} is already set — the machine is not clean`)
const leftoverScripts = codesysScripts.map((s) => join(documentsVolt, s)).filter(existsSync)
if (leftoverScripts.length > 0) refuse(`${leftoverScripts.join(", ")} already present — the machine is not clean`)
const leftoverEnv = retiredEnv.filter((name) => reg("HKCU\\Environment", name) !== null)
if (leftoverEnv.length > 0) refuse(`${leftoverEnv.join(", ")} already set in HKCU\\Environment — the machine is not clean`)

// Step 10 runs a net10.0 test project. Several dotnets may exist (a user-local SDK 8 one earlier on PATH fails it
// with NETSDK1045, which would read as "the updater tests failed"), so the dotnet is CHOSEN by the measured fact —
// the first candidate whose `--list-sdks` has a 10.x SDK — and the run is refused by name when none has one.
function resolveDotnet(): string {
  const machine = "C:\\Program Files\\dotnet\\dotnet.exe"
  const onPath = (spawnSync("where", ["dotnet"], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "")
  const candidates = [...new Set([machine, ...onPath].filter(existsSync))]
  const seen: string[] = []
  for (const exe of candidates) {
    const sdks = (spawnSync(exe, ["--list-sdks"], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/).map((l) => l.split(" ")[0] ?? "").filter((v) => v !== "")
    if (sdks.some((v) => v.startsWith("10."))) return exe
    seen.push(`${exe} [${sdks.join(", ") || "no SDK"}]`)
  }
  return refuse(`no dotnet with a .NET 10 SDK (step 10 runs a net10.0 test project) — found: ${seen.join("; ") || "no dotnet at all"}`)
}
const dotnet = resolveDotnet()

// The extension leaves the installer (vscode-extension-marketplace), but this release's uninstall still runs
// `--uninstall-extension` on every editor — so the gate captures who had it and gives it back from the
// Marketplace at the end. Courtesy, never an assertion; deleted with those uninstall lines.
const editors = ["code", "windsurf", "cursor"].filter((cli) => spawnSync("where", [cli], { shell: true }).status === 0)
const hasExtension = (cli: string): boolean =>
  (spawnSync(cli, ["--list-extensions"], { encoding: "utf8", shell: true }).stdout ?? "").toLowerCase().includes("volt-ai.volt-vscode")
const hadExtension = new Map(editors.map((cli) => [cli, hasExtension(cli)] as const))

// ── the WM_SETTINGCHANGE("Environment") observer ─────────────────────────────
// `ChangesEnvironment=yes` makes Inno broadcast it so a running Explorer (and every shell/editor launched from it)
// re-reads PATH. Grepping Inno's log would prove the intent, not the delivery: this is a hidden TOP-LEVEL window
// (HWND_BROADCAST never reaches a message-only one) that records the broadcast while the setup runs.
const listenerScript = join(work, "env-listener.ps1")
writeFileSync(
  listenerScript,
  `param([string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System; using System.IO; using System.Runtime.InteropServices; using System.Windows.Forms;
public sealed class VoltEnvListener : NativeWindow {
  private readonly string _out;
  public VoltEnvListener(string o) { _out = o; CreateHandle(new CreateParams { Caption = "volt-test-install-env" }); }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x001A && m.LParam != IntPtr.Zero && Marshal.PtrToStringUni(m.LParam) == "Environment")
      File.AppendAllText(_out, "Environment\\n");
    base.WndProc(ref m);
  }
}
"@ -WarningAction SilentlyContinue
$l = New-Object VoltEnvListener $Out
[System.IO.File]::WriteAllText("$Out.ready", "ready")
[System.Windows.Forms.Application]::Run()
`,
)
let listenerSeq = 0
async function startBroadcastListener(step: string): Promise<{ stop: () => boolean }> {
  const out = join(work, `env-${++listenerSeq}.txt`)
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", listenerScript, "-Out", out], { stdio: "ignore", windowsHide: true })
  if (!(await waitFor(() => existsSync(`${out}.ready`), 30))) {
    child.kill()
    fail(step, "the WM_SETTINGCHANGE listener did not start — the broadcast cannot be observed")
    return { stop: () => false }
  }
  return {
    stop: () => {
      child.kill()
      return existsSync(out) && readFileSync(out, "utf8").includes("Environment")
    },
  }
}

// ── running setups ───────────────────────────────────────────────────────────

type SetupRun = { status: number | null; log: string; mark: LogMark }

/** Run a setup /VERYSILENT with its own /LOG. Inno can exit 0 on an abort path, so the log is read too. A setup
 *  that outlives `timeoutS` is a bug, not a slow machine — it is killed and failed by name. */
async function runSetup(exe: string, step: string, extra: string[] = [], timeoutS = 600, during?: (child: ChildProcess) => Promise<void>): Promise<SetupRun> {
  const log = join(work, `setup-${step.replace(/\W+/g, "-")}.log`)
  const mark = logMark()
  const child = spawn(exe, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", `/LOG=${log}`, ...extra], { stdio: "inherit" })
  const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)))
  // Inno does the work in an extracted `is-*.tmp\*.tmp` CHILD; killing only Setup.exe would leave it running beside
  // the next step's setup — so the whole tree goes.
  const timer = setTimeout(() => {
    // A volt.exe started after the gate's start check (an editor's, another session's) is the one setup waits on:
    // named, so the timeout does not read as an installer bug when it is not one.
    const cli = processesNamed("volt.exe")
    fail(step, `setup still running after ${timeoutS} s — killed with its whole process tree (a wait that never ends is a bug)${cli.length > 0 ? `; volt.exe running: ${describe(cli)}` : ""}`)
    if (child.pid !== undefined) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"])
  }, timeoutS * 1000)
  if (during) await during(child)
  const status = await exited
  clearTimeout(timer)
  return { status, log, mark }
}

/** The rollback that shipped announced itself in the setup log and nowhere else (exit code and all). */
function assertNoRollback(step: string, run: SetupRun): void {
  if (!existsSync(run.log)) return fail(step, `setup wrote no /LOG (${run.log})`)
  const text = readFileSync(run.log, "utf8")
  if (text.includes("Rolling back changes")) fail(step, `setup ROLLED BACK (see ${run.log})`)
  if (/appears to be in use[\s\S]{0,400}?Defaulting to Abort/.test(text)) fail(step, `a file was in use and setup aborted (see ${run.log})`)
}

/** Inno's uninstaller re-runs itself from %TEMP% (`_iu*.tmp`) and deletes unins000.exe late, so its exit is not
 *  the end of the uninstall: wait until no second phase is running. */
async function runUninstall(step: string, extra: string[] = []): Promise<{ mark: LogMark; status: number | null }> {
  const mark = logMark()
  if (!existsSync(uninstaller)) {
    fail(step, "uninstaller missing — cannot uninstall")
    return { mark, status: null }
  }
  const r = spawnSync(uninstaller, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", ...extra], { stdio: "inherit", timeout: 600_000 })
  if (r.error) fail(step, `uninstaller did not finish: ${r.error.message}`)
  if (!(await waitFor(() => !prefixRunning("_iu"), 120))) {
    // Left running, it would race the next step's setup — killed, and failed by name.
    fail(step, "the uninstaller's second phase (_iu*.tmp) is still running after 120 s — killed")
    spawnSync("taskkill", ["/F", "/T", "/FI", "IMAGENAME eq _iu*"])
  }
  return { mark, status: r.status }
}

/** The size of every file in Volt's shared log store when a step starts. The uninstaller APPENDS every uninstall
 *  of a day to one `uninstall-<yyyy-mm-dd>.log`, so a whole file is several runs' evidence: a marker written by an
 *  earlier step (or an earlier gate run that day) would pass this step, and one FAILED line would fail every later
 *  step. A step's evidence is exactly the bytes appended after its mark — a per-run file reads whole, a shared one
 *  reads its new tail. */
type LogMark = Map<string, number>
function logMark(): LogMark {
  const sizes: LogMark = new Map()
  if (existsSync(logStore)) for (const f of readdirSync(logStore)) sizes.set(f, statSync(join(logStore, f)).size)
  return sizes
}
/** What this step appended to `<prefix>*.log` since `mark` (new files whole), or null when it appended nothing. */
function logSince(prefix: string, mark: LogMark): { files: string[]; text: string } | null {
  if (!existsSync(logStore)) return null
  const files: string[] = []
  let text = ""
  for (const f of readdirSync(logStore).filter((n) => n.startsWith(prefix) && n.endsWith(".log")).sort()) {
    const from = mark.get(f) ?? 0
    const bytes = readFileSync(join(logStore, f))
    if (bytes.length <= from) continue
    files.push(join(logStore, f))
    text += bytes.subarray(from).toString("utf8")
  }
  return files.length > 0 ? { files, text } : null
}

/** The mirrored install/uninstall log of THIS step: present, carries the markers in order, records no failed
 *  action. Inno's own log (the install mirror) has lines of its own, so there only `volt:` lines are Volt's; the
 *  uninstall log is written by Volt alone, so EVERY line in it must carry `volt:` — an unprefixed line is one the
 *  WARNING/FAILED/MISSING check would never see. */
function assertLog(step: string, prefix: "install-" | "uninstall-", mark: LogMark, required: string[]): string | null {
  const log = logSince(prefix, mark)
  if (log === null) {
    fail(step, `no ${prefix}*.log written to ${logStore} by this step — the setup log was not mirrored`)
    return null
  }
  const where = log.files.join(", ")
  let from = 0
  for (const marker of required) {
    const at = log.text.indexOf(marker, from)
    if (at < 0) {
      fail(step, `log marker missing or out of order: "${marker}" (in what this step wrote to ${where})`)
      return log.text
    }
    from = at + marker.length
  }
  const lines = log.text.split(/\r?\n/).filter((l) => l.trim() !== "")
  if (prefix === "uninstall-") {
    const unprefixed = lines.filter((l) => !l.includes("volt:"))
    if (unprefixed.length > 0) fail(step, `${unprefixed.length} uninstall log line(s) without "volt:" (e.g. "${unprefixed[0]?.trim()}") in ${where}`)
  }
  const bad = lines.filter((l) => l.includes("volt:") && /\b(WARNING|FAILED|MISSING)\b/.test(l))
  if (bad.length > 0) fail(step, `log records a failed action: ${bad.map((l) => (l.split("volt:")[1] ?? "").trim()).join(" | ")}`)
  else ok(`${step}: ${prefix}log clean, ${required.length} marker(s) in order`)
  return log.text
}

// ── the assertions ───────────────────────────────────────────────────────────

/** After step 1 only: the OLDER build (today's layout) is what the target is measured against, so only the fact
 *  that it installed is asserted — its layout is exactly what step 2 must migrate away. */
function assertOlderInstalled(step: string, run: SetupRun): void {
  if (run.status !== 0) fail(step, `older installer exited ${run.status}`)
  assertNoRollback(step, run)
  const v = reg(uninstallKey, "DisplayVersion")
  if (v !== olderVersion) fail(step, `Add/Remove DisplayVersion is ${v ?? "absent"}, not ${olderVersion}`)
  else ok(`${step}: ${olderVersion} installed (today's layout — the upgrade source)`)
}

/** The `volt:` markers every install writes, in order (installer/Volt.iss [Code]; build-installer.ts refuses a build
 *  that lost one): what the run is, the processes it stopped by path, the PATH entry read back. The upgrade from the
 *  app-<version> layout (step 2) also logs what it migrated, between the two. */
const installMarkers = (migrated: boolean): string[] =>
  ["volt: install ", "volt: stopped ", ...(migrated ? ["volt: migrate removed "] : []), "volt: PATH carries "]
/** The uninstaller's: what the run is (before its CLI wait), the processes it stopped, the PATH entry removed. */
const uninstallMarkers = ["volt: uninstall ", "volt: stopped ", "volt: PATH no longer carries "]

/** THE assertion: the whole install agrees with itself and with the design's layout, exactly. */
async function assertInstalled(step: string, run: SetupRun, broadcast: boolean, migrated = false): Promise<void> {
  if (run.status !== 0) fail(step, `installer exited ${run.status}`)
  assertNoRollback(step, run)

  // The version oracle: what Inno recorded, which must be what this setup carries.
  const claimed = reg(uninstallKey, "DisplayVersion")
  if (claimed !== newVersion) fail(step, `Add/Remove DisplayVersion is ${claimed ?? "absent"}, not ${newVersion}`)
  if (reg(uninstallKey, "UninstallString") === null) fail(step, "Add/Remove entry has no UninstallString")
  if (!existsSync(uninstaller)) fail(step, "unins000.exe missing")

  // Flat: no versioned dir, no junction, no sideloaded extension.
  const top = existsSync(installDir) ? readdirSync(installDir) : []
  const versioned = top.filter((n) => /^app-/i.test(n))
  if (versioned.length > 0) fail(step, `versioned dir(s) present: ${versioned.join(", ")} (the layout is flat)`)
  if (top.some((n) => n.toLowerCase() === "current")) fail(step, `${join(installDir, "current")} present (no junction in the flat layout)`)
  const vsix = existsSync(installDir) ? readdirSync(installDir, { recursive: true, encoding: "utf8" }).filter((f) => f.toLowerCase().endsWith(".vsix")) : []
  if (vsix.length > 0) fail(step, `.vsix in the install: ${vsix.join(", ")} (the extension ships from the Marketplace)`)

  // Every stamped binary measures the claimed version.
  const missing = stamped.filter((f) => !existsSync(f))
  for (const f of missing) fail(step, `${f.replace(installDir, "{app}")} missing`)
  const stale = stamped.filter(existsSync).map((f) => [f.replace(installDir, "{app}"), fileVersion(f)] as const).filter(([, v]) => v !== newVersion)
  if (stale.length > 0) fail(step, `binary(ies) not at ${newVersion}: ${stale.map(([n, v]) => `${n}=${v ?? "none"}`).join(", ")}`)
  else if (missing.length === 0) ok(`${step}: all ${stamped.length} stamped binaries report ${newVersion}`)
  // The LSP is bun-compiled — no PE FileVersion; ask it (a "(dev)" means the compile-time define did not land).
  if (!existsSync(lspExe)) fail(step, "{app}\\bin\\volt-lsp-iec.exe missing")
  else {
    const lspv = (spawnSync(lspExe, ["--version"], { encoding: "utf8", timeout: 30_000 }).stdout ?? "").trim()
    if (!lspv.includes(newVersion)) fail(step, `volt-lsp-iec --version says "${lspv}", not ${newVersion}`)
    else ok(`${step}: volt-lsp-iec reports ${newVersion}`)
  }
  // Only the CLI and the LSP on PATH — not the 198-file runtime the CLI used to drag along.
  const bin = existsSync(binDir) ? readdirSync(binDir).map((n) => n.toLowerCase()).sort() : []
  if (bin.join("|") !== binExpected.join("|")) fail(step, `{app}\\bin holds [${bin.slice(0, 8).join(", ")}${bin.length > 8 ? `, … ${bin.length} total` : ""}], not exactly [${binExpected.join(", ")}]`)

  // PATH: the exact entry, once; nothing else under {app}; every other entry exactly as it was.
  const entries = userPathEntries()
  const ours = entries.filter(underApp)
  const exact = ours.filter((e) => e.trim().toLowerCase() === binDir.toLowerCase())
  if (exact.length !== 1 || ours.length !== 1) fail(step, `user PATH must carry ${binDir} exactly once and nothing else under {app}; it carries [${ours.join("; ")}]`)
  else ok(`${step}: PATH carries ${binDir} exactly once`)
  if (entries.filter((e) => !underApp(e)).join(";") !== pathBaseline.join(";")) fail(step, "a non-Volt user PATH entry changed")
  if (broadcast) ok(`${step}: WM_SETTINGCHANGE("Environment") observed during setup`)
  else fail(step, `no WM_SETTINGCHANGE("Environment") reached a running window during setup — new shells will not see PATH until logon (ChangesEnvironment=yes)`)
  for (const name of retiredEnv) if (reg("HKCU\\Environment", name) !== null) fail(step, `${name} is set — Volt publishes PATH and nothing else`)

  // The shortcut and the login item: declared by the installer, exact.
  if (!existsSync(shortcut)) fail(step, `Start Menu shortcut missing: ${shortcut}`)
  else {
    const target = ps(`(New-Object -ComObject WScript.Shell).CreateShortcut(${q(shortcut)}).TargetPath`)
    if (target.toLowerCase() !== desktopExe.toLowerCase()) fail(step, `Volt.lnk targets "${target}", not ${desktopExe}`)
    else ok(`${step}: Volt.lnk → ${desktopExe}`)
  }
  const loginItem = reg(runKey, runValueName)
  if (loginItem !== runValueData) fail(step, `Run\\${runValueName} is ${loginItem === null ? "absent" : `"${loginItem}"`}, not "${runValueData}"`)
  else ok(`${step}: login item exact`)

  // The tray: nothing else notices if it silently fails to start, and it owns auto-update. Measured by the INSTALLED
  // exe's path — and first, because the connector is what publishes the Documents scripts below, at its startup.
  const trayUp = await waitFor(() => runningFrom(connectorExe), 15)
  if (!trayUp) fail(step, `the connector (tray) is not running from ${connectorExe}`)
  else ok(`${step}: tray running from ${connectorExe}`)

  // The CODESYS scripts the user runs, and the DLL found without VOLT_BRIDGE_DLL: the visible Documents copy has
  // no DLL beside it, so it resolves through its `_INSTALL_SUBDIR` — the gate reads that from the INSTALLED script
  // and requires the DLL there. (The live proof is the CODESYS e2e through the shipped script, task 2.4.) The
  // connector publishes them at startup, so they are polled; and each must be byte-identical to THIS install's
  // `{app}\codesys` copy — an older build's script left in Documents would otherwise pass for this one.
  const codesysDir = join(installDir, "codesys")
  const scriptState = (s: string): string => {
    const shipped = join(codesysDir, s)
    const published = join(documentsVolt, s)
    if (!existsSync(shipped)) return `${shipped.replace(installDir, "{app}")} missing`
    if (!existsSync(published)) return `${published} missing`
    return readFileSync(published).equals(readFileSync(shipped)) ? "" : `${published} differs from ${shipped.replace(installDir, "{app}")} (not this build's script)`
  }
  if (trayUp) await waitFor(() => codesysScripts.every((s) => scriptState(s) === ""), 15)
  const scriptProblems = codesysScripts.map(scriptState).filter((m) => m !== "")
  for (const m of scriptProblems) fail(step, m)
  if (scriptProblems.length === 0) ok(`${step}: Documents\\Volt holds this build's ${codesysScripts.join(" + ")}`)
  const startScript = join(documentsVolt, "start_volt_codesys.py")
  if (scriptProblems.length === 0) {
    const sub = readFileSync(startScript, "utf8").match(/^_INSTALL_SUBDIR\s*=\s*\(([^)]*)\)/m)?.[1]
    const parts = sub ? [...sub.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? "") : []
    if (parts.length === 0) fail(step, `${startScript} declares no _INSTALL_SUBDIR — the Documents copy cannot find the bridge DLL`)
    else {
      const dll = join(process.env.LOCALAPPDATA!, ...parts, bridgeDll)
      if (!existsSync(dll)) fail(step, `the installed start script resolves the bridge to ${dll}, which does not exist`)
      else ok(`${step}: bridge DLL resolves without VOLT_BRIDGE_DLL → ${dll}`)
    }
  }

  assertLog(step, "install-", run.mark, installMarkers(migrated))
}

/** After an uninstall NOTHING Volt wrote may remain, and nothing it did not write may have changed. */
async function assertClean(step: string, mark: LogMark, broadcast: boolean): Promise<void> {
  // A genuine leftover never disappears, so polling cannot mask one; it only waits out Inno's late deletes.
  let left: string[] = []
  await waitFor(() => {
    left = existsSync(installDir) ? readdirSync(installDir) : []
    return left.length === 0
  }, 15)
  if (left.length > 0) fail(step, `${left.length} leftover entr(ies) in ${installDir}: ${left.slice(0, 8).join(", ")}`)
  else ok(`${step}: install dir ${existsSync(installDir) ? "empty" : "gone"}`)
  if (reg(uninstallKey) !== null) fail(step, "Add/Remove entry still present")
  if (reg(runKey, runValueName) !== null) fail(step, "login item still present")
  if (existsSync(shortcut)) fail(step, "Start Menu shortcut still present")
  for (const s of codesysScripts) if (existsSync(join(documentsVolt, s))) fail(step, `${join(documentsVolt, s)} still present`)
  for (const name of retiredEnv) if (reg("HKCU\\Environment", name) !== null) fail(step, `${name} still set`)
  const entries = userPathEntries()
  if (entries.some(underApp)) fail(step, `user PATH still names {app}: ${entries.filter(underApp).join("; ")}`)
  if (entries.join(";") !== pathBaseline.join(";")) fail(step, "the user PATH is not exactly what it was before the run — uninstall touched another entry")
  else ok(`${step}: user PATH entries exactly as before the run`)
  const pathValue = userPathValue()
  if (pathValue !== pathValueBaseline)
    fail(step, `the user PATH value is not byte-identical to the run's start (existence, type, string): was ${pathValueBaseline}, now ${pathValue}`)
  else ok(`${step}: user PATH value byte-identical to the run's start (${pathValue.split(" ")[0]})`)
  if (broadcast) ok(`${step}: WM_SETTINGCHANGE("Environment") observed during uninstall`)
  else fail(step, `no WM_SETTINGCHANGE("Environment") during uninstall — running shells keep a dead PATH entry`)
  const running = voltProcesses.filter(imageRunning)
  if (running.length > 0) fail(step, `Volt process(es) still running after uninstall: ${running.join(", ")}`)
  assertLog(step, "uninstall-", mark, uninstallMarkers)
}

// ── the CLI that must never be killed ────────────────────────────────────────

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once("error", rej)
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      if (addr === null || typeof addr === "string") return rej(new Error("no TCP port bound"))
      s.close(() => res(addr.port))
    })
  })
}

/** A real, long-running `volt.exe`: `volt console --port <free>` serves until stopped (no test hook in the
 *  shipped binary). Null — failed by name — when the installed CLI is missing or will not stay up. */
async function startCli(step: string): Promise<ChildProcess | null> {
  if (!existsSync(cliExe)) {
    fail(step, `${cliExe} missing — cannot hold a CLI open for this step`)
    return null
  }
  // `--no-open`: without it every CLI step opens a browser tab on the machine running the gate.
  const child = spawn(cliExe, ["console", "--port", String(await freePort()), "--no-open"], { stdio: "ignore", windowsHide: true })
  await sleep(2000)
  if (child.exitCode !== null || child.pid === undefined || !pidAlive(child.pid)) {
    fail(step, `\`volt console\` exited at once (code ${child.exitCode}) — cannot hold a CLI open for this step`)
    return null
  }
  ok(`${step}: volt.exe alive (pid ${child.pid})`)
  return child
}
const stopCli = (cli: ChildProcess | null): void => {
  if (cli?.pid !== undefined && pidAlive(cli.pid)) spawnSync("taskkill", ["/PID", String(cli.pid), "/F"])
}
/** The NTFS id of every binary that exists. An id that cannot be read is failed by name — two unread ids would
 *  otherwise compare equal and "no binary replaced" would pass unmeasured. */
const snapshotIds = (step: string): Map<string, string> => {
  const ids = new Map<string, string>()
  for (const f of [...stamped, lspExe].filter(existsSync)) {
    const id = fileId(f)
    if (id === null) fail(step, `could not read the NTFS file id of ${f.replace(installDir, "{app}")} (fsutil file queryfileid failed) — replacement unmeasured`)
    else ids.set(f, id)
  }
  return ids
}
/** The wait on a running volt.exe, as the [Code] wait logs it (setup AND uninstaller): `volt: waiting for volt.exe …`
 *  when it starts waiting, `volt: gave up waiting for volt.exe …` when /VOLTWAIT runs out. Matched as these exact
 *  `volt:` markers, never a bare `volt.exe` anywhere — Inno's own file lines (`Dest filename: …\volt.exe`) name it
 *  on every run, so an abort for any other reason would pass. */
const waitingMarker = "volt: waiting for volt.exe"
const gaveUpMarker = "volt: gave up waiting for volt.exe"
const stoppedMarker = "volt: stopped "

// ── the flow ─────────────────────────────────────────────────────────────────

async function install(exe: string, step: string, extra: string[] = []): Promise<{ run: SetupRun; broadcast: boolean }> {
  const listener = await startBroadcastListener(step)
  const run = await runSetup(exe, step, extra)
  await sleep(500)
  return { run, broadcast: listener.stop() }
}
async function uninstall(step: string, extra: string[] = []): Promise<{ mark: LogMark; broadcast: boolean }> {
  const listener = await startBroadcastListener(step)
  const { mark } = await runUninstall(step, extra)
  await sleep(500)
  return { mark, broadcast: listener.stop() }
}

const steps: [string, () => Promise<void>][] = [
  ["1 install older", async () => {
    const { run } = await install(olderSetup, "1 install older")
    assertOlderInstalled("1 install older", run)
  }],
  ["2 update (upgrade + migration)", async () => {
    const { run, broadcast } = await install(setup, "2 update")
    await assertInstalled("2 update", run, broadcast, true)
  }],
  ["3 update again", async () => {
    const { run, broadcast } = await install(setup, "3 update again")
    await assertInstalled("3 update again", run, broadcast)
  }],
  ["4 update with the CLI alive (gives up)", async () => {
    const step = "4 CLI alive"
    const cli = await startCli(step)
    if (cli === null) return
    const before = snapshotIds(step)
    // "Untouched" is measured as the SAME pids: setup waits for the CLI before it stops anything — stopping first
    // killed connector\VoltBridgeTwincat.exe, the other end of the pipe a `volt push` to TwinCAT writes through,
    // and a setup that stopped and relaunched the tray would still pass a "tray running" check.
    const trayBefore = pidsFrom(connectorExe)
    if (trayBefore.length === 0) fail(step, `no connector running from ${connectorExe} before the update — "untouched" cannot be measured`)
    const run = await runSetup(setup, step, ["/VOLTWAIT=15"], 300)
    if (run.status === 0) fail(step, "setup exited 0 although volt.exe was running — it must give up (non-zero) after /VOLTWAIT")
    else ok(`${step}: setup gave up, exit ${run.status}`)
    if (!pidAlive(cli.pid!)) fail(step, "setup KILLED the running volt.exe — a live `volt push` would have died mid-write")
    else ok(`${step}: volt.exe survived`)
    const after = snapshotIds(step)
    const replaced = [...before].filter(([f, id]) => after.get(f) !== id).map(([f]) => f.replace(installDir, "{app}"))
    if (replaced.length > 0) fail(step, `setup replaced binaries although it gave up: ${replaced.join(", ")}`)
    else if (before.size > 0) ok(`${step}: no binary replaced (${before.size} NTFS file ids unchanged)`)
    const trayAfter = pidsFrom(connectorExe)
    const lost = trayBefore.filter((pid) => !trayAfter.includes(pid))
    if (lost.length > 0) fail(step, `the abandoned update stopped the tray (before: [${trayBefore.join(", ")}], after: [${trayAfter.join(", ")}]) — it stopped Volt's processes while volt.exe ran`)
    else ok(`${step}: tray untouched (pid ${trayBefore.join(", ")})`)
    const log = logSince("install-", run.mark)
    const text = log?.text ?? ""
    if (!text.includes(gaveUpMarker)) fail(step, `what this step wrote to the mirrored install log (${log?.files.join(", ") ?? "nothing"}) has no "${gaveUpMarker}" — nothing says setup gave up because of volt.exe`)
    else ok(`${step}: the log says setup gave up waiting for volt.exe`)
    if (text.includes(stoppedMarker)) fail(step, `the mirrored install log has "${stoppedMarker}" although setup gave up waiting for volt.exe — it stopped Volt's processes (the TwinCAT worker among them) while the CLI ran`)
    else ok(`${step}: nothing was stopped`)
    stopCli(cli)
  }],
  ["5 update with the CLI alive (waits, then completes)", async () => {
    const step = "5 CLI ends"
    const cli = await startCli(step)
    if (cli === null) return
    const listener = await startBroadcastListener(step)
    const run = await runSetup(setup, step, ["/VOLTWAIT=120"], 300, async (child) => {
      await sleep(5000)
      if (child.exitCode !== null) fail(step, `setup exited (${child.exitCode}) within 5 s instead of waiting for volt.exe`)
      if (!pidAlive(cli.pid!)) fail(step, "setup KILLED the running volt.exe instead of waiting for it")
      stopCli(cli)
    })
    await sleep(500)
    await assertInstalled(step, run, listener.stop())
    // Completing proves nothing about WAITING (a setup that ignored volt.exe completes too): the log must say it
    // waited, and must not say it gave up.
    const text = logSince("install-", run.mark)?.text ?? ""
    if (!text.includes(waitingMarker)) fail(step, `the mirrored install log has no "${waitingMarker}" — setup did not wait for the CLI`)
    else if (text.includes(gaveUpMarker)) fail(step, `the mirrored install log says "${gaveUpMarker}" although setup completed`)
    else ok(`${step}: the log says setup waited for volt.exe`)
    // Waiting is not enough: the stop must come AFTER it, or the TwinCAT worker died under the running CLI.
    if (text.indexOf(stoppedMarker) < text.indexOf(waitingMarker)) fail(step, `"${stoppedMarker}" is not after "${waitingMarker}" in the mirrored install log — setup stopped Volt's processes while volt.exe ran`)
    else ok(`${step}: Volt's processes were stopped only after the wait`)
  }],
  ["6 uninstall with the CLI alive (aborts)", async () => {
    const step = "6 uninstall, CLI alive"
    const cli = await startCli(step)
    if (cli === null) return
    // "Untouched" as in step 4: the SAME tray pids, and nothing stopped. A "tray running" check alone passes an
    // uninstaller that stops the tray and the TwinCAT worker under the running CLI and then relaunches the tray.
    const trayBefore = pidsFrom(connectorExe)
    if (trayBefore.length === 0) fail(step, `no connector running from ${connectorExe} before the uninstall — "untouched" cannot be measured`)
    const { mark, status } = await runUninstall(step, ["/VOLTWAIT=15"])
    if (status === 0) fail(step, "the uninstaller exited 0 although volt.exe was running — it must abort (non-zero) after /VOLTWAIT")
    else ok(`${step}: uninstaller aborted, exit ${status}`)
    const log = logSince("uninstall-", mark)
    const text = log?.text ?? ""
    if (!text.includes(gaveUpMarker)) fail(step, `what this step wrote to the mirrored uninstall log (${log?.files.join(", ") ?? "nothing"}) has no "${gaveUpMarker}" — nothing says the uninstall aborted because of volt.exe`)
    if (text.includes(stoppedMarker)) fail(step, `the mirrored uninstall log has "${stoppedMarker}" although the uninstall gave up waiting for volt.exe — it stopped Volt's processes (the TwinCAT worker among them) while the CLI ran`)
    else ok(`${step}: nothing was stopped`)
    const trayAfter = pidsFrom(connectorExe)
    const lost = trayBefore.filter((pid) => !trayAfter.includes(pid))
    if (lost.length > 0) fail(step, `the aborted uninstall stopped the tray (before: [${trayBefore.join(", ")}], after: [${trayAfter.join(", ")}]) — it stopped Volt's processes while volt.exe ran`)
    else ok(`${step}: tray untouched (pid ${trayBefore.join(", ")})`)
    if (!pidAlive(cli.pid!)) fail(step, "the uninstaller KILLED the running volt.exe")
    else ok(`${step}: volt.exe survived`)
    // Everything an uninstall takes away, the Documents scripts ([UninstallDelete]) included — an uninstaller that
    // removed anything, or stopped the tray, BEFORE its volt.exe wait would otherwise pass.
    const kept = [uninstaller, ...stamped, lspExe, shortcut, ...codesysScripts.map((s) => join(installDir, "codesys", s)), ...codesysScripts.map((s) => join(documentsVolt, s))]
    const removed = kept.filter((f) => !existsSync(f))
    if (removed.length > 0) fail(step, `the aborted uninstall removed: ${removed.join(", ")}`)
    else ok(`${step}: all ${kept.length} files still present`)
    if (!(await waitFor(() => runningFrom(connectorExe), 15))) fail(step, `the aborted uninstall left no connector running from ${connectorExe} — Volt is installed but without its tray`)
    else ok(`${step}: tray running from ${connectorExe}`)
    if (reg(uninstallKey) === null) fail(step, "the aborted uninstall removed the Add/Remove entry")
    if (reg(runKey, runValueName) === null) fail(step, "the aborted uninstall removed the login item")
    if (!userPathEntries().some((e) => e.trim().toLowerCase() === binDir.toLowerCase())) fail(step, "the aborted uninstall removed the PATH entry")
    stopCli(cli)
  }],
  ["7 uninstall", async () => {
    const { mark, broadcast } = await uninstall("7 uninstall")
    await assertClean("7 uninstall", mark, broadcast)
  }],
  ["8 fresh install", async () => {
    const { run, broadcast } = await install(setup, "8 fresh install")
    await assertInstalled("8 fresh install", run, broadcast)
  }],
  ["9 uninstall", async () => {
    const { mark, broadcast } = await uninstall("9 uninstall")
    await assertClean("9 uninstall", mark, broadcast)
  }],
  ["10 updater refuses an unverified download", async () => {
    const step = "10 verified update"
    const r = spawnSync(dotnet, ["test", "test/Volt.Connector.Tests/", "--filter", "FullyQualifiedName~UpdaterVerificationTests"], { cwd: join(repo, "packages", "volt-cli"), encoding: "utf8", timeout: 900_000 })
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    const total = Number(out.match(/Total:\s+(\d+)/)?.[1] ?? 0)
    if (r.status !== 0) fail(step, `UpdaterVerificationTests failed:\n${out.split("\n").filter((l) => /Failed|Error Message|^\s{3}\S/.test(l)).slice(0, 12).join("\n")}`)
    else if (total === 0) fail(step, "the UpdaterVerificationTests filter ran 0 tests — the gate proved nothing")
    else ok(`${step}: ${total} test(s) green`)
  }],
]

console.log(`• gate: ${setup} (${newVersion})\n  upgrading from: ${olderSetup} (${olderVersion})\n`)
try {
  for (const [name, run] of steps) {
    console.log(`── ${name} ──`)
    await run()
  }
} finally {
  // Give back the extension this release's uninstall stripped, from the Marketplace. Never an assertion.
  for (const [cli, had] of hadExtension) {
    if (!had || hasExtension(cli)) continue
    const r = spawnSync(cli, ["--install-extension", "volt-ai.volt-vscode"], { encoding: "utf8", shell: true })
    console.log(r.status === 0 ? `  ↺ ${cli}: Volt extension reinstalled from the Marketplace` : `  ↺ ${cli}: could not reinstall volt-ai.volt-vscode — reinstall it manually`)
  }
  rmSync(work, { recursive: true, force: true })
}

console.log(failures === 0 ? "\n✓ install gate clean at every step" : `\n✗ ${failures} problem(s) across the gate`)
process.exit(failures === 0 ? 0 : 1)
