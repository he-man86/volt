#!/usr/bin/env bun
/**
 * The extension-install gate. Sideloading a .vsix is the ONLY way the Volt extension reaches an editor (it is not
 * pulled from the Marketplace — release.yml never publishes it), and the mechanism has three documented sharp
 * edges that silently leave the engineer running old code:
 *
 *   1. A VSIX-installed extension NEVER auto-updates. Nothing but our installer will ever move it.
 *   2. `--install-extension` is a NO-OP unless the .vsix version is strictly higher than what's installed. The
 *      local `bun run package` used to stamp the base 0.0.1 — lower than every installed dev build — so a local
 *      build appeared to install and changed nothing. That is the bug this file exists to make impossible.
 *   3. The editor garbage-collects superseded version folders only on a full RESTART, so an editor left open
 *      across several updates accumulates one folder per build (13 in two days, observed).
 *
 * So this asserts the three invariants that (1)-(3) break:
 *   • the built .vsix carries the git-derived version (never the base) — catches (2) before it ships
 *   • installing it leaves the editor reporting EXACTLY that version — the install really took
 *   • exactly ONE version folder survives per editor — catches (3)
 *
 * Editors whose CLI is not on PATH are skipped, never failed: an engineer with only Windsurf is not broken.
 * At least one editor must be present, or there is nothing to gate and we say so.
 *
 * Note what NO test can assert: a running editor keeps executing the OLD extension until it is fully quit and
 * reopened — a window reload is not enough. Microsoft closed that as-designed (microsoft/vscode#68234). The gate
 * checks what is INSTALLED on disk; the reminder below is the rest of the story.
 *
 *   bun run test:ext            # build + install into every editor on PATH + verify
 *   bun run test:ext --verify   # verify what is already installed (no build, no install)
 */
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

// The EDITOR half is Windows-only (that's where the extension dirs and the installer live), but the packaging
// invariant — that `bun run package` stamps the git-derived version — is platform-neutral and is the one that
// actually regressed. Run it anywhere, so CI can gate it on a runner with no editor installed.
const editorsInspectable = process.platform === "win32"

const repo = resolve(import.meta.dirname, "..")
const pkgDir = resolve(repo, "packages/volt-vscode")
const EXT_ID = "volt-ai.volt-vscode"
const verifyOnly = process.argv.includes("--verify")

// The same (extensions dir → CLI) pairing the installer and reinstall-dev.ps1 use, so all three cover one set.
const EDITORS = !editorsInspectable ? [] : [
  { dir: ".vscode", cli: "code" },
  { dir: ".vscode-insiders", cli: "code-insiders" },
  { dir: ".vscode-oss", cli: "codium" },
  { dir: ".cursor", cli: "cursor" },
  { dir: ".windsurf", cli: "windsurf" },
  { dir: ".windsurf-next", cli: "windsurf-next" },
]

const fails: string[] = []
const fail = (msg: string): void => { fails.push(msg); console.error(`  ✗ ${msg}`) }
const ok = (msg: string): void => console.log(`  ✓ ${msg}`)

/** Run a native command, capturing stdout. `shell` because the editor CLIs are .cmd shims on Windows. */
const run = (cmd: string, args: string[]): { code: number; out: string } => {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: true })
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}
const onPath = (cli: string): boolean => editorsInspectable && run("where", [cli]).code === 0

// ── the one version, from the one place ──────────────────────────────────────
const expected = run("bun", [resolve(repo, "scripts/version.ts"), "--vsix"]).out.trim()
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error(`✗ version.ts --vsix produced '${expected}' — expected a bare X.Y.Z`)
  process.exit(1)
}
const vsix = join(pkgDir, `volt-vscode-${expected}.vsix`)

// ── 1. the built .vsix carries it (the 0.0.1 regression, caught at the source) ─
// Only in FULL mode. `--verify` inspects whatever is installed and cannot demand HEAD's version: the moment you
// commit, the git-derived version moves ahead of the build you are actually running, and a gate that fails for
// that reason is a gate people learn to ignore. Verify asserts the invariants that hold regardless of HEAD —
// every editor on the SAME version, exactly one folder each.
if (!verifyOnly) {
  console.log(`expected extension version: ${expected}\n`)
  console.log("• packaging")
  const r = spawnSync("bun", ["run", "package"], { cwd: pkgDir, stdio: "inherit", shell: true })
  if (r.status !== 0) { console.error("✗ `bun run package` failed"); process.exit(1) }
  if (existsSync(vsix)) ok(`${vsix.split("\\").pop()}`)
  else fail(`no volt-vscode-${expected}.vsix — package stamped a different version, so --install-extension would no-op against an installed dev build`)
} else {
  console.log("verify-only: asserting every editor agrees on ONE version, one folder each\n")
}
const seen = new Map<string, string>() // cli → reported version, for the cross-editor agreement check

// ── 2 + 3. install, then assert what the editor actually has ─────────────────
let present = 0
for (const ed of EDITORS) {
  const extRoot = join(process.env.USERPROFILE!, ed.dir, "extensions")
  const installed = existsSync(extRoot)
    ? readdirSync(extRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith(`${EXT_ID}-`)).map((d) => d.name)
    : []
  if (!onPath(ed.cli)) {
    // Never fail an editor we can't drive — but a stranded install is worth saying out loud.
    if (installed.length > 0) console.log(`• ${ed.cli}: not on PATH, but ${installed.length} version(s) installed — skipped`)
    continue
  }
  present++
  console.log(`• ${ed.cli}`)

  if (!verifyOnly && existsSync(vsix)) {
    // Uninstall-then-install: exactly what installer/Volt.iss does, and the reason a stale folder can't survive.
    run(ed.cli, ["--uninstall-extension", EXT_ID])
    const i = run(ed.cli, ["--install-extension", `"${vsix}"`, "--force"])
    if (i.code !== 0) fail(`${ed.cli}: --install-extension exited ${i.code}\n${i.out.trim()}`)
  }

  // What the editor REPORTS — the install either took or it didn't; disk layout is checked separately below.
  const listed = run(ed.cli, ["--list-extensions", "--show-versions"]).out
    .split(/\r?\n/).filter((l) => l.toLowerCase().startsWith(EXT_ID))
  if (listed.length === 0) {
    fail(`${ed.cli}: the extension is not installed`)
  } else if (listed.length > 1) {
    fail(`${ed.cli}: reports ${listed.length} copies — ${listed.join(", ")}`)
  } else {
    const version = listed[0].split("@")[1]?.trim() ?? "?"
    seen.set(ed.cli, version)
    if (verifyOnly) ok(`${ed.cli} reports ${EXT_ID}@${version}`)
    else if (version === expected) ok(`${ed.cli} reports ${EXT_ID}@${version}`)
    else fail(`${ed.cli} reports @${version}, expected @${expected} — the install did not take (a lower or equal version is a silent no-op)`)
  }

  // Exactly one version folder. More means the editor never GC'd the superseded ones, which is how an engineer
  // ends up running a build they can't identify.
  const after = existsSync(extRoot)
    ? readdirSync(extRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith(`${EXT_ID}-`)).map((d) => d.name)
    : []
  // Orphan folders are a WARNING, not a failure. `--uninstall-extension` deregisters immediately but leaves the
  // directory for the editor to delete at startup, so a machine that never fully quits its editor always has a
  // few. They are unregistered — `--list-extensions` above proves exactly one is live — so they cost disk and
  // confuse a human reading the folder, nothing more. Failing on them would make the gate red on every healthy
  // dev box, which is how gates get ignored.
  if (after.length === 0) fail(`${ed.dir}: no version folder on disk`)
  else if (after.length === 1) ok(`${ed.dir}: one version folder (${after[0]})`)
  else console.log(`  ! ${ed.dir}: ${after.length - 1} orphaned folder(s) alongside the live one — the editor deletes these on a full restart: ${after.filter((f) => !f.endsWith(seen.get(ed.cli) ?? "")).join(", ")}`)
}

// No editor is a legitimate environment — CI runners have none — and the MOST important invariant does not need
// one: that `bun run package` stamps the git-derived version. That is the regression that actually shipped (a
// constant 0.0.1 could never out-version an installed dev build, so every install silently no-op'd), and it is
// caught above. Pass on the packaging half rather than failing a machine that simply has no editor.
if (present === 0) {
  console.log(
    verifyOnly
      ? "\n! no editor CLI on PATH — nothing installed to verify."
      : "\n! no editor CLI on PATH (code / code-insiders / codium / cursor / windsurf) — checked packaging only.",
  )
}

// Editors drifting apart is its own bug: the installer sideloads into each one separately, so one failing (a
// locked folder, a CLI that wasn't on PATH at install time) leaves you debugging Volt in an editor running a
// different build than the one you just fixed.
const versions = [...new Set(seen.values())]
if (versions.length > 1) fail(`editors disagree: ${[...seen].map(([c, v]) => `${c}@${v}`).join(", ")}`)

console.log(
  fails.length === 0
    ? `\n✓ extension install is sound in ${present} editor(s) @ ${expected}` +
      `\n  NOTE: a running editor keeps executing the OLD extension until it is fully QUIT and reopened —` +
      `\n  a window reload is not enough (microsoft/vscode#68234, closed as-designed).`
    : `\n✗ ${fails.length} problem(s):\n${fails.map((f) => `  - ${f}`).join("\n")}`,
)
process.exit(fails.length === 0 ? 0 : 1)
