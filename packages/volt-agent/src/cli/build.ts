/**
 * `volt build` verb — ask the IDE to build, print diagnostics as JSON.
 *
 * Pure passthrough to the bridge's `/build` endpoint with a small
 * "format for humans" helper. Doesn't touch workspace state — read-only,
 * runnable at any time including on a dirty workspace.
 *
 * Exit code 2 = build had errors. Exit code 0 = success (warnings ok).
 *
 * Output: a single JSON object on stdout. Structured `diagnostics`
 * array (BridgeDiagnostic[]) lets consumers — terminal humans reading
 * the pretty-printed JSON, AI agents parsing it, the VS Code extension
 * mapping into Problems panel — all branch on the same shape without
 * parsing prose. Pretty-printed (2-space indent) so terminal output
 * stays readable; an extra `summary` field gives a markdown render of
 * the diagnostics for humans who want to skim past the JSON noise.
 */
import type { BridgeDiagnostic } from "../bridge/types.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const build: VerbFn = async ({ bridge, flags }) => {
	const full = flagBool(flags, "full");
	const result = await bridge.build({ buildType: full ? "full" : "incremental" });
	const errors = result.diagnostics.filter((d) => d.severity === "error").length;
	const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
	const out = {
		success: result.success,
		duration_ms: result.duration,
		errors,
		warnings,
		diagnostics: result.diagnostics,
		...(result.diagnostics.length > 0 && { summary: formatDiagnostics(result.diagnostics) }),
	};
	console.log(JSON.stringify(out, null, 2));
	return errors > 0 ? 2 : 0;
};

/** Render diagnostics as markdown grouped by affected object. */
function formatDiagnostics(diagnostics: readonly BridgeDiagnostic[]): string {
	if (diagnostics.length === 0) return "";
	const byObject = new Map<string, BridgeDiagnostic[]>();
	for (const d of diagnostics) {
		const key = d.object ?? "<project>";
		const bucket = byObject.get(key) ?? [];
		bucket.push(d);
		byObject.set(key, bucket);
	}
	const lines: string[] = [];
	for (const [object, diags] of byObject) {
		lines.push(`## ${object}`);
		for (const d of diags) {
			const parts: string[] = [];
			if (d.section !== null) parts.push(d.section);
			if (d.line > 0) parts.push(`L${d.line}`);
			const loc = parts.length > 0 ? ` (${parts.join(" ")})` : "";
			lines.push(`- ${d.severity.toUpperCase()}${loc}: ${d.message}`);
		}
	}
	return lines.join("\n");
}
