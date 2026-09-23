/**
 * `bun run console` — build the CLI and serve the interface console.
 *
 * <p>Two things this exists to stop, both of which have actually happened in this repo:</p>
 *
 * <p>THE WRONG DOTNET. `dotnet` on PATH is not necessarily one with an SDK — on the primary dev machine it
 * resolves to `C:\Program Files (x86)\dotnet\dotnet.exe`, which has none at all, so a script that shells out
 * to a bare `dotnet` fails with a message about nothing in particular. The probe below is the same one
 * `build-cli.ps1` already uses: try each candidate, ASK it for its SDKs, take the first that has the major
 * this toolchain needs.</p>
 *
 * <p>A STALE BINARY. `dist/Cli/volt.exe` is a shipped build that can be months old, and pointing a browser at
 * a console served by one is how you get a page that disagrees with the bridge it is describing. The e2e
 * suite drove exactly that binary for weeks because its candidate list named a framework version that had
 * moved on. Building first makes staleness unrepresentable rather than merely unlikely.</p>
 *
 * Args are passed through: `bun run console -- --allow-write --port 9000`.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const SDK_MAJOR = 10
const ROOT = resolve(import.meta.dir, "..")

function dotnetWithSdk(): string {
	const candidates = [
		"dotnet",
		join(homedir(), ".dotnet", "dotnet.exe"),
		"C:/Program Files/dotnet/dotnet.exe",   // forward slashes: Windows accepts them and no shell can eat them
	]
	for (const exe of candidates) {
		const r = spawnSync(exe, ["--list-sdks"], { encoding: "utf8" })
		if (r.status !== 0 || !r.stdout) continue
		const majors = r.stdout.split("\n").map((l) => Number.parseInt(l, 10))
		if (majors.some((m) => m >= SDK_MAJOR)) return exe
	}
	console.error(
		`no dotnet with a .NET ${SDK_MAJOR} SDK found — install it (winget install Microsoft.DotNet.SDK.${SDK_MAJOR}).\n` +
			`(a 'dotnet' on PATH is not enough: this machine's resolves to an x86 install with no SDKs at all)`,
	)
	process.exit(1)
}

const dotnet = dotnetWithSdk()

const build = spawnSync(dotnet, ["build", join(ROOT, "src", "Volt.Cli"), "-c", "Release", "--nologo", "-v", "q"], {
	stdio: "inherit",
})
if (build.status !== 0) process.exit(build.status ?? 1)

const exe = join(ROOT, "src", "Volt.Cli", "bin", "Release", `net${SDK_MAJOR}.0`, "volt.exe")
if (!existsSync(exe)) {
	console.error(`built, but no volt.exe at ${exe} — did the target framework move?`)
	process.exit(1)
}

// Forward everything after `--`, so `--allow-write` and `--port` reach the console rather than this script.
const run = spawnSync(exe, ["console", ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(run.status ?? 0)
