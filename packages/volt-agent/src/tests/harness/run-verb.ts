/**
 * Run a CLI verb directly in-process against a test env.
 *
 * Scenarios use this instead of spawning the real `volt` binary —
 * faster, deterministic, and the test bridge plugs in directly
 * through `VerbContext.bridge`. The verb's exit code is returned
 * untouched so tests assert on the standard `0` / `1` / `2`
 * semantics.
 *
 * Stdout / stderr produced by the verb is captured into the returned
 * object so assertions can match on the user-facing output without
 * spamming the test runner.
 */
import { safeVerb, type VerbFn, type Flags } from "../../cli/_shared.js";
import type { TestEnv } from "./make-test-env.js";

export interface VerbRun {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/**
 * Invoke `verb` against `env` with the given flags. Captures stdout
 * + stderr (and `console.log` output) into the result instead of
 * letting them leak into the test runner.
 *
 * Errors thrown by the verb propagate. Verbs follow the convention
 * of returning a non-zero exit code for refusal cases (drift, policy
 * block) rather than throwing — those land in `result.exitCode`.
 */
export async function runVerb(
	verb: VerbFn,
	env: TestEnv,
	flags: Flags = {},
): Promise<VerbRun> {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];

	const origStdoutWrite = process.stdout.write.bind(process.stdout);
	const origStderrWrite = process.stderr.write.bind(process.stderr);
	const origLog = console.log;
	const origError = console.error;

	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: string | Uint8Array): boolean => {
		stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
		return true;
	}) as typeof process.stderr.write;
	console.log = (...args: unknown[]): void => {
		stdoutChunks.push(args.map(String).join(" ") + "\n");
	};
	console.error = (...args: unknown[]): void => {
		stderrChunks.push(args.map(String).join(" ") + "\n");
	};

	try {
		// Wrap with `safeVerb` so the test sees the SAME error-to-
		// exit-code translation production uses (VoltError → exit 1/2,
		// bridge offline → friendly message + exit 1, etc.).
		const exitCode = await safeVerb(verb, {
			workspace: env.workspace,
			port: 0,
			bridge: env.bridge,
			flags,
		});
		return {
			exitCode,
			stdout: stdoutChunks.join(""),
			stderr: stderrChunks.join(""),
		};
	} finally {
		process.stdout.write = origStdoutWrite;
		process.stderr.write = origStderrWrite;
		console.log = origLog;
		console.error = origError;
	}
}
