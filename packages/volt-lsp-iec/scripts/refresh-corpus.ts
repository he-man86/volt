/**
 * Refresh test-corpus/<name> via the REAL `volt` CLI — dogfoods `volt pull` instead of hand-rolling the
 * fetch+write (which produced a byte-identical tree; verified against `volt init` src/). `volt init` in a
 * throwaway temp dir does the pull + materialization, then its `src/` tree replaces the corpus folder.
 *
 * The bridge must already serve the project (headless launcher, or your live IDE):
 *   pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up -Project <path>     # or a running IDE + connector
 *   bun run refresh:corpus <name> [codesys|twincat]
 *
 * The recorded build oracle (expected-build.<vendor>.json) is captured SEPARATELY (record-corpus-build.ts)
 * and preserved across the swap. Re-record it when a project's source changes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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

// Preserve the recorded build oracle across the swap — it's ground truth, not harvested.
const oracles = existsSync(corpus)
	? readdirSync(corpus)
			.filter((f) => f.startsWith("expected-build."))
			.map((f) => [f, readFileSync(join(corpus, f))] as const)
	: []
rmSync(corpus, { recursive: true, force: true })
cpSync(join(tmp, "src"), corpus, { recursive: true })
for (const [f, data] of oracles) writeFileSync(join(corpus, f), data)
rmSync(tmp, { recursive: true, force: true })
console.log(`refreshed test-corpus/${name} via volt pull (${vendor})`)
