/** The CLI binary an e2e drives: the NEWEST `volt.exe` built under `src/Volt.Cli/bin` (and, unless told otherwise,
 *  `dist/Cli`). A pinned path once named a months-old binary, and the suite failed `volt init` for a reason that had
 *  nothing to do with the code under test; walking the build output has no version in it to go stale. */
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const CLI_ROOT = resolve(import.meta.dir, "..", "..", "..")

function exesUnder(dir: string): string[] {
	if (!existsSync(dir)) return []
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? exesUnder(join(dir, e.name)) : e.name === "volt.exe" ? [join(dir, e.name)] : [],
	)
}

export function newestBuiltCli(opts: { dist?: boolean } = {}): string | undefined {
	const dirs = [join(CLI_ROOT, "src", "Volt.Cli", "bin"), ...(opts.dist === false ? [] : [join(CLI_ROOT, "dist", "Cli")])]
	return dirs.flatMap(exesUnder).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}
