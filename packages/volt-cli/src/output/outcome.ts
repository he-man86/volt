import type { PullResult } from "../commands/pull.js"
import type { PushResult } from "../commands/push.js"

/**
 * How a command outcome should reach the outside world: an exit code plus
 * optional stdout/stderr text. Pure (returns the emission instead of touching
 * process globals) so it's trivially testable; `bin.ts` applies it.
 *
 * The CLI is the single source of truth for "command → outcome" — consumed by
 * BOTH the terminal user (human text + exit code) and the VS Code extension
 * (`--json` on stdout). Before this, `bin.ts` discarded pull/push results, so a
 * conflict/refused/rejected exited 0 and printed nothing — the extension then
 * reported success. This routes every outcome through one honest contract.
 *
 * Exit codes: 0 = ok, 2 = needs attention (refused / conflict / rejected),
 * matching the existing CliError exitCode() convention. `--json` still reflects
 * the exit code; consumers branch on the JSON `kind` and must read stdout even
 * on a non-zero exit.
 */
export interface Emission {
	exitCode: number
	stdout?: string
	stderr?: string
}

/** Conflict paths are snapshot-tree-relative (src/ is the tree root); show the
 *  real on-disk path so the user can open the marked files directly. */
function conflictMessage(paths: readonly string[]): string {
	const list = paths.map((p) => `  - src/${p}`).join("\n")
	return (
		`volt: pull produced ${paths.length} conflict(s):\n${list}\n` +
		"  hint: resolve the <<<<<<< markers in those files, then run `volt merge --continue` " +
		"(or `volt merge --abort` to back out)\n"
	)
}

export function renderPull(result: PullResult, json: boolean): Emission {
	if (json) {
		return { exitCode: result.kind === "ok" ? 0 : 2, stdout: `${JSON.stringify(result)}\n` }
	}
	switch (result.kind) {
		case "ok":
			// The success summary is already printed by the command itself.
			return { exitCode: 0 }
		case "refused":
			// reason is already a complete, hint-bearing message.
			return { exitCode: 2, stderr: `volt: ${result.reason}\n` }
		case "conflict":
			return { exitCode: 2, stderr: conflictMessage(result.paths) }
	}
}

export function renderPush(result: PushResult, json: boolean): Emission {
	if (json) {
		return { exitCode: result.kind === "ok" ? 0 : 2, stdout: `${JSON.stringify(result)}\n` }
	}
	switch (result.kind) {
		case "ok":
			return { exitCode: 0 }
		case "rejected":
			return { exitCode: 2, stderr: `volt: ${result.reason}\n` }
	}
}

/** Apply an emission to the current process (used by bin.ts). */
export function applyEmission(e: Emission): void {
	if (e.stdout !== undefined) process.stdout.write(e.stdout)
	if (e.stderr !== undefined) process.stderr.write(e.stderr)
	process.exitCode = e.exitCode
}
