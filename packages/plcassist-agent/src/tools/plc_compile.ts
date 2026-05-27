/**
 * `plc_compile` MCP tool — ask the IDE to build, return diagnostics.
 *
 * Returns the structured diagnostics array PLUS a human-readable
 * summary. Read-only — doesn't touch workspace or snapshot.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatDiagnostics, runCompile } from "../engine/compile.js";
import {
	commonArgs,
	errorContent,
	jsonContent,
	newBridge,
	resolvePort,
	safeRun,
} from "./_shared.js";

export function registerPlcCompile(server: McpServer): void {
	server.registerTool(
		"plc_compile",
		{
			description:
				"Ask the IDE to build the project. Returns diagnostics (errors + warnings) in a structured shape plus a human-readable summary. Does NOT touch workspace or snapshot — purely a query.",
			inputSchema: {
				...commonArgs,
				full: z
					.boolean()
					.optional()
					.describe("Full rebuild instead of incremental. Slower but catches stale-incremental issues."),
			},
		},
		async (args) => {
			const port = resolvePort(args.port);
			const r = await safeRun(() => runCompile(newBridge(port), { full: args.full }));
			if (!r.ok) return errorContent(r.error);
			return jsonContent({
				status: r.value.success ? "ok" : "failed",
				durationMs: r.value.durationMs,
				errors: r.value.errors,
				warnings: r.value.warnings,
				diagnostics: r.value.diagnostics,
				summary: formatDiagnostics(r.value.diagnostics) || "no diagnostics",
			});
		},
	);
}
