/**
 * `volt build` verb — ask the IDE to build, print diagnostics as JSON.
 *
 * Exit code 2 = build had errors. Exit code 0 = success (warnings ok).
 *
 * Output: a single JSON object on stdout. Structured `diagnostics` array
 * (BridgeDiagnostic[]) lets consumers — terminal humans reading the
 * pretty-printed JSON, AI agents parsing it, the VS Code extension
 * mapping into Problems panel — all branch on the same shape without
 * parsing prose. Pretty-printed (2-space indent) so terminal output
 * stays readable; an extra `summary` field gives a markdown render of
 * the diagnostics for humans who want to skim past the JSON noise.
 */
import { formatDiagnostics, runBuild } from "../engine/build.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const build: VerbFn = async ({ bridge, flags }) => {
	const r = await runBuild(bridge, { full: flagBool(flags, "full") });
	const summary = {
		success: r.success,
		duration_ms: r.durationMs,
		errors: r.errors,
		warnings: r.warnings,
		diagnostics: r.diagnostics,
		...(r.diagnostics.length > 0 && { summary: formatDiagnostics(r.diagnostics) }),
	};
	console.log(JSON.stringify(summary, null, 2));
	return r.errors > 0 ? 2 : 0;
};
