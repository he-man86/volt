/**
 * `plc compile` verb — ask the IDE to build, print diagnostics.
 *
 * Exit code 2 = build had errors. Exit code 0 = success (warnings ok).
 * The CLI prints a JSON summary so it's pipeable into tools that want
 * to parse the diagnostics (e.g. shell scripts that fail CI on warnings).
 */
import { formatDiagnostics, runCompile } from "../engine/compile.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const compile: VerbFn = async ({ bridge, flags }) => {
	const r = await runCompile(bridge, { full: flagBool(flags, "full") });
	const summary = {
		success: r.success,
		duration_ms: r.durationMs,
		errors: r.errors,
		warnings: r.warnings,
		...(r.diagnostics.length > 0 && { diagnostics: formatDiagnostics(r.diagnostics) }),
	};
	console.log(JSON.stringify(summary, null, 2));
	return r.errors > 0 ? 2 : 0;
};
