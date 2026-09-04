/**
 * Refresh test-corpus/<name> via the REAL `volt` CLI — dogfoods `volt pull` instead of hand-rolling the
 * fetch+write (which produced a byte-identical tree; verified against `volt init` src/). `volt init` in a
 * throwaway temp dir does the pull + materialization, then its `src/` tree is swapped in — pull first,
 * replace last, so a failure anywhere leaves the existing corpus exactly as it was.
 *
 * The bridge must already serve the project (headless launcher, or your live IDE):
 *   pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up -Project <path>     # or a running IDE + connector
 *   bun run refresh:corpus <name> [codesys|twincat]
 *
 * The recorded build oracle (expected-build.<vendor>.json) is captured SEPARATELY (record-corpus-build.ts)
 * and preserved across the swap. Re-record it when a project's source changes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const name = process.argv[2]
const vendor = process.argv[3] ?? "codesys"
if (!name) {
	console.error("usage: bun run refresh:corpus <name> [codesys|twincat]")
	process.exit(1)
}

const VOLT = join(import.meta.dir, "..", "..", "volt-cli", "src", "Volt.Cli", "bin", "Release", "net8.0", "volt.exe")
const corpus = join(import.meta.dir, "..", "test-corpus", name)

// A temp dir OUTSIDE the repo (a `volt init` here would nest a .git inside the monorepo).
const tmp = mkdtempSync(join(tmpdir(), "volt-corpus-"))
execFileSync(VOLT, ["init", "--vendor", vendor], { cwd: tmp, stdio: "inherit" })

// `volt init` creates the workspace in a subdirectory NAMED AFTER THE PROJECT (that folder is the git repo
// root), so the materialized tree is `<tmp>/<ProjectName>/src` — not `<tmp>/src`, which is what this script
// assumed until the tree it produced stopped existing. Read the name off disk rather than deriving it from
// the corpus folder: the two need not match (`test-corpus/pro2193` comes from `Pro2193-94-95-96_COdesys`).
const created = readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isDirectory())
if (created.length !== 1)
	throw new Error(`expected \`volt init\` to create exactly one workspace dir in ${tmp}, found ${created.length}`)
const workspace = join(tmp, created[0]!.name)
const pulled = join(workspace, "src")
if (!existsSync(pulled)) throw new Error(`no materialized tree at ${pulled} — did the pull fail?`)

// Preserve the recorded build oracle — it's ground truth, not harvested — by staging it INTO the pulled tree
// so that tree is the complete final corpus before anything existing is touched.
if (existsSync(corpus))
	for (const f of readdirSync(corpus).filter((f) => f.startsWith("expected-build.")))
		writeFileSync(join(pulled, f), readFileSync(join(corpus, f)))

/**
 * Swap the staged tree in LAST, and never destroy the old one before the new one is in place.
 *
 * This used to `rmSync(corpus)` and then copy. On Windows that is a live grenade: `rmSync` deletes the
 * contents and only then fails to remove the directory itself if anything holds a handle on it (an indexer, a
 * shell sitting in the folder, an editor). The corpus was left DELETED and the refresh reported failure — 616
 * files gone, recoverable only because they happened to be committed.
 *
 * Renaming first means a lock costs nothing: the rename throws with the corpus untouched. Only once the new
 * tree is in place is the old one removed, and if that removal is the thing that fails, the refresh has still
 * succeeded — a leftover directory is a mess, not a loss.
 */
const backup = `${corpus}.replaced-${process.pid}`
if (existsSync(corpus)) rename(corpus, backup, "the corpus is in use — close anything reading it and retry")
try {
	moveInto(pulled, corpus)
} catch (err) {
	if (existsSync(backup)) renameSync(backup, corpus) // put it back exactly as it was
	throw err
}
try {
	rmSync(backup, { recursive: true, force: true })
} catch {
	console.warn(`note: could not remove ${backup} — delete it by hand; the refresh itself succeeded.`)
}
rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
console.log(`refreshed test-corpus/${name} via volt pull (${vendor})`)

/** `renameSync` with a short retry — Windows file locks are usually a passing indexer, not a real conflict. */
function rename(from: string, to: string, what: string): void {
	for (let attempt = 1; ; attempt++) {
		try {
			renameSync(from, to)
			return
		} catch (err) {
			if (attempt === 5) throw new Error(`${what}: ${String(err)}`)
			Bun.sleepSync(200)
		}
	}
}

/**
 * Move the staged tree into place. A rename is preferred — it is one operation, so the corpus is never
 * half-written — but `%TEMP%` need not be on the repo's volume, and a cross-device rename is `EXDEV` rather
 * than something a retry fixes. Copy then, which is slower and still safe: the old tree is already renamed
 * aside, so a failure mid-copy restores it rather than losing it.
 */
function moveInto(from: string, to: string): void {
	try {
		renameSync(from, to)
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err
		cpSync(from, to, { recursive: true })
	}
}
