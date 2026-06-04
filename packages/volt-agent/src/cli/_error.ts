/**
 * VoltError — structured CLI errors that always carry user-facing
 * information instead of leaking raw command output.
 *
 * Every error a user sees from the `volt` CLI should be a VoltError, so
 * the rendering is consistent: one line describing what failed, one
 * line of context, and a one-line hint telling the user what to do
 * about it. Underlying `git`, `bun`, or bridge errors get wrapped at
 * the engine boundary — they never reach the user verbatim.
 *
 * Use `wrap()` when re-throwing a caught error so the original cause is
 * preserved (printed only with `--debug` or when `VOLT_DEBUG=1`).
 */

export interface VoltErrorOpts {
	/** One-line summary, plain English. e.g. "could not pull from bridge". */
	what: string;
	/** Optional context — paths, refs, what we were doing when it failed. */
	why?: string;
	/** The concrete next action the user can take. */
	hint?: string;
	/** Exit code. Defaults to 1. Use 2 for "expected refusal" (drift, merge conflict). */
	exitCode?: number;
	/** Underlying error chain — surfaced only in debug mode. */
	cause?: unknown;
}

export class VoltError extends Error {
	readonly what: string;
	readonly why: string | undefined;
	readonly hint: string | undefined;
	readonly exitCode: number;
	readonly cause: unknown;

	constructor(opts: VoltErrorOpts) {
		super(opts.what);
		this.name = "VoltError";
		this.what = opts.what;
		this.why = opts.why;
		this.hint = opts.hint;
		this.exitCode = opts.exitCode ?? 1;
		this.cause = opts.cause;
	}

	/** Wrap a caught error in a VoltError, preserving the original as `cause`. */
	static wrap(err: unknown, opts: Omit<VoltErrorOpts, "cause">): VoltError {
		return new VoltError({ ...opts, cause: err });
	}
}

/** True iff the value is a VoltError instance. */
export function isVoltError(err: unknown): err is VoltError {
	return err instanceof VoltError;
}

/**
 * Render a VoltError for stderr. Intentionally plain ASCII — runs cleanly
 * in PowerShell, cmd.exe, git-bash, and CI logs without garbled escapes.
 *
 * Format:
 *   volt: <what>
 *         <why>
 *     hint: <hint>
 */
export function formatVoltError(err: VoltError, debug = false): string {
	const lines: string[] = [];
	lines.push(`volt: ${err.what}`);
	if (err.why !== undefined && err.why.length > 0) {
		// Indent multi-line `why` consistently.
		for (const line of err.why.split("\n")) {
			lines.push(`      ${line}`);
		}
	}
	if (err.hint !== undefined && err.hint.length > 0) {
		lines.push(`  hint: ${err.hint}`);
	}
	if (debug && err.cause !== undefined) {
		const causeStr = err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : String(err.cause);
		lines.push(`  cause:`);
		for (const line of causeStr.split("\n")) {
			lines.push(`    ${line}`);
		}
	}
	return lines.join("\n") + "\n";
}

/** True iff debug rendering should be enabled (env or flag). */
export function isDebugMode(flags: Record<string, string | boolean> | undefined): boolean {
	if (process.env.VOLT_DEBUG !== undefined && process.env.VOLT_DEBUG !== "" && process.env.VOLT_DEBUG !== "0") {
		return true;
	}
	if (flags !== undefined && flags["debug"] === true) return true;
	return false;
}

/**
 * Wrap a GitCmdError (or any other low-level engine error) into a
 * VoltError that explains what the user can do about it. Pattern-matches
 * common git failure modes — "invalid object", "not a git repository",
 * "object file is empty" — and provides a targeted hint. Unknown shapes
 * get a generic "snapshot may be corrupt" hint that points at the
 * universal recovery path.
 *
 * `operation` is the high-level thing the user was trying to do, e.g.
 * "pull", "push", "build the workspace tree". It becomes the `what` of
 * the VoltError so the user sees the operation name, not "git write-tree".
 */
export function wrapEngineError(err: unknown, operation: string): VoltError {
	if (!(err instanceof Error)) {
		return new VoltError({
			what: `${operation} failed`,
			why: String(err),
			hint: "run with --debug for a full trace, or check that the bridge is reachable",
			cause: err,
		});
	}
	const isGit = err.name === "GitCmdError";
	const msg = err.message;

	// Common corruption pattern — surface the universal recovery hint.
	if (isGit && /invalid object|object file is empty|loose object .* is corrupt|not a tree/i.test(msg)) {
		return new VoltError({
			what: `${operation} failed — snapshot is corrupt`,
			why: `the local .volt/snapshot/ bare repo has an unreadable or missing git object:\n${msg}`,
			hint: "delete .volt/snapshot/ and run `volt pull --force` to rebuild from the bridge — your workspace files are not touched",
			cause: err,
		});
	}

	if (isGit && /not a git repository/i.test(msg)) {
		return new VoltError({
			what: `${operation} failed — snapshot missing or unreadable`,
			why: msg,
			hint: "run `volt init` if this is a new workspace, or delete .volt/ and re-init",
			cause: err,
		});
	}

	// Unknown shape — keep the original message, point at debug + recovery.
	return new VoltError({
		what: `${operation} failed`,
		why: msg,
		hint: "run with --debug for a full trace; if it persists, try `volt pull --force` to rebuild the snapshot",
		cause: err,
	});
}
