/**
 * The SINGLE source of truth for the installer's on-disk contract — what `installer/Volt.iss` lays down and where —
 * shared by both install gates (`test-install.ts` smoke + `test-install-lifecycle.ts`).
 *
 * Why this file exists: the two gates each carried their own copy of this knowledge, and they drifted. When the
 * installer moved the payload under a `{app}\current` junction (over versioned `app-<ver>` dirs), the lifecycle gate
 * was updated but the smoke gate was not — it kept checking the old flat `{app}\<file>` paths. Nothing caught it,
 * because the install gates run ONLY on a stable release and none had ever been cut, so the first stable cut failed
 * on paths that had been wrong for months. One definition both import means that can't recur: change the layout
 * here, both gates follow.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve, join } from "node:path"

const repo = resolve(import.meta.dirname, "..")

// {app} — Inno's DefaultDirName (a per-user install) — and the `unins000.exe` Inno drops there. Inno owns these
// regardless of how the payload is arranged inside.
export const installDir = join(process.env.LOCALAPPDATA!, "Programs", "Volt")
export const uninstaller = join(installDir, "unins000.exe")

// The junction EVERY published path resolves through — PATH, OPENCODE_CONFIG_DIR, the shortcut. The payload lives
// under a versioned `app-<version>` dir that `current` points at, so the whole install is inspected THROUGH this:
// a version dir can exist and still be unreachable if `current` is missing/stale, and that is the one failure that
// makes an otherwise-perfect install resolve to nothing. Never record a VERSIONED path anywhere outside {app} — it
// must go through `current`, or every update has to rewrite HKCU (a registry race for a file-lock one).
export const currentDir = join(installDir, "current")

// Inno's per-user uninstall subkey is {AppId}_is1 — read AppId from the .iss so this can't drift from the installer.
export const appId = readFileSync(resolve(repo, "installer/Volt.iss"), "utf8").match(/AppId=\{\{([0-9A-Fa-f-]+)\}/)?.[1]
export const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${appId}}_is1`

export const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"

/**
 * `reg query`. With a value NAME, returns the VALUE (its data may itself contain spaces) — not `reg query`'s raw
 * multi-line dump, which was survivable for `includes("volt")` checks but silently wrong the moment a check needed
 * the value itself (e.g. to resolve a path). Without a name, returns the raw stdout (non-null iff the key exists),
 * so `reg(key) != null` is a presence check. Null when absent.
 */
export function reg(key: string, value?: string): string | null {
  const r = spawnSync("reg", ["query", key, ...(value ? ["/v", value] : [])], { encoding: "utf8" })
  if (r.status !== 0) return null
  if (!value) return r.stdout
  const line = (r.stdout ?? "").split("\n").find((l) => new RegExp(`^\\s+${value}\\s+REG_`, "i").test(l))
  return line ? line.replace(new RegExp(`^\\s+${value}\\s+REG_\\w+\\s+`, "i"), "").trim() : null
}

/** Is <dir> one of the persisted user PATH ENTRIES? Exact per-entry match — a substring test would let a superstring
 *  (…\Volt\current\bin-old) or a partial path spuriously pass. */
export function pathHasEntry(dir: string): boolean {
  return (reg("HKCU\\Environment", "Path") ?? "").split(";").some((e) => e.trim().toLowerCase() === dir.toLowerCase())
}
