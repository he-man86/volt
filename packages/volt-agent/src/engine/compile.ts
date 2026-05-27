/**
 * `volt compile` — ask the IDE to build, return diagnostics.
 *
 * Pure passthrough to the bridge's /compile endpoint plus a small
 * "format for humans" helper. Doesn't touch workspace state — it's
 * a read-only query you can run at any time, even on a dirty
 * workspace or right after `volt export`.
 */
import { BridgeClient } from "../bridge/client.js";
import type { BridgeDiagnostic, CompileResponse } from "../bridge/types.js";

export interface CompileOptions {
	/** Full rebuild instead of incremental. Slower but catches stale-incremental issues. */
	full?: boolean;
}

export interface CompileSummary {
	success: boolean;
	durationMs: number;
	errors: number;
	warnings: number;
	diagnostics: BridgeDiagnostic[];
}

export async function runCompile(
	bridge: BridgeClient,
	opts: CompileOptions = {},
): Promise<CompileSummary> {
	const result: CompileResponse = await bridge.compile({
		buildType: opts.full === true ? "full" : "incremental",
	});
	return {
		success: result.success,
		durationMs: result.duration,
		errors: result.diagnostics.filter((d) => d.severity === "error").length,
		warnings: result.diagnostics.filter((d) => d.severity === "warning").length,
		diagnostics: result.diagnostics,
	};
}

/**
 * Render a diagnostics list as a markdown-flavoured string grouped by
 * affected object. Used by both the CLI (for stdout) and the MCP tool
 * (for the human-readable `summary` field alongside the structured
 * diagnostics).
 */
export function formatDiagnostics(diagnostics: readonly BridgeDiagnostic[]): string {
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
